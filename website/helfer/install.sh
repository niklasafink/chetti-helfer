#!/bin/bash
# Chetti-Helfer installieren (macOS mit Apple-Chip). Aufruf: curl -fsSL https://chettiai.de/helfer/install.sh | bash
# Die Datei kommt über curl und trägt deshalb kein Quarantäne-Kennzeichen: macOS fragt nicht nach einem Apple-Entwicklerzertifikat.
set -euo pipefail
URL="${CHETTI_HELPER_URL:-https://chettiai.de/helfer/Chetti-Helfer-mac-arm64.tar.xz}"
DIR="${CHETTI_INSTALL_DIR:-$HOME/Applications}"
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Dieser Helfer läuft derzeit nur auf einem Mac mit Apple-Chip." >&2; exit 1
fi
mkdir -p "$DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "Chetti-Helfer wird geladen …"
curl -fSL --progress-bar "$URL" -o "$TMP/helfer.tar.xz"
pkill -f "Chetti Helfer.app/Contents/MacOS" 2>/dev/null || true
rm -rf "$DIR/Chetti Helfer.app"
tar -xJf "$TMP/helfer.tar.xz" -C "$DIR"
xattr -dr com.apple.quarantine "$DIR/Chetti Helfer.app" 2>/dev/null || true
if [ -z "${CHETTI_HELPER_NO_LAUNCH:-}" ]; then open "$DIR/Chetti Helfer.app"; fi
echo "Fertig. Der Chetti-Helfer läuft jetzt im Hintergrund (Symbol oben in der Menüleiste)."
echo "Beim ersten Start fragt macOS einmal nach Ihrem Passwort, damit der Browser dem Helfer vertraut."
