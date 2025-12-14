import redisClient from '../config/redis';
import { AISuggestion } from '../types/models';

const CACHE_TTL = 30 * 24 * 60 * 60; // 30天

export class AISuggestionCacheService {
  /**
   * 生成缓存键
   */
  private generateCacheKey(compareTaskId: string, aiConfigVersion: number): string {
    return `ai_suggestion:${compareTaskId}:${aiConfigVersion}`;
  }

  /**
   * 获取缓存的建议
   */
  async getCachedSuggestion(
    compareTaskId: string,
    aiConfigVersion: number
  ): Promise<AISuggestion | null> {
    try {
      const key = this.generateCacheKey(compareTaskId, aiConfigVersion);
      const cached = await redisClient.get(key);

      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('获取缓存建议失败:', error);
    }
    return null;
  }

  /**
   * 缓存建议
   */
  async cacheSuggestion(
    compareTaskId: string,
    aiConfigVersion: number,
    suggestion: AISuggestion
  ): Promise<boolean> {
    try {
      const key = this.generateCacheKey(compareTaskId, aiConfigVersion);
      await redisClient.setEx(key, CACHE_TTL, JSON.stringify(suggestion));
      return true;
    } catch (error) {
      console.error('缓存建议失败:', error);
      return false;
    }
  }

  /**
   * 清除缓存
   */
  async clearCache(compareTaskId: string, aiConfigVersion?: number): Promise<boolean> {
    try {
      if (aiConfigVersion !== undefined) {
        const key = this.generateCacheKey(compareTaskId, aiConfigVersion);
        await redisClient.del(key);
      } else {
        // 清除该任务的所有版本缓存
        const pattern = `ai_suggestion:${compareTaskId}:*`;
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          // Redis v4 del 接受单个或多个键
          for (const key of keys) {
            await redisClient.del(key);
          }
        }
      }
      return true;
    } catch (error) {
      console.error('清除缓存失败:', error);
      return false;
    }
  }

  /**
   * 清除旧版本缓存
   */
  async clearOldVersions(compareTaskId: string, currentVersion: number): Promise<boolean> {
    try {
      const pattern = `ai_suggestion:${compareTaskId}:*`;
      const keys = await redisClient.keys(pattern);

      for (const key of keys) {
        // 提取版本号
        const parts = key.split(':');
        if (parts.length === 3) {
          const version = parseInt(parts[2]);
          if (version < currentVersion) {
            await redisClient.del(key);
          }
        }
      }
      return true;
    } catch (error) {
      console.error('清除旧版本缓存失败:', error);
      return false;
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    totalSize: number;
  }> {
    try {
      const keys = await redisClient.keys('ai_suggestion:*');
      let totalSize = 0;

      for (const key of keys) {
        const size = await redisClient.strLen(key);
        totalSize += size;
      }

      return {
        totalKeys: keys.length,
        totalSize,
      };
    } catch (error) {
      console.error('获取缓存统计失败:', error);
      return { totalKeys: 0, totalSize: 0 };
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const keys = await redisClient.keys('ai_suggestion:*');
      let cleaned = 0;

      for (const key of keys) {
        const ttl = await redisClient.ttl(key);
        if (ttl === -1) {
          // 没有设置过期时间，删除
          await redisClient.del(key);
          cleaned++;
        }
      }

      return cleaned;
    } catch (error) {
      console.error('清理过期缓存失败:', error);
      return 0;
    }
  }
}

export default new AISuggestionCacheService();
