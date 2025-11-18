/**
 * Custom group names management
 * Allows users to set custom names for groups when metadata can't be found
 * Stored in localStorage per user
 */

const STORAGE_KEY_PREFIX = 'hive-messenger-custom-group-names';

function getStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}-${username}`;
}

/**
 * Get custom group names for a user
 */
export function getCustomGroupNames(username: string): Record<string, string> {
  try {
    const stored = localStorage.getItem(getStorageKey(username));
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('[CUSTOM GROUP NAMES] Failed to load custom names:', error);
    return {};
  }
}

/**
 * Set a custom name for a group
 */
export function setCustomGroupName(username: string, groupId: string, customName: string): void {
  try {
    const names = getCustomGroupNames(username);
    names[groupId] = customName;
    localStorage.setItem(getStorageKey(username), JSON.stringify(names));
    console.log('[CUSTOM GROUP NAMES] Set custom name for group:', groupId, 'name:', customName);
  } catch (error) {
    console.error('[CUSTOM GROUP NAMES] Failed to save custom name:', error);
    throw error;
  }
}

/**
 * Remove a custom name for a group (revert to default)
 */
export function removeCustomGroupName(username: string, groupId: string): void {
  try {
    const names = getCustomGroupNames(username);
    delete names[groupId];
    localStorage.setItem(getStorageKey(username), JSON.stringify(names));
    console.log('[CUSTOM GROUP NAMES] Removed custom name for group:', groupId);
  } catch (error) {
    console.error('[CUSTOM GROUP NAMES] Failed to remove custom name:', error);
    throw error;
  }
}

/**
 * Get a custom name for a specific group (or null if not set)
 */
export function getCustomGroupName(username: string, groupId: string): string | null {
  const names = getCustomGroupNames(username);
  return names[groupId] || null;
}

/**
 * Check if a group has a custom name set
 */
export function hasCustomGroupName(username: string, groupId: string): boolean {
  return getCustomGroupName(username, groupId) !== null;
}
