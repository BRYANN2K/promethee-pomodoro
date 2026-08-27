// Linux Promethee window helper.
//
// Answers the same bounded contract as the macOS and Windows helpers: `pid`
// resolves the single Promethee process that owns visible windows, `windows`
// prints one `x,y,width,height` record per line, `capture` writes the pixels of
// one re-verified HUD, `click` presses exactly one named control on a window it
// has just re-verified, and the permission commands report what the session
// actually offers.
//
// `capture` and `click` are the two commands here that touch something other
// than this app.
// It carries the same argument-for-argument contract as the macOS helper and
// re-checks every part of it against the live session before it moves anything,
// so a target computed from a stale capture is refused rather than pressed.
//
// Linux adds one command the other platforms have no use for. `attach` places
// this app's own surfaces, and only those: Wayland gives a client no way to
// position its own toplevel, so the compositor has to be asked. It names a
// window only when the compositor reports the helper's own parent process as
// its owner, which keeps the reach of this command inside the app that spawned
// it. Promethee's windows are read and never touched.
//
// Linux has no single window server, so the geometry source is negotiated at
// run time. Wayland compositors deny clients any view of other clients'
// windows, which leaves the compositor's own control socket as the only
// answer; X11 still allows a direct tree walk. The backends are tried in the
// order the session advertises them, and a session that advertises a
// compositor it cannot reach fails closed rather than falling through to a
// backend that would answer for a different display.
//
// Capture and injection are negotiated the same way, and they follow the
// geometry backend rather than choosing for themselves. A Wayland session runs
// an X server too, so both mechanisms are usually reachable at once, and they
// do not describe the same windows: a native Wayland toplevel is not in the X11
// tree at all. Reading pixels through one window server and coordinates through
// the other would be two answers about two different things, so the slot is
// whichever server already answered `windows`.

#include <sys/socket.h>
#include <sys/un.h>
#include <sys/time.h>
#include <unistd.h>

#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/XTest.h>

#include <wayland-client.h>

#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"
#include "xdg-output-unstable-v1-client-protocol.h"
#include "ext-foreign-toplevel-list-v1-client-protocol.h"
#include "ext-image-capture-source-v1-client-protocol.h"
#include "ext-image-copy-capture-v1-client-protocol.h"

#include <sys/mman.h>

#include <cerrno>
#include <csignal>
#include <ctime>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {
constexpr size_t kMaximumWindowRecords = 128;
constexpr size_t kMaximumResponseBytes = 8u * 1024u * 1024u;
constexpr size_t kMaximumJsonDepth = 64;
constexpr int kSocketTimeoutMs = 400;
constexpr int kMaximumX11Depth = 32;
// Promethee publishes no Linux build, so there is no vendor window identity to
// match. What every Electron build does report is the application name, as the
// Wayland app_id and as the X11 class, whatever the binary happens to be called.
// Matching that, and never a window title, keeps discovery independent of how a
// given local build names its windows or its executable.
constexpr std::string_view kPrometheeClass = "promethee";

void receipt(const char* value) {
  std::cout << value << '\n';
}

struct WindowRecord {
  long long x = 0;
  long long y = 0;
  long long width = 0;
  long long height = 0;
  long long processId = 0;
};

bool equalsPrometheeClass(std::string_view value) {
  if (value.size() != kPrometheeClass.size()) return false;
  for (size_t index = 0; index < value.size(); index += 1) {
    char candidate = value[index];
    if (candidate >= 'A' && candidate <= 'Z') candidate = static_cast<char>(candidate - 'A' + 'a');
    if (candidate != kPrometheeClass[index]) return false;
  }
  return true;
}

bool pushRecord(std::vector<WindowRecord>& records, const WindowRecord& record, bool& overflow) {
  if (record.width <= 0 || record.height <= 0 || record.processId <= 0) return false;
  if (records.size() >= kMaximumWindowRecords) {
    overflow = true;
    return false;
  }
  records.push_back(record);
  return true;
}

// ---------------------------------------------------------------- JSON

// Both Wayland backends answer in JSON and nothing else, so the helper needs a
// reader. It is deliberately small and total: every malformed document is a
// parse failure rather than a partial value, and depth is bounded so a hostile
// or corrupted response cannot exhaust the stack.
struct JsonValue;
using JsonArray = std::vector<JsonValue>;
using JsonMember = std::pair<std::string, JsonValue>;

struct JsonValue {
  enum class Type { null, boolean, number, string, array, object };
  Type type = Type::null;
  bool boolean = false;
  double number = 0.0;
  std::string string;
  JsonArray array;
  std::vector<JsonMember> object;
};

class JsonParser {
public:
  explicit JsonParser(const std::string& text) : text_(text) {}

  bool parse(JsonValue& output) {
    skipWhitespace();
    if (!parseValue(output, 0)) return false;
    skipWhitespace();
    return index_ == text_.size();
  }

private:
  const std::string& text_;
  size_t index_ = 0;

  bool atEnd() const { return index_ >= text_.size(); }
  char peek() const { return text_[index_]; }

  void skipWhitespace() {
    while (!atEnd()) {
      const char current = peek();
      if (current != ' ' && current != '\t' && current != '\n' && current != '\r') break;
      index_ += 1;
    }
  }

  bool expect(char expected) {
    if (atEnd() || peek() != expected) return false;
    index_ += 1;
    return true;
  }

  bool literal(std::string_view word) {
    if (text_.compare(index_, word.size(), word) != 0) return false;
    index_ += word.size();
    return true;
  }

  bool parseValue(JsonValue& output, size_t depth) {
    if (depth > kMaximumJsonDepth || atEnd()) return false;
    switch (peek()) {
      case '{': return parseObject(output, depth);
      case '[': return parseArray(output, depth);
      case '"':
        output.type = JsonValue::Type::string;
        return parseString(output.string);
      case 't':
        if (!literal("true")) return false;
        output.type = JsonValue::Type::boolean;
        output.boolean = true;
        return true;
      case 'f':
        if (!literal("false")) return false;
        output.type = JsonValue::Type::boolean;
        output.boolean = false;
        return true;
      case 'n':
        if (!literal("null")) return false;
        output.type = JsonValue::Type::null;
        return true;
      default: return parseNumber(output);
    }
  }

  bool parseObject(JsonValue& output, size_t depth) {
    if (!expect('{')) return false;
    output.type = JsonValue::Type::object;
    skipWhitespace();
    if (expect('}')) return true;
    for (;;) {
      skipWhitespace();
      JsonMember member;
      if (!parseString(member.first)) return false;
      skipWhitespace();
      if (!expect(':')) return false;
      skipWhitespace();
      if (!parseValue(member.second, depth + 1)) return false;
      output.object.push_back(std::move(member));
      skipWhitespace();
      if (expect(',')) continue;
      return expect('}');
    }
  }

  bool parseArray(JsonValue& output, size_t depth) {
    if (!expect('[')) return false;
    output.type = JsonValue::Type::array;
    skipWhitespace();
    if (expect(']')) return true;
    for (;;) {
      skipWhitespace();
      JsonValue element;
      if (!parseValue(element, depth + 1)) return false;
      output.array.push_back(std::move(element));
      skipWhitespace();
      if (expect(',')) continue;
      return expect(']');
    }
  }

  bool parseString(std::string& output) {
    if (!expect('"')) return false;
    output.clear();
    while (!atEnd()) {
      const char current = text_[index_];
      index_ += 1;
      if (current == '"') return true;
      if (current != '\\') {
        output.push_back(current);
        continue;
      }
      if (atEnd()) return false;
      const char escaped = text_[index_];
      index_ += 1;
      switch (escaped) {
        case '"': output.push_back('"'); break;
        case '\\': output.push_back('\\'); break;
        case '/': output.push_back('/'); break;
        case 'b': output.push_back('\b'); break;
        case 'f': output.push_back('\f'); break;
        case 'n': output.push_back('\n'); break;
        case 'r': output.push_back('\r'); break;
        case 't': output.push_back('\t'); break;
        case 'u': {
          // The only escaped text this helper compares is the title of a window
          // this app named itself, and it asks for those by the same bytes it
          // gave them. An escape therefore has to be consumed to keep the
          // document in step, and a placeholder is enough to stand for it.
          if (index_ + 4 > text_.size()) return false;
          index_ += 4;
          output.push_back('?');
          break;
        }
        default: return false;
      }
    }
    return false;
  }

  bool parseNumber(JsonValue& output) {
    const size_t start = index_;
    if (!atEnd() && (peek() == '-' || peek() == '+')) index_ += 1;
    bool digits = false;
    while (!atEnd()) {
      const char current = peek();
      const bool numeric = (current >= '0' && current <= '9') || current == '.' ||
        current == 'e' || current == 'E' || current == '+' || current == '-';
      if (!numeric) break;
      digits = digits || (current >= '0' && current <= '9');
      index_ += 1;
    }
    if (!digits) return false;
    const std::string token = text_.substr(start, index_ - start);
    errno = 0;
    char* end = nullptr;
    const double parsed = std::strtod(token.c_str(), &end);
    if (errno != 0 || end == token.c_str() || *end != '\0') return false;
    output.type = JsonValue::Type::number;
    output.number = parsed;
    return true;
  }
};

const JsonValue* member(const JsonValue& value, std::string_view name) {
  if (value.type != JsonValue::Type::object) return nullptr;
  for (const JsonMember& entry : value.object) {
    if (entry.first == name) return &entry.second;
  }
  return nullptr;
}

bool integerOf(const JsonValue& value, long long& output) {
  if (value.type != JsonValue::Type::number) return false;
  if (!std::isfinite(value.number) || std::trunc(value.number) != value.number) return false;
  if (value.number < -9007199254740992.0 || value.number > 9007199254740992.0) return false;
  output = static_cast<long long>(value.number);
  return true;
}

bool integerMember(const JsonValue& value, std::string_view name, long long& output) {
  const JsonValue* found = member(value, name);
  return found != nullptr && integerOf(*found, output);
}

bool stringMember(const JsonValue& value, std::string_view name, std::string_view& output) {
  const JsonValue* found = member(value, name);
  if (found == nullptr || found->type != JsonValue::Type::string) return false;
  output = found->string;
  return true;
}

// A missing flag is not a denial: fields appear and disappear across
// compositor releases, and treating an absent one as false would hide every
// window the day the key is renamed.
bool booleanMemberOrDefault(const JsonValue& value, std::string_view name, bool fallback) {
  const JsonValue* found = member(value, name);
  if (found == nullptr || found->type != JsonValue::Type::boolean) return fallback;
  return found->boolean;
}

bool integerPair(const JsonValue& value, std::string_view name, long long& first, long long& second) {
  const JsonValue* found = member(value, name);
  if (found == nullptr || found->type != JsonValue::Type::array || found->array.size() != 2) return false;
  return integerOf(found->array[0], first) && integerOf(found->array[1], second);
}

// ---------------------------------------------------------------- sockets

enum class BackendStatus { unavailable, ok, error };

