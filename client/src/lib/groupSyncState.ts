/**
 * Group Message Sync State Management
 * 
 * Tracks the last scanned blockchain operation index for each user
 * to enable incremental pagination and prevent message loss.
 */

const STORAGE_KEY_PREFIX = 'hive-messenger-group-sync';
const MAX_BACKFILL_OPERATIONS = 1000;

/**
 * Get the last synced operation index for a user
 * Returns null if no sync has occurred yet (first time)
 */
export const getLastSyncedOperation = (username: string): number | null => {
  if (!username) return null;
  
  const key = `${STORAGE_KEY_PREFIX}-${username}`;
  const value = localStorage.getItem(key);
  
  if (!value) return null;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
};

/**
 * Store the last synced operation index for a user
 */
export const setLastSyncedOperation = (username: string, opIndex: number): void => {
  if (!username || typeof opIndex !== 'number' || opIndex < 0) {
    return;
  }
  
  const key = `${STORAGE_KEY_PREFIX}-${username}`;
  localStorage.setItem(key, opIndex.toString());
};

/**
 * Clear sync state for a user (useful for logout or reset)
 */
export const clearSyncState = (username: string): void => {
  if (!username) return;
  
  const key = `${STORAGE_KEY_PREFIX}-${username}`;
  localStorage.removeItem(key);
};

/**
 * Get the maximum number of operations to backfill
 * Prevents excessive API calls for users who've been offline
 */
export const getMaxBackfill = (): number => {
  return MAX_BACKFILL_OPERATIONS;
};

/**
 * Check if the gap between last synced and current is too large
 * Returns true if we need to show a warning about potentially missed messages
 */
export const shouldShowBackfillWarning = (
  lastSyncedOp: number | null,
  currentLatestOp: number
): boolean => {
  if (lastSyncedOp === null) {
    // First sync - no warning needed
    return false;
  }
  
  const gap = currentLatestOp - lastSyncedOp;
  return gap > MAX_BACKFILL_OPERATIONS;
};
