#!/bin/sh
set -e
node scripts/migrate.mjs drizzle
exec node server.js
