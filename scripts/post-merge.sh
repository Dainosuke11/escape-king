#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# ----------------------------------------------------------------
# Fly.io CLI check
# ----------------------------------------------------------------
if command -v flyctl &>/dev/null || command -v fly &>/dev/null; then
    echo "✅ Fly.io CLI (flyctl) is installed."
    echo "   To deploy the API server, run from the workspace root:"
    echo "     fly deploy --config artifacts/api-server/fly.toml --app escape-king-api"
    echo "   First-time setup guide: .local/tasks/flyio-setup-guide.md"
else
    echo "⚠️  Fly.io CLI (flyctl) is NOT installed."
    echo "   The API server Dockerfile and fly.toml are ready for deployment."
    echo "   To deploy to Fly.io (always-on hosting), install the CLI first:"
    echo "     curl -L https://fly.io/install.sh | sh"
    echo "   Then follow the guide at: .local/tasks/flyio-setup-guide.md"
fi
