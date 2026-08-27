import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The imports are static, so a payload list that omits one of them ships a
// `main.js` that fails at load on every platform, including the ones the module
// never runs on. Each list is read as text rather than through the module that
// owns it, because two of them are not JavaScript.
function entryPointModules(): readonly string[] {
  const entry = readFileSync(new URL("../../src/electron/main.ts", import.meta.url), "utf8");
  const imports = entry.match(/from "\.\/[a-z0-9-]+\.(?:ts|cts)"/g) ?? [];
  assert.ok(imports.length > 5, "the entry point imports were not found at all");
  return imports.map((statement) => statement
    .slice(8, -1)
    .replace(/\.ts$/, ".js")
    .replace(/\.cts$/, ".cjs"));
}

function repositoryFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the published package carries every module the entry point imports", () => {
  const manifest: { readonly files: readonly string[] } = JSON.parse(repositoryFile("package.json"));
  const published = new Set(manifest.files);
  for (const module of entryPointModules()) {
    assert.ok(published.has(`dist/electron/${module}`), `${module} is imported by main.ts and not published`);
  }
});

test("the release verifier requires every module the entry point imports", () => {
  const verifier = repositoryFile("scripts/verify-release-package.mjs");
  for (const module of entryPointModules()) {
    assert.ok(verifier.includes(`"dist/electron/${module}"`), `${module} is imported by main.ts and not verified`);
  }
});

// This one cannot be asserted through `payloadFilesForTarget`, because the
// installer test builds its fixtures out of that same list and would agree with
// whatever it says.
test("the macOS application payload carries every module the entry point imports", () => {
  const installer = repositoryFile("bin/macos-app.cjs");
  for (const module of entryPointModules()) {
    assert.ok(installer.includes(`"dist/electron/${module}"`), `${module} is imported by main.ts and not in the app payload`);
  }
});

test("the source installer copies every module the entry point imports", () => {
  const script = repositoryFile("install-electron.sh");
  const block = /for relative_file in \\\n([\s\S]*?)\ndo\n/.exec(script);
  assert.ok(block !== null, "the installer copy list was not found");
  const copied = new Set((block[1] ?? "").split(/[\s\\]+/).filter((name) => name.length > 0));
  for (const module of entryPointModules()) {
    assert.ok(copied.has(module), `${module} is imported by main.ts and not copied by install-electron.sh`);
  }
});
