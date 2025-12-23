/**
 * Sync State Manager
 * 
 * Tracks the last synced block number and operation ID per conversation.
 * Enables incremental sync to fetch only new operations (~80% less data).
 * 
 * Benefits:
 * - Dramatically reduces redundant blockchain fetches
 * - Faster sync after initial load
 * - Lower bandwidth usage
 */

import { logger } from './logger';

interface ConversationSyncState {
  conversationKey: string;
  lastSyncedOpId: number;
  lastSyncedBlockNum: number;
  lastSyncTimestamp: number;
  messageCount: number;
}

interface GroupSyncState {
  groupId: string;
  lastSyncedOpId: number;
  lastSyncedBlockNum: number;
  lastSyncTimestamp: number;
  memberMessageCounts: Record<string, number>;
}

const SYNC_STATE_DB_NAME = 'hive-messenger-sync-state';
const SYNC_STATE_DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;
let currentUsername: string | null = null;

/**
 * Open the sync state database
 */
async function getDB(username?: string): Promise<IDBDatabase> {
  // If username changed, close existing connection
  if (username && currentUsername && username !== currentUsername && dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  
  if (username) {
    currentUsername = username;
  }
  
  if (dbInstance) return dbInstance;

  const dbName = currentUsername 
    ? `${SYNC_STATE_DB_NAME}-${currentUsername}` 
    : SYNC_STATE_DB_NAME;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, SYNC_STATE_DB_VERSION);

    request.onerror = () => {
      logger.error('[SYNC STATE] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains('conversationSync')) {
        db.createObjectStore('conversationSync', { keyPath: 'conversationKey' });
        logger.info('[SYNC STATE] Created conversation sync store');
      }
      
      if (!db.objectStoreNames.contains('groupSync')) {
        db.createObjectStore('groupSync', { keyPath: 'groupId' });
        logger.info('[SYNC STATE] Created group sync store');
      }
    };
  });
}

/**
 * Get sync state for a 1:1 conversation
 */
export async function getConversationSyncState(
  username: string,
  partnerUsername: string
): Promise<ConversationSyncState | null> {
  try {
    const db = await getDB(username);
    const conversationKey = [username, partnerUsername].sort().join('-');

    return new Promise((resolve) => {
      const transaction = db.transaction('conversationSync', 'readonly');
      const store = transaction.objectStore('conversationSync');
      const request = store.get(conversationKey);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        logger.error('[SYNC STATE] Get error:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Get error:', error);
    return null;
  }
}

/**
 * Update sync state for a 1:1 conversation
 */
export async function updateConversationSyncState(
  username: string,
  partnerUsername: string,
  lastOpId: number,
  lastBlockNum: number,
  messageCount?: number
): Promise<void> {
  try {
    const db = await getDB(username);
    const conversationKey = [username, partnerUsername].sort().join('-');

    const state: ConversationSyncState = {
      conversationKey,
      lastSyncedOpId: lastOpId,
      lastSyncedBlockNum: lastBlockNum,
      lastSyncTimestamp: Date.now(),
      messageCount: messageCount || 0
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('conversationSync', 'readwrite');
      const store = transaction.objectStore('conversationSync');
      const request = store.put(state);

      request.onsuccess = () => {
        logger.debug('[SYNC STATE] Updated conversation sync:', conversationKey, 'opId:', lastOpId);
        resolve();
      };

      request.onerror = () => {
        logger.error('[SYNC STATE] Update error:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Update error:', error);
  }
}

/**
 * Get sync state for a group
 */
export async function getGroupSyncState(
  username: string,
  groupId: string
): Promise<GroupSyncState | null> {
  try {
    const db = await getDB(username);

    return new Promise((resolve) => {
      const transaction = db.transaction('groupSync', 'readonly');
      const store = transaction.objectStore('groupSync');
      const request = store.get(groupId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        logger.error('[SYNC STATE] Get group error:', request.error);
        resolve(null);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Get group error:', error);
    return null;
  }
}

/**
 * Update sync state for a group
 */
export async function updateGroupSyncState(
  username: string,
  groupId: string,
  lastOpId: number,
  lastBlockNum: number,
  memberMessageCounts?: Record<string, number>
): Promise<void> {
  try {
    const db = await getDB(username);

    const state: GroupSyncState = {
      groupId,
      lastSyncedOpId: lastOpId,
      lastSyncedBlockNum: lastBlockNum,
      lastSyncTimestamp: Date.now(),
      memberMessageCounts: memberMessageCounts || {}
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('groupSync', 'readwrite');
      const store = transaction.objectStore('groupSync');
      const request = store.put(state);

      request.onsuccess = () => {
        logger.debug('[SYNC STATE] Updated group sync:', groupId, 'opId:', lastOpId);
        resolve();
      };

      request.onerror = () => {
        logger.error('[SYNC STATE] Update group error:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Update group error:', error);
  }
}

/**
 * Get all conversation sync states for a user
 */
export async function getAllConversationSyncStates(
  username: string
): Promise<ConversationSyncState[]> {
  try {
    const db = await getDB(username);

    return new Promise((resolve) => {
      const transaction = db.transaction('conversationSync', 'readonly');
      const store = transaction.objectStore('conversationSync');
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        logger.error('[SYNC STATE] Get all error:', request.error);
        resolve([]);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Get all error:', error);
    return [];
  }
}

/**
 * Clear all sync states for a user
 */
export async function clearAllSyncStates(username: string): Promise<void> {
  try {
    const db = await getDB(username);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['conversationSync', 'groupSync'], 'readwrite');
      
      transaction.objectStore('conversationSync').clear();
      transaction.objectStore('groupSync').clear();

      transaction.oncomplete = () => {
        logger.info('[SYNC STATE] Cleared all sync states');
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error('[SYNC STATE] Clear error:', error);
  }
}

/**
 * Helper to determine if we should do a full sync or incremental
 * Returns true if incremental sync is possible
 */
export function canDoIncrementalSync(
  syncState: ConversationSyncState | GroupSyncState | null,
  maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours
): boolean {
  if (!syncState) return false;
  
  const now = Date.now();
  const age = now - syncState.lastSyncTimestamp;
  
  // If sync state is too old, do full sync
  if (age > maxAgeMs) {
    logger.debug('[SYNC STATE] Sync state too old, doing full sync');
    return false;
  }
  
  return syncState.lastSyncedOpId > 0;
}
