#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Promethee Pomodoro.app"
INSTALL_ROOT="${PROMETHEE_POMODORO_INSTALL_DIR:-${HOME}/Applications}"
DESTINATION_APP="${INSTALL_ROOT}/${APP_NAME}"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/promethee-pomodoro-electron.XXXXXX")"
STAGING_APP="${STAGING_ROOT}/${APP_NAME}"
BACKUP_APP=""
INCOMING_ROOT=""

cleanup() {
    /bin/rm -rf -- "${STAGING_ROOT}"
    if [[ -n "${INCOMING_ROOT}" && -d "${INCOMING_ROOT}" ]]; then
        /bin/rm -rf -- "${INCOMING_ROOT}"
    fi
}
trap cleanup EXIT

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
    echo "Error: the V1 installer currently supports macOS only."
    exit 1
fi

MACOS_VERSION="$(/usr/bin/sw_vers -productVersion)"
MACOS_MAJOR="${MACOS_VERSION%%.*}"
if [[ ! "${MACOS_MAJOR}" =~ ^[0-9]+$ ]] || (( MACOS_MAJOR < 14 )); then
    echo "Error: Promethee Pomodoro V1 requires macOS 14 or later (found ${MACOS_VERSION})."
    exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Error: Node.js 22.12+ and npm are required."
    exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
    echo "Error: Node.js 22.12+ is required; found ${NODE_VERSION}."
    exit 1
fi

cd "${SCRIPT_DIR}"
echo "→ Installing locked npm dependencies…"
npm ci --ignore-scripts --no-audit --no-fund

ELECTRON_VERSION="$(node -p 'require("./package.json").dependencies.electron')"
echo "→ Downloading the pinned Electron ${ELECTRON_VERSION} runtime…"
node "${SCRIPT_DIR}/node_modules/electron/install.js"

echo "→ Building Promethee Pomodoro V1…"
npm run target:build

ELECTRON_APP="${SCRIPT_DIR}/node_modules/electron/dist/Electron.app"
if [[ ! -d "${ELECTRON_APP}" ]]; then
    echo "Error: the Electron runtime is missing at ${ELECTRON_APP}."
    exit 1
fi

