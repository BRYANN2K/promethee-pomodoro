#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>
#include <tlhelp32.h>

#include <cwchar>
#include <iostream>
#include <utility>
#include <vector>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")

namespace {
constexpr wchar_t kPrometheeExecutable[] = L"Promethee.exe";
constexpr size_t kMaximumWindowRecords = 128;

std::vector<DWORD> prometheeProcesses() {
  std::vector<DWORD> matches;
  const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return matches;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (_wcsicmp(entry.szExeFile, kPrometheeExecutable) == 0) matches.push_back(entry.th32ProcessID);
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return matches;
}

bool exactWindowRect(HWND window, RECT& bounds) {
  if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
    return GetWindowRect(window, &bounds) != FALSE;
  }
  return true;
}

struct WindowRecord { RECT bounds; };
struct EnumerationContext {
  DWORD processId;
  std::vector<WindowRecord> windows;
  bool complete;
};

BOOL CALLBACK enumerateWindows(HWND window, LPARAM parameter) {
  auto& context = *reinterpret_cast<EnumerationContext*>(parameter);
  DWORD owner = 0;
  GetWindowThreadProcessId(window, &owner);
  if (owner != context.processId || !IsWindowVisible(window)) return TRUE;
  RECT bounds{};
  if (!exactWindowRect(window, bounds)) return TRUE;
  if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
    if (context.windows.size() >= kMaximumWindowRecords) {
      context.complete = false;
      return FALSE;
    }
    context.windows.push_back({bounds});
  }
  return TRUE;
}

bool windowsForProcess(DWORD processId, std::vector<WindowRecord>& windows) {
  EnumerationContext context{processId, {}, true};
  const BOOL enumerated = EnumWindows(enumerateWindows, reinterpret_cast<LPARAM>(&context));
  if (enumerated == FALSE && context.complete) return false;
  if (!context.complete) return false;
  windows = std::move(context.windows);
  return true;
}

enum class ProcessResolution { found, notFound, ambiguous, incomplete };

ProcessResolution resolvePrometheeProcess(DWORD& processId, std::vector<WindowRecord>* resolvedWindows = nullptr) {
  const auto matches = prometheeProcesses();
  if (matches.empty()) return ProcessResolution::notFound;

  std::vector<std::pair<DWORD, std::vector<WindowRecord>>> visibleOwners;
  for (const DWORD candidate : matches) {
    std::vector<WindowRecord> windows;
    if (!windowsForProcess(candidate, windows)) return ProcessResolution::incomplete;
    if (!windows.empty()) visibleOwners.emplace_back(candidate, std::move(windows));
  }

  if (visibleOwners.empty()) return ProcessResolution::notFound;
  if (visibleOwners.size() != 1) return ProcessResolution::ambiguous;
  processId = visibleOwners.front().first;
  if (resolvedWindows != nullptr) *resolvedWindows = std::move(visibleOwners.front().second);
  return ProcessResolution::found;
}

int pidCommand() {
  DWORD processId = 0;
  const ProcessResolution resolution = resolvePrometheeProcess(processId);
  if (resolution == ProcessResolution::notFound) { std::wcout << L"process-not-found\n"; return 2; }
  if (resolution == ProcessResolution::ambiguous) { std::wcout << L"process-ambiguous\n"; return 2; }
  if (resolution == ProcessResolution::incomplete) { std::wcout << L"window-list-incomplete\n"; return 3; }
  std::wcout << processId << L'\n';
  return 0;
}

int windowsCommand() {
  DWORD processId = 0;
  std::vector<WindowRecord> windows;
  const ProcessResolution resolution = resolvePrometheeProcess(processId, &windows);
  if (resolution == ProcessResolution::notFound) { std::wcout << L"process-not-found\n"; return 2; }
  if (resolution == ProcessResolution::ambiguous) { std::wcout << L"process-ambiguous\n"; return 2; }
  if (resolution == ProcessResolution::incomplete) { std::wcout << L"window-list-incomplete\n"; return 3; }
  for (const auto& record : windows) {
    const RECT& value = record.bounds;
    std::wcout << value.left << L',' << value.top << L','
      << value.right - value.left << L',' << value.bottom - value.top << L'\n';
  }
  return 0;
}
} // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
    std::wcout << L"dpi-awareness-unavailable\n";
    return 3;
  }
  if (argc == 2 && std::wcscmp(argv[1], L"self-test") == 0) {
    std::wcout << L"ready,1,observe-only\n";
    return 0;
  }
  if (argc == 2 && std::wcscmp(argv[1], L"pid") == 0) return pidCommand();
  if (argc == 2 && std::wcscmp(argv[1], L"windows") == 0) return windowsCommand();
  std::wcout << L"invalid-command\n";
  return 2;
}
