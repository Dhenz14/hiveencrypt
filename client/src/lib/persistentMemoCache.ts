/**
 * Persistent Memo Cache with TTL
 * 
 * Stores decrypted memos in IndexedDB to eliminate re-decryption across sessions.
 * Uses a 24-hour TTL to balance storage with freshness.
 * 
 * Benefits:
 * - Eliminates redundant Keychain prompts
 * - Instant message display on app reload
 * - Reduces Keychain rate limiting issues
 */

import { logger } from './logger';

interface CachedMemo {
  cacheKey: string;          // Hash of encrypted memo (primary key)
  encryptedMemo: string;     // Original encrypted content
  decryptedContent: string;  // Decrypted content
  cachedAt: number;          // Timestamp when cached
  expiresAt: number;         // TTL expiration timestamp
  accessCount: number;       // Usage tracking
  lastAccess: number;        // Last access timestamp
}

// Configuration
const CACHE_DB_NAME = 'hive-messenger-memo-cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'decryptedMemos';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 5000; // Maximum entries before cleanup

let dbInstance: IDBDatabase | null = null;

/**
 * Generate a cache key from encrypted memo content
 * Uses first 64 chars of memo as key (sufficient for uniqueness)
 */
function generateCacheKey(encryptedMemo: string): string {
  return encryptedMemo.substring(0, 64);
}

/**
 * Open or get the IndexedDB database
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onerror = () => {
      logger.error('[MEMO CACHE] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('by-expiry', 'expiresAt');
        store.createIndex('by-access', 'lastAccess');
        logger.info('[MEMO CACHE] Created persistent memo cache store');
      }
    };
  });
}

/**
 * Cache a decrypted memo
 */
export async function cacheDecryptedMemo(
  encryptedMemo: string,
  decryptedContent: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  try {
    const db = await getDB();
    const now = Date.now();
    const cacheKey = generateCacheKey(encryptedMemo);

    const entry: CachedMemo = {
      cacheKey,
      encryptedMemo,
      decryptedContent,
      cachedAt: now,
      expiresAt: now + ttlMs,
      accessCount: 1,
      lastAccess: now
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      
      const request = store.put(entry);
      
      request.onsuccess = () => {
        logger.debug('[MEMO CACHE] Cached memo, key:', cacheKey.substring(0, 20) + '...');
        resolve();
      };
      
      request.onerror = () => {
        logger.error('[MEMO CACHE] Failed to cache memo:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error('[MEMO CACHE] Cache error:', error);
  }
}

/**
 * Get a cached decrypted memo
 * Returns null if not found or expired
 */
export async function getCachedDecryptedMemo(encryptedMemo: string): Promise<string | null> {
  try {
    const db = await getDB();
    const cacheKey = generateCacheKey(encryptedMemo);
    const now = Date.now();

    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      
      const request = store.get(cacheKey);
      
      request.onsuccess = () => {
        const entry = request.result as CachedMemo | undefined;
        
        if (!entry) {
          resolve(null);
          return;
        }

        // Check if expired
        if (entry.expiresAt < now) {
          // Delete expired entry
          store.delete(cacheKey);
          logger.debug('[MEMO CACHE] Expired entry removed');
          resolve(null);
          return;
        }

        // Update access stats
        entry.accessCount++;
        entry.lastAccess = now;
        store.put(entry);

        resolve(entry.decryptedContent);
      };
      
      request.onerror = () => {
        logger.error('[MEMO CACHE] Failed to get cached memo:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    logger.error('[MEMO CACHE] Get error:', error);
    return null;
  }
}

/**
 * Batch get multiple cached memos
 * Returns a Map of cacheKey -> decryptedContent
 */
export async function batchGetCachedMemos(encryptedMemos: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  try {
    const db = await getDB();
    const now = Date.now();

    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      
      let pending = encryptedMemos.length;
      
      for (const memo of encryptedMemos) {
        const cacheKey = generateCacheKey(memo);
        const request = store.get(cacheKey);
        
        request.onsuccess = () => {
          const entry = request.result as CachedMemo | undefined;
          
          if (entry && entry.expiresAt >= now) {
            results.set(memo, entry.decryptedContent);
            
            // Update access stats
            entry.accessCount++;
            entry.lastAccess = now;
            store.put(entry);
          }
          
          pending--;
          if (pending === 0) {
            logger.info('[MEMO CACHE] Batch get:', results.size, '/', encryptedMemos.length, 'hits');
            resolve(results);
          }
        };
        
        request.onerror = () => {
          pending--;
          if (pending === 0) {
            resolve(results);
          }
        };
      }

      // Handle empty array case
      if (encryptedMemos.length === 0) {
        resolve(results);
      }
    });
  } catch (error) {
    logger.error('[MEMO CACHE] Batch get error:', error);
    return results;
  }
}

/**
 * Clean up expired entries
 */
export async function cleanupExpiredEntries(): Promise<number> {
  try {
    const db = await getDB();
    const now = Date.now();
    let deletedCount = 0;

    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      const index = store.index('by-expiry');
      
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          logger.info('[MEMO CACHE] Cleanup complete, removed', deletedCount, 'expired entries');
          resolve(deletedCount);
        }
      };
      
      request.onerror = () => {
        logger.error('[MEMO CACHE] Cleanup error:', request.error);
        resolve(deletedCount);
      };
    });
  } catch (error) {
    logger.error('[MEMO CACHE] Cleanup error:', error);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  expiredEntries: number;
  cacheSize: number;
}> {
  try {
    const db = await getDB();
    const now = Date.now();

    return new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      
      let totalEntries = 0;
      let expiredEntries = 0;
      
      const request = store.openCursor();
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          totalEntries++;
          const entry = cursor.value as CachedMemo;
          if (entry.expiresAt < now) {
            expiredEntries++;
          }
          cursor.continue();
        } else {
          resolve({
            totalEntries,
            expiredEntries,
            cacheSize: totalEntries - expiredEntries
          });
        }
      };
      
      request.onerror = () => {
        resolve({ totalEntries: 0, expiredEntries: 0, cacheSize: 0 });
      };
    });
  } catch (error) {
    return { totalEntries: 0, expiredEntries: 0, cacheSize: 0 };
  }
}

/**
 * Clear all cached memos
 */
export async function clearMemoCache(): Promise<void> {
  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      
      const request = store.clear();
      
      request.onsuccess = () => {
        logger.info('[MEMO CACHE] Cache cleared');
        resolve();
      };
      
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error('[MEMO CACHE] Clear error:', error);
  }
}

// Run cleanup on module load (async, non-blocking)
setTimeout(() => {
  cleanupExpiredEntries().catch(() => {});
}, 5000);
