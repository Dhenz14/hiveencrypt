import { hiveClient as optimizedHiveClient } from './hiveClient';
import { normalizeHiveTimestamp } from './hive';
import { logger } from './logger';
import type { Group } from '@/../../shared/schema';

// ============================================================================
// GROUP CHAT: Blockchain Custom JSON Operations
// ============================================================================

export const GROUP_CUSTOM_JSON_ID = 'hive_messenger_group';

export interface GroupCustomJson {
  action: 'create' | 'update' | 'leave';
  groupId: string;
  name?: string;
  members?: string[];
  creator?: string;
  version?: number;
  timestamp: string;
}

/**
 * Generates a unique group ID using crypto.randomUUID()
 */
export function generateGroupId(): string {
  return crypto.randomUUID();
}

/**
 * Broadcasts a group creation custom_json operation to the blockchain
 * This is FREE (no HBD cost) and creates an immutable group record
 */
export async function broadcastGroupCreation(
  username: string,
  groupId: string,
  name: string,
  members: string[]
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting group creation:', { groupId, name, members });

  const customJson: GroupCustomJson = {
    action: 'create',
    groupId,
    name,
    members,
    creator: username,
    version: 1,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Create Group Chat',
      (response: any) => {
        if (response.success) {
          logger.info('[GROUP BLOCKCHAIN] ✅ Group created on blockchain:', response.result.id);
          resolve(response.result.id);
        } else {
          logger.error('[GROUP BLOCKCHAIN] ❌ Failed to create group:', response.error);
          reject(new Error(response.error || 'Failed to broadcast group creation'));
        }
      }
    );
  });
}

/**
 * Broadcasts a group update (membership change) custom_json operation
 */
export async function broadcastGroupUpdate(
  username: string,
  groupId: string,
  name: string,
  members: string[],
  version: number
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting group update:', { groupId, version });

  const customJson: GroupCustomJson = {
    action: 'update',
    groupId,
    name,
    members,
    version,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Update Group Chat',
      (response: any) => {
        if (response.success) {
          logger.info('[GROUP BLOCKCHAIN] ✅ Group updated on blockchain:', response.result.id);
          resolve(response.result.id);
        } else {
          logger.error('[GROUP BLOCKCHAIN] ❌ Failed to update group:', response.error);
          reject(new Error(response.error || 'Failed to broadcast group update'));
        }
      }
    );
  });
}

/**
 * Broadcasts a "leave group" custom_json operation
 */
export async function broadcastLeaveGroup(
  username: string,
  groupId: string
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting leave group:', groupId);

  const customJson: GroupCustomJson = {
    action: 'leave',
    groupId,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Leave Group Chat',
      (response: any) => {
        if (response.success) {
          logger.info('[GROUP BLOCKCHAIN] ✅ Left group on blockchain:', response.result.id);
          resolve(response.result.id);
        } else {
          logger.error('[GROUP BLOCKCHAIN] ❌ Failed to leave group:', response.error);
          reject(new Error(response.error || 'Failed to broadcast leave group'));
        }
      }
    );
  });
}

/**
 * Discovers all groups where the user is a member by scanning account history
 * Returns the most recent version of each group
 */
export async function discoverUserGroups(username: string): Promise<Group[]> {
  logger.info('[GROUP BLOCKCHAIN] Discovering groups for user:', username);

  try {
    // Scan account history for ALL operations (not just transfers)
    // We need custom_json operations, not transfer operations
    const history = await optimizedHiveClient.getAccountHistory(
      username,
      1000,      // limit
      false,     // filterTransfersOnly = false (we want custom_json)
      -1         // start = -1 (latest)
    );

    logger.info('[GROUP BLOCKCHAIN] Scanned', history.length, 'operations');

    // Parse and aggregate group operations by groupId
    const groupMap = new Map<string, Group>();
    const leftGroups = new Set<string>(); // Track groups user has left

    for (const [, operation] of history) {
      try {
        const op = operation[1].op;
        
        // Ensure it's a custom_json operation with our ID
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData: GroupCustomJson = JSON.parse(op[1].json);
        const { groupId, action } = jsonData;

        // Handle "leave" action
        if (action === 'leave') {
          leftGroups.add(groupId);
          groupMap.delete(groupId); // Remove from discovered groups
          continue;
        }

        // Only include groups where user is a member
        if (!jsonData.members?.includes(username)) {
          continue;
        }

        // If user has left this group, skip it
        if (leftGroups.has(groupId)) {
          continue;
        }

        // Check if we already have this group with a newer version
        const existing = groupMap.get(groupId);
        if (existing && existing.version >= (jsonData.version || 1)) {
          continue; // Skip older versions
        }

        // Create or update group entry
        const group: Group = {
          groupId,
          name: jsonData.name || 'Unnamed Group',
          members: jsonData.members || [],
          creator: jsonData.creator || username,
          createdAt: normalizeHiveTimestamp(jsonData.timestamp),
          version: jsonData.version || 1,
        };

        groupMap.set(groupId, group);
      } catch (parseError) {
        logger.warn('[GROUP BLOCKCHAIN] Failed to parse group operation:', parseError);
        continue;
      }
    }

    const discoveredGroups = Array.from(groupMap.values());
    logger.info('[GROUP BLOCKCHAIN] ✅ Discovered', discoveredGroups.length, 'groups');

    return discoveredGroups;
  } catch (error) {
    logger.error('[GROUP BLOCKCHAIN] ❌ Failed to discover groups:', error);
    return [];
  }
}

/**
 * Checks if a message memo contains a group prefix
 * Group messages are formatted as: "group:{groupId}:{encryptedContent}"
 * Returns null if malformed (instead of throwing) to prevent crashes
 */
export function parseGroupMessageMemo(memo: string): { isGroupMessage: boolean; groupId?: string; content?: string } | null {
  try {
    const groupPrefix = 'group:';
    
    if (!memo.startsWith(groupPrefix)) {
      return { isGroupMessage: false };
    }

    // Parse format: group:{groupId}:{content}
    const parts = memo.split(':');
    
    if (parts.length < 3) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (too few parts):', memo.substring(0, 50));
      return null;
    }

    const groupId = parts[1];
    const content = parts.slice(2).join(':'); // Rejoin in case content contains ":"

    // Basic validation
    if (!groupId || !content) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (missing groupId or content)');
      return null;
    }

    return {
      isGroupMessage: true,
      groupId,
      content,
    };
  } catch (error) {
    logger.warn('[GROUP BLOCKCHAIN] Failed to parse group message memo:', error);
    return null;
  }
}

/**
 * Formats a message for group sending
 * Returns the prefixed memo that will be encrypted
 */
export function formatGroupMessageMemo(groupId: string, message: string): string {
  return `group:${groupId}:${message}`;
}