echo "→ Assembling the local macOS app…"
/usr/bin/ditto "${ELECTRON_APP}" "${STAGING_APP}"
/bin/rm -f -- "${STAGING_APP}/Contents/Resources/default_app.asar"
/bin/mkdir -p "${STAGING_APP}/Contents/Resources/app/dist/core"
/bin/mkdir -p "${STAGING_APP}/Contents/Resources/app/dist/electron/styles"
/bin/mkdir -p "${STAGING_APP}/Contents/Resources/app/dist/native"
NATIVE_TARGET="darwin-$(node -p 'process.arch')"
for source_file in "${SCRIPT_DIR}"/dist/core/*.js; do
    /usr/bin/ditto "${source_file}" "${STAGING_APP}/Contents/Resources/app/dist/core/$(/usr/bin/basename "${source_file}")"
done
for relative_file in \
    geometry-poll-cadence.js handle.css handle.html handle.js \
    macos-hud-capture.js native-promethee-bridge.js promethee-control.js main.js \
    menu.css menu.html menu.js overlay.css overlay.html overlay.js \
    promethee-sqlite.js promethee-window-locator.js release-update.js \
    runtime-controller.js runtime-preload.cjs runtime-store.js \
    task-time-store.js task-time-tracker.js \
    runtime-window-plan.js window-plan.js
do
    /usr/bin/ditto "${SCRIPT_DIR}/dist/electron/${relative_file}" "${STAGING_APP}/Contents/Resources/app/dist/electron/${relative_file}"
done
/bin/mkdir -p "${STAGING_APP}/Contents/Resources/app/dist/native/${NATIVE_TARGET}"
/usr/bin/ditto "${SCRIPT_DIR}/dist/native/${NATIVE_TARGET}/promethee-input-bridge" "${STAGING_APP}/Contents/Resources/app/dist/native/${NATIVE_TARGET}/promethee-input-bridge"
/bin/chmod 755 "${STAGING_APP}/Contents/Resources/app/dist/native/${NATIVE_TARGET}/promethee-input-bridge"
/usr/bin/ditto "${SCRIPT_DIR}/dist/electron/styles/tokens.css" "${STAGING_APP}/Contents/Resources/app/dist/electron/styles/tokens.css"
/usr/bin/ditto "${SCRIPT_DIR}/assets/PrometheePomodoro.icns" "${STAGING_APP}/Contents/Resources/PrometheePomodoro.icns"
/usr/bin/ditto "${SCRIPT_DIR}/package.json" "${STAGING_APP}/Contents/Resources/app/package.json"
/usr/bin/ditto "${SCRIPT_DIR}/LICENSE" "${STAGING_APP}/Contents/Resources/app/LICENSE"

INFO_PLIST="${STAGING_APP}/Contents/Info.plist"
APP_VERSION="$(node -p 'require("./package.json").version')"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.bryann2k.promethee-pomodoro" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Promethee Pomodoro" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Promethee Pomodoro" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_VERSION}" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile PrometheePomodoro.icns" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "${INFO_PLIST}" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "${INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Add :NSAccessibilityUsageDescription string Promethee Pomodoro requests access at launch only for its bounded Pause and Resume automation. Automatic Pause starts enabled and can be turned off." "${INFO_PLIST}" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :NSAccessibilityUsageDescription Promethee Pomodoro requests access at launch only for its bounded Pause and Resume automation. Automatic Pause starts enabled and can be turned off." "${INFO_PLIST}"

echo "→ Applying a local ad hoc signature (no Apple certificate)…"
/usr/bin/codesign --force --deep --sign - "${STAGING_APP}"
/usr/bin/codesign --verify --deep --strict "${STAGING_APP}"

/bin/mkdir -p "${INSTALL_ROOT}"
INCOMING_ROOT="$(mktemp -d "${INSTALL_ROOT}/.promethee-pomodoro-install.XXXXXX")"
INCOMING_APP="${INCOMING_ROOT}/${APP_NAME}"
echo "→ Copying the verified app beside its final destination…"
/usr/bin/ditto "${STAGING_APP}" "${INCOMING_APP}"
/usr/bin/codesign --verify --deep --strict "${INCOMING_APP}"

if [[ -e "${DESTINATION_APP}" ]]; then
    BACKUP_APP="${DESTINATION_APP}.backup-$(date +%Y%m%d-%H%M%S)"
    /bin/mv -- "${DESTINATION_APP}" "${BACKUP_APP}"
fi

if ! /bin/mv -- "${INCOMING_APP}" "${DESTINATION_APP}"; then
    if [[ -n "${BACKUP_APP}" && -e "${BACKUP_APP}" ]]; then
        if [[ -e "${DESTINATION_APP}" ]]; then
            FAILED_DESTINATION="${INCOMING_ROOT}/failed-${APP_NAME}"
            /bin/mv -- "${DESTINATION_APP}" "${FAILED_DESTINATION}" 2>/dev/null || true
        fi
        /bin/mv -- "${BACKUP_APP}" "${DESTINATION_APP}"
    fi
    echo "Error: installation failed."
    exit 1
fi
/usr/bin/codesign --verify --deep --strict "${DESTINATION_APP}"

echo "→ Resetting stale privacy grants from previous unsigned builds…"
for privacy_service in Accessibility ScreenCapture; do
    if ! /usr/bin/tccutil reset "${privacy_service}" io.github.bryann2k.promethee-pomodoro >/dev/null 2>&1; then
        echo "Warning: macOS could not reset ${privacy_service} for Promethee Pomodoro."
    fi
    /usr/bin/tccutil reset "${privacy_service}" io.github.bryann2k.PrometheePomodoro >/dev/null 2>&1 || true
done

echo
echo "Promethee Pomodoro V${APP_VERSION} is installed at:"
echo "  ${DESTINATION_APP}"
echo "Launch it with:"
echo "  open \"${DESTINATION_APP}\""
echo "Automatic Pause starts enabled; automatic Resume starts disabled. Both can be changed in the attached popup."
