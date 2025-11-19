import { hiveClient as optimizedHiveClient } from './hiveClient';
import { normalizeHiveTimestamp } from './hive';
import { logger } from './logger';
import type { Group } from '@/../../shared/schema';

// ============================================================================
// GROUP CHAT: Blockchain Custom JSON Operations
// ============================================================================

// Configuration for deep backfill scanning
export const MAX_DEEP_BACKFILL_OPS = 5000; // Maximum total operations to scan during deep backfill
export const BACKFILL_CHUNK_SIZE = 1000;   // Hive RPC hard limit per request

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

// In-memory caches for group metadata lookups to prevent repeated expensive RPC calls
// Sender-level cache: `${groupId}:${knownMember}` → group metadata
const metadataCache = new Map<string, { group: Group | null; timestamp: number }>();
// Group-level positive cache: `${groupId}` → group metadata (if found from any sender)
const groupPositiveCache = new Map<string, { group: Group; timestamp: number }>();
// Group-level negative cache: `${groupId}` → null (if all attempted senders failed)
const groupNegativeCache = new Map<string, { timestamp: number }>();
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Looks up group metadata by querying the blockchain for a specific groupId
 * Searches through the history of a known member to find group custom_json operations
 * Uses in-memory memoization to prevent repeated expensive RPC calls
 */
export async function lookupGroupMetadata(groupId: string, knownMember: string): Promise<Group | null> {
  // Cache key used throughout the function
  const cacheKey = `${groupId}:${knownMember}`;
  
  try {
    // Check group-level positive cache FIRST (shared across all senders)
    const positiveCache = groupPositiveCache.get(groupId);
    if (positiveCache && (Date.now() - positiveCache.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] ✅ Using group-level positive cache for:', groupId);
      return positiveCache.group;
    }
    
    // Check group-level negative cache (prevents repeated failed lookups)
    const negativeCache = groupNegativeCache.get(groupId);
    if (negativeCache && (Date.now() - negativeCache.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] ⚠️ Using group-level negative cache for:', groupId);
      return null;
    }
    
    // Check sender-level cache
    const cached = metadataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] Using sender-level cached metadata for:', { groupId, knownMember });
      return cached.group;
    }
    
    logger.info('[GROUP BLOCKCHAIN] Looking up group metadata:', { groupId, knownMember });
    
    // Scan the known member's account history for custom_json operations about this group
    const history = await optimizedHiveClient.getAccountHistory(
      knownMember,
      1000,      // limit (Hive's max per request)
      'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
      -1         // start = -1 (latest)
    );

    let latestGroupData: Group | null = null;
    let latestVersion = 0;

    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }
        
        const op = operation[1].op;
        
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData: GroupCustomJson = JSON.parse(op[1].json);
        
        // Only process operations for this specific groupId
        if (jsonData.groupId !== groupId) {
          continue;
        }

        // Skip leave actions
        if (jsonData.action === 'leave') {
          continue;
        }

        // Use the latest version
        const version = jsonData.version || 1;
        if (version > latestVersion) {
          latestVersion = version;
          latestGroupData = {
            groupId,
            name: jsonData.name || 'Unnamed Group',
            members: jsonData.members || [],
            creator: jsonData.creator || knownMember,
            createdAt: normalizeHiveTimestamp(jsonData.timestamp),
            version,
          };
        }
      } catch (parseError) {
        continue;
      }
    }

    // Cache the result at sender level
    metadataCache.set(cacheKey, {
      group: latestGroupData,
      timestamp: Date.now()
    });

    // Cache at group level (positive or negative)
    if (latestGroupData) {
      logger.info('[GROUP BLOCKCHAIN] ✅ Found group metadata:', latestGroupData.name);
      
      // Positive cache: Store for this groupId (shared across all senders)
      groupPositiveCache.set(groupId, {
        group: latestGroupData,
        timestamp: Date.now()
      });
      
      // Clear any negative cache entry
      groupNegativeCache.delete(groupId);
    } else {
      logger.warn('[GROUP BLOCKCHAIN] ⚠️ No metadata found for group:', groupId, 'from sender:', knownMember);
      // Don't set negative cache here - only when ALL senders fail (handled by caller)
    }

    return latestGroupData;
  } catch (error) {
    logger.error('[GROUP BLOCKCHAIN] ❌ Failed to lookup group metadata:', error);
    
    // Cache the failure at sender level to prevent repeated failed lookups for this sender
    metadataCache.set(cacheKey, {
      group: null,
      timestamp: Date.now()
    });
    
    // Don't set negative cache at group level - let caller decide after trying all senders
    return null;
  }
}