int connectUnixSocket(const std::string& socketPath) {
  if (socketPath.empty()) return -1;
  sockaddr_un address{};
  if (socketPath.size() >= sizeof(address.sun_path)) return -1;
  const int descriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (descriptor < 0) return -1;

  timeval timeout{};
  timeout.tv_sec = kSocketTimeoutMs / 1000;
  timeout.tv_usec = (kSocketTimeoutMs % 1000) * 1000;
  setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

  address.sun_family = AF_UNIX;
  std::memcpy(address.sun_path, socketPath.c_str(), socketPath.size());
  if (connect(descriptor, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0) {
    close(descriptor);
    return -1;
  }
  return descriptor;
}

bool writeAll(int descriptor, const void* data, size_t length) {
  const char* cursor = static_cast<const char*>(data);
  size_t remaining = length;
  while (remaining > 0) {
    const ssize_t written = send(descriptor, cursor, remaining, MSG_NOSIGNAL);
    if (written < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (written == 0) return false;
    cursor += written;
    remaining -= static_cast<size_t>(written);
  }
  return true;
}

bool readExactly(int descriptor, void* data, size_t length) {
  char* cursor = static_cast<char*>(data);
  size_t remaining = length;
  while (remaining > 0) {
    const ssize_t received = recv(descriptor, cursor, remaining, 0);
    if (received < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (received == 0) return false;
    cursor += received;
    remaining -= static_cast<size_t>(received);
  }
  return true;
}

bool readUntilEndOfStream(int descriptor, std::string& output) {
  char buffer[65536];
  for (;;) {
    const ssize_t received = recv(descriptor, buffer, sizeof(buffer), 0);
    if (received < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (received == 0) return true;
    if (output.size() + static_cast<size_t>(received) > kMaximumResponseBytes) return false;
    output.append(buffer, static_cast<size_t>(received));
  }
}

std::string environmentValue(const char* name) {
  const char* value = std::getenv(name);
  return value == nullptr ? std::string() : std::string(value);
}

// ---------------------------------------------------------------- Hyprland

// Hyprland answers one request per connection and closes, so the reply is
// everything up to end of stream.
bool hyprlandRequest(const std::string& socketPath, std::string_view request, std::string& response) {
  const int descriptor = connectUnixSocket(socketPath);
  if (descriptor < 0) return false;
  const bool exchanged = writeAll(descriptor, request.data(), request.size()) &&
    readUntilEndOfStream(descriptor, response);
  close(descriptor);
  return exchanged;
}

std::vector<std::string> hyprlandSocketCandidates(const std::string& signature) {
  std::vector<std::string> candidates;
  if (signature.empty()) return candidates;
  const std::string runtimeDirectory = environmentValue("XDG_RUNTIME_DIR");
  if (!runtimeDirectory.empty()) {
    candidates.push_back(runtimeDirectory + "/hypr/" + signature + "/.socket.sock");
  }
  candidates.push_back("/tmp/hypr/" + signature + "/.socket.sock");
  return candidates;
}

// The socket path is not knowable in advance, so the first candidate that
// answers is the session's own socket and every later request reuses it.
bool hyprlandExchange(std::string& socketPath, std::string_view request, std::string& response) {
  if (!socketPath.empty()) return hyprlandRequest(socketPath, request, response);
  for (const std::string& candidate : hyprlandSocketCandidates(environmentValue("HYPRLAND_INSTANCE_SIGNATURE"))) {
    response.clear();
    if (hyprlandRequest(candidate, request, response)) {
      socketPath = candidate;
      return true;
    }
  }
  return false;
}

BackendStatus collectFromHyprland(std::vector<WindowRecord>& records, bool& overflow) {
  if (environmentValue("HYPRLAND_INSTANCE_SIGNATURE").empty()) return BackendStatus::unavailable;

  std::string socketPath;
  std::string response;
  // The session says it is Hyprland. If its socket cannot be reached, the
  // honest answer is a failure, not a walk of some other display's tree.
  if (!hyprlandExchange(socketPath, "j/clients", response)) return BackendStatus::error;

  JsonValue document;
  if (!JsonParser(response).parse(document) || document.type != JsonValue::Type::array) {
    return BackendStatus::error;
  }

  for (const JsonValue& client : document.array) {
    std::string_view className;
    if (!stringMember(client, "class", className) || !equalsPrometheeClass(className)) continue;
    if (!booleanMemberOrDefault(client, "mapped", true)) continue;
    if (booleanMemberOrDefault(client, "hidden", false)) continue;

    WindowRecord record;
    if (!integerPair(client, "at", record.x, record.y)) continue;
    if (!integerPair(client, "size", record.width, record.height)) continue;
    if (!integerMember(client, "pid", record.processId)) continue;
    pushRecord(records, record, overflow);
    if (overflow) return BackendStatus::error;
  }
  return BackendStatus::ok;
}

// ---------------------------------------------------------------- Sway

// Sway speaks the i3 IPC framing: a fixed magic, then a native-endian length
// and type, in both directions.
constexpr std::string_view kSwayMagic = "i3-ipc";
constexpr uint32_t kSwayRunCommand = 0;
constexpr uint32_t kSwayGetTree = 4;

bool swayRequest(
  const std::string& socketPath,
  uint32_t messageType,
  std::string_view payload,
  std::string& response
) {
  const int descriptor = connectUnixSocket(socketPath);
  if (descriptor < 0) return false;

  char header[14];
  std::memcpy(header, kSwayMagic.data(), kSwayMagic.size());
  const uint32_t payloadLength = static_cast<uint32_t>(payload.size());
  std::memcpy(header + 6, &payloadLength, sizeof(payloadLength));
  std::memcpy(header + 10, &messageType, sizeof(messageType));

  bool exchanged = false;
  if (writeAll(descriptor, header, sizeof(header)) &&
      (payload.empty() || writeAll(descriptor, payload.data(), payload.size()))) {
    char replyHeader[14];
    if (readExactly(descriptor, replyHeader, sizeof(replyHeader)) &&
        std::memcmp(replyHeader, kSwayMagic.data(), kSwayMagic.size()) == 0) {
      uint32_t replyLength = 0;
      std::memcpy(&replyLength, replyHeader + 6, sizeof(replyLength));
      if (replyLength <= kMaximumResponseBytes) {
        response.assign(replyLength, '\0');
        exchanged = replyLength == 0 || readExactly(descriptor, response.data(), replyLength);
      }
    }
  }
  close(descriptor);
  return exchanged;
}

bool swayNodeIsPromethee(const JsonValue& node) {
  std::string_view identifier;
  if (stringMember(node, "app_id", identifier) && equalsPrometheeClass(identifier)) return true;
  const JsonValue* properties = member(node, "window_properties");
  if (properties == nullptr) return false;
  // An XWayland client has no app_id; its class arrives under window_properties.
  return stringMember(*properties, "class", identifier) && equalsPrometheeClass(identifier);
}

void collectSwayNode(const JsonValue& node, std::vector<WindowRecord>& records, bool& overflow, size_t depth) {
  if (overflow || depth > kMaximumJsonDepth || node.type != JsonValue::Type::object) return;

  if (swayNodeIsPromethee(node) && booleanMemberOrDefault(node, "visible", true)) {
    const JsonValue* rect = member(node, "rect");
    WindowRecord record;
    if (rect != nullptr &&
        integerMember(*rect, "x", record.x) &&
        integerMember(*rect, "y", record.y) &&
        integerMember(*rect, "width", record.width) &&
        integerMember(*rect, "height", record.height) &&
        integerMember(node, "pid", record.processId)) {
      pushRecord(records, record, overflow);
      if (overflow) return;
    }
  }

  for (std::string_view branch : {"nodes", "floating_nodes"}) {
    const JsonValue* children = member(node, branch);
    if (children == nullptr || children->type != JsonValue::Type::array) continue;
    for (const JsonValue& child : children->array) {
      collectSwayNode(child, records, overflow, depth + 1);
      if (overflow) return;
    }
  }
}

BackendStatus collectFromSway(std::vector<WindowRecord>& records, bool& overflow) {
  const std::string socketPath = environmentValue("SWAYSOCK");
  if (socketPath.empty()) return BackendStatus::unavailable;

  std::string response;
  if (!swayRequest(socketPath, kSwayGetTree, {}, response)) return BackendStatus::error;

  JsonValue document;
  if (!JsonParser(response).parse(document)) return BackendStatus::error;
  collectSwayNode(document, records, overflow, 0);
  return overflow ? BackendStatus::error : BackendStatus::ok;
}

// ---------------------------------------------------------------- X11

bool x11ProcessId(Display* display, Window window, Atom pidAtom, long long& output) {
  if (pidAtom == None) return false;
  Atom actualType = None;
  int actualFormat = 0;
  unsigned long itemCount = 0;
  unsigned long remainingBytes = 0;
  unsigned char* data = nullptr;
  const int status = XGetWindowProperty(
    display, window, pidAtom, 0, 1, False, XA_CARDINAL,
    &actualType, &actualFormat, &itemCount, &remainingBytes, &data
  );
  if (status != Success) return false;
  bool resolved = false;
  if (data != nullptr && actualType == XA_CARDINAL && actualFormat == 32 && itemCount >= 1) {
    output = static_cast<long long>(*reinterpret_cast<unsigned long*>(data));
    resolved = output > 0;
  }
  if (data != nullptr) XFree(data);
  return resolved;
}

bool x11IsPromethee(Display* display, Window window) {
  XClassHint classHint{};
  if (XGetClassHint(display, window, &classHint) == 0) return false;
  const bool matched =
    (classHint.res_class != nullptr && equalsPrometheeClass(classHint.res_class)) ||
    (classHint.res_name != nullptr && equalsPrometheeClass(classHint.res_name));
  if (classHint.res_class != nullptr) XFree(classHint.res_class);
  if (classHint.res_name != nullptr) XFree(classHint.res_name);
  return matched;
}

void collectX11Tree(
  Display* display,
  Window root,
  Window window,
  Atom pidAtom,
  std::vector<WindowRecord>& records,
  bool& overflow,
  int depth
) {
  if (overflow || depth > kMaximumX11Depth) return;

  XWindowAttributes attributes{};
  if (XGetWindowAttributes(display, window, &attributes) != 0 &&
      attributes.map_state == IsViewable &&
      attributes.width > 0 &&
      attributes.height > 0 &&
      x11IsPromethee(display, window)) {
    WindowRecord record;
    int absoluteX = 0;
    int absoluteY = 0;
    Window ignored = None;
    // A reparenting window manager puts the client inside a frame, so the
    // client's own x/y are relative to that frame rather than to the screen.
    if (XTranslateCoordinates(display, window, root, 0, 0, &absoluteX, &absoluteY, &ignored) != 0 &&
        x11ProcessId(display, window, pidAtom, record.processId)) {
      record.x = absoluteX;
      record.y = absoluteY;
      record.width = attributes.width;
      record.height = attributes.height;
      pushRecord(records, record, overflow);
      if (overflow) return;
    }
  }

  Window resolvedRoot = None;
  Window parent = None;
  Window* children = nullptr;
  unsigned int childCount = 0;
  if (XQueryTree(display, window, &resolvedRoot, &parent, &children, &childCount) == 0) return;
  if (children != nullptr) {
    for (unsigned int index = 0; index < childCount && !overflow; index += 1) {
      collectX11Tree(display, root, children[index], pidAtom, records, overflow, depth + 1);
    }
    XFree(children);
  }
}

// Xlib's default handler prints and calls exit, so a window that closes between
// the tree walk finding it and this helper asking about it would end the process
// instead of the walk. Every X call in the tree walk already reports its own
// failure, so there the error is dropped and the window is simply one this
// helper does not describe.
//
// Capture cannot be that relaxed. Half of what it asks for fails asynchronously:
// naming a pixmap for a window nobody redirected succeeds locally and reports a
// `BadMatch` later, leaving an identifier that names nothing. So the handler
// also records that something failed, and the capture path reads that record
// back after each step instead of trusting the identifier it was handed.
bool gX11ErrorSeen = false;

int ignoreX11Error(Display*, XErrorEvent*) {
  gX11ErrorSeen = true;
  return 0;
}

// Errors arrive when the server gets round to sending them, so the flag means
// nothing until the request that would have caused one has been answered. The
// sync is what makes reading it a question about the step that just ran.
bool takeX11Error(Display* display) {
  XSync(display, False);
  const bool seen = gX11ErrorSeen;
  gX11ErrorSeen = false;
  return seen;
}

BackendStatus collectFromX11(std::vector<WindowRecord>& records, bool& overflow) {
  if (environmentValue("DISPLAY").empty()) return BackendStatus::unavailable;
  XSetErrorHandler(ignoreX11Error);
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr) return BackendStatus::error;
  const Atom pidAtom = XInternAtom(display, "_NET_WM_PID", True);
  const Window root = DefaultRootWindow(display);
  collectX11Tree(display, root, root, pidAtom, records, overflow, 0);
  XCloseDisplay(display);
  return overflow ? BackendStatus::error : BackendStatus::ok;
}

// True exactly when the tree walk above is the backend `windows` reached, which
// is the same thing as saying the X server is this session's window server. It
// is written as the conditions of the two backends ahead of it rather than as a
// question about X11, because that is what makes the two orders one order: a
// session whose geometry came from a compositor socket must not have its pixels
// read from an X server that never saw those windows.
//
// i3 is one of the sessions this answers true for, since discovery reaches it
// through the tree walk and not through its socket. That is deliberate and it
// grants nothing: reading is not acting, and the separate refusal below still
// keeps i3 from being pressed.
bool sessionUsesX11Slots() {
  return environmentValue("HYPRLAND_INSTANCE_SIGNATURE").empty() &&
         environmentValue("SWAYSOCK").empty() &&
         !environmentValue("DISPLAY").empty();
}

// ------------------------------------------------------- Wayland pointer

// The core Wayland protocol gives a client no way to synthesise input, and that
// is deliberate: a compositor that let any client move the seat pointer would
// let any client drive every other window. Every mechanism that does exist is
// an extension, and none of them is on every session, so which one answers is
// decided at run time. This is the first of the three slots ADR-0021 names, the
// wlroots one, and the only one with live evidence behind it.
//
// Where it exists it is unprivileged: no prompt, no grant, and nothing in system
// settings to revoke afterwards. That is the reason the app collects consent
// itself instead of leaning on one the system would have collected for it.
constexpr size_t kMaximumOutputs = 16;
// BTN_LEFT, from linux/input-event-codes.h. Spelled out here rather than
// included, because that header brings in the whole input vocabulary for one
// number this file will never need a second value from.
constexpr uint32_t kLeftButtonCode = 0x110;
constexpr long kPressHoldNanoseconds = 12L * 1000L * 1000L;
constexpr long kReleaseSettleNanoseconds = 50L * 1000L * 1000L;

// The socket timeout above bounds one wait, not a command. A click waits on the
// display eight separate times, so a compositor that answers each one just
// slowly enough runs the helper long past the moment its caller gave up on it,
// and what the caller then kills is a process holding a mouse button down. So a
// click carries one deadline for the whole run and spends what is left of it on
// each wait. The run ends on its own terms, inside the window the caller waits,
// and the release always gets sent.
constexpr long long kClickDeadlineMs = 1200;
// What the release is granted even by a deadline that has already run out. A
// press that never got its release leaves the user's session with a button held
// down over somebody else's window, which is worse than any late answer.
constexpr long long kReleaseGraceMs = 250;
// The same bound for the read. A capture has no button to put back, so it owes
// itself no grace, but it waits in three loops that turn on an event arriving
// rather than on a count of round trips, and a compositor that keeps answering
// without ever sending the one being waited for would hold every one of them
// open for as long as it liked. The deadline is what ends those loops.
constexpr long long kCaptureDeadlineMs = 900;

long long monotonicMilliseconds() {
  timespec moment{};
  clock_gettime(CLOCK_MONOTONIC, &moment);
  return static_cast<long long>(moment.tv_sec) * 1000 + moment.tv_nsec / 1000000;
}

struct Deadline {
  long long endMs = 0;
  long long remainingMs() const { return endMs - monotonicMilliseconds(); }
};

Deadline deadlineIn(long long milliseconds) {
  return Deadline{ monotonicMilliseconds() + milliseconds };
}

// A signal that would otherwise arrive as a kill is noted rather than obeyed, so
// a run already holding a button down gets to put it back up first. The handler
// touches nothing but this flag, and it is installed without SA_RESTART so the
// wait the helper is sitting in returns instead of resuming.
volatile sig_atomic_t gInterrupted = 0;

void noteInterruption(int) { gInterrupted = 1; }

void watchForInterruption() {
  struct sigaction handler {};
  handler.sa_handler = noteInterruption;
  sigemptyset(&handler.sa_mask);
  handler.sa_flags = 0;
  sigaction(SIGTERM, &handler, nullptr);
  sigaction(SIGINT, &handler, nullptr);
  sigaction(SIGHUP, &handler, nullptr);
}

// Never zero, because a zero timeout on a socket means no timeout at all rather
// than one that has already run out, and never longer than the single-wait bound
// the rest of the file uses.
void budgetDisplayWait(wl_display* display, long long milliseconds) {
  if (milliseconds < 1) milliseconds = 1;
  if (milliseconds > kSocketTimeoutMs) milliseconds = kSocketTimeoutMs;
  timeval timeout{};
  timeout.tv_sec = static_cast<time_t>(milliseconds / 1000);
  timeout.tv_usec = static_cast<suseconds_t>((milliseconds % 1000) * 1000);
  const int descriptor = wl_display_get_fd(display);
  setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
}

bool roundtripWithin(wl_display* display, const Deadline& deadline) {
  budgetDisplayWait(display, deadline.remainingMs());
  return wl_display_roundtrip(display) >= 0;
}

struct OutputRecord {
  wl_output* output = nullptr;
  zxdg_output_v1* xdgOutput = nullptr;
  int32_t logicalX = 0;
  int32_t logicalY = 0;
  int32_t logicalWidth = 0;
  int32_t logicalHeight = 0;
  bool hasPosition = false;
  bool hasSize = false;
};

struct PointerSession {
  wl_display* display = nullptr;
  wl_registry* registry = nullptr;
  wl_seat* seat = nullptr;
  zwlr_virtual_pointer_manager_v1* manager = nullptr;
  zxdg_output_manager_v1* outputManager = nullptr;
  std::vector<OutputRecord> outputs;
};

void xdgOutputLogicalPosition(void* data, zxdg_output_v1*, int32_t x, int32_t y) {
  OutputRecord* record = static_cast<OutputRecord*>(data);
  record->logicalX = x;
  record->logicalY = y;
  record->hasPosition = true;
}

void xdgOutputLogicalSize(void* data, zxdg_output_v1*, int32_t width, int32_t height) {
  OutputRecord* record = static_cast<OutputRecord*>(data);
  record->logicalWidth = width;
  record->logicalHeight = height;
  record->hasSize = true;
}

void xdgOutputDone(void*, zxdg_output_v1*) {}
void xdgOutputName(void*, zxdg_output_v1*, const char*) {}
void xdgOutputDescription(void*, zxdg_output_v1*, const char*) {}

const zxdg_output_v1_listener kXdgOutputListener = {
  xdgOutputLogicalPosition,
  xdgOutputLogicalSize,
  xdgOutputDone,
  xdgOutputName,
  xdgOutputDescription
};

void registryGlobal(void* data, wl_registry* registry, uint32_t name, const char* interface, uint32_t version) {
  PointerSession* session = static_cast<PointerSession*>(data);
  const std::string_view advertised = interface;
  if (advertised == wl_seat_interface.name && session->seat == nullptr) {
    session->seat = static_cast<wl_seat*>(
      wl_registry_bind(registry, name, &wl_seat_interface, version < 7 ? version : 7));
    return;
  }
  if (advertised == zwlr_virtual_pointer_manager_v1_interface.name && session->manager == nullptr) {
    session->manager = static_cast<zwlr_virtual_pointer_manager_v1*>(
      wl_registry_bind(registry, name, &zwlr_virtual_pointer_manager_v1_interface, version < 2 ? version : 2));
    return;
  }
  if (advertised == zxdg_output_manager_v1_interface.name && session->outputManager == nullptr) {
    session->outputManager = static_cast<zxdg_output_manager_v1*>(
      wl_registry_bind(registry, name, &zxdg_output_manager_v1_interface, version < 3 ? version : 3));
    return;
  }
  // The listener for each output is attached only once every global has
  // arrived, so this vector may still move underneath itself here and the
  // records must not be pointed at yet.
  if (advertised == wl_output_interface.name && session->outputs.size() < kMaximumOutputs) {
    OutputRecord record;
    record.output = static_cast<wl_output*>(
      wl_registry_bind(registry, name, &wl_output_interface, version < 4 ? version : 4));
    if (record.output != nullptr) session->outputs.push_back(record);
  }
}

void registryGlobalRemove(void*, wl_registry*, uint32_t) {}

const wl_registry_listener kRegistryListener = { registryGlobal, registryGlobalRemove };

void closePointerSession(PointerSession& session) {
  for (OutputRecord& record : session.outputs) {
    if (record.xdgOutput != nullptr) zxdg_output_v1_destroy(record.xdgOutput);
    if (record.output != nullptr) wl_output_destroy(record.output);
  }
  session.outputs.clear();
  if (session.outputManager != nullptr) zxdg_output_manager_v1_destroy(session.outputManager);
  if (session.manager != nullptr) zwlr_virtual_pointer_manager_v1_destroy(session.manager);
  if (session.seat != nullptr) wl_seat_destroy(session.seat);
  if (session.registry != nullptr) wl_registry_destroy(session.registry);
  if (session.display != nullptr) wl_display_disconnect(session.display);
  session.display = nullptr;
  session.registry = nullptr;
  session.seat = nullptr;
  session.manager = nullptr;
  session.outputManager = nullptr;
}

// Every other socket in this file is bounded, and the display connection is
// bounded the same way: a compositor that stops answering makes a roundtrip
// fail rather than making the helper hang until its caller gives up on it.
bool openPointerSession(PointerSession& session, const Deadline& deadline) {
  session.display = wl_display_connect(nullptr);
  if (session.display == nullptr) return false;

  session.registry = wl_display_get_registry(session.display);
  if (session.registry == nullptr) { closePointerSession(session); return false; }
  wl_registry_add_listener(session.registry, &kRegistryListener, &session);
  // The first roundtrip delivers the globals, the second whatever the binds
  // made during the first have to say for themselves. Both come out of the one
  // deadline the whole run is spending.
  if (!roundtripWithin(session.display, deadline) || !roundtripWithin(session.display, deadline)) {
    closePointerSession(session);
    return false;
  }
  if (session.outputManager == nullptr) return true;
  for (OutputRecord& record : session.outputs) {
    record.xdgOutput = zxdg_output_manager_v1_get_xdg_output(session.outputManager, record.output);
    if (record.xdgOutput != nullptr) {
      zxdg_output_v1_add_listener(record.xdgOutput, &kXdgOutputListener, &record);
    }
  }
  if (!roundtripWithin(session.display, deadline) || !roundtripWithin(session.display, deadline)) {
    closePointerSession(session);
    return false;
  }
  return true;
}

bool pointerSessionUsable(const PointerSession& session) {
  return session.manager != nullptr && session.seat != nullptr &&
    session.outputManager != nullptr && !session.outputs.empty();
}

// Global coordinates are the compositor's own layout, which is what xdg-output
// reports and what the core request does not: Hyprland answers wl_output.geometry
// with 0,0 for every output it has, so a reading taken from there would put every
// point on whichever monitor enumerated first.
const OutputRecord* outputContaining(const PointerSession& session, long long x, long long y) {
  for (const OutputRecord& record : session.outputs) {
    if (!record.hasPosition || !record.hasSize) continue;
    if (record.logicalWidth <= 0 || record.logicalHeight <= 0) continue;
    if (x < record.logicalX || x >= record.logicalX + record.logicalWidth) continue;
    if (y < record.logicalY || y >= record.logicalY + record.logicalHeight) continue;
    return &record;
  }
  return nullptr;
}

uint32_t nowMilliseconds() {
  return static_cast<uint32_t>(monotonicMilliseconds());
}

void sleepFor(long nanoseconds) {
  timespec request{};
  request.tv_nsec = nanoseconds;
  nanosleep(&request, nullptr);
}

enum class InjectionOutcome { clicked, unsupported, offScreen, failed };

// The pointer is not put back where it was. The macOS helper reads the cursor
// position before it moves it and restores it after, and Wayland gives a client
// no way to ask where the pointer is, so on this slot there is nothing to
// restore it to. The cursor is left parked on the control it pressed. That is a
// real difference in what the two platforms do to the user's session, so the
// consent copy says it outright rather than letting it arrive as a surprise.
InjectionOutcome clickThroughVirtualPointer(long long targetX, long long targetY) {
  const Deadline deadline = deadlineIn(kClickDeadlineMs);
  PointerSession session;
  if (!openPointerSession(session, deadline)) return InjectionOutcome::unsupported;
  if (!pointerSessionUsable(session)) {
    closePointerSession(session);
    return InjectionOutcome::unsupported;
  }

  const OutputRecord* chosen = outputContaining(session, targetX, targetY);
  if (chosen == nullptr) {
    closePointerSession(session);
    return InjectionOutcome::offScreen;
  }

  zwlr_virtual_pointer_v1* pointer = zwlr_virtual_pointer_manager_v1_create_virtual_pointer_with_output(
    session.manager, session.seat, chosen->output);
  if (pointer == nullptr) {
    closePointerSession(session);
    return InjectionOutcome::failed;
  }

  // A virtual pointer belongs to one output, so absolute motion is output-local
  // and is scaled against an extent the client names. The point was read out of
  // the logical layout, so the logical size is the extent it is expressed in.
  const uint32_t localX = static_cast<uint32_t>(targetX - chosen->logicalX);
  const uint32_t localY = static_cast<uint32_t>(targetY - chosen->logicalY);
  const uint32_t extentX = static_cast<uint32_t>(chosen->logicalWidth);
  const uint32_t extentY = static_cast<uint32_t>(chosen->logicalHeight);

  zwlr_virtual_pointer_v1_motion_absolute(pointer, nowMilliseconds(), localX, localY, extentX, extentY);
  zwlr_virtual_pointer_v1_frame(pointer);
  bool delivered = roundtripWithin(session.display, deadline);

  // What decides whether the release is owed is whether the press was written,
  // not whether it was acknowledged. A press whose roundtrip timed out may well
  // have reached the compositor, so the button is put back up either way, and a
  // signal that arrived in the meantime is answered after the release rather
  // than instead of it.
  bool pressed = false;
  if (delivered && gInterrupted == 0) {
    zwlr_virtual_pointer_v1_button(
      pointer, nowMilliseconds(), kLeftButtonCode, WL_POINTER_BUTTON_STATE_PRESSED);
    zwlr_virtual_pointer_v1_frame(pointer);
    pressed = true;
    delivered = roundtripWithin(session.display, deadline);
  }
  if (pressed) {
    sleepFor(kPressHoldNanoseconds);
    zwlr_virtual_pointer_v1_button(
      pointer, nowMilliseconds(), kLeftButtonCode, WL_POINTER_BUTTON_STATE_RELEASED);
    zwlr_virtual_pointer_v1_frame(pointer);
    delivered = roundtripWithin(session.display, deadlineIn(kReleaseGraceMs)) && delivered;
    sleepFor(kReleaseSettleNanoseconds);
  }

  zwlr_virtual_pointer_v1_destroy(pointer);
  roundtripWithin(session.display, deadlineIn(kReleaseGraceMs));
  closePointerSession(session);
  return delivered && gInterrupted == 0 ? InjectionOutcome::clicked : InjectionOutcome::failed;
}

// ----------------------------------------------------------- X11 pointer

// The third slot ADR-0021 names. X11 predates the idea that one client driving
// another is worth preventing, so the mechanism is old, unprivileged and always
// the same one: XTest, which any client that can open the display may use. There
// is no prompt and nothing to revoke, exactly as on the wlroots slot, so consent
// is collected in the app on both.
bool x11InjectionSlotPresent(Display* display) {
  int eventBase = 0;
  int errorBase = 0;
  int major = 0;
  int minor = 0;
  return XTestQueryExtension(display, &eventBase, &errorBase, &major, &minor) == True;
}

// The pointer is left where it was put, the same as on the wlroots slot. X11
// would allow better: `XQueryPointer` reads the cursor, so this slot could put
// it back, which is what the macOS helper does. It does not, because the user
// was told once, before any of this ran, that automation leaves the pointer on
// the control it pressed, and one sentence that is true of every Linux session
// is worth more than a slot that quietly behaves better than its own consent
// copy. Changing it means changing that copy first.
InjectionOutcome clickThroughXTest(long long targetX, long long targetY) {
  XSetErrorHandler(ignoreX11Error);
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr) return InjectionOutcome::unsupported;
  if (!x11InjectionSlotPresent(display)) {
    XCloseDisplay(display);
    return InjectionOutcome::unsupported;
  }

  // Xinerama and RandR both report one root window spanning every monitor, so
  // the screen this point has to fall inside is that root and not a display of
  // its own. A point outside it came from a layout this session no longer has.
  const int screen = DefaultScreen(display);
  const long long screenWidth = XDisplayWidth(display, screen);
  const long long screenHeight = XDisplayHeight(display, screen);
  if (targetX < 0 || targetY < 0 || targetX >= screenWidth || targetY >= screenHeight) {
    XCloseDisplay(display);
    return InjectionOutcome::offScreen;
  }

  takeX11Error(display);
  XTestFakeMotionEvent(display, screen, static_cast<int>(targetX), static_cast<int>(targetY), 0);
  bool delivered = !takeX11Error(display);

  // As on the Wayland slot, the release is owed the moment the press was sent
  // rather than the moment it was seen to succeed. An X server that refused the
  // press has nothing to put back up, but one that took it and then reported an
  // error on something else would otherwise be left holding the button.
  bool pressed = false;
  if (delivered) {
    XTestFakeButtonEvent(display, Button1, True, 0);
    pressed = true;
    delivered = !takeX11Error(display);
  }
  if (pressed) {
    sleepFor(kPressHoldNanoseconds);
    XTestFakeButtonEvent(display, Button1, False, 0);
    delivered = !takeX11Error(display) && delivered;
    sleepFor(kReleaseSettleNanoseconds);
  }

  XCloseDisplay(display);
  return delivered && gInterrupted == 0 ? InjectionOutcome::clicked : InjectionOutcome::failed;
}

// ------------------------------------------------------- Wayland capture

// The macOS helper does not have this command, because macOS has a screenshot
// tool that any process may point at a rectangle. Linux has nothing of the sort,
// for the same reason it has no way to enumerate another client's windows, so
// the pixels come from a protocol extension and the session decides whether one
// is there to answer.
//
// What is captured is the HUD's own surface, not the screen region it sits on,
// and that distinction is the whole of why this slot exists at all. Promethee's
// HUD is translucent: a rectangle read off the screen carries whatever is behind
// it, and the classifier's flatness gates cannot tell such a raster from a valid
// one on thresholds alone. `ext-image-copy-capture-v1` sourced from an
// `ext-foreign-toplevel-list-v1` handle returns the surface, alpha intact and
// nothing of the desktop in it, which is the raster the classifier was written
// for. It is also the sanctioned protocol rather than a compositor's own, so a
// slot built on it reaches wlroots, Hyprland and KDE with one implementation.
constexpr size_t kMaximumToplevels = 64;
// The largest HUD the classifier will accept, which is also the largest buffer
// worth allocating for one. Anything past it is refused before any memory is
// reserved on a size the compositor chose.
constexpr uint32_t kMaximumRasterWidth = 220;
constexpr uint32_t kMaximumRasterHeight = 32;

struct ToplevelRecord {
  ext_foreign_toplevel_handle_v1* handle = nullptr;
  std::string appId;
  bool matchesPromethee = false;
};

struct CaptureSession {
  wl_display* display = nullptr;
  wl_registry* registry = nullptr;
  wl_shm* shm = nullptr;
  ext_foreign_toplevel_list_v1* toplevelList = nullptr;
  ext_foreign_toplevel_image_capture_source_manager_v1* sourceManager = nullptr;
  ext_image_copy_capture_manager_v1* captureManager = nullptr;
  std::vector<ToplevelRecord*> toplevels;
};

void toplevelAppId(void* data, ext_foreign_toplevel_handle_v1*, const char* appId) {
  ToplevelRecord* record = static_cast<ToplevelRecord*>(data);
  record->appId = appId == nullptr ? "" : appId;
  // The same identity the window backends match on, and never the title. A local
  // build is free to name its windows anything; what every Electron build reports
  // is the application name.
  record->matchesPromethee = equalsPrometheeClass(record->appId);
}

void toplevelTitle(void*, ext_foreign_toplevel_handle_v1*, const char*) {}
void toplevelIdentifier(void*, ext_foreign_toplevel_handle_v1*, const char*) {}
void toplevelDone(void*, ext_foreign_toplevel_handle_v1*) {}

void toplevelClosed(void* data, ext_foreign_toplevel_handle_v1*) {
  ToplevelRecord* record = static_cast<ToplevelRecord*>(data);
  record->matchesPromethee = false;
}

const ext_foreign_toplevel_handle_v1_listener kToplevelListener = {
  toplevelClosed,
  toplevelDone,
  toplevelTitle,
  toplevelAppId,
  toplevelIdentifier
};

void toplevelListToplevel(void* data, ext_foreign_toplevel_list_v1*,
                          ext_foreign_toplevel_handle_v1* handle) {
  CaptureSession* session = static_cast<CaptureSession*>(data);
  if (session->toplevels.size() >= kMaximumToplevels) {
    ext_foreign_toplevel_handle_v1_destroy(handle);
    return;
  }
  ToplevelRecord* record = new ToplevelRecord();
  record->handle = handle;
  session->toplevels.push_back(record);
  ext_foreign_toplevel_handle_v1_add_listener(handle, &kToplevelListener, record);
}

void toplevelListFinished(void*, ext_foreign_toplevel_list_v1*) {}

const ext_foreign_toplevel_list_v1_listener kToplevelListListener = {
  toplevelListToplevel,
  toplevelListFinished
};

void captureRegistryGlobal(void* data, wl_registry* registry, uint32_t name,
                           const char* interface, uint32_t version) {
  CaptureSession* session = static_cast<CaptureSession*>(data);
  const std::string_view advertised = interface;
  if (advertised == wl_shm_interface.name && session->shm == nullptr) {
    session->shm = static_cast<wl_shm*>(wl_registry_bind(registry, name, &wl_shm_interface, 1));
    return;
  }
  if (advertised == ext_foreign_toplevel_list_v1_interface.name && session->toplevelList == nullptr) {
    session->toplevelList = static_cast<ext_foreign_toplevel_list_v1*>(
      wl_registry_bind(registry, name, &ext_foreign_toplevel_list_v1_interface, 1));
    return;
  }
  if (advertised == ext_foreign_toplevel_image_capture_source_manager_v1_interface.name &&
      session->sourceManager == nullptr) {
    session->sourceManager = static_cast<ext_foreign_toplevel_image_capture_source_manager_v1*>(
      wl_registry_bind(registry, name,
                       &ext_foreign_toplevel_image_capture_source_manager_v1_interface, 1));
    return;
  }
  if (advertised == ext_image_copy_capture_manager_v1_interface.name &&
      session->captureManager == nullptr) {
    session->captureManager = static_cast<ext_image_copy_capture_manager_v1*>(
      wl_registry_bind(registry, name, &ext_image_copy_capture_manager_v1_interface, 1));
  }
  (void)version;
}

const wl_registry_listener kCaptureRegistryListener = {
  captureRegistryGlobal,
  registryGlobalRemove
};

void closeCaptureSession(CaptureSession& session) {
  for (ToplevelRecord* record : session.toplevels) {
    if (record->handle != nullptr) ext_foreign_toplevel_handle_v1_destroy(record->handle);
    delete record;
  }
  session.toplevels.clear();
  if (session.captureManager != nullptr) ext_image_copy_capture_manager_v1_destroy(session.captureManager);
  if (session.sourceManager != nullptr) {
    ext_foreign_toplevel_image_capture_source_manager_v1_destroy(session.sourceManager);
  }
  if (session.toplevelList != nullptr) ext_foreign_toplevel_list_v1_destroy(session.toplevelList);
  if (session.shm != nullptr) wl_shm_destroy(session.shm);
  if (session.registry != nullptr) wl_registry_destroy(session.registry);
  if (session.display != nullptr) wl_display_disconnect(session.display);
  session.display = nullptr;
  session.registry = nullptr;
  session.shm = nullptr;
  session.toplevelList = nullptr;
  session.sourceManager = nullptr;
  session.captureManager = nullptr;
}

bool openCaptureSession(CaptureSession& session, const Deadline& deadline) {
  session.display = wl_display_connect(nullptr);
  if (session.display == nullptr) return false;

  session.registry = wl_display_get_registry(session.display);
  if (session.registry == nullptr) { closeCaptureSession(session); return false; }
  wl_registry_add_listener(session.registry, &kCaptureRegistryListener, &session);
  if (!roundtripWithin(session.display, deadline)) { closeCaptureSession(session); return false; }
  if (session.toplevelList == nullptr) return true;
  ext_foreign_toplevel_list_v1_add_listener(session.toplevelList, &kToplevelListListener, &session);
  // The first roundtrip delivers the toplevels, the second the app_id each of
  // them has to give for itself. Both come out of the one deadline the whole
  // read is spending.
  if (!roundtripWithin(session.display, deadline) || !roundtripWithin(session.display, deadline)) {
    closeCaptureSession(session);
    return false;
  }
  return true;
}

bool captureSessionUsable(const CaptureSession& session) {
  return session.shm != nullptr && session.toplevelList != nullptr &&
    session.sourceManager != nullptr && session.captureManager != nullptr;
}

// The offered format is the renderer's answer, not the compositor's. A nested
// Sway 1.12 offers BGR888 under GLES2 and XRGB8888 under pixman, and neither of
// them is ARGB8888, so asking for ARGB8888 by name locked this slot to Hyprland.
// The alpha it was asked for turned out not to be needed. This helper writes the
// surface composited over opaque black, and a Wayland shm buffer is premultiplied,
// so the colour channels of a copy that dropped the alpha are already that answer.
// Measured rather than argued: the same live 159 by 32 HUD captured twice on
// Hyprland, once as ARGB8888 and once as XRGB8888, differed in none of its 15264
// colour bytes.
//
// The order is a preference rather than a requirement. ARGB8888 stays first so a
// session that offers it is read exactly as it was before this list existed.
struct CaptureFormat {
  uint32_t code;
  size_t bytesPerPixel;
  size_t redOffset;
  size_t greenOffset;
  size_t blueOffset;
};

// BGR888 is `[23:0] B:G:R little endian`, which puts red in the first byte of
// each pixel and drops the fourth byte entirely.
constexpr CaptureFormat kAcceptedCaptureFormats[] = {
  {WL_SHM_FORMAT_ARGB8888, 4, 2, 1, 0},
  {WL_SHM_FORMAT_XRGB8888, 4, 2, 1, 0},
  {WL_SHM_FORMAT_BGR888, 3, 0, 1, 2}
};
constexpr size_t kAcceptedCaptureFormatCount =
  sizeof(kAcceptedCaptureFormats) / sizeof(kAcceptedCaptureFormats[0]);

struct CaptureConstraints {
  uint32_t width = 0;
  uint32_t height = 0;
  size_t formatIndex = 0;
  bool hasFormat = false;
  bool done = false;
  bool stopped = false;
};

void captureSessionBufferSize(void* data, ext_image_copy_capture_session_v1*,
                              uint32_t width, uint32_t height) {
  CaptureConstraints* constraints = static_cast<CaptureConstraints*>(data);
  constraints->width = width;
  constraints->height = height;
}

void captureSessionShmFormat(void* data, ext_image_copy_capture_session_v1*, uint32_t format) {
  CaptureConstraints* constraints = static_cast<CaptureConstraints*>(data);
  // The formats are taken by name rather than in offer order, because offer order
  // is the compositor's convenience and this helper has a stated preference.
  for (size_t index = 0; index < kAcceptedCaptureFormatCount; index += 1) {
    if (kAcceptedCaptureFormats[index].code != format) continue;
    if (constraints->hasFormat && constraints->formatIndex <= index) return;
    constraints->formatIndex = index;
    constraints->hasFormat = true;
    return;
  }
}

void captureSessionDmabufDevice(void*, ext_image_copy_capture_session_v1*, wl_array*) {}
void captureSessionDmabufFormat(void*, ext_image_copy_capture_session_v1*, uint32_t, wl_array*) {}

void captureSessionDone(void* data, ext_image_copy_capture_session_v1*) {
  static_cast<CaptureConstraints*>(data)->done = true;
}

void captureSessionStopped(void* data, ext_image_copy_capture_session_v1*) {
  CaptureConstraints* constraints = static_cast<CaptureConstraints*>(data);
  constraints->stopped = true;
  constraints->done = true;
}

const ext_image_copy_capture_session_v1_listener kCaptureSessionListener = {
  captureSessionBufferSize,
  captureSessionShmFormat,
  captureSessionDmabufDevice,
  captureSessionDmabufFormat,
  captureSessionDone,
  captureSessionStopped
};

enum class FrameOutcome { pending, ready, failed };

void captureFrameTransform(void*, ext_image_copy_capture_frame_v1*, uint32_t) {}
void captureFrameDamage(void*, ext_image_copy_capture_frame_v1*, int32_t, int32_t, int32_t, int32_t) {}
void captureFramePresentationTime(void*, ext_image_copy_capture_frame_v1*, uint32_t, uint32_t, uint32_t) {}

void captureFrameReady(void* data, ext_image_copy_capture_frame_v1*) {
  *static_cast<FrameOutcome*>(data) = FrameOutcome::ready;
}

void captureFrameFailed(void* data, ext_image_copy_capture_frame_v1*, uint32_t) {
  *static_cast<FrameOutcome*>(data) = FrameOutcome::failed;
}

const ext_image_copy_capture_frame_v1_listener kCaptureFrameListener = {
  captureFrameTransform,
  captureFrameDamage,
  captureFramePresentationTime,
  captureFrameReady,
  captureFrameFailed
};

// Reading the constraints costs one session per candidate and answers the one
// question that separates the HUD from the app's main window without ever
// reading a title: how large a buffer the compositor would fill for it.
bool readCaptureConstraints(CaptureSession& session, ToplevelRecord& record,
                            CaptureConstraints& constraints, const Deadline& deadline) {
  ext_image_capture_source_v1* source =
    ext_foreign_toplevel_image_capture_source_manager_v1_create_source(
      session.sourceManager, record.handle);
  if (source == nullptr) return false;
  ext_image_copy_capture_session_v1* captureSession =
    ext_image_copy_capture_manager_v1_create_session(session.captureManager, source, 0);
  if (captureSession == nullptr) {
    ext_image_capture_source_v1_destroy(source);
    return false;
  }
  ext_image_copy_capture_session_v1_add_listener(captureSession, &kCaptureSessionListener, &constraints);
  // The loop turns on the compositor sending what was asked for, not on a count
  // of round trips, so without the deadline a compositor that keeps answering
  // something else holds it open indefinitely. This runs once per candidate
  // window, and they all spend the same deadline, so a session full of
  // Promethee-looking toplevels cannot multiply the wait either.
  bool answered = true;
  while (!constraints.done) {
    if (deadline.remainingMs() <= 0) { answered = false; break; }
    if (!roundtripWithin(session.display, deadline)) { answered = false; break; }
  }
  ext_image_copy_capture_session_v1_destroy(captureSession);
  ext_image_capture_source_v1_destroy(source);
  return answered && !constraints.stopped;
}

// `formatUnsupported` is the outcome a nested Sway 1.12 produced and that this
// enum first had no room for. The compositor listed the toplevel, agreed on its
// size, and then offered one shm format that was not on the accepted list.
// Without its own outcome that came back as `notFound`, which says the HUD is not
// on screen when the HUD is on screen and readable in a format this helper will
// not take. The difference matters to whoever reads the receipt: one is a stale
// rectangle to measure again, the other is a session this slot cannot serve at
// all. The list has since grown to cover every format any measured session has
// offered, so this outcome now names a session nobody here has met.
enum class CaptureOutcome {
  captured, unsupported, notFound, ambiguous, mismatch, failed, formatUnsupported
};

// The raster is the surface composited over opaque black, and that is a decision
// rather than a detail. Wayland shm buffers are premultiplied, so over black the
// stored value is already the answer and no arithmetic can go wrong. It is also
// the one background that is the same on every session, which is what makes a
// classification reproducible: the same HUD read twice gives the same pixels
// whatever the user's wallpaper is doing.
CaptureOutcome capturePrometheeHudThroughWayland(long long expectedWidth, long long expectedHeight,
                                                 std::vector<unsigned char>& raster) {
  const Deadline deadline = deadlineIn(kCaptureDeadlineMs);
  CaptureSession session;
  if (!openCaptureSession(session, deadline)) return CaptureOutcome::unsupported;
  if (!captureSessionUsable(session)) {
    closeCaptureSession(session);
    return CaptureOutcome::unsupported;
  }

  ToplevelRecord* chosen = nullptr;
  size_t matches = 0;
  // A surface of the right size that offered no format this helper takes. It is
  // counted separately so the refusal can say which of the two things went wrong.
  size_t refusedForFormat = 0;
  size_t chosenFormatIndex = 0;
  for (ToplevelRecord* record : session.toplevels) {
    if (!record->matchesPromethee) continue;
    CaptureConstraints constraints;
    if (!readCaptureConstraints(session, *record, constraints, deadline)) continue;
    if (constraints.width != static_cast<uint32_t>(expectedWidth)) continue;
    if (constraints.height != static_cast<uint32_t>(expectedHeight)) continue;
    if (!constraints.hasFormat) { refusedForFormat += 1; continue; }
    matches += 1;
    if (chosen == nullptr) { chosen = record; chosenFormatIndex = constraints.formatIndex; }
  }
  if (matches > 1) { closeCaptureSession(session); return CaptureOutcome::ambiguous; }
  if (chosen == nullptr && refusedForFormat > 0) {
    closeCaptureSession(session);
    return CaptureOutcome::formatUnsupported;
  }
  if (chosen == nullptr) { closeCaptureSession(session); return CaptureOutcome::notFound; }

  const CaptureFormat& format = kAcceptedCaptureFormats[chosenFormatIndex];
  const uint32_t width = static_cast<uint32_t>(expectedWidth);
  const uint32_t height = static_cast<uint32_t>(expectedHeight);
  const size_t stride = static_cast<size_t>(width) * format.bytesPerPixel;
  // The buffer the compositor fills and the raster this helper hands back are no
  // longer the same size, because a three-byte format packs the same picture
  // smaller. Keeping the two counts apart is what stops a BGR888 capture from
  // being written out a quarter short.
  const size_t bytes = stride * height;
  const size_t rasterBytes = static_cast<size_t>(width) * height * 4;

  const int memory = memfd_create("promethee-hud-capture", MFD_CLOEXEC);
  if (memory < 0 || ftruncate(memory, static_cast<off_t>(bytes)) != 0) {
    if (memory >= 0) close(memory);
    closeCaptureSession(session);
    return CaptureOutcome::failed;
  }
  void* mapped = mmap(nullptr, bytes, PROT_READ | PROT_WRITE, MAP_SHARED, memory, 0);
  if (mapped == MAP_FAILED) {
    close(memory);
    closeCaptureSession(session);
    return CaptureOutcome::failed;
  }
  unsigned char* pixels = static_cast<unsigned char*>(mapped);

  ext_image_capture_source_v1* source =
    ext_foreign_toplevel_image_capture_source_manager_v1_create_source(
      session.sourceManager, chosen->handle);
  CaptureConstraints constraints;
  ext_image_copy_capture_session_v1* captureSession =
    source == nullptr
      ? nullptr
      : ext_image_copy_capture_manager_v1_create_session(session.captureManager, source, 0);
  FrameOutcome outcome = FrameOutcome::pending;
  wl_shm_pool* pool = nullptr;
  wl_buffer* buffer = nullptr;
  ext_image_copy_capture_frame_v1* frame = nullptr;

  if (captureSession != nullptr) {
    ext_image_copy_capture_session_v1_add_listener(captureSession, &kCaptureSessionListener, &constraints);
    while (!constraints.done && deadline.remainingMs() > 0 &&
           roundtripWithin(session.display, deadline)) {}
    // The surface may have resized between the two sessions, and a buffer sized
    // from the first reading would then be filled against a different frame. The
    // format is checked for the same reason: the buffer is already allocated to
    // the packing the first session named.
    if (!constraints.done || constraints.stopped || constraints.width != width ||
        constraints.height != height || !constraints.hasFormat ||
        constraints.formatIndex != chosenFormatIndex) {
      outcome = FrameOutcome::failed;
    } else {
      pool = wl_shm_create_pool(session.shm, memory, static_cast<int32_t>(bytes));
      buffer = pool == nullptr
        ? nullptr
        : wl_shm_pool_create_buffer(pool, 0, static_cast<int32_t>(width),
                                    static_cast<int32_t>(height), static_cast<int32_t>(stride),
                                    format.code);
      if (pool != nullptr) wl_shm_pool_destroy(pool);
      frame = buffer == nullptr
        ? nullptr
        : ext_image_copy_capture_session_v1_create_frame(captureSession);
      if (frame == nullptr) {
        outcome = FrameOutcome::failed;
      } else {
        ext_image_copy_capture_frame_v1_add_listener(frame, &kCaptureFrameListener, &outcome);
        ext_image_copy_capture_frame_v1_attach_buffer(frame, buffer);
        ext_image_copy_capture_frame_v1_damage_buffer(frame, 0, 0, static_cast<int32_t>(width),
                                                      static_cast<int32_t>(height));
        ext_image_copy_capture_frame_v1_capture(frame);
        while (outcome == FrameOutcome::pending) {
          if (deadline.remainingMs() <= 0) { outcome = FrameOutcome::failed; break; }
          if (!roundtripWithin(session.display, deadline)) { outcome = FrameOutcome::failed; break; }
        }
      }
    }
  } else {
    outcome = FrameOutcome::failed;
  }

  if (outcome == FrameOutcome::ready) {
    raster.resize(rasterBytes);
    for (size_t index = 0; index < static_cast<size_t>(width) * height; index += 1) {
      const size_t source = index * format.bytesPerPixel;
      const size_t target = index * 4;
      raster[target] = pixels[source + format.redOffset];
      raster[target + 1] = pixels[source + format.greenOffset];
      raster[target + 2] = pixels[source + format.blueOffset];
      raster[target + 3] = 255;
    }
  }

  if (frame != nullptr) ext_image_copy_capture_frame_v1_destroy(frame);
  if (buffer != nullptr) wl_buffer_destroy(buffer);
  if (captureSession != nullptr) ext_image_copy_capture_session_v1_destroy(captureSession);
  if (source != nullptr) ext_image_capture_source_v1_destroy(source);
  munmap(mapped, bytes);
  close(memory);
  closeCaptureSession(session);
  return outcome == FrameOutcome::ready ? CaptureOutcome::captured : CaptureOutcome::failed;
}

bool waylandCaptureSlotPresent() {
  CaptureSession session;
  if (!openCaptureSession(session, deadlineIn(kCaptureDeadlineMs))) return false;
  const bool usable = captureSessionUsable(session);
  closeCaptureSession(session);
  return usable;
}

// ----------------------------------------------------------- X11 capture

// The same refusal to read the screen, reached by a different route. X11 will
// hand any client a rectangle of the root window, and that is precisely the
// picture this must not take: the HUD is translucent, so a root grab returns it
// blended with the wallpaper behind it and the classifier has no way to tell
// that raster from a real one. XComposite gives the window its own off-screen
// pixmap, which holds what the client drew and nothing else, which is the same
// thing the Wayland slot asks its compositor for.
//
// `XCompositeNameWindowPixmap` only answers for a window somebody has redirected.
// On any session where the HUD looks translucent at all, a compositing manager
// is running and has already redirected everything, so the usual path is to name
// the pixmap and stop. The fallback below is for a bare X server, where this
// helper redirects the window itself, and it is the weaker of the two: a window
// that has just been redirected holds whatever it repaints into the new pixmap,
// so the picture is only there once the client has answered the exposure.
constexpr long kRedirectSettleNanoseconds = 80L * 1000L * 1000L;

// A TrueColor visual describes each channel as a mask, and the masks are not the
// same on every server or every depth. Reading them off the image rather than
// assuming a packing is what keeps this from being a second format demand of the
// kind the Wayland slot already had to give up.
unsigned char channelOf(unsigned long pixel, unsigned long mask) {
  if (mask == 0) return 0;
  int shift = 0;
  while (((mask >> shift) & 1u) == 0) shift += 1;
  const unsigned long extent = mask >> shift;
  const unsigned long value = (pixel & mask) >> shift;
  return static_cast<unsigned char>((value * 255u + extent / 2u) / extent);
}

void collectX11Matches(
  Display* display,
  Window root,
  Window window,
  Atom pidAtom,
  long long expectedPid,
  const WindowRecord& expected,
  std::vector<Window>& matches,
  int depth
) {
  if (depth > kMaximumX11Depth || matches.size() > kMaximumWindowRecords) return;

  XWindowAttributes attributes{};
  long long processId = 0;
  int absoluteX = 0;
  int absoluteY = 0;
  Window ignored = None;
  if (XGetWindowAttributes(display, window, &attributes) != 0 &&
      attributes.map_state == IsViewable &&
      attributes.width == expected.width &&
      attributes.height == expected.height &&
      x11IsPromethee(display, window) &&
      x11ProcessId(display, window, pidAtom, processId) &&
      processId == expectedPid &&
      XTranslateCoordinates(display, window, root, 0, 0, &absoluteX, &absoluteY, &ignored) != 0 &&
      absoluteX == expected.x &&
      absoluteY == expected.y) {
    matches.push_back(window);
  }

  Window resolvedRoot = None;
  Window parent = None;
  Window* children = nullptr;
  unsigned int childCount = 0;
  if (XQueryTree(display, window, &resolvedRoot, &parent, &children, &childCount) == 0) return;
  if (children != nullptr) {
    for (unsigned int index = 0; index < childCount; index += 1) {
      collectX11Matches(display, root, children[index], pidAtom, expectedPid, expected, matches,
                        depth + 1);
    }
    XFree(children);
  }
}

CaptureOutcome capturePrometheeHudThroughX11(long long expectedPid, const WindowRecord& expected,
                                             std::vector<unsigned char>& raster) {
  XSetErrorHandler(ignoreX11Error);
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr) return CaptureOutcome::unsupported;

  int eventBase = 0;
  int errorBase = 0;
  int major = 0;
  int minor = 0;
  // Naming a window's pixmap arrived in Composite 0.2. A server with 0.1 has the
  // extension and not the one request this slot is built on, so it is the slot
  // being absent rather than present and failing.
  if (XCompositeQueryExtension(display, &eventBase, &errorBase) != True ||
      XCompositeQueryVersion(display, &major, &minor) != 1 ||
      (major == 0 && minor < 2)) {
    XCloseDisplay(display);
    return CaptureOutcome::unsupported;
  }

  const Atom pidAtom = XInternAtom(display, "_NET_WM_PID", True);
  const Window root = DefaultRootWindow(display);
  std::vector<Window> matches;
  collectX11Matches(display, root, root, pidAtom, expectedPid, expected, matches, 0);
  if (matches.size() > 1) { XCloseDisplay(display); return CaptureOutcome::ambiguous; }
  if (matches.empty()) { XCloseDisplay(display); return CaptureOutcome::notFound; }

  const Window window = matches.front();
  XWindowAttributes attributes{};
  if (XGetWindowAttributes(display, window, &attributes) == 0) {
    XCloseDisplay(display);
    return CaptureOutcome::failed;
  }

  takeX11Error(display);
  Pixmap pixmap = XCompositeNameWindowPixmap(display, window);
  bool redirected = false;
  if (takeX11Error(display)) {
    if (pixmap != None) XFreePixmap(display, pixmap);
    pixmap = None;
    XCompositeRedirectWindow(display, window, CompositeRedirectAutomatic);
    if (!takeX11Error(display)) {
      redirected = true;
      sleepFor(kRedirectSettleNanoseconds);
      pixmap = XCompositeNameWindowPixmap(display, window);
      if (takeX11Error(display)) {
        if (pixmap != None) XFreePixmap(display, pixmap);
        pixmap = None;
      }
    }
  }

  const int width = static_cast<int>(expected.width);
  const int height = static_cast<int>(expected.height);
  CaptureOutcome outcome = CaptureOutcome::failed;
  if (pixmap != None) {
    // The named pixmap covers the window and its border, with the window's own
    // origin one border in on each side. Electron draws no border, so this is
    // nearly always zero, and reading it is what stops the one session that does
    // from being captured a few pixels off.
    const int border = attributes.border_width;
    XImage* image = XGetImage(display, pixmap, border, border,
                              static_cast<unsigned int>(width),
                              static_cast<unsigned int>(height),
                              AllPlanes, ZPixmap);
    if (takeX11Error(display) && image != nullptr) {
      XDestroyImage(image);
      image = nullptr;
    }
    // The masks come from the window's visual and not from the image, because a
    // pixmap has a depth and no visual: the server answers `GetImage` on one with
    // no visual id at all, and Xlib then hands back an image whose masks are
    // every one of them zero. The window is where the packing is actually
    // written down, and it is also the right authority, since the pixmap is a
    // copy of that window's contents.
    const unsigned long redMask = attributes.visual == nullptr ? 0 : attributes.visual->red_mask;
    const unsigned long greenMask = attributes.visual == nullptr ? 0 : attributes.visual->green_mask;
    const unsigned long blueMask = attributes.visual == nullptr ? 0 : attributes.visual->blue_mask;
    if (image != nullptr) {
      if (redMask == 0 || greenMask == 0 || blueMask == 0) {
        // A visual that names its colours through a palette rather than through
        // masks. Nothing that renders a translucent HUD runs on one, and reading
        // it would mean a colormap lookup per pixel to answer a question no
        // measured session asks, so it is refused under its own name.
        outcome = CaptureOutcome::formatUnsupported;
      } else {
        raster.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
        for (int row = 0; row < height; row += 1) {
          for (int column = 0; column < width; column += 1) {
            const unsigned long pixel = XGetPixel(image, column, row);
            const size_t target =
              (static_cast<size_t>(row) * static_cast<size_t>(width) + static_cast<size_t>(column)) * 4;
            raster[target] = channelOf(pixel, redMask);
            raster[target + 1] = channelOf(pixel, greenMask);
            raster[target + 2] = channelOf(pixel, blueMask);
            raster[target + 3] = 255;
          }
        }
        outcome = CaptureOutcome::captured;
      }
      XDestroyImage(image);
    }
    XFreePixmap(display, pixmap);
  }

  // Only ever undone where this helper did it. A window the session's own
  // compositing manager redirected is left exactly as it was found.
  if (redirected) XCompositeUnredirectWindow(display, window, CompositeRedirectAutomatic);
  XCloseDisplay(display);
  return outcome;
}

bool x11CaptureSlotPresent() {
  XSetErrorHandler(ignoreX11Error);
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr) return false;
  int eventBase = 0;
  int errorBase = 0;
  int major = 0;
  int minor = 0;
  const bool present = XCompositeQueryExtension(display, &eventBase, &errorBase) == True &&
                       XCompositeQueryVersion(display, &major, &minor) == 1 &&
                       !(major == 0 && minor < 2);
  XCloseDisplay(display);
  return present;
}

