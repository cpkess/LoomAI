#!/bin/sh
set -e

DATA_DIR="${LOOMAI_DATA_DIR:-/data}"

# Bootstrap LOOMAI_SECRET when not provided: generate once and persist it in
# the data volume so sessions and encrypted provider keys survive restarts.
if [ -z "$LOOMAI_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/loomai-secret"
  if [ ! -f "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "Generated LOOMAI_SECRET (persisted in $SECRET_FILE)"
  fi
  LOOMAI_SECRET="$(cat "$SECRET_FILE")"
  export LOOMAI_SECRET
fi

# Self-update: when the in-app "Software update" dropped a marker, pull the
# latest source from GitHub and rebuild before serving. Guarded by
# LOOMAI_SELF_UPDATE; any failure here falls back to the current build so a bad
# update never bricks the app.
MARKER="$DATA_DIR/loomai-update-requested"
if [ "${LOOMAI_SELF_UPDATE:-0}" = "1" ] && [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  REPO="${LOOMAI_REPO_URL:-https://github.com/cpkess/loomai.git}"
  REF="${LOOMAI_UPDATE_REF:-main}"
  echo "Update requested — pulling $REF from $REPO"
  if [ ! -d .git ]; then
    git init -q
    git remote add origin "$REPO" 2>/dev/null || git remote set-url origin "$REPO"
  fi
  if git fetch --depth=1 origin "$REF" && git reset --hard "origin/$REF"; then
    if npm ci --include=dev && npm run build; then
      echo "Update applied."
    else
      echo "Rebuild failed — serving the previous build."
    fi
  else
    echo "Fetch failed — serving the previous build."
  fi
fi

export NODE_ENV=production
node scripts/migrate.mjs drizzle
node scripts/seed.mjs

exec npm run start
