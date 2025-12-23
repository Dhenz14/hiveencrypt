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

// Nodes known to support follow_api (verified working)
// Order by reliability - api.hive.blog is most reliable for follow_api
// Best Hive RPC nodes ordered by reliability (from beacon.peakd.com monitoring)
const FOLLOW_API_NODES = [
  'https://api.hive.blog',         // Official - 100% score
  'https://api.deathwing.me',      // 100% score
  'https://api.openhive.network',  // 100% score
  'https://techcoderx.com',        // 100% score
  'https://hiveapi.actifit.io',    // 100% score
  'https://rpc.mahdiyari.info',    // 100% score
  'https://api.syncad.com',        // 100% score
];

// Track unhealthy nodes for this session (nodes that don't have follow_api)
const unhealthyNodes = new Set<string>();

// Get a client with healthy nodes only
function getFollowApiClient(): Client {
  const healthyNodes = FOLLOW_API_NODES.filter(n => !unhealthyNodes.has(n));
  
  // If all nodes marked unhealthy, reset and try again
  if (healthyNodes.length === 0) {
    logger.warn('[FOLLOWING] All nodes marked unhealthy, resetting');
    unhealthyNodes.clear();
    return new Client(FOLLOW_API_NODES);
  }
  
  return new Client(healthyNodes);
}

// Mark a node as unhealthy (doesn't support follow_api)
function markNodeUnhealthy(nodeUrl: string): void {
  unhealthyNodes.add(nodeUrl);
  logger.warn('[FOLLOWING] Marked node as unhealthy for follow_api:', nodeUrl);
}

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
// In-Memory Shadow Cache (for synchronous access)
// ============================================================================

interface InMemoryCache {
  following: Set<string>;
  timestamp: number;
}

const inMemoryCache = new Map<string, InMemoryCache>();

function setInMemoryCache(username: string, following: string[]): void {
  inMemoryCache.set(username.toLowerCase(), {
    following: new Set(following.map(f => f.toLowerCase())),
    timestamp: Date.now(),
  });
}

function getInMemoryCache(username: string): InMemoryCache | null {
  const cached = inMemoryCache.get(username.toLowerCase());
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    inMemoryCache.delete(username.toLowerCase());
    return null;
  }
  
  return cached;
}

function clearInMemoryCache(username?: string): void {
  if (username) {
    inMemoryCache.delete(username.toLowerCase());
  } else {
    inMemoryCache.clear();
  }
}

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
 * Call follow_api with automatic node failover
 * Tries each node until one works, marks failed nodes as unhealthy
 */