bool x11InjectionSlotPresent() {
  XSetErrorHandler(ignoreX11Error);
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr) return false;
  const bool present = x11InjectionSlotPresent(display);
  XCloseDisplay(display);
  return present;
}

bool captureSlotPresent() {
  return sessionUsesX11Slots() ? x11CaptureSlotPresent() : waylandCaptureSlotPresent();
}

// ------------------------------------------------------- permission probe

// This once refused every session speaking the i3 socket protocol, Sway included,
// on the stated ground that none of them had ever run any of it. Sway has now run
// all of it. A real Sway 1.12 listed the toplevel, handed over a frame of it, and
// took a press that the target client reported arriving on its own surface at the
// coordinates the plan named. The refusal is lifted exactly there and nowhere
// else, on the evidence it said it wanted rather than on the protocol argument it
// declined to accept.
//
// i3 keeps the refusal. Sway sets both variables and i3 sets only its own, so the
// two are told apart without asking the compositor what it is. i3 is X11, has no
// wlroots pointer to bind, and would depend on the X11 slot that no i3 session has
// exercised, so nothing there has been shown to work.
bool sessionRefusesAutomation() {
  return !environmentValue("I3SOCK").empty() && environmentValue("SWAYSOCK").empty();
}

// A slot that is not in the session and a slot that is there and said no are
// different answers, and only one of them is a permission. macOS never has to
// tell them apart, because its mechanism is always present and always has an
// opinion. Linux does, so the probe carries both.
struct SlotProbe {
  bool present = false;
  bool granted = false;
};

