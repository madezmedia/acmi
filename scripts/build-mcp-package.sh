#!/usr/bin/env bash
# Build a publish-ready dist-mcp/ directory for @madezmedia/acmi-mcp.
# No source duplication — copies canonical files from the parent dir.
# Run from ~/.openclaw/skills/acmi/ root: bash scripts/build-mcp-package.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist-mcp"

echo "→ Building $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

# Canonical sources
cp "$ROOT/mcp-server.mjs"         "$DIST/mcp-server.mjs"
cp "$ROOT/mcp-server-helpers.mjs" "$DIST/mcp-server-helpers.mjs"
cp "$ROOT/mcp-package.json"       "$DIST/package.json"
cp "$ROOT/MCP-README.md"          "$DIST/README.md"
cp "$ROOT/LICENSE"                "$DIST/LICENSE"

# Optional: include test file so users can verify locally
cp "$ROOT/mcp-server.test.mjs"    "$DIST/mcp-server.test.mjs" 2>/dev/null || true

# Make the entry point executable (needed for bin)
chmod +x "$DIST/mcp-server.mjs"

# Sanity: validate package.json
cd "$DIST"
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" \
  && echo "  package.json valid" \
  || (echo "  package.json INVALID" && exit 1)

# Sanity: syntax check
node --check mcp-server.mjs && echo "  mcp-server.mjs syntax OK"
node --check mcp-server-helpers.mjs && echo "  mcp-server-helpers.mjs syntax OK"

echo ""
echo "✓ dist-mcp ready at: $DIST"
echo ""
echo "Files:"
ls -la "$DIST"
echo ""
echo "Next: cd dist-mcp && npm publish"
echo "(npm whoami first to confirm you're logged in as madezmedia)"
