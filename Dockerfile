FROM node:20-alpine

# Puppeteer / Chromium system dependencies.
# python3 + py3-pip also carry Channel B's pdfplumber sidecar (see below).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont python3 py3-pip

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# PDF dual-channel Channel B: pdfplumber in its own venv, so engine upgrades cannot
# disturb the app's dependency tree. pdfplumber's native deps (pypdfium2, Pillow) ship
# musllinux wheels for both x86_64 and aarch64, so this builds on either arch.
RUN python3 -m venv /opt/lattice-venv \
    && /opt/lattice-venv/bin/pip install --no-cache-dir pdfplumber==0.11.10
ENV PDF_LATTICE_PYTHON_PATH=/opt/lattice-venv/bin/python3

WORKDIR /app

# Install production dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application
COPY dist ./dist
# The sidecar script sits outside dist, so it has to be copied explicitly.
COPY scripts/pdf_lattice_extract.py ./scripts/

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN mkdir -p data/uploads data/exports/pdf uploads logs && chown -R nodejs:nodejs /app

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8787}/api/health || exit 1

USER nodejs

CMD ["node", "dist/index-llm.js"]