struct AutomationProbe {
  SlotProbe inputEvents;
  SlotProbe screenCapture;
};

AutomationProbe probeAutomationSlots() {
  AutomationProbe probe;

  // The capture slot is probed on every session, including the ones automation
  // is refused on. It reads and never acts, so a compositor this project has no
  // action evidence for can still be told the truth about what it offers.
  probe.screenCapture.present = captureSlotPresent();
  probe.screenCapture.granted = probe.screenCapture.present;

  if (sessionRefusesAutomation()) return probe;

  if (sessionUsesX11Slots()) {
    probe.inputEvents.present = x11InjectionSlotPresent();
  } else {
    PointerSession session;
    if (openPointerSession(session, deadlineIn(kClickDeadlineMs))) {
      probe.inputEvents.present = pointerSessionUsable(session);
      closePointerSession(session);
    }
  }
  // Both of these slots are unprivileged: reaching them is the whole of the
  // asking, so present and granted cannot come apart on either. A slot that
  // prompts, as the portal one will, is where they will.
  probe.inputEvents.granted = probe.inputEvents.present;
  return probe;
}

// ---------------------------------------------------------------- attach

// Wayland lets a client ask for a size and never for a position: the protocol
// has no way to say where a toplevel belongs, and a compositor that offered one
// would be handing every client the power to cover any other. The companion's
// three surfaces are placed against the real HUD, so on Wayland that placement
// has to be asked of the compositor, over the same socket the geometry is read
// from. The helper only ever names windows whose owning process is its own
// parent, so it can move what this app drew and nothing else.
constexpr size_t kMaximumSurfaceRequests = 8;
constexpr size_t kMaximumTitleLength = 128;
constexpr long long kMaximumCoordinate = 1'000'000;