/**
 * Sets the negative cache for a groupId to prevent repeated failed lookups
 * Call this when all known senders have been tried and none had metadata
 */
export function setGroupNegativeCache(groupId: string): void {
  groupNegativeCache.set(groupId, {
    timestamp: Date.now()
  });
  logger.info('[GROUP BLOCKCHAIN] Set negative cache for group:', groupId);
}

/**
 * Discovers all groups where the user is a member by scanning account history
 * Now also discovers groups from incoming group messages
 * Returns the most recent version of each group
 */
export async function discoverUserGroups(username: string): Promise<Group[]> {
  logger.info('[GROUP BLOCKCHAIN] Discovering groups for user:', username);

  try {
    const groupMap = new Map<string, Group>();
    const leftGroups = new Set<string>(); // Track groups user has left

    // STEP 1: Scan user's own custom_json operations for groups they created/updated
    logger.info('[GROUP BLOCKCHAIN] STEP 1: Scanning user\'s custom_json for group metadata');
    const customJsonHistory = await optimizedHiveClient.getAccountHistory(
      username,
      1000,      // limit (Hive's max per request)
      'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
      -1         // start = -1 (latest)
    );

    logger.info('[GROUP BLOCKCHAIN] Initial scan:', customJsonHistory.length, 'operations');

    // NEW: Paged backfill for older operations
    let allCustomJsonOps = [...customJsonHistory];

    // Track the oldest sequence number from the initial fetch
    let oldestSeqNum = -1;
    if (customJsonHistory.length > 0) {
      oldestSeqNum = Math.min(...customJsonHistory.map(([idx]) => idx));
      logger.info('[GROUP BLOCKCHAIN] Oldest sequence from initial scan:', oldestSeqNum);
    }

    // Calculate how many more chunks we need
    const totalOpsTarget = MAX_DEEP_BACKFILL_OPS;
    const alreadyFetched = customJsonHistory.length;
    const remainingOps = totalOpsTarget - alreadyFetched;
    const chunksToFetch = Math.ceil(remainingOps / BACKFILL_CHUNK_SIZE);

    if (oldestSeqNum > 0 && chunksToFetch > 0) {
      logger.info('[GROUP BLOCKCHAIN] Starting deep backfill, will scan up to', totalOpsTarget, 'total operations');
      
      for (let i = 0; i < chunksToFetch; i++) {
        // Use the oldestSeqNum as the starting point for the next chunk
        const nextStart = oldestSeqNum - 1;
        
        if (nextStart < 0) {
          logger.info('[GROUP BLOCKCHAIN] Reached beginning of account history, stopping backfill');
          break;
        }
        
        logger.info('[GROUP BLOCKCHAIN] Backfill chunk', i + 1, '/', chunksToFetch, 'starting at sequence:', nextStart);
        
        const olderHistory = await optimizedHiveClient.getAccountHistory(
          username,
          BACKFILL_CHUNK_SIZE,
          'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
          nextStart  // Start from the operation BEFORE the oldest we've seen
        );
        
        if (olderHistory.length === 0) {
          logger.info('[GROUP BLOCKCHAIN] No more operations, stopping backfill');
          break;
        }
        
        // Update oldestSeqNum for the next iteration
        // Defensive: Validate Math.min result to catch edge cases
        const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
        if (!Number.isFinite(chunkOldest)) {
          logger.error('[GROUP BLOCKCHAIN] Invalid sequence number from chunk, stopping backfill');
          break;
        }
        oldestSeqNum = chunkOldest;
        
        allCustomJsonOps = [...allCustomJsonOps, ...olderHistory];
        logger.info('[GROUP BLOCKCHAIN] Total scanned:', allCustomJsonOps.length, 'operations, oldest sequence:', oldestSeqNum);
        
        // Stop if we've fetched enough
        if (allCustomJsonOps.length >= totalOpsTarget) {
          logger.info('[GROUP BLOCKCHAIN] Reached target of', totalOpsTarget, 'operations, stopping backfill');
          break;
        }
      }
    }

    logger.info('[GROUP BLOCKCHAIN] ✅ Completed scanning', allCustomJsonOps.length, 'custom_json operations');

    for (const [, operation] of allCustomJsonOps) {
      try {
        // Safely access operation data with null check
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }
        
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

    logger.info('[GROUP BLOCKCHAIN] Found', groupMap.size, 'groups from custom_json operations');

    // STEP 2: Tiered transfer scanning to find potential group senders
    // Start with quick scan, expand if needed
    const potentialGroupSenders = new Set<string>();
    
    // Stage 1: Quick scan of recent 500 transfers
    // CRITICAL FIX: Use unfiltered query to bypass RPC node caching issues
    logger.info('[GROUP BLOCKCHAIN] Stage 1: Scanning last 500 operations (unfiltered)...');
    let transferHistory = await optimizedHiveClient.getAccountHistory(
      username,
      500,
      'all',  // Use 'all' filter to bypass potential RPC caching (includes transfers + custom_json)
      -1
    );

    logger.info('[GROUP BLOCKCHAIN] Stage 1: Scanned', transferHistory.length, 'operations');

    // Diagnostic: Count all types of operations
    let totalTransfers = 0;
    let incomingTransfers = 0;
    let encryptedIncoming = 0;

    // Collect senders from Stage 1
    for (const [, operation] of transferHistory) {
      try {
        if (!operation || !operation[1] || !operation[1].op) continue;
        const op = operation[1].op;
        if (op[0] !== 'transfer') continue;
        
        totalTransfers++;
        const transfer = op[1];
        
        if (transfer.to === username) {
          incomingTransfers++;
          
          if (transfer.memo && transfer.memo.startsWith('#')) {
            encryptedIncoming++;
            potentialGroupSenders.add(transfer.from);
            logger.info('[GROUP BLOCKCHAIN] Found encrypted transfer from:', transfer.from, 'amount:', transfer.amount);
          }
        }
      } catch (parseError) {
        continue;
      }
    }

    logger.info('[GROUP BLOCKCHAIN] Stage 1: Total transfers:', totalTransfers, 'Incoming:', incomingTransfers, 'Encrypted:', encryptedIncoming);
    logger.info('[GROUP BLOCKCHAIN] Stage 1: Found', potentialGroupSenders.size, 'potential senders');

    // Stage 2: If no senders found, expand deeper
    if (potentialGroupSenders.size === 0) {
      try {
        logger.info('[GROUP BLOCKCHAIN] Stage 2: No senders in recent history, expanding to 1000 operations (unfiltered)...');
        
        transferHistory = await optimizedHiveClient.getAccountHistory(
          username,
          1000,  // Hive's max per request
          'all',  // Use 'all' filter to bypass potential RPC caching (includes transfers + custom_json)
          -1
        );

        logger.info('[GROUP BLOCKCHAIN] Stage 2: Scanned', transferHistory.length, 'operations');

        // Diagnostic: Count all types of operations
        let stage2TotalTransfers = 0;
        let stage2IncomingTransfers = 0;
        let stage2EncryptedIncoming = 0;

        for (const [, operation] of transferHistory) {
          try {
            if (!operation || !operation[1] || !operation[1].op) continue;
            const op = operation[1].op;
            if (op[0] !== 'transfer') continue;
            
            stage2TotalTransfers++;
            const transfer = op[1];
            
            if (transfer.to === username) {
              stage2IncomingTransfers++;
              
              if (transfer.memo && transfer.memo.startsWith('#')) {
                stage2EncryptedIncoming++;
                potentialGroupSenders.add(transfer.from);
                logger.info('[GROUP BLOCKCHAIN] Stage 2: Found encrypted transfer from:', transfer.from, 'amount:', transfer.amount);
              }
            }
          } catch (parseError) {
            continue;
          }
        }

        logger.info('[GROUP BLOCKCHAIN] Stage 2: Total transfers:', stage2TotalTransfers, 'Incoming:', stage2IncomingTransfers, 'Encrypted:', stage2EncryptedIncoming);
        logger.info('[GROUP BLOCKCHAIN] Stage 2: Found', potentialGroupSenders.size, 'total potential senders');
      } catch (stage2Error) {
        logger.error('[GROUP BLOCKCHAIN] Stage 2 failed:', stage2Error);
        logger.info('[GROUP BLOCKCHAIN] Continuing with', potentialGroupSenders.size, 'senders from Stage 1');
      }
    }

    logger.info('[GROUP BLOCKCHAIN] ✅ Discovery complete:', potentialGroupSenders.size, 'potential group senders to scan');

    // Track how many groups we had before sender scans
    const initialGroupCount = groupMap.size;

    // STEP 3: Check each sender's custom_json for group creations that include us
    // Use batched parallel scanning to avoid overwhelming RPC nodes
    const BATCH_SIZE = 10; // Process 10 senders at a time to avoid RPC overload
    const senders = Array.from(potentialGroupSenders);
    const allFoundGroups: Group[] = [];
    
    // Process senders in batches
    for (let i = 0; i < senders.length; i += BATCH_SIZE) {
      const batch = senders.slice(i, i + BATCH_SIZE);
      logger.info('[GROUP BLOCKCHAIN] Processing batch', Math.floor(i / BATCH_SIZE) + 1, '/', Math.ceil(senders.length / BATCH_SIZE), '(', batch.length, 'senders)');
      
      const batchScans = batch.map(async (sender) => {
        try {
          logger.info('[GROUP BLOCKCHAIN] Checking', sender, 'for group creations with deep backfill');
          
          // DEEP BACKFILL: Fetch initial chunk (up to 1000 operations)
          let senderHistory = await optimizedHiveClient.getAccountHistory(
            sender,
            BACKFILL_CHUNK_SIZE,  // 1000 operations per chunk
            'custom_json',
            -1  // start at latest
          );

          let allSenderOps = [...senderHistory];
          let oldestSeqNum = -1;

          if (senderHistory.length > 0) {
            oldestSeqNum = Math.min(...senderHistory.map(([idx]) => idx));
            logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- initial fetch:', senderHistory.length, 'ops, oldest seq:', oldestSeqNum);
          }

          // Continue backfilling until we hit the limit or run out of history
          const totalOpsTarget = MAX_DEEP_BACKFILL_OPS; // 5000 operations max
          const chunksToFetch = Math.ceil((totalOpsTarget - allSenderOps.length) / BACKFILL_CHUNK_SIZE);

          if (oldestSeqNum > 0 && chunksToFetch > 0 && allSenderOps.length < totalOpsTarget) {
            logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- starting deep backfill, target:', totalOpsTarget, 'ops');

            for (let chunkIdx = 0; chunkIdx < chunksToFetch; chunkIdx++) {
              const nextStart = oldestSeqNum - 1;

              if (nextStart < 0) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- reached beginning of history');
                break;
              }

              const olderHistory = await optimizedHiveClient.getAccountHistory(
                sender,
                BACKFILL_CHUNK_SIZE,
                'custom_json',
                nextStart
              );

              if (olderHistory.length === 0) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- no more operations');
                break;
              }

              const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
              if (!Number.isFinite(chunkOldest)) {
                logger.error('[GROUP BLOCKCHAIN] Sender', sender, '- invalid sequence number, stopping');
                break;
              }

              oldestSeqNum = chunkOldest;
              allSenderOps = [...allSenderOps, ...olderHistory];

              logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- chunk', chunkIdx + 1, ':', olderHistory.length, 'ops, total:', allSenderOps.length);

              if (allSenderOps.length >= totalOpsTarget) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- reached target of', totalOpsTarget, 'ops');
                break;
              }
            }
          }

          logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- completed scan of', allSenderOps.length, 'operations');

          const foundGroups: Group[] = [];

          // Process all fetched operations
          for (const [, operation] of allSenderOps) {
            try {
              if (!operation || !operation[1] || !operation[1].op) {
                continue;
              }
              
              const op = operation[1].op;
              
              if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
                continue;
              }

              const jsonData: GroupCustomJson = JSON.parse(op[1].json);
              const { groupId, action } = jsonData;

              // Skip leave actions
              if (action === 'leave') {
                continue;
              }

              // Only include groups where current user is a member
              if (!jsonData.members?.includes(username)) {
                continue;
              }

              // Check if we already have this group with a newer version
              const existing = groupMap.get(groupId);
              if (existing && existing.version >= (jsonData.version || 1)) {
                continue;
              }

              // Create or update group entry
              const group: Group = {
                groupId,
                name: jsonData.name || 'Unnamed Group',
                members: jsonData.members || [],
                creator: jsonData.creator || sender,
                createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                version: jsonData.version || 1,
              };

              foundGroups.push(group);
              logger.info('[GROUP BLOCKCHAIN] Discovered group from', sender, ':', group.name, 'v' + group.version, 'with', group.members.length, 'members');

            } catch (parseError) {
              logger.warn('[GROUP BLOCKCHAIN] Failed to parse group operation from', sender, ':', parseError);
              continue;
            }
          }

          logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- found', foundGroups.length, 'groups');
          return foundGroups;
        } catch (error) {
          logger.warn('[GROUP BLOCKCHAIN] Failed to scan', sender, 'history:', error);
          return [];
        }
      });

      // Wait for this batch to complete
      const batchResults = await Promise.all(batchScans);
      
      // Merge batch results
      for (const foundGroups of batchResults) {
        allFoundGroups.push(...foundGroups);
      }
    }

    // Now merge all discovered groups into groupMap (respecting leftGroups and versions)
    for (const group of allFoundGroups) {
      // Skip groups the user has left
      if (leftGroups.has(group.groupId)) {
        logger.info('[GROUP BLOCKCHAIN] Skipping left group:', group.name);
        continue;
      }
      
      // Check if we already have a newer version
      const existing = groupMap.get(group.groupId);
      if (existing && existing.version >= group.version) {
        logger.info('[GROUP BLOCKCHAIN] Skipping older version of', group.name, '(have v', existing.version, ', found v', group.version, ')');
        continue;
      }
      
      groupMap.set(group.groupId, group);
    }

    logger.info('[GROUP BLOCKCHAIN] Scanned', potentialGroupSenders.size, 'senders, found', groupMap.size - initialGroupCount, 'new groups');

    // STEP 4: Chain Discovery (BFS) - Recursively scan ALL group members
    // This discovers membership updates from members who haven't sent messages yet
    logger.info('[GROUP BLOCKCHAIN] STEP 4: Starting BFS chain discovery for group members');
    
    const CHAIN_BATCH_SIZE = 8; // Smaller batch size to reduce RPC load
    const CHAIN_OPS_LIMIT = 2000; // 1K initial + 1K backfill per member
    const MAX_CHAIN_ITERATIONS = 10; // Prevent infinite loops
    
    // BFS queue: Start with all current group members
    const memberQueue: string[] = [];
    const visitedMembers = new Set<string>([username]); // Skip current user
    
    // Initialize queue with ALL members from initially discovered groups
    // CRITICAL: Don't skip already scanned senders - they might have newer updates
    for (const group of Array.from(groupMap.values())) {
      for (const member of group.members) {
        if (!visitedMembers.has(member)) {
          memberQueue.push(member);
          visitedMembers.add(member);
        }
      }
    }
    
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Initial queue size:', memberQueue.length, 'members');
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Scanning members from', groupMap.size, 'initially discovered groups');
    
    // Diagnostic: Log if queue is empty
    if (memberQueue.length === 0) {
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Queue is empty! No members to scan.');
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: groupMap size:', groupMap.size);
      for (const group of Array.from(groupMap.values())) {
        logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Group', group.name, 'has members:', group.members);
      }
    }
    
    let chainIteration = 0;
    let totalScanned = 0;
    
    // BFS loop: Process queue until empty or max iterations reached
    while (memberQueue.length > 0 && chainIteration < MAX_CHAIN_ITERATIONS) {
      chainIteration++;
      const currentBatch = memberQueue.splice(0, CHAIN_BATCH_SIZE); // Take up to CHAIN_BATCH_SIZE members
      
      logger.info('[GROUP BLOCKCHAIN] Chain iteration', chainIteration, '- processing', currentBatch.length, 'members, queue remaining:', memberQueue.length);
      
      const batchScans = currentBatch.map(async (member) => {
        try {
          logger.info('[GROUP BLOCKCHAIN] Chain scanning:', member);
          
          // Fetch initial chunk (1000 ops)
          let memberHistory = await optimizedHiveClient.getAccountHistory(
            member,
            BACKFILL_CHUNK_SIZE,
            'custom_json',
            -1
          );
          
          let allMemberOps = [...memberHistory];
          let oldestSeqNum = -1;
          
          if (memberHistory.length > 0) {
            oldestSeqNum = Math.min(...memberHistory.map(([idx]) => idx));
          }
          
          // Single backfill chunk if needed (to reach 2K ops)
          if (oldestSeqNum > 0 && allMemberOps.length < CHAIN_OPS_LIMIT) {
            const nextStart = oldestSeqNum - 1;
            
            if (nextStart >= 0) {
              const olderHistory = await optimizedHiveClient.getAccountHistory(
                member,
                BACKFILL_CHUNK_SIZE,
                'custom_json',
                nextStart
              );
              
              if (olderHistory.length > 0) {
                allMemberOps = [...allMemberOps, ...olderHistory];
              }
            }
          }
          
          logger.info('[GROUP BLOCKCHAIN] Chain member', member, '- scanned', allMemberOps.length, 'ops');
          totalScanned++;
          
          const foundGroups: Group[] = [];
          const newMembersFound = new Set<string>();
          
          // Process all operations
          for (const [, operation] of allMemberOps) {
            try {
              if (!operation || !operation[1] || !operation[1].op) {
                continue;
              }
              
              const op = operation[1].op;
              
              if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
                continue;
              }
              
              const jsonData: GroupCustomJson = JSON.parse(op[1].json);
              const { groupId, action } = jsonData;
              
              // Skip leave actions
              if (action === 'leave') {
                continue;
              }
              
              // Only include groups where current user is a member
              if (!jsonData.members?.includes(username)) {
                continue;
              }
              
              // Check if this is a newer version than what we have
              const existing = groupMap.get(groupId);
              const newVersion = jsonData.version || 1;
              const existingVersion = existing?.version || 0;
              
              if (newVersion > existingVersion) {
                // Create group entry
                const group: Group = {
                  groupId,
                  name: jsonData.name || 'Unnamed Group',
                  members: jsonData.members || [],
                  creator: jsonData.creator || member,
                  createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                  version: newVersion,
                };
                
                foundGroups.push(group);
                
                // Track new members to add to queue
                for (const m of group.members) {
                  if (!visitedMembers.has(m) && m !== username) {
                    newMembersFound.add(m);
                  }
                }
                
                logger.info('[GROUP BLOCKCHAIN] Chain found:', group.name, 'v' + group.version, 'with', group.members.length, 'members from', member);
              }
            } catch (parseError) {
              continue;
            }
          }
          
          return { foundGroups, newMembersFound: Array.from(newMembersFound) };
        } catch (error) {
          logger.warn('[GROUP BLOCKCHAIN] Chain scan failed for', member, ':', error);
          return { foundGroups: [], newMembersFound: [] };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchScans);
      
      // Merge results and enqueue newly discovered members
      for (const { foundGroups, newMembersFound } of batchResults) {
        // Update groupMap with newer versions
        for (const group of foundGroups) {
          // Skip groups the user has left
          if (leftGroups.has(group.groupId)) {
            continue;
          }
          
          const existing = groupMap.get(group.groupId);
          if (!existing || existing.version < group.version) {
            groupMap.set(group.groupId, group);
            logger.info('[GROUP BLOCKCHAIN] Chain: Updated', group.name, 'to v' + group.version);
          }
        }
        
        // Add new members to queue (BFS expansion)
        for (const newMember of newMembersFound) {
          if (!visitedMembers.has(newMember)) {
            memberQueue.push(newMember);
            visitedMembers.add(newMember);
            logger.info('[GROUP BLOCKCHAIN] Chain: Enqueued new member:', newMember);
          }
        }
      }
    }
    
    if (chainIteration >= MAX_CHAIN_ITERATIONS) {
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Reached max iterations limit');
    }
    
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Completed in', chainIteration, 'iterations, scanned', totalScanned, 'members, visited', visitedMembers.size, 'total');

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
 * New format: "group:{groupId}:{creator}:{encryptedContent}"
 * Legacy format: "group:{groupId}:{encryptedContent}" (backwards compatible)
 * Returns null if malformed (instead of throwing) to prevent crashes
 */
export function parseGroupMessageMemo(memo: string): { 
  isGroupMessage: boolean; 
  groupId?: string; 
  creator?: string;
  content?: string;
} | null {
  try {
    // CRITICAL FIX: Strip leading # if present (Keychain bug workaround)
    // Sometimes Keychain returns decrypted content with # prefix still attached
    let cleanMemo = memo;
    if (cleanMemo.startsWith('#')) {
      cleanMemo = cleanMemo.substring(1);
      logger.warn('[GROUP BLOCKCHAIN] Stripped # prefix from decrypted memo (Keychain bug)');
    }
    
    const groupPrefix = 'group:';
    
    if (!cleanMemo.startsWith(groupPrefix)) {
      return { isGroupMessage: false };
    }

    // Parse format: group:{groupId}:{creator}:{content} or group:{groupId}:{content}
    const parts = cleanMemo.split(':');
    
    if (parts.length < 3) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (too few parts):', memo.substring(0, 50));
      return null;
    }

    const groupId = parts[1];
    let creator: string | undefined;
    let content: string;
    
    // Check if this is new format (4+ parts) with creator or legacy format (3 parts)
    if (parts.length >= 4) {
      // New format: group:{groupId}:{creator}:{content}
      creator = parts[2];
      content = parts.slice(3).join(':'); // Rejoin in case content contains ":"
      logger.info('[GROUP BLOCKCHAIN] Parsed new format group message with creator:', creator);
    } else {
      // Legacy format: group:{groupId}:{content}
      creator = undefined;
      content = parts.slice(2).join(':');
      logger.info('[GROUP BLOCKCHAIN] Parsed legacy format group message (no creator)');
    }

    // Basic validation
    if (!groupId || !content) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (missing groupId or content)');
      return null;
    }

    return {
      isGroupMessage: true,
      groupId,
      creator,
      content,
    };
  } catch (error) {
    logger.warn('[GROUP BLOCKCHAIN] Failed to parse group message memo:', error);
    return null;
  }
}

/**
 * Formats a message for group sending
 * New format includes the group creator to enable metadata discovery
 * Returns the prefixed memo that will be encrypted
 */
export function formatGroupMessageMemo(groupId: string, creator: string, message: string): string {
  return `group:${groupId}:${creator}:${message}`;
}
