#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# ----------------------------------------------------------------
# Fly.io auto-deploy
# ----------------------------------------------------------------
if [ -z "${FLY_API_TOKEN}" ]; then
    echo "⚠️  FLY_API_TOKEN is not set — skipping Fly.io deploy."
    echo "   Add it as a secret in Replit to enable automatic deployment."
    exit 0
fi

# Install flyctl if not already on PATH
if ! command -v flyctl &>/dev/null && ! command -v fly &>/dev/null; then
    echo "📦 Installing flyctl..."
    curl -fsSL https://fly.io/install.sh | sh -s -- --yes
    export PATH="$HOME/.fly/bin:$PATH"
fi

FLY_CMD="fly"
if command -v flyctl &>/dev/null; then
    FLY_CMD="flyctl"
fi

echo "🚀 Deploying to Fly.io..."
if $FLY_CMD deploy \
    --config artifacts/api-server/fly.toml \
    --remote-only \
    --auto-confirm; then
    echo "✅ Fly.io deployment complete."
else
    echo "⚠️  Fly.io deployment failed (trial ended or billing issue). Skipping."
    echo "   Visit https://fly.io/trial to add a credit card."
fi
