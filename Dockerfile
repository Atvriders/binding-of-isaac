# syntax=docker/dockerfile:1

# ---- stage 1: vendor Ruffle (the emulator, not the game) ----
FROM --platform=$BUILDPLATFORM alpine:3.20 AS ruffle
ARG RUFFLE_VERSION=0.5.0
RUN apk add --no-cache curl unzip
RUN set -eux; \
    curl -fsSL --retry 3 --retry-delay 2 \
      -o /tmp/ruffle.zip \
      "https://github.com/ruffle-rs/ruffle/releases/download/v${RUFFLE_VERSION}/ruffle-${RUFFLE_VERSION}-web-selfhosted.zip"; \
    mkdir -p /out/ruffle; \
    unzip -q /tmp/ruffle.zip -d /out/ruffle; \
    test -f /out/ruffle/ruffle.js

# ---- stage 2: runtime ----
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Isaac Cabinet" \
      org.opencontainers.image.description="Self-hosted browser cabinet for the Flash-era Binding of Isaac, powered by Ruffle. Ships no game data." \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache curl

COPY --from=ruffle /out/ruffle /usr/share/nginx/html/ruffle
COPY web/ /usr/share/nginx/html/
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY scripts/docker-entrypoint.sh /usr/local/bin/isaac-entrypoint
RUN chmod +x /usr/local/bin/isaac-entrypoint

# The game file is deliberately NOT part of this image. It is fetched into a
# volume on first start, or supplied by the operator.
ENV GAME_DIR=/srv/game \
    GAME_URL="https://archive.org/download/binding-of-isaac/Binding%20of%20Isaac.swf" \
    GAME_SHA256="3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761"

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/isaac-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
