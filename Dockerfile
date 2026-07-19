FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Chromium for agent web_browse (free, key-less full navigation). web_search
# and web_open work without it via plain fetch.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV LOOMAI_CHROMIUM_PATH=/usr/bin/chromium-browser
RUN addgroup -S loomai && adduser -S loomai -G loomai
COPY --from=builder /app/public ./public
COPY --from=builder --chown=loomai:loomai /app/.next/standalone ./
COPY --from=builder --chown=loomai:loomai /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
RUN mkdir -p /data && chown loomai:loomai /data
USER loomai
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
