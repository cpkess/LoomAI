#!/bin/sh
set -e

# Bootstrap LOOMAI_SECRET when not provided: generate once and persist it in
# the data volume so sessions and encrypted provider keys survive restarts.
if [ -z "$LOOMAI_SECRET" ]; then
  SECRET_FILE="${LOOMAI_DATA_DIR:-/data}/loomai-secret"
  if [ ! -f "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "Generated LOOMAI_SECRET (persisted in $SECRET_FILE)"
  fi
  LOOMAI_SECRET="$(cat "$SECRET_FILE")"
  export LOOMAI_SECRET
fi

node scripts/migrate.mjs drizzle
node scripts/seed.mjs

exec node server.js