struct SurfaceRequest {
  std::string title;
  long long x = 0;
  long long y = 0;
  bool inputTransparent = false;
};

struct OwnWindow {
  std::string selector;
  std::string title;
  long long x = 0;
  long long y = 0;
  bool floating = false;
  bool pinned = false;
};

enum class AttachOutcome { placed, unsupported, ambiguous, incomplete };

const OwnWindow* matchOwnWindow(
  const std::vector<OwnWindow>& windows,
  const std::string& title,
  bool& ambiguous
) {
  const OwnWindow* found = nullptr;
  for (const OwnWindow& window : windows) {
    if (window.title != title) continue;
    // Two of this app's own windows under one title is not a tie to break.
    if (found != nullptr) { ambiguous = true; return nullptr; }
    found = &window;
  }
  return found;
}

// Hyprland's legacy parser and its Lua configuration provider take the same
// dispatchers under different spellings, and neither accepts the other's.
void appendHyprlandCommands(
  bool lua,
  const OwnWindow& window,
  const SurfaceRequest& request,
  std::vector<std::string>& commands
) {
  const std::string& selector = window.selector;
  // Floating and pinned are toggles on both dialects, so each is asked for only
  // when the window is not already in that state.
  if (!window.floating) {
    commands.push_back(lua
      ? "/dispatch hl.dsp.window.float({ window = \"" + selector + "\" })"
      : "/dispatch togglefloating " + selector);
  }
  if (!window.pinned) {
    commands.push_back(lua
      ? "/dispatch hl.dsp.window.pin({ window = \"" + selector + "\" })"
      : "/dispatch pin " + selector);
  }
  // The outline covers the pill it draws around and asks Electron to be
  // invisible to the mouse. That ask alone does not get the pointer through on
  // the one compositor this was measured against: with the property off, a
  // hover over the real Pause button leaves the button's own pixels untouched,
  // and with it on the button renders its hover state. So the property, not the
  // Electron call, is what keeps the timer underneath reachable here. This is a
  // measured effect of one Hyprland version, not a guarantee the protocol
  // makes. A compositor with no equivalent property leaves the outline in the
  // way of the pointer.
  const std::string value = request.inputTransparent ? "1" : "0";
  commands.push_back(lua
    ? "/dispatch hl.dsp.window.set_prop({ window = \"" + selector + "\", prop = \"no_focus\", value = " +
      value + " })"
    : "/setprop " + selector + " nofocus " + value);
  if (window.x != request.x || window.y != request.y) {
    const std::string x = std::to_string(request.x);
    const std::string y = std::to_string(request.y);
    commands.push_back(lua
      ? "/dispatch hl.dsp.window.move({ x = " + x + ", y = " + y + ", window = \"" + selector + "\" })"
      : "/dispatch movewindowpixel exact " + x + " " + y + "," + selector);
  }
}

