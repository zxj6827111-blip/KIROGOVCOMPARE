# Production Deployment Checklist

## Required Environment Variables

### Security-Critical (MUST change from defaults)

| Variable | Default | Required Action |
|----------|---------|-----------------|
| `JWT_SECRET` | *(empty)* | Generate a 64+ char random hex string. Used to sign all auth tokens. |
| `ADMIN_BOOTSTRAP_TOKEN` | *(empty)* | Generate a 32+ char random string. Used for one-time admin password reset. |
| `DB_PASSWORD` | `postgres` | Change to a strong random password. |

### LLM / AI Service URLs (MUST use HTTPS)

| Variable | Notes |
|----------|-------|
| `OPENAI_BASE_URL` | Must use `https://` unless relay is on `localhost`/`127.0.0.1`. HTTP remote URLs are blocked at runtime in production. |
| `VISION_REVIEW_BASE_URL` | Same HTTPS requirement as above. |
| `GEMINI_OPENAI_BASE_URL` | Same HTTPS requirement as above. |

### CORS

| Variable | Notes |
|----------|-------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins. Must NOT be `*` in production. |

## Health Check

`GET /api/health` returns `{"status":"ok","database":"connected"}` when healthy.

Use this endpoint for load balancer, container orchestrator, or monitoring health probes.

## Generating Secrets

```bash
# JWT_SECRET (64 hex chars)
openssl rand -hex 32

# ADMIN_BOOTSTRAP_TOKEN (32 chars)
openssl rand -base64 24

# DB_PASSWORD (24 chars)
openssl rand -base64 18
```

## Docker

The Dockerfile uses Node 20 Alpine with Chromium for Puppeteer PDF rendering.
Ensure the container has sufficient memory (512MB+) for Puppeteer browser instances.
