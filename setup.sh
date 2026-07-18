#!/bin/bash
# One-step development setup: checks prerequisites, prepares .env, starts
# Postgres, migrates, seeds, and launches the dev server.
set -e
cd "$(dirname "$0")"

fail() { echo "✗ $1" >&2; exit 1; }

command -v node >/dev/null || fail "Node.js is required (v22+). Install from https://nodejs.org or 'brew install node'."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
  || fail "Node.js v22+ is required (found $(node --version))."
command -v docker >/dev/null || fail "Docker is required for the database. Install Docker Desktop or OrbStack."
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — start Docker Desktop / OrbStack first."

if [ ! -f .env ]; then
  {
    echo "DATABASE_URL=postgres://loomai:loomai@localhost:5432/loomai"
    echo "LOOMAI_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  } > .env
  echo "✓ Created .env with a generated LOOMAI_SECRET"
fi

echo "✓ Starting Postgres (docker compose up -d db)"
docker compose up -d db

echo "✓ Installing dependencies"
npm install --no-fund --no-audit

echo "✓ Waiting for the database"
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U loomai >/dev/null 2>&1 && break
  [ "$i" = 30 ] && fail "Postgres did not become ready"
  sleep 1
done

npm run db:migrate
npm run db:seed

echo
echo "──────────────────────────────────────────────────────"
echo "  LoomAI is ready: http://localhost:3000"
echo "  Sign in: admin@loomai.local / loomai-admin"
echo "  Tip: start LM Studio ('lms server start'), then use"
echo "  Platform admin → AI providers → Auto-discover."
echo "──────────────────────────────────────────────────────"
echo

exec npm run dev