async function callFollowApiWithFailover(
  method: string,
  params: any[]
): Promise<any> {
  const maxAttempts = FOLLOW_API_NODES.length;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const client = getFollowApiClient();
    const currentNode = FOLLOW_API_NODES.find(n => !unhealthyNodes.has(n)) || FOLLOW_API_NODES[0];
    
    try {
      const result = await client.call('follow_api', method, params);
      return result;
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message?.toLowerCase() || '';
      
      // If node doesn't support follow_api, mark it unhealthy
      if (errorMsg.includes('could not find api') || 
          errorMsg.includes('follow_api') ||
          errorMsg.includes('not found')) {
        markNodeUnhealthy(currentNode);
        logger.warn(`[FOLLOWING] Node ${currentNode} doesn't support follow_api, trying next`);
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError || new Error('All nodes failed for follow_api');
}

/**
 * Fetch the complete list of accounts a user follows from Hive blockchain
 * Uses pagination to handle large following lists
 * Now with automatic node failover for nodes missing follow_api
 * 
 * @param username - Hive username to fetch following list for
 * @returns Array of usernames the user follows
 */
export async function fetchFollowingList(username: string): Promise<string[]> {
  try {
    const normalizedUsername = username.toLowerCase();
    logger.info('[FOLLOWING] Fetching following list for:', normalizedUsername);

    const followingSet = new Set<string>(); // Use Set to prevent duplicates
    let startFollowing = '';
    let hasMore = true;
    let iterations = 0;
    const maxIterations = Math.ceil(MAX_FOLLOWING / FETCH_LIMIT);

    while (hasMore && iterations < maxIterations) {
      // Call Hive Follow API with automatic node failover
      const result = await callFollowApiWithFailover('get_following', [
        normalizedUsername,
        startFollowing,
        'blog',
        FETCH_LIMIT
      ]) as FollowingRecord[];

      logger.info(`[FOLLOWING] Fetched ${result.length} accounts (iteration ${iterations + 1})`);

      if (!result || result.length === 0) {
        hasMore = false;
        break;
      }

      // Extract and normalize usernames, skip the duplicate start record on pagination
      const startIndex = (iterations === 0 || startFollowing === '') ? 0 : 1;
      const beforeSize = followingSet.size;
      let lastUniqueAdded: string | null = null;
      
      for (let i = startIndex; i < result.length; i++) {
        const normalized = result[i].following.toLowerCase();
        const sizeBefore = followingSet.size;
        followingSet.add(normalized);
        // Track if this entry was actually new (not a duplicate)
        if (followingSet.size > sizeBefore) {
          lastUniqueAdded = normalized;
        }
      }
      
      // Count how many NEW unique usernames were added this iteration
      const newEntriesAdded = followingSet.size - beforeSize;

      // CRITICAL FIX: Pagination termination logic
      // Stop if we added zero new entries (all duplicates) OR got a partial page
      // Only continue if we got a full page AND added new unique entries
      if (newEntriesAdded === 0 || result.length < FETCH_LIMIT) {
        // No new entries or partial page - we've reached the end
        hasMore = false;
      } else if (result.length === FETCH_LIMIT && lastUniqueAdded) {
        // Full page with new entries - continue from last UNIQUE username we actually added
        startFollowing = lastUniqueAdded;
        hasMore = true;
      } else {
        hasMore = false;
      }

      iterations++;
    }

    const allFollowing = Array.from(followingSet);
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
    const normalizedUsername = username.toLowerCase();
    
    // Check in-memory cache first (fastest)
    if (!forceRefresh) {
      const memCache = getInMemoryCache(normalizedUsername);
      if (memCache) {
        logger.info(`[FOLLOWING] 💾 Using in-memory cache (${memCache.following.size} accounts)`);
        return Array.from(memCache.following);
      }
    }
    
    const db = await getFollowingDB();

    // Check IndexedDB cache unless force refresh
    if (!forceRefresh) {
      const cached = await db.get('following', normalizedUsername);
      
      if (cached) {
        const now = new Date();
        const expiresAt = new Date(cached.expiresAt);

        // Return cached data if not expired
        if (now < expiresAt) {
          logger.info(`[FOLLOWING] 📦 Using IndexedDB cache (${cached.following.length} accounts)`);
          // Populate in-memory cache
          setInMemoryCache(normalizedUsername, cached.following);
          return cached.following;
        }

        logger.info('[FOLLOWING] ⏰ Cache expired, fetching fresh data');
      }
    }

    // Fetch fresh data from blockchain
    const following = await fetchFollowingList(normalizedUsername);

    // Cache the result in both IndexedDB and memory
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    await db.put('following', {
      username: normalizedUsername,
      following,
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    
    setInMemoryCache(normalizedUsername, following);

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
    const normalizedFollower = follower.toLowerCase();
    const normalizedFollowing = following.toLowerCase();
    
    // Try in-memory cache first (synchronous check)
    const memCache = getInMemoryCache(normalizedFollower);
    if (memCache) {
      return memCache.following.has(normalizedFollowing);
    }
    
    // Fall back to async fetch
    const followingList = await getFollowingList(normalizedFollower);
    return followingList.includes(normalizedFollowing);
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error checking follow status:', error);
    return false;
  }
}

/**
 * Synchronous check if a user follows another user
 * Only works if data is in in-memory cache
 * 
 * @param follower - Username who might be following
 * @param following - Username to check if followed
 * @returns boolean | null (null if not in cache)
 */
export function doesUserFollowSync(
  follower: string,
  following: string
): boolean | null {
  const normalizedFollower = follower.toLowerCase();
  const normalizedFollowing = following.toLowerCase();
  
  const memCache = getInMemoryCache(normalizedFollower);
  if (!memCache) return null;
  
  return memCache.following.has(normalizedFollowing);
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
export async function clearFollowingCache(username?: string): Promise<void> {
  try {
    if (username) {
      const normalizedUsername = username.toLowerCase();
      const db = await getFollowingDB();
      await db.delete('following', normalizedUsername);
      clearInMemoryCache(normalizedUsername);
      logger.info('[FOLLOWING] 🗑️ Cache cleared for:', normalizedUsername);
    } else {
      // Clear all caches
      const db = await getFollowingDB();
      const tx = db.transaction('following', 'readwrite');
      await tx.store.clear();
      await tx.done;
      clearInMemoryCache();
      logger.info('[FOLLOWING] 🗑️ All caches cleared');
    }
  } catch (error) {
    logger.error('[FOLLOWING] ❌ Error clearing cache:', error);
  }
}

/**
 * Preload following list into cache (for React Query)
 * This populates both IndexedDB and in-memory caches
 * 
 * @param username - Hive username to preload following list for
 * @returns Promise<string[]> - Following list
 */
export async function preloadFollowingList(username: string): Promise<string[]> {
  return await getFollowingList(username, false);
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
