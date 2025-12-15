import { createClient } from 'redis';

// 优先支持 REDIS_URL，无则回退到 REDIS_* 环境变量
const getRedisConfig = () => {
  if (process.env.REDIS_URL) {
    console.log('[Redis] 使用 REDIS_URL 连接');
    return {
      url: process.env.REDIS_URL,
    };
  }

  console.log('[Redis] 使用 REDIS_* 环境变量连接');
  return {
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  };
};

const redisClient = createClient(getRedisConfig());

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('✓ Redis Client Connected');
});

export default redisClient;
