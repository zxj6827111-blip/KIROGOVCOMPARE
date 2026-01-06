#!/bin/bash
# Install dependencies required for Puppeteer/Chrome on Ubuntu/Debian Linux
# Run with: sudo bash scripts/install-chrome-deps.sh

echo "Installing Chrome/Puppeteer dependencies..."

# Update package list
apt-get update

# Install required libraries for headless Chrome
# Chrome dependencies
apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    wget \
    ca-certificates

# Chinese fonts for PDF export (fixes □□□ display issue)
echo "Installing Chinese fonts..."
apt-get install -y \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-wqy-zenhei \
    fonts-wqy-microhei

# Rebuild font cache
fc-cache -fv

# Alternative minimal set if above fails
# apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

echo "Chrome dependencies installed successfully!"
echo "You may need to restart your Node.js application for changes to take effect."
