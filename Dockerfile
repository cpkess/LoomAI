# LoomAI runs as a self-updating image: it ships the full source + toolchain so
# the in-app "Software update" can pull the latest from GitHub and rebuild on
# restart (see scripts/docker-entrypoint.sh). That trades a larger image and a
# short rebuild on update for one-click updates with no manual `docker build`.
FROM node:22-alpine
WORKDIR /app

# git for self-update; chromium for agent web_browse + PDF export (free, key-less).
RUN apk add --no-cache git chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Optional: the commit this image was built from, shown as the current version
# until the first self-update turns /app into a git checkout.
ARG LOOMAI_BUILD_COMMIT=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    LOOMAI_CHROMIUM_PATH=/usr/bin/chromium-browser \
    LOOMAI_BUILD_COMMIT=$LOOMAI_BUILD_COMMIT \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# App and data dirs owned by the unprivileged runtime user so self-update can
# write to the checkout and rebuild.
RUN addgroup -S loomai && adduser -S loomai -G loomai \
    && chown loomai:loomai /app \
    && mkdir -p /data && chown loomai:loomai /data
USER loomai

# Install ALL dependencies (dev deps are needed to build, including on update).
COPY --chown=loomai:loomai package.json package-lock.json ./
RUN npm ci

COPY --chown=loomai:loomai . .
RUN npm run build

EXPOSE 3000
ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
