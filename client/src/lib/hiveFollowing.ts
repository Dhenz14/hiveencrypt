/**
 * Hive Following/Friendslist Integration
 * 
 * Provides access to Hive's built-in follow system to enable:
 * - Privacy controls (friend-only groups and messages)
 * - Contact discovery (suggest followed accounts)
 * - Trust indicators (show badges for followed users)
 * 
 * Uses Hive Follow API with IndexedDB caching for performance.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Client } from '@hiveio/dhive';
import { logger } from './logger';

// Use direct dhive client for follow API (not supported by HiveBlockchainClient)
const hiveClient = new Client([
  'https://api.hive.blog',
  'https://anyx.io',
  'https://api.openhive.network',
]);

// ============================================================================
// Type Definitions
// ============================================================================

export interface FollowingRecord {
  follower: string;      // Your username
  following: string;     // Account you follow
  what: string[];        // ['blog'] = following, ['ignore'] = muted
}

export interface FollowingCache {
  username: string;      // Primary key (your username)
  following: string[];   // Array of usernames you follow
  cachedAt: string;      // ISO timestamp
  expiresAt: string;     // ISO timestamp (cache TTL)
}

interface HiveFollowingDB extends DBSchema {
  following: {
    key: string;         // username
    value: FollowingCache;
  };
}

// ============================================================================
// Configuration
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000;          // 5 minutes cache
const FETCH_LIMIT = 1000;                     // Max accounts per API call
const MAX_FOLLOWING = 10000;                  // Safety limit for pagination

// ============================================================================
// IndexedDB Setup
// ============================================================================

let followingDbInstance: IDBPDatabase<HiveFollowingDB> | null = null;

async function getFollowingDB(): Promise<IDBPDatabase<HiveFollowingDB>> {
  if (followingDbInstance) {
    return followingDbInstance;
  }

  followingDbInstance = await openDB<HiveFollowingDB>('hive-following-cache-v1', 1, {
    upgrade(db) {
      // Create following cache store
      if (!db.objectStoreNames.contains('following')) {
        db.createObjectStore('following', { keyPath: 'username' });
      }
    },
  });

  return followingDbInstance;
}

// ============================================================================
// Core Following API Functions
// ============================================================================

/**
 * Fetch the complete list of accounts a user follows from Hive blockchain
 * Uses pagination to handle large following lists
 * 
 * @param username - Hive username to fetch following list for
 * @returns Array of usernames the user follows
 */
export async function fetchFollowingList(username: string): Promise<string[]> {
  try {
    logger.info('[FOLLOWING] Fetching following list for:', username);

    const allFollowing: string[] = [];
    let startFollowing = '';
    let hasMore = true;
    let iterations = 0;
    const maxIterations = Math.ceil(MAX_FOLLOWING / FETCH_LIMIT);

    while (hasMore && iterations < maxIterations) {
      // Call Hive Follow API using optimized client
      const result = await hiveClient.call('follow_api', 'get_following', [
        username,
        startFollowing,
        'blog',
        FETCH_LIMIT
      ]) as FollowingRecord[];

      logger.info(`[FOLLOWING] Fetched ${result.length} accounts (iteration ${iterations + 1})`);

      if (!result || result.length === 0) {
        hasMore = false;
        break;
      }

      // Extract usernames from results
      const usernames = result.map(record => record.following);
      allFollowing.push(...usernames);

      // Check if we need to paginate
      if (result.length < FETCH_LIMIT) {
        hasMore = false;
      } else {
        // Set start for next page (last username from current page)
        startFollowing = result[result.length - 1].following;
      }

      iterations++;
    }

    logger.info(`[FOLLOWING] ✅ Total following: ${allFollowing.length} accounts`);
    return allFollowing;

  } catch (error) {
    logger.error('[FOLLOWING] ❌ Failed to fetch following list:', error);
    throw new Error(`Failed to fetch following list: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get following list with caching
 * Checks IndexedDB cache first, fetches from blockchain if expired
 * 
 * @param username - Hive username
 * @param forceRefresh - Skip cache and fetch fresh data
 * @returns Array of usernames the user follows
 */
export async function getFollowingList(
  username: string,
  forceRefresh: boolean = false
): Promise<string[]> {
  try {
    const db = await getFollowingDB();

    // Check cache unless force refresh
    if (!forceRefresh) {
      const cached = await db.get('following', username);
      
      if (cached) {
        const now = new Date();
        const expiresAt = new Date(cached.expiresAt);

        // Return cached data if not expired
        if (now < expiresAt) {
          logger.info(`[FOLLOWING] 📦 Using cached data (${cached.following.length} accounts)`);
          return cached.following;
        }

        logger.info('[FOLLOWING] ⏰ Cache expired, fetching fresh data');
      }
    }

    // Fetch fresh data from blockchain
    const following = await fetchFollowingList(username);

    // Cache the result
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    await db.put('following', {
      username,
      following,
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return following;

  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error getting following list:', error);
    // Return empty array instead of throwing to prevent UI crashes
    return [];
  }
}

/**
 * Check if a user follows another user
 * Uses cached following list for performance
 * 
 * @param follower - Username who might be following
 * @param following - Username to check if followed
 * @returns true if follower follows following
 */
export async function doesUserFollow(
  follower: string,
  following: string
): Promise<boolean> {
  try {
    const followingList = await getFollowingList(follower);
    return followingList.includes(following);
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error checking follow status:', error);
    return false;
  }
}

/**
 * Check if a user follows multiple users (batch check)
 * More efficient than calling doesUserFollow multiple times
 * 
 * @param follower - Username who might be following
 * @param targets - Array of usernames to check
 * @returns Map of username -> isFollowed
 */
export async function checkMultipleFollows(
  follower: string,
  targets: string[]
): Promise<Map<string, boolean>> {
  try {
    const followingList = await getFollowingList(follower);
    const followingSet = new Set(followingList);

    const results = new Map<string, boolean>();
    for (const target of targets) {
      results.set(target, followingSet.has(target));
    }

    return results;
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error checking multiple follows:', error);
    // Return all false on error
    const results = new Map<string, boolean>();
    for (const target of targets) {
      results.set(target, false);
    }
    return results;
  }
}

/**
 * Clear following cache for a user
 * Useful for forcing a refresh after follow/unfollow operations
 * 
 * @param username - Username to clear cache for
 */
export async function clearFollowingCache(username: string): Promise<void> {
  try {
    const db = await getFollowingDB();
    await db.delete('following', username);
    logger.info('[FOLLOWING] 🗑️ Cache cleared for:', username);
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error clearing cache:', error);
  }
}

/**
 * Get cache status for debugging
 * 
 * @param username - Username to check cache status for
 * @returns Cache info or null if not cached
 */
export async function getFollowingCacheInfo(username: string): Promise<{
  cached: boolean;
  count: number;
  cachedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
} | null> {
  try {
    const db = await getFollowingDB();
    const cached = await db.get('following', username);

    if (!cached) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(cached.expiresAt);
    const expired = now >= expiresAt;

    return {
      cached: true,
      count: cached.following.length,
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      expired,
    };
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error getting cache info:', error);
    return null;
  }
}
