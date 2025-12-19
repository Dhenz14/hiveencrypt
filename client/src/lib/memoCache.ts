import { logger } from './logger';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

class LRUMemoCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private stats: CacheStats;

  constructor(maxSize: number = 1000, ttlMs: number = 300000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      maxSize,
      hitRate: 0,
    };
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      this.updateHitRate();
      logger.debug('[MEMO CACHE] Entry expired:', key.substring(0, 20) + '...');
      return null;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    this.updateHitRate();

    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      entry.value = value;
      entry.timestamp = Date.now();
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.cache.delete(key);
      this.cache.set(key, entry);
      return;
    }

    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccess: Date.now(),
    });

    this.stats.size = this.cache.size;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    this.stats.size = this.cache.size;
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      maxSize: this.maxSize,
      hitRate: 0,
    };
    logger.info('[MEMO CACHE] Cache cleared');
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;

    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        pruned++;
      }
    }

    this.stats.size = this.cache.size;

    if (pruned > 0) {
      logger.info('[MEMO CACHE] Pruned', pruned, 'expired entries');
    }

    return pruned;
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  private evictLRU(): void {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size = this.cache.size;
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

export const decryptedMemoCache = new LRUMemoCache<string>(2000, 600000);

export function getCachedDecryptedMemo(encryptedMemo: string, txId: string): string | null {
  const cacheKey = `${txId}:${encryptedMemo.substring(0, 32)}`;
  return decryptedMemoCache.get(cacheKey);
}

export function cacheDecryptedMemo(encryptedMemo: string, txId: string, decryptedContent: string): void {
  const cacheKey = `${txId}:${encryptedMemo.substring(0, 32)}`;
  decryptedMemoCache.set(cacheKey, decryptedContent);
  ensurePruneInterval();
}

export function getMemoCacheStats(): CacheStats {
  return decryptedMemoCache.getStats();
}

export function pruneExpiredMemos(): number {
  return decryptedMemoCache.prune();
}

export function clearMemoCache(): void {
  decryptedMemoCache.clear();
}

let pruneIntervalId: ReturnType<typeof setInterval> | null = null;

function ensurePruneInterval(): void {
  if (pruneIntervalId !== null) return;
  if (typeof window === 'undefined') return;
  
  pruneIntervalId = setInterval(() => {
    const pruned = pruneExpiredMemos();
    if (pruned > 0) {
      const stats = getMemoCacheStats();
      logger.debug('[MEMO CACHE] Auto-prune complete. Stats:', stats);
    }
  }, 60000);
}

function stopPruneInterval(): void {
  if (pruneIntervalId !== null) {
    clearInterval(pruneIntervalId);
    pruneIntervalId = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', stopPruneInterval);
}
