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

# ---- stage 1b: vendor the OCR engine used by Auto-ID ----
FROM --platform=$BUILDPLATFORM alpine:3.20 AS ocr
ARG TESSERACT_JS_VERSION=5.1.1
ARG TESSERACT_CORE_VERSION=5.1.1
RUN apk add --no-cache curl
RUN set -eux; \
    mkdir -p /out/tesseract/core; \
    base="https://unpkg.com"; \
    curl -fsSL --retry 3 -o /out/tesseract/tesseract.min.js \
      "$base/tesseract.js@${TESSERACT_JS_VERSION}/dist/tesseract.min.js"; \
    curl -fsSL --retry 3 -o /out/tesseract/worker.min.js \
      "$base/tesseract.js@${TESSERACT_JS_VERSION}/dist/worker.min.js"; \
    # All four cores, each with its .wasm binary. tesseract.js picks one at runtime
    # based on the browser's SIMD support; vendoring a subset means a 404 inside the
    # worker and an engine that never starts.
    for v in "" "-simd" "-lstm" "-simd-lstm"; do \
      for ext in wasm.js wasm; do \
        f="tesseract-core${v}.${ext}"; \
        curl -fsSL --retry 3 -o "/out/tesseract/core/$f" \
          "$base/tesseract.js-core@${TESSERACT_CORE_VERSION}/$f"; \
        test -s "/out/tesseract/core/$f"; \
      done; \
    done; \
    curl -fsSL --retry 3 -o /out/tesseract/eng.traineddata.gz \
      "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz"; \
    test -s /out/tesseract/tesseract.min.js; \
    test -s /out/tesseract/eng.traineddata.gz

# ---- stage 2: runtime ----
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Isaac Cabinet" \
      org.opencontainers.image.description="Self-hosted browser cabinet for the Flash-era Binding of Isaac, powered by Ruffle. Ships no game data." \
      org.opencontainers.image.licenses="MIT"

# nodejs runs the item fetcher at container start. The parser is shared with the
# test suite, so there is one implementation rather than a shell copy that drifts.
RUN apk add --no-cache curl nodejs

COPY --from=ruffle /out/ruffle /usr/share/nginx/html/ruffle
COPY --from=ocr /out/tesseract /usr/share/nginx/html/vendor/tesseract-5
COPY web/ /usr/share/nginx/html/
COPY scripts/parse-items.mjs scripts/fetch-items.mjs /usr/local/lib/isaac/
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY scripts/docker-entrypoint.sh /usr/local/bin/isaac-entrypoint
RUN chmod +x /usr/local/bin/isaac-entrypoint

# The game file is deliberately NOT part of this image. It is fetched into a
# volume on first start, or supplied by the operator.
ENV ITEMS_FILE=/srv/data/items.json \
    ITEMS_MAX_AGE_DAYS=7 \
    GAME_DIR=/srv/game \
    GAME_URL="https://archive.org/download/binding-of-isaac/Binding%20of%20Isaac.swf" \
    GAME_SHA256="3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761"

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/isaac-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
