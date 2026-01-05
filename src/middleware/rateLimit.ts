import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  store?: RateLimitStore;
};

type RateLimitEntry = {
  count: number;
  expiresAt: number;
};

type RateLimitResult = {
  count: number;
  resetMs: number;
};

type RateLimitStore = {
  increment: (key: string, windowMs: number) => Promise<RateLimitResult>;
};

type RedisStoreOptions = {
  url?: string;
  host?: string;
  port?: number;
  db?: number;
  prefix?: string;
};

function defaultKeyGenerator(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]?.trim();
  return ip || req.ip || 'unknown';
}

class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.store.set(key, { count: 1, expiresAt: now + windowMs });
      return { count: 1, resetMs: windowMs };
    }

    entry.count += 1;
    return { count: entry.count, resetMs: Math.max(0, entry.expiresAt - now) };
  }
}

class RedisRateLimitStore implements RateLimitStore {
  private client;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private failed = false;
  private options: RedisStoreOptions;

  constructor(options: RedisStoreOptions) {
    this.options = options;
    this.client = createClient({
      url: this.options.url,
      socket: this.options.url
        ? undefined
        : {
          host: this.options.host || process.env.REDIS_HOST || 'localhost',
          port: this.options.port ?? Number(process.env.REDIS_PORT || 6379),
        },
      database: this.options.db ?? Number(process.env.REDIS_DB || 0),
    });

    this.client.on('error', (err) => {
      if (!this.failed) {
        console.warn('Rate limit Redis error:', err);
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connecting) {
      await this.connecting;
      return;
    }
    this.connecting = this.client.connect()
      .then(() => {
        this.connected = true;
      })
      .catch((err) => {
        this.failed = true;
        this.connected = false;
        throw err;
      })
      .finally(() => {
        this.connecting = null;
      });
    await this.connecting;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    await this.ensureConnected();
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const prefix = this.options.prefix ?? process.env.RATE_LIMIT_REDIS_PREFIX ?? 'rate_limit:';
    const redisKey = `${prefix}${key}:${bucket}`;
    const count = await this.client.incr(redisKey);
    if (count === 1) {
      await this.client.pExpire(redisKey, windowMs);
      return { count, resetMs: windowMs };
    }
    const ttl = await this.client.pTTL(redisKey);
    const resetMs = ttl > 0 ? ttl : windowMs;
    return { count, resetMs };
  }
}

export function createRedisStore(options: RedisStoreOptions = {}): RateLimitStore {
  return new RedisRateLimitStore({
    url: options.url ?? process.env.RATE_LIMIT_REDIS_URL ?? process.env.REDIS_URL,
    host: options.host,
    port: options.port,
    db: options.db,
    prefix: options.prefix,
  });
}

export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : 60_000;
  const max = Number.isFinite(options.max) && options.max > 0 ? options.max : 300;
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const store: RateLimitStore = options.store || new MemoryRateLimitStore();

  return async (req: Request, res: Response, next: NextFunction) => {
    if (options.skip && options.skip(req)) {
      next();
      return;
    }

    const key = keyGenerator(req);
    try {
      const result = await store.increment(key, windowMs);
      if (result.count > max) {
        const retryAfter = Math.ceil(result.resetMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'rate_limited', retry_after: retryAfter });
        return;
      }
    } catch (error) {
      console.warn('Rate limit store error, allowing request:', error);
    }

    next();
  };
}
