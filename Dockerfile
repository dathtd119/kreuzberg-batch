# ============================================
# Kreuzberg Batch Processor
# Full image with Bun + Playwright for URL fetching
# ============================================

FROM ghcr.io/kreuzberg-dev/kreuzberg:latest

# Build arguments
ARG BUN_VERSION=1.1.42

USER root

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    # Playwright dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && mv /root/.bun/bin/bun /usr/local/bin/ \
    && chmod +x /usr/local/bin/bun \
    && rm -rf /root/.bun

# Create app directories
RUN mkdir -p /app/scripts /files/input /files/output /files/error \
    && chown -R kreuzberg:kreuzberg /app /files

# Copy package.json first for layer caching
WORKDIR /app/scripts
COPY --chown=kreuzberg:kreuzberg scripts/package.json ./

# Install dependencies as kreuzberg user
USER kreuzberg

# Install npm dependencies (bun will generate lockfile)
RUN bun install

# Install Playwright browsers (chromium only to save space)
RUN bunx playwright install chromium

USER root

# Copy all scripts
COPY --chown=kreuzberg:kreuzberg scripts/ ./

USER kreuzberg

# Environment defaults
ENV NODE_ENV=production \
    FILES_DIR=/files \
    INPUT_DIR=/files/input \
    OUTPUT_DIR=/files/output \
    ERROR_DIR=/files/error \
    CONFIG_DIR=/config

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD bun --version && kreuzberg --version

ENTRYPOINT ["bun", "run", "/app/scripts/main.ts"]
