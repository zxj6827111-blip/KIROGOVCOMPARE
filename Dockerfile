FROM node:20-alpine

# Puppeteer / Chromium system dependencies
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Install production dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy built application
COPY dist ./dist

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8787}/api/health || exit 1

USER nodejs

CMD ["node", "dist/index-llm.js"]