AttachOutcome attachThroughHyprland(const std::vector<SurfaceRequest>& requests, size_t& placed) {
  if (environmentValue("HYPRLAND_INSTANCE_SIGNATURE").empty()) return AttachOutcome::unsupported;

  std::string socketPath;
  std::string response;
  if (!hyprlandExchange(socketPath, "systeminfo", response)) return AttachOutcome::incomplete;
  const bool lua = response.find("configProvider: lua") != std::string::npos;

  response.clear();
  if (!hyprlandExchange(socketPath, "j/clients", response)) return AttachOutcome::incomplete;
  JsonValue document;
  if (!JsonParser(response).parse(document) || document.type != JsonValue::Type::array) {
    return AttachOutcome::incomplete;
  }

  const long long owner = static_cast<long long>(getppid());
  std::vector<OwnWindow> windows;
  for (const JsonValue& client : document.array) {
    long long processId = 0;
    if (!integerMember(client, "pid", processId) || processId != owner) continue;
    if (!booleanMemberOrDefault(client, "mapped", true)) continue;

    std::string_view address;
    std::string_view title;
    if (!stringMember(client, "address", address) || !stringMember(client, "title", title)) continue;

    OwnWindow window;
    if (!integerPair(client, "at", window.x, window.y)) continue;
    window.selector = "address:" + std::string(address);
    window.title = std::string(title);
    window.floating = booleanMemberOrDefault(client, "floating", false);
    window.pinned = booleanMemberOrDefault(client, "pinned", false);
    if (windows.size() >= kMaximumWindowRecords) return AttachOutcome::incomplete;
    windows.push_back(std::move(window));
  }

  std::vector<std::string> commands;
  for (const SurfaceRequest& request : requests) {
    bool ambiguous = false;
    const OwnWindow* window = matchOwnWindow(windows, request.title, ambiguous);
    if (ambiguous) return AttachOutcome::ambiguous;
    // A surface the app has hidden is absent rather than misplaced.
    if (window == nullptr) continue;
    appendHyprlandCommands(lua, *window, request, commands);
    placed += 1;
  }
  if (commands.empty()) return AttachOutcome::placed;

  std::string batch = "[[BATCH]]";
  for (size_t index = 0; index < commands.size(); index += 1) {
    if (index > 0) batch += ';';
    batch += commands[index];
  }

  response.clear();
  if (!hyprlandExchange(socketPath, batch, response)) return AttachOutcome::incomplete;

  // A command Hyprland ran answers `ok`, and a batch answers once per command
  // it ran. Asking only whether the whole reply avoids the word `error` accepts
  // an empty reply, a reply short by a command, and the `unknown request` this
  // compositor answers to a spelling it does not carry, which names no error at
  // all. The placement gate releases on this receipt, so the reply is counted
  // and read instead: one `ok` per command sent and nothing else in between. An
  // allowlist refuses a reply it does not recognise, where the old test waved
  // it through.
  size_t acknowledged = 0;
  for (size_t start = 0; start <= response.size();) {
    const size_t newline = response.find('\n', start);
    const size_t stop = newline == std::string::npos ? response.size() : newline;
    std::string_view segment(response.data() + start, stop - start);
    while (!segment.empty() && (segment.back() == '\r' || segment.back() == ' ')) segment.remove_suffix(1);
    while (!segment.empty() && segment.front() == ' ') segment.remove_prefix(1);
    if (!segment.empty()) {
      if (segment != "ok") return AttachOutcome::incomplete;
      acknowledged += 1;
    }
    if (newline == std::string::npos) break;
    start = newline + 1;
  }
  return acknowledged == commands.size() ? AttachOutcome::placed : AttachOutcome::incomplete;
}

