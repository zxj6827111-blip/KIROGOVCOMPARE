#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env file with your database configuration."
    exit 1
fi

# Load .env to check configuration (optional, just for verification)
if grep -q "DATABASE_TYPE=postgres" .env; then
    echo "✅ Configuration check: DATABASE_TYPE is postgres"
else
    echo "⚠️  Warning: DATABASE_TYPE is not set to 'postgres' in .env"
    echo "   Current value: $(grep DATABASE_TYPE .env)"
    echo "   The server might default to SQLite."
fi

# Build the project first
echo "🔨 Building project..."
npm run build

# Start with PM2
echo "🚀 Starting application with PM2..."
if command -v pm2 >/dev/null 2>&1; then
    pm2 delete kiro-backend 2>/dev/null || true
    pm2 start dist/index-llm.js --name "kiro-backend" --node-args="-r dotenv/config"
    pm2 save
    echo "✅ Application started!"
    echo "   Use 'pm2 logs kiro-backend' to view logs."
else
    echo "⚠️  PM2 not found. Starting with node directly..."
    # Fallback to direct node execution
    node -r dotenv/config dist/index-llm.js
fi
