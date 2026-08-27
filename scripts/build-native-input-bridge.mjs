import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(repositoryRoot, "dist", "native");
const target = `${process.platform}-${process.arch}`;
const minimumMacOSVersion = "14.0";
const supportedTargets = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]);
if (!supportedTargets.has(target)) {
  process.stderr.write(`Native Promethee input is not supported for ${target}.\n`);
  process.exit(1);
}

const outputDirectory = path.join(nativeRoot, target);
mkdirSync(outputDirectory, { recursive: true });
rmSync(path.join(nativeRoot, "promethee-input-bridge"), { force: true });
rmSync(path.join(nativeRoot, "promethee-input-bridge.exe"), { force: true });

let executable;
let args;
if (process.platform === "darwin") {
  executable = "/usr/bin/clang";
  args = [
    "-fobjc-arc",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-mmacosx-version-min=${minimumMacOSVersion}`,
    "-framework", "AppKit",
    "-framework", "ApplicationServices",
    "-framework", "Foundation",
    path.join(repositoryRoot, "native", "macos", "promethee-input-bridge.m"),
    "-o", path.join(outputDirectory, "promethee-input-bridge")
  ];
} else if (process.platform === "linux") {
  // Wayland ships no client library for anything outside the core protocol: an
  // extension is an XML description that `wayland-scanner` turns into the stubs
  // and the interface tables a client links against. Both descriptions are
  // vendored rather than read from the system, because they live in different
  // packages on every distribution and one of them, wlr-protocols, is not
  // packaged at all on some. Vendoring leaves the build needing only the scanner
  // and the client library, which come together in the one package that
  // `-lwayland-client` already requires.
  const protocolDirectory = path.join(repositoryRoot, "native", "linux", "protocol");
  const generatedDirectory = path.join(outputDirectory, "generated");
  mkdirSync(generatedDirectory, { recursive: true });
  const generatedObjects = [];
  for (const protocol of [
    "wlr-virtual-pointer-unstable-v1",
    "xdg-output-unstable-v1",
    "ext-foreign-toplevel-list-v1",
    "ext-image-capture-source-v1",
    "ext-image-copy-capture-v1"
  ]) {
    const source = path.join(protocolDirectory, `${protocol}.xml`);
    const generatedSource = path.join(generatedDirectory, `${protocol}-protocol.c`);
    for (const [mode, output] of [
      ["client-header", path.join(generatedDirectory, `${protocol}-client-protocol.h`)],
      ["private-code", generatedSource]
    ]) {
      const scan = spawnSync("wayland-scanner", [mode, source, output], {
        cwd: repositoryRoot,
        stdio: "inherit"
      });
      if (scan.error) throw scan.error;
      if (scan.status !== 0) process.exit(scan.status ?? 1);
    }
    // The scanner emits C, and it is compiled as C rather than folded into the
    // C++ translation unit. It marks its interface tables hidden without a prior
    // declaration, which a C++ compiler reports and `-Werror` then rejects. The
    // warning is about generated code nobody here can fix, so the fix is to stop
    // holding machine output to the standard our own source is held to.
    const generatedObject = path.join(generatedDirectory, `${protocol}-protocol.o`);
    const compile = spawnSync("cc", ["-std=c11", "-O2", "-fPIC", "-c", generatedSource, "-o", generatedObject], {
      cwd: repositoryRoot,
      stdio: "inherit"
    });
    if (compile.error) throw compile.error;
    if (compile.status !== 0) process.exit(compile.status ?? 1);
    generatedObjects.push(generatedObject);
  }
  executable = "c++";
  args = [
    "-std=c++20",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-I${generatedDirectory}`,
    path.join(repositoryRoot, "native", "linux", "promethee-input-bridge.cpp"),
    ...generatedObjects,
    "-o", path.join(outputDirectory, "promethee-input-bridge"),
    "-lwayland-client",
    // X11's core protocol covers the window tree and nothing else. Reading a
    // window's own pixels and synthesising a press are both extensions, and each
    // ships its own client library: XComposite for the off-screen pixmap the
    // translucent HUD has to be read from, XTest for the press. Neither is
    // vendored, because unlike the Wayland extensions both are in the one X11
    // development package every distribution has.
    "-lX11",
    "-lXcomposite",
    "-lXtst"
  ];
} else if (process.platform === "win32") {
  executable = "cl.exe";
  args = [
    "/nologo", "/std:c++20", "/EHsc", "/O2", "/W4", "/WX",
    path.join(repositoryRoot, "native", "windows", "promethee-input-bridge.cpp"),
    `/Fe:${path.join(outputDirectory, "promethee-input-bridge.exe")}`,
    "dwmapi.lib",
    "user32.lib"
  ];
}

const result = spawnSync(executable, args, {
  cwd: repositoryRoot,
  env: process.platform === "darwin"
    ? { ...process.env, MACOSX_DEPLOYMENT_TARGET: minimumMacOSVersion }
    : process.env,
  stdio: "inherit",
  windowsHide: true
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