void collectOwnSwayNode(
  const JsonValue& node,
  long long owner,
  std::vector<OwnWindow>& windows,
  bool& overflow,
  size_t depth
) {
  if (overflow || depth > kMaximumJsonDepth || node.type != JsonValue::Type::object) return;

  long long processId = 0;
  long long identifier = 0;
  std::string_view title;
  if (integerMember(node, "pid", processId) && processId == owner &&
      integerMember(node, "id", identifier) &&
      stringMember(node, "name", title)) {
    const JsonValue* rect = member(node, "rect");
    OwnWindow window;
    if (rect != nullptr && integerMember(*rect, "x", window.x) && integerMember(*rect, "y", window.y)) {
      window.selector = "con_id=" + std::to_string(identifier);
      window.title = std::string(title);
      if (windows.size() >= kMaximumWindowRecords) { overflow = true; return; }
      windows.push_back(std::move(window));
    }
  }

  for (std::string_view branch : {"nodes", "floating_nodes"}) {
    const JsonValue* children = member(node, branch);
    if (children == nullptr || children->type != JsonValue::Type::array) continue;
    for (const JsonValue& child : children->array) {
      collectOwnSwayNode(child, owner, windows, overflow, depth + 1);
      if (overflow) return;
    }
  }
}

AttachOutcome attachThroughSway(const std::vector<SurfaceRequest>& requests, size_t& placed, bool& opaque) {
  const std::string socketPath = environmentValue("SWAYSOCK");
  if (socketPath.empty()) return AttachOutcome::unsupported;

  std::string response;
  if (!swayRequest(socketPath, kSwayGetTree, {}, response)) return AttachOutcome::incomplete;
  JsonValue document;
  if (!JsonParser(response).parse(document)) return AttachOutcome::incomplete;

  std::vector<OwnWindow> windows;
  bool overflow = false;
  collectOwnSwayNode(document, static_cast<long long>(getppid()), windows, overflow, 0);
  if (overflow) return AttachOutcome::incomplete;

  // Sway takes these as settings rather than toggles, so the wanted state can
  // be stated outright. It has no per-window equivalent of taking a box out of
  // the running for the pointer, so a surface asked for as input-transparent is
  // refused rather than placed: placing it would put an opaque box over the
  // pill and take Promethee's own drag and Play/Pause with it. Saying so lets
  // the app take that surface down instead of leaving it in the way.
  // Sway splits a payload on commas as well as on semicolons and answers once
  // per part, so the three settings asked of each window are three answers,
  // measured against sway 1.12 rather than assumed. Counting them matters
  // because a criteria that matches nothing is answered per part too: a run
  // that placed no window at all still comes back as an array, and reading only
  // the flags inside an array nobody sized reads an empty one as a success.
  size_t expected = 0;
  std::string payload;
  for (const SurfaceRequest& request : requests) {
    if (request.inputTransparent) { opaque = true; continue; }
    bool ambiguous = false;
    const OwnWindow* window = matchOwnWindow(windows, request.title, ambiguous);
    if (ambiguous) return AttachOutcome::ambiguous;
    if (window == nullptr) continue;
    if (!payload.empty()) payload += "; ";
    payload += "[" + window->selector + "] floating enable, sticky enable, move absolute position " +
      std::to_string(request.x) + " " + std::to_string(request.y);
    expected += 3;
    placed += 1;
  }
  if (payload.empty()) return AttachOutcome::placed;

  response.clear();
  if (!swayRequest(socketPath, kSwayRunCommand, payload, response)) return AttachOutcome::incomplete;
  JsonValue results;
  if (!JsonParser(response).parse(results) || results.type != JsonValue::Type::array) {
    return AttachOutcome::incomplete;
  }
  if (results.array.size() != expected) return AttachOutcome::incomplete;
  for (const JsonValue& result : results.array) {
    if (!booleanMemberOrDefault(result, "success", false)) return AttachOutcome::incomplete;
  }
  return AttachOutcome::placed;
}

bool parseCoordinate(const char* text, long long& value) {
  if (text == nullptr || *text == '\0') return false;
  errno = 0;
  char* end = nullptr;
  const long long parsed = std::strtoll(text, &end, 10);
  if (errno != 0 || end == nullptr || *end != '\0') return false;
  if (parsed < -kMaximumCoordinate || parsed > kMaximumCoordinate) return false;
  value = parsed;
  return true;
}

bool acceptableTitle(const std::string& title) {
  if (title.empty() || title.size() > kMaximumTitleLength) return false;
  for (const char character : title) {
    if (static_cast<unsigned char>(character) < 0x20) return false;
    if (character == '"' || character == '\\') return false;
  }
  return true;
}

// ---------------------------------------------------------------- commands

enum class ProcessResolution { found, notFound, ambiguous, incomplete };

ProcessResolution resolvePromethee(long long& processId, std::vector<WindowRecord>& windows) {
  std::vector<WindowRecord> records;
  bool overflow = false;
  bool answered = false;

  for (const auto backend : {collectFromHyprland, collectFromSway, collectFromX11}) {
    records.clear();
    overflow = false;
    const BackendStatus status = backend(records, overflow);
    if (status == BackendStatus::unavailable) continue;
    if (status == BackendStatus::error) return ProcessResolution::incomplete;
    answered = true;
    break;
  }
  if (!answered) return ProcessResolution::incomplete;
  if (records.empty()) return ProcessResolution::notFound;

  // Every platform helper refuses to guess between two live Promethee
  // processes rather than attaching to whichever one enumerated first.
  const long long owner = records.front().processId;
  for (const WindowRecord& record : records) {
    if (record.processId != owner) return ProcessResolution::ambiguous;
  }
  processId = owner;
  windows = std::move(records);
  return ProcessResolution::found;
}

int reportResolution(ProcessResolution resolution) {
  if (resolution == ProcessResolution::notFound) { receipt("process-not-found"); return 2; }
  if (resolution == ProcessResolution::ambiguous) { receipt("process-ambiguous"); return 2; }
  receipt("window-list-incomplete");
  return 3;
}

int pidCommand() {
  long long processId = 0;
  std::vector<WindowRecord> windows;
  const ProcessResolution resolution = resolvePromethee(processId, windows);
  if (resolution != ProcessResolution::found) return reportResolution(resolution);
  std::cout << processId << '\n';
  return 0;
}

int windowsCommand() {
  long long processId = 0;
  std::vector<WindowRecord> windows;
  const ProcessResolution resolution = resolvePromethee(processId, windows);
  if (resolution != ProcessResolution::found) return reportResolution(resolution);
  for (const WindowRecord& record : windows) {
    std::cout << record.x << ',' << record.y << ',' << record.width << ',' << record.height << '\n';
  }
  return 0;
}

