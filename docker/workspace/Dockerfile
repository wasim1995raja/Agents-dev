# Isolated workspace image for generated projects.
# The orchestrator mounts one project directory at /workspace and never gives
# the container access to the host filesystem.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=1 \
    TERM=dumb

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        jq \
        unzip \
        libnss3 \
        libnspr4 \
        libdbus-1-3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libatspi2.0-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libcairo2 \
        libasound2 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@9.15.9 --activate

# Pre-install Playwright so generated projects can run tests without network
# access or an approval round-trip. Version is pinned to the browser revision
# in the mounted /ms-playwright cache.
RUN mkdir -p /opt/autodev \
    && cd /opt/autodev \
    && npm init -y >/dev/null \
    && npm install --no-audit --no-fund @playwright/test@1.64.1 \
    && chmod -R a+rX /opt/autodev

ENV NODE_PATH=/opt/autodev/node_modules

RUN mkdir -p /workspace /ms-playwright \
    && chown -R node:node /workspace /ms-playwright

WORKDIR /workspace
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node --version || exit 1

CMD ["sleep", "infinity"]
