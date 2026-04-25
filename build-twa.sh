#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# build-twa.sh — Generate a signed AAB for Google Play via Bubblewrap
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Prerequisites check
command -v npx >/dev/null 2>&1 || { echo "Error: npx not found. Install Node.js first."; exit 1; }
command -v java >/dev/null 2>&1 || { echo "Error: java not found. Install JDK 11+ first."; exit 1; }

echo "=== Step 1: Install Bubblewrap CLI (if needed) ==="
npm ls -g @bubblewrap/cli >/dev/null 2>&1 || npm install -g @bubblewrap/cli

echo ""
echo "=== Step 2: Initialize TWA project from manifest ==="
if [ ! -d "twa-output" ]; then
  mkdir -p twa-output
  cd twa-output
  bubblewrap init --manifest="https://shalomapp.in/manifest.json"
  cd ..
else
  echo "twa-output/ already exists, skipping init."
fi

echo ""
echo "=== Step 3: Build signed AAB ==="
cd twa-output
bubblewrap build
cd ..

echo ""
echo "=== Done! ==="
echo "Your signed AAB is at: twa-output/app-release-bundle.aab"
echo ""
echo "Next steps:"
echo "  1. Upload the AAB to Google Play Console (https://play.google.com/console)"
echo "  2. Fill in the store listing (title, description, screenshots)"
echo "  3. Set the privacy policy URL to: https://shalomapp.in/privacy"
echo "  4. Update .well-known/assetlinks.json with your signing key fingerprint"
echo "     Run: bubblewrap fingerprint   (from twa-output/)"
echo "  5. Deploy the updated assetlinks.json to your frontend"