int attachCommand(int argc, char* argv[]) {
  const int fields = argc - 2;
  if (fields <= 0 || fields % 4 != 0) { receipt("invalid-command"); return 2; }
  const size_t count = static_cast<size_t>(fields / 4);
  if (count > kMaximumSurfaceRequests) { receipt("invalid-command"); return 2; }

  std::vector<SurfaceRequest> requests;
  for (size_t index = 0; index < count; index += 1) {
    const int base = 2 + static_cast<int>(index) * 4;
    SurfaceRequest request;
    request.title = argv[base];
    if (!acceptableTitle(request.title)) { receipt("invalid-command"); return 2; }
    if (!parseCoordinate(argv[base + 1], request.x)) { receipt("invalid-command"); return 2; }
    if (!parseCoordinate(argv[base + 2], request.y)) { receipt("invalid-command"); return 2; }
    const std::string_view input = argv[base + 3];
    if (input == "transparent") request.inputTransparent = true;
    else if (input != "interactive") { receipt("invalid-command"); return 2; }
    for (const SurfaceRequest& existing : requests) {
      if (existing.title == request.title) { receipt("invalid-command"); return 2; }
    }
    requests.push_back(std::move(request));
  }

  // Same fixed order as discovery, and the same refusal to fall through: a
  // session that advertises a compositor which then fails is a failure, not an
  // invitation to place these windows on somebody else's display. X11 is absent
  // because an X11 client places its own windows and never needs this.
  size_t placed = 0;
  // Set when the session has no way to take a box out of the running for the
  // pointer, so a surface that asked for that was refused rather than placed.
  bool opaque = false;
  AttachOutcome outcome = attachThroughHyprland(requests, placed);
  if (outcome == AttachOutcome::unsupported) outcome = attachThroughSway(requests, placed, opaque);

  if (outcome == AttachOutcome::unsupported) { receipt("attach-unsupported"); return 2; }
  if (outcome == AttachOutcome::ambiguous) { receipt("attach-ambiguous"); return 2; }
  if (outcome == AttachOutcome::incomplete) { receipt("attach-incomplete"); return 3; }
  // A refusal is not a failure and asking again will not change it, so it is
  // reported under its own name and with the same counts as a placement.
  std::cout << (opaque ? "attach-opaque," : "attached,") << placed << ',' << count << '\n';
  return 0;
}
// The two spellings mean different things on macOS, where asking can raise a
// system prompt and reading never does. No slot named here prompts: each one is
// a protocol a client either can bind or cannot, and binding it is the whole of
// the answer, so both commands run the same probe and the distinction is kept
// only so the frozen command vocabulary stays the same on every platform.
int permissionsCommand() {
  const AutomationProbe probe = probeAutomationSlots();
  // A mechanism that is not in the session is not a denial. Saying denied would
  // send the user looking for a setting to turn on, and there is none to find,
  // so an absent mechanism gets its own receipt and the app reads it as the
  // feature being unavailable here rather than refused here. A mechanism that
  // is present and says no is still a denial and is still reported as a 0.
  if (!probe.inputEvents.present || !probe.screenCapture.present) {
    receipt("automation-unsupported");
    return 2;
  }
  const bool inputEvents = probe.inputEvents.granted;
  const bool screenCapture = probe.screenCapture.granted;
  std::cout << "permissions," << (inputEvents ? 1 : 0) << ',' << (screenCapture ? 1 : 0) << '\n';
  return inputEvents && screenCapture ? 0 : 3;
}

// `parseCoordinate` clamps to the largest screen position worth believing, and
// a process id on Linux runs past that, so the click arguments get their own
// parser and each field is then held to its own range below.
bool parseWholeNumber(const char* text, long long& value) {
  if (text == nullptr || *text == '\0') return false;
  errno = 0;
  char* end = nullptr;
  const long long parsed = std::strtoll(text, &end, 10);
  if (end == text || end == nullptr || *end != '\0' || errno == ERANGE) return false;
  value = parsed;
  return true;
}

// Argument for argument, and check for check, the macOS contract. The caller
// computed this target from a capture it took, so every part of that capture is
// re-read from the live session here and the click is refused unless all of it
// still holds. The helper never derives a target of its own.
int clickCommand(int argc, char* argv[]) {
  if (argc != 13) { receipt("invalid-action"); return 2; }

  // Only this command holds anything that has to be put back. The others read,
  // so being killed mid-run costs them their answer and nothing else, and they
  // are left to die on the spot.
  watchForInterruption();

  const std::string_view action = argv[2];
  const std::string_view expectedState = argv[3];
  const bool pauseAction = action == "pause";
  const bool resumeAction = action == "resume";
  if ((!pauseAction && !resumeAction) ||
      (pauseAction && expectedState != "running") ||
      (resumeAction && expectedState != "paused")) {
    receipt("state-mismatch");
    return 2;
  }

  long long values[9] = {0};
  for (int index = 0; index < 9; index += 1) {
    if (!parseWholeNumber(argv[index + 4], values[index])) { receipt("invalid-action"); return 2; }
  }
  const long long expectedPid = values[0];
  const long long expectedX = values[1];
  const long long expectedY = values[2];
  const long long expectedWidth = values[3];
  const long long expectedHeight = values[4];
  const long long expectedGeneration = values[5];
  const long long targetX = values[6];
  const long long targetY = values[7];
  const long long controlCount = values[8];

  if (expectedPid <= 0 || expectedPid > 0x7fff'ffff || expectedGeneration < 0 ||
      expectedWidth < 120 || expectedWidth > 220 || expectedHeight != 32) {
    receipt("target-mismatch");
    return 2;
  }
  if ((pauseAction && controlCount != 2) || (resumeAction && controlCount != 3)) {
    receipt("state-mismatch");
    return 2;
  }
  const long long expectedTargetX = expectedX + expectedWidth - 1 - (pauseAction ? 50 : 82);
  const long long expectedTargetY = expectedY + 16;
  if (targetX != expectedTargetX || targetY != expectedTargetY) { receipt("target-mismatch"); return 2; }

  if (sessionRefusesAutomation()) { receipt("permission-denied"); return 3; }

  long long processId = 0;
  std::vector<WindowRecord> windows;
  const ProcessResolution resolution = resolvePromethee(processId, windows);
  if (resolution != ProcessResolution::found) return reportResolution(resolution);
  if (processId != expectedPid) { receipt("process-changed"); return 2; }

  size_t matching = 0;
  for (const WindowRecord& record : windows) {
    if (record.x == expectedX && record.y == expectedY &&
        record.width == expectedWidth && record.height == expectedHeight) {
      matching += 1;
    }
  }
  if (matching == 0) { receipt("timer-not-found"); return 2; }
  if (matching != 1) { receipt("timer-ambiguous"); return 2; }

  const InjectionOutcome outcome = sessionUsesX11Slots()
    ? clickThroughXTest(targetX, targetY)
    : clickThroughVirtualPointer(targetX, targetY);
  if (outcome == InjectionOutcome::unsupported) { receipt("permission-denied"); return 3; }
  // A point no output covers is a point that came from a layout this session no
  // longer has, which makes it the same class of staleness as a moved window.
  if (outcome == InjectionOutcome::offScreen) { receipt("target-mismatch"); return 2; }
  if (outcome == InjectionOutcome::failed) { receipt("click-failed"); return 4; }

  std::cout << "clicked-unconfirmed," << action << ',' << expectedGeneration << '\n';
  return 0;
}

// The same preflight `click` runs, for the same reason: the caller names a window
// it believes is there, and the helper reads the live session back before it
// hands over any pixels. The bytes go to a file rather than to stdout because
// every other receipt on this contract is a line of text, and a command that
// answers with several megabytes of raster on the same channel would be the one
// exception a caller has to special-case.
int captureCommand(int argc, char* argv[]) {
  if (argc != 9) { receipt("invalid-command"); return 2; }

  long long values[6] = {0};
  for (int index = 0; index < 6; index += 1) {
    if (!parseWholeNumber(argv[index + 2], values[index])) { receipt("invalid-command"); return 2; }
  }
  const long long expectedPid = values[0];
  const long long expectedGeneration = values[1];
  const long long expectedX = values[2];
  const long long expectedY = values[3];
  const long long expectedWidth = values[4];
  const long long expectedHeight = values[5];
  const char* outputPath = argv[8];

  if (expectedPid <= 0 || expectedPid > 0x7fff'ffff || expectedGeneration < 0 ||
      expectedWidth < 120 || expectedWidth > kMaximumRasterWidth ||
      expectedHeight != static_cast<long long>(kMaximumRasterHeight)) {
    receipt("target-mismatch");
    return 2;
  }
  if (outputPath == nullptr || *outputPath == '\0') { receipt("invalid-command"); return 2; }

  long long processId = 0;
  std::vector<WindowRecord> windows;
  const ProcessResolution resolution = resolvePromethee(processId, windows);
  if (resolution != ProcessResolution::found) return reportResolution(resolution);
  if (processId != expectedPid) { receipt("process-changed"); return 2; }

  size_t matching = 0;
  for (const WindowRecord& record : windows) {
    if (record.x == expectedX && record.y == expectedY &&
        record.width == expectedWidth && record.height == expectedHeight) {
      matching += 1;
    }
  }
  if (matching == 0) { receipt("timer-not-found"); return 2; }
  if (matching != 1) { receipt("timer-ambiguous"); return 2; }

  WindowRecord expected;
  expected.x = expectedX;
  expected.y = expectedY;
  expected.width = expectedWidth;
  expected.height = expectedHeight;
  expected.processId = expectedPid;

  std::vector<unsigned char> raster;
  // The two slots identify the surface differently, and neither is a choice this
  // helper made. A Wayland toplevel handle carries no position, so that slot has
  // only the size to match on; an X11 window carries all of it, so that slot
  // matches the whole rectangle and the owning process as well.
  const CaptureOutcome outcome = sessionUsesX11Slots()
    ? capturePrometheeHudThroughX11(expectedPid, expected, raster)
    : capturePrometheeHudThroughWayland(expectedWidth, expectedHeight, raster);
  if (outcome == CaptureOutcome::unsupported) { receipt("capture-unsupported"); return 3; }
  // The slot is present and the surface is there, and the session will only hand
  // the pixels over in a packing this helper cannot read: a Wayland format that
  // is not one of the three, or an X11 visual that names its colours through a
  // palette. That is the slot being unavailable on this session, not the request
  // being wrong, so it shares the unsupported exit code and keeps its own receipt.
  if (outcome == CaptureOutcome::formatUnsupported) {
    receipt("capture-format-unsupported");
    return 3;
  }
  // The window server said the HUD is this size and the compositor offered a
  // buffer of another, which is the same staleness a moved window is: the
  // geometry the caller measured is no longer the geometry on screen.
  if (outcome == CaptureOutcome::mismatch) { receipt("target-mismatch"); return 2; }
  if (outcome == CaptureOutcome::notFound) { receipt("timer-not-found"); return 2; }
  if (outcome == CaptureOutcome::ambiguous) { receipt("timer-ambiguous"); return 2; }
  if (outcome != CaptureOutcome::captured) { receipt("capture-failed"); return 4; }

  std::FILE* output = std::fopen(outputPath, "wb");
  if (output == nullptr) { receipt("capture-failed"); return 4; }
  const size_t written = std::fwrite(raster.data(), 1, raster.size(), output);
  const bool flushed = std::fclose(output) == 0;
  if (written != raster.size() || !flushed) { receipt("capture-failed"); return 4; }

  std::cout << "captured," << expectedWidth << ',' << expectedHeight << ','
            << expectedGeneration << '\n';
  return 0;
}
} // namespace

int main(int argc, char* argv[]) {
  if (argc == 2 && std::strcmp(argv[1], "self-test") == 0) {
    // What this build can do, not what the session it happens to be running in
    // will allow. It carries both halves now, which is what macOS says here too.
    receipt("ready,1,pause-resume");
    return 0;
  }
  if (argc == 2 && std::strcmp(argv[1], "permission-status") == 0) return permissionsCommand();
  if (argc == 2 && std::strcmp(argv[1], "permissions") == 0) return permissionsCommand();
  if (argc == 2 && std::strcmp(argv[1], "pid") == 0) return pidCommand();
  if (argc == 2 && std::strcmp(argv[1], "windows") == 0) return windowsCommand();
  if (argc >= 3 && std::strcmp(argv[1], "attach") == 0) return attachCommand(argc, argv);
  if (argc >= 2 && std::strcmp(argv[1], "capture") == 0) return captureCommand(argc, argv);
  if (argc >= 2 && std::strcmp(argv[1], "click") == 0) return clickCommand(argc, argv);
  receipt("invalid-command");
  return 2;
}
