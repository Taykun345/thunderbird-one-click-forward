#!/bin/bash
# Build the Thunderbird extension as an .xpi file
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUTPUT="bulk-inline-forward-v${VERSION}.xpi"

# Remove old builds
rm -f *.xpi

# Create .xpi (which is just a zip)
zip -r "$OUTPUT" \
  manifest.json \
  background.js \
  utils.js \
  options.html \
  options.js \
  popup/ \
  icons/*.png \
  -x "icons/generate-icons.py"

echo ""
echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
echo ""
echo "To install in Thunderbird:"
echo "  1. Open Thunderbird"
echo "  2. Menu > Add-ons and Themes (or Ctrl+Shift+A)"
echo "  3. Gear icon > Install Add-on From File..."
echo "  4. Select: $(pwd)/$OUTPUT"
