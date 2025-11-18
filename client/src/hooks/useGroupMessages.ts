import { useQuery, QueryFunctionContext } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';
import {
  getGroupConversations,
  getGroupMessages,
  getAllGroupMessages,
  cacheGroupConversation,
  cacheGroupMessages,
  type GroupConversationCache,
  type GroupMessageCache,
} from '@/lib/messageCache';
import { discoverUserGroups, parseGroupMessageMemo, lookupGroupMetadata, setGroupNegativeCache } from '@/lib/groupBlockchain';
import { hiveClient as optimizedHiveClient } from '@/lib/hiveClient';
import { decryptMemo } from '@/lib/hive';
import { useToast } from '@/hooks/use-toast';
import {
  getLastSyncedOperation,
  setLastSyncedOperation,
  getMaxBackfill,
  shouldShowBackfillWarning,
} from '@/lib/groupSyncState';

/**
 * Helper to check if query was cancelled and throw appropriate error
 */
function checkCancellation(signal: AbortSignal, context: string) {
  if (signal.aborted) {
    logger.info(`[QUERY CANCELLED] ${context}`);
    throw new DOMException('Query was cancelled', 'AbortError');
  }
}

/**
 * Hook to pre-sync incoming group messages BEFORE discovery
 * This solves the chicken-and-egg problem where:
 * - Discovery needs cached messages to find groups
 * - But messages aren't cached until a group is opened
 * 
 * This hook fetches recent incoming transfers, decrypts group messages,
 * and caches them so that discovery can find groups created by others
 */
export function useGroupMessagePreSync() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['group-message-presync', user?.username],
    queryFn: async ({ signal }: QueryFunctionContext): Promise<number> => {
      if (!user?.username) {
        return 0;
      }

      // DISABLED: Pre-sync is no longer needed because discovery now scans
      // blockchain metadata directly without triggering Keychain popups
      logger.info('[GROUP PRESYNC] Pre-sync disabled - discovery uses blockchain metadata');
      return 0;

      /* PREVIOUS APPROACH (CAUSED KEYCHAIN POPUP SPAM):
      logger.info('[GROUP PRESYNC] Starting pre-sync for user:', user.username);

      try {
        // Load existing cached messages to avoid duplicates
        const existingMessages = await getAllGroupMessages(user.username);
        // Build deduplication set from confirmed messages, handling both old and new cache formats
        const cachedTxIds = new Set(
          existingMessages
            .filter(m => m.confirmed)
            .flatMap(m => {
              // Prefer txIds array if it has items
              const validTxIds = m.txIds?.filter(id => id && !id.startsWith('temp-')) || [];
              
              // Fallback: use id field if txIds is empty AND id is a real txId (not temp)
              // This handles legacy cache entries that don't have txIds populated
              if (validTxIds.length === 0 && m.id && !m.id.startsWith('temp-')) {
                return [m.id];
              }
              
              return validTxIds;
            })
        );
        logger.info('[GROUP PRESYNC] Found', existingMessages.length, 'existing cached messages,', cachedTxIds.size, 'unique confirmed txIds');

        // Fetch recent incoming transfers (500 operations should cover most cases)
        // Always scan to find new messages even if cache exists
        const history = await optimizedHiveClient.getAccountHistory(
          user.username,
          500,      // limit - scan last 500 operations
          true,     // filterTransfersOnly = true
          -1        // start = -1 (latest)
        );

        checkCancellation(signal, 'Group presync after blockchain fetch');

        logger.info('[GROUP PRESYNC] Fetched', history.length, 'recent transfers');

        const newGroupMessages: GroupMessageCache[] = [];
        const seenTxIds = new Set<string>(cachedTxIds); // Initialize with cached txIds

        // Process transfers to find group messages
        for (let i = 0; i < history.length; i++) {
          if (i % 10 === 0) {
            checkCancellation(signal, `Group presync processing (${i}/${history.length})`);
          }

          let txId: string = '';
          let transfer: any = null;
          let memo: string = '';
          
          try {
            const [, operation] = history[i];
            if (!operation || !operation[1]) {
              logger.warn('[GROUP PRESYNC] Invalid operation structure at index', i);
              continue;
            }
            
            const op = operation[1].op;
            if (!op || op[0] !== 'transfer') continue;
            
            transfer = op[1];
            memo = transfer.memo;
            txId = operation[1].trx_id;
            
            // Skip if already processed
            if (seenTxIds.has(txId)) continue;
            seenTxIds.add(txId);
            
            // Only process incoming encrypted memos
            if (transfer.to !== user.username || !memo || !memo.startsWith('#')) {
              continue;
            }

            // Decrypt the memo
            const decryptedMemo = await decryptMemo(
              user.username,
              memo,
              transfer.from,
              txId
            );

            if (!decryptedMemo) continue;

            // Check if it's a group message
            const parsed = parseGroupMessageMemo(decryptedMemo);
            
            if (parsed === null || !parsed.isGroupMessage) {
              continue;
            }

            // Cache this group message
            const groupMessage: GroupMessageCache = {
              id: txId,
              groupId: parsed.groupId!,
              sender: transfer.from,
              creator: parsed.creator,
              content: parsed.content || '',
              encryptedContent: memo,
              timestamp: operation[1].timestamp + 'Z',
              recipients: [user.username],
              txIds: [txId],
              confirmed: true,
              status: 'confirmed',
            };

            newGroupMessages.push(groupMessage);
            logger.info('[GROUP PRESYNC] Found group message for:', parsed.groupId, 'from:', transfer.from);

          } catch (error) {
            logger.warn('[GROUP PRESYNC] Failed to process transfer:', {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              txId,
              from: transfer?.from,
              to: transfer?.to,
              memo: memo?.substring(0, 20) + '...'
            });
            continue;
          }
        }

        // Cache all discovered group messages
        if (newGroupMessages.length > 0) {
          logger.info('[GROUP PRESYNC] Caching', newGroupMessages.length, 'group messages');
          await cacheGroupMessages(newGroupMessages, user.username);
        }

        logger.info('[GROUP PRESYNC] ✅ Pre-sync complete, cached', newGroupMessages.length, 'group messages');
        return newGroupMessages.length;

      } catch (error) {
        logger.error('[GROUP PRESYNC] ❌ Failed to pre-sync group messages:', error);
        return 0;
      }
      */
    },
    enabled: !!user?.username,
    staleTime: Infinity, // Only run once per session
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Hook to discover and fetch all groups the user is a member of
 * Now discovers groups directly from blockchain metadata without needing cached messages
 * Supports query cancellation via signal to prevent stale state
 */
export function useGroupDiscovery() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['blockchain-group-conversations', user?.username],
    queryFn: async ({ signal }: QueryFunctionContext): Promise<GroupConversationCache[]> => {
      if (!user?.username) {
        logger.warn('[GROUP DISCOVERY] No username, skipping group discovery');
        return [];
      }

      logger.info('[GROUP DISCOVERY] Discovering groups for:', user.username);

      try {
        // STEP 1: Fetch from local cache first (instant load)
        const cachedGroups = await getGroupConversations(user.username);
        logger.info('[GROUP DISCOVERY] Loaded', cachedGroups.length, 'groups from cache');

        // Check if query was cancelled after cache read
        checkCancellation(signal, 'Group discovery after cache read');

        // STEP 2: Discover groups from blockchain custom_json operations
        const blockchainGroups = await discoverUserGroups(user.username);
        logger.info('[GROUP DISCOVERY] Discovered', blockchainGroups.length, 'groups from blockchain');

        // Check if query was cancelled after blockchain fetch
        checkCancellation(signal, 'Group discovery after blockchain fetch');

        // STEP 2.5: Discover groups from already-cached group messages
        // This is critical for discovering groups created by others!
        // We use cached messages to avoid triggering Keychain popups
        logger.info('[GROUP DISCOVERY] Scanning cached group messages for new groups...');
        
        const cachedGroupMessages = await getAllGroupMessages(user.username);
        logger.info('[GROUP DISCOVERY] Found', cachedGroupMessages.length, 'cached group messages');

        checkCancellation(signal, 'Group discovery after cached message scan');

        const discoveredGroupIds = new Set<string>();
        const groupSendersMap = new Map<string, Set<string>>(); // groupId -> Set of all senders
        const groupCreatorMap = new Map<string, string>(); // groupId -> creator (from cached messages)

        // Extract unique groupIds and collect ALL senders + creators per group
        for (const message of cachedGroupMessages) {
          const groupId = message.groupId;
          const sender = message.sender;
          
          if (!discoveredGroupIds.has(groupId)) {
            discoveredGroupIds.add(groupId);
            groupSendersMap.set(groupId, new Set([sender]));
          } else {
            // Add this sender to the list of known senders for this group
            const senders = groupSendersMap.get(groupId);
            if (senders) {
              senders.add(sender);
            }
          }
          
          // CRITICAL: Store creator if available (for direct metadata lookup)
          if (message.creator && !groupCreatorMap.has(groupId)) {
            groupCreatorMap.set(groupId, message.creator);
            logger.info('[GROUP DISCOVERY] Found creator from cached message:', message.creator, 'for group:', groupId);
          }
          
          logger.info('[GROUP DISCOVERY] Found cached group message for groupId:', groupId, 'from:', sender);
        }

        logger.info('[GROUP DISCOVERY] Found', discoveredGroupIds.size, 'unique groups from cached messages');

        // Look up metadata for discovered groups
        for (const groupId of Array.from(discoveredGroupIds)) {
          checkCancellation(signal, `Group discovery looking up metadata for ${groupId}`);

          // Skip if we already have this group from blockchain discovery
          if (blockchainGroups.some(g => g.groupId === groupId)) {
            continue;
          }

          let groupMetadata = null;
          
          // PRIORITY 1: Try creator from cached messages FIRST (most reliable)
          const cachedCreator = groupCreatorMap.get(groupId);
          if (cachedCreator) {
            logger.info('[GROUP DISCOVERY] Trying cached creator for group:', groupId, 'creator:', cachedCreator);
            try {
              groupMetadata = await lookupGroupMetadata(groupId, cachedCreator);
              if (groupMetadata) {
                logger.info('[GROUP DISCOVERY] ✅ Resolved group metadata from cached creator:', cachedCreator, 'group:', groupMetadata.name);
              }
            } catch (lookupError) {
              logger.warn('[GROUP DISCOVERY] Failed to lookup from cached creator:', cachedCreator, lookupError);
            }
          }
          
          // PRIORITY 2: Fallback to trying all known senders
          if (!groupMetadata) {
            const knownSenders = Array.from(groupSendersMap.get(groupId) || []);
            if (knownSenders.length === 0) continue;

            logger.info('[GROUP DISCOVERY] Trying', knownSenders.length, 'fallback senders for group:', groupId);

            for (const sender of knownSenders) {
              try {
                groupMetadata = await lookupGroupMetadata(groupId, sender);
                
                if (groupMetadata) {
                  logger.info('[GROUP DISCOVERY] ✅ Resolved group metadata from fallback sender:', sender, 'group:', groupMetadata.name);
                  break; // Found it!
                }
              } catch (lookupError) {
                logger.warn('[GROUP DISCOVERY] Failed to lookup from fallback sender:', sender, lookupError);
                // Try next sender
              }
            }
          }

          if (groupMetadata) {
            blockchainGroups.push(groupMetadata);
          } else {
            const attemptedMethods = [];
            if (cachedCreator) attemptedMethods.push(`creator: ${cachedCreator}`);
            const senderCount = groupSendersMap.get(groupId)?.size || 0;
            if (senderCount > 0) attemptedMethods.push(`${senderCount} senders`);
            
            logger.warn('[GROUP DISCOVERY] ⚠️ Could not resolve metadata for group:', groupId, 'tried:', attemptedMethods.join(', '));
            // Set negative cache to prevent repeated failed lookups
            setGroupNegativeCache(groupId);
          }
        }

        logger.info('[GROUP DISCOVERY] Total discovered groups (custom_json + transfers):', blockchainGroups.length);

        // STEP 3: Merge and update cache
        const groupMap = new Map<string, GroupConversationCache>();

        // Add cached groups first
        cachedGroups.forEach(group => {
          groupMap.set(group.groupId, group);
        });

        // Update with blockchain data (newer versions)
        for (const blockchainGroup of blockchainGroups) {
          // Check cancellation periodically in loop
          checkCancellation(signal, 'Group discovery during merge loop');

          const existing = groupMap.get(blockchainGroup.groupId);
          
          // Use blockchain version if it's newer or doesn't exist in cache
          if (!existing || blockchainGroup.version > existing.version) {
            const groupCache: GroupConversationCache = {
              groupId: blockchainGroup.groupId,
              name: blockchainGroup.name,
              members: blockchainGroup.members,
              creator: blockchainGroup.creator,
              createdAt: blockchainGroup.createdAt,
              version: blockchainGroup.version,
              lastMessage: existing?.lastMessage || '',
              lastTimestamp: existing?.lastTimestamp || blockchainGroup.createdAt,
              unreadCount: existing?.unreadCount || 0,
              lastChecked: existing?.lastChecked || new Date().toISOString(),
            };

            groupMap.set(blockchainGroup.groupId, groupCache);
            
            // Update cache (skip if cancelled)
            if (!signal.aborted) {
              await cacheGroupConversation(groupCache, user.username);
            }
          }
        }

        // Final cancellation check before returning
        checkCancellation(signal, 'Group discovery before return');

        const mergedGroups = Array.from(groupMap.values());
        logger.info('[GROUP DISCOVERY] ✅ Total groups:', mergedGroups.length);

        return mergedGroups;
      } catch (error) {
        logger.error('[GROUP DISCOVERY] ❌ Failed to discover groups:', error);
        
        // Fallback to cached groups on error
        const cachedGroups = await getGroupConversations(user.username);
        return cachedGroups;
      }
    },
    enabled: !!user?.username,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

/**
 * Hook to fetch messages for a specific group
 * Scans blockchain for incoming transfers with group: prefix
 * Now supports pagination to prevent message loss for active users
 * Supports query cancellation via signal to prevent stale state
 */
export function useGroupMessages(groupId?: string) {
  const { user } = useAuth();
  const { toast } = useToast();

  return useQuery({
    queryKey: ['blockchain-group-messages', user?.username, groupId],
    queryFn: async ({ signal }: QueryFunctionContext): Promise<GroupMessageCache[]> => {
      if (!user?.username || !groupId) {
        return [];
      }

      logger.info('[GROUP MESSAGES] Syncing messages for group:', groupId);

      try {
        // Step 1: Load cached messages first (instant display)
        const cachedMessages = await getGroupMessages(groupId, user.username);
        logger.info('[GROUP MESSAGES] Loaded', cachedMessages.length, 'cached messages');

        // Check if query was cancelled after cache read
        checkCancellation(signal, 'Group messages after cache read');

        // Step 2: Get last synced operation index for pagination
        const lastSyncedOp = getLastSyncedOperation(user.username);
        logger.info('[GROUP MESSAGES] Last synced operation:', lastSyncedOp ?? 'none (first sync)');

        // Step 3: Fetch initial 200 operations from blockchain
        const latestHistory = await optimizedHiveClient.getAccountHistory(
          user.username,
          200,      // limit
          true,     // filterTransfersOnly = true
          -1        // start = -1 (latest)
        );

        logger.info('[GROUP MESSAGES] Fetched', latestHistory.length, 'latest operations');

        // Check if query was cancelled after blockchain fetch
        checkCancellation(signal, 'Group messages after initial blockchain fetch');
        
        // Track the highest operation index seen
        let highestOpIndex = -1;
        if (latestHistory.length > 0) {
          highestOpIndex = Math.max(...latestHistory.map(([idx]) => idx));
          logger.info('[GROUP MESSAGES] Highest operation index:', highestOpIndex);
        }

        // Step 4: Process initial 200 operations and cache them BEFORE checking backfill limit
        logger.info('[GROUP MESSAGES] Processing initial', latestHistory.length, 'operations');
        const newMessages: GroupMessageCache[] = [];
        const seenTxIds = new Set(cachedMessages.map(m => m.txIds).flat());

        for (let i = 0; i < latestHistory.length; i++) {
          // Check cancellation periodically (every 10 messages)
          if (i % 10 === 0) {
            checkCancellation(signal, `Group messages processing initial ops (${i}/${latestHistory.length})`);
          }

          const [index, operation] = latestHistory[i];
          
          try {
            const op = operation[1].op;
            
            // Only process incoming transfers
            if (op[0] !== 'transfer') continue;
            
            const transfer = op[1];
            const memo = transfer.memo;
            const txId = operation[1].trx_id;
            
            // Skip if already cached
            if (seenTxIds.has(txId)) continue;
            
            // Only process incoming transfers with encrypted memos
            if (transfer.to !== user.username || !memo || !memo.startsWith('#')) {
              continue;
            }

            // Decrypt the memo
            const decryptedMemo = await decryptMemo(
              user.username,
              memo,
              transfer.from,
              txId
            );

            if (!decryptedMemo) continue;

            // Parse group message format
            const parsed = parseGroupMessageMemo(decryptedMemo);
            
            // Skip null results (malformed memos) - don't crash, just log and continue
            if (parsed === null) {
              logger.warn('[GROUP MESSAGES] Skipping malformed group message memo, txId:', txId);
              continue;
            }
            
            // Only process messages for this group
            if (!parsed.isGroupMessage || parsed.groupId !== groupId) {
              continue;
            }

            // Create group message cache entry
            const messageCache: GroupMessageCache = {
              id: txId,
              groupId: parsed.groupId,
              sender: transfer.from,
              creator: parsed.creator, // Store creator for group discovery
              content: parsed.content || '',
              encryptedContent: memo,
              timestamp: operation[1].timestamp + 'Z', // Normalize to UTC
              recipients: [user.username], // This user received it
              txIds: [txId],
              confirmed: true,
              status: 'confirmed',
            };

            newMessages.push(messageCache);
            seenTxIds.add(txId);

          } catch (parseError) {
            logger.warn('[GROUP MESSAGES] Failed to parse/decrypt message:', parseError);
            continue;
          }
        }

        // Check cancellation before cache writes
        checkCancellation(signal, 'Group messages before initial cache writes');

        // Step 5: Cache newly discovered messages from initial 200 operations
        if (newMessages.length > 0 && !signal.aborted) {
          logger.info('[GROUP MESSAGES] Discovered', newMessages.length, 'new messages from initial operations');
          await cacheGroupMessages(newMessages, user.username);
        }

        // Step 6: NOW check if we should backfill
        const MAX_BACKFILL = getMaxBackfill();
        
        if (lastSyncedOp !== null && highestOpIndex > 0) {
          const gap = highestOpIndex - lastSyncedOp;
          logger.info('[GROUP MESSAGES] Operation gap since last sync:', gap);

          if (shouldShowBackfillWarning(lastSyncedOp, highestOpIndex)) {
            logger.warn('[GROUP MESSAGES] ⚠️ Large gap detected, showing backfill warning');
            toast({
              title: 'Message History Limited',
              description: 'Showing recent messages. Older messages beyond 1000 operations may not be visible.',
            });
            
            // Update lastSynced to highestOpIndex so we don't keep checking this gap
            setLastSyncedOperation(user.username, highestOpIndex);
            
            // EDGE CASE FIX #3: Deduplicate by ID and sort by timestamp
            const messageMap = new Map<string, GroupMessageCache>();
            
            // Add new messages first (take precedence)
            for (const msg of newMessages) {
              messageMap.set(msg.id, msg);
            }
            
            // Add cached messages (only if not already present)
            for (const msg of cachedMessages) {
              if (!messageMap.has(msg.id)) {
                messageMap.set(msg.id, msg);
              }
            }
            
            // Convert to array and sort by timestamp (oldest first for chronological order)
            const dedupedMessages = Array.from(messageMap.values()).sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            logger.info('[GROUP MESSAGES] ✅ Total messages (backfill limit hit):', dedupedMessages.length, '(', cachedMessages.length, 'cached +', newMessages.length, 'new)');
            return dedupedMessages;
          }

          // Implement pagination if gap exists but is within backfill limit
          const shouldBackfill = gap > 200 && gap <= MAX_BACKFILL;
          
          if (shouldBackfill) {
            logger.info('[GROUP MESSAGES] Gap within backfill limit, fetching older operations...');
            
            // Start backfill from older operations
            let allOperations: Array<[number, any]> = [...latestHistory];
            
            // Calculate how many more operations we need to fetch
            const operationsToFetch = Math.min(gap - 200, MAX_BACKFILL - 200);
            const chunks = Math.ceil(operationsToFetch / 200);
            
            // EDGE CASE FIX #4: Track highest operation index seen during backfill
            let highestOpIndexSeen = highestOpIndex;
            
            for (let i = 0; i < chunks; i++) {
              // Check cancellation before each chunk fetch
              checkCancellation(signal, `Group messages backfill chunk ${i + 1}`);

              const startIndex = highestOpIndex - 200 - (i * 200);
              if (startIndex <= lastSyncedOp) break;
              
              logger.info('[GROUP MESSAGES] Fetching chunk', i + 1, 'of', chunks, 'starting at index:', startIndex);
              
              try {
                const olderHistory = await optimizedHiveClient.getAccountHistory(
                  user.username,
                  200,
                  true,
                  startIndex
                );
                
                // Check cancellation after chunk fetch
                checkCancellation(signal, `Group messages after backfill chunk ${i + 1}`);

                // Filter out operations we already have
                const newOps = olderHistory.filter(([idx]) => 
                  !allOperations.some(([existingIdx]) => existingIdx === idx)
                );
                
                allOperations = [...allOperations, ...newOps];
                logger.info('[GROUP MESSAGES] Added', newOps.length, 'new operations from chunk', i + 1);
                
                // Update highest operation index seen
                if (olderHistory.length > 0) {
                  const maxIdx = Math.max(...olderHistory.map(([idx]) => idx));
                  highestOpIndexSeen = Math.max(highestOpIndexSeen, maxIdx);
                }
                
                // Stop if we've reached the last synced operation
                if (olderHistory.some(([idx]) => idx <= lastSyncedOp)) {
                  logger.info('[GROUP MESSAGES] Reached last synced operation, stopping backfill');
                  break;
                }
              } catch (error) {
                // EDGE CASE FIX #4: Network failure during backfill
                logger.error('[GROUP MESSAGES] Backfill chunk', i + 1, 'failed:', error);
                
                // Even on error, update lastSynced to what we've successfully processed
                // This prevents infinite retry loops
                if (highestOpIndexSeen > (lastSyncedOp || 0)) {
                  logger.warn('[GROUP MESSAGES] Updating lastSyncedOperation to', highestOpIndexSeen, 'after backfill error');
                  setLastSyncedOperation(user.username, highestOpIndexSeen);
                }
                
                // Return what we have so far - don't crash, just stop backfill
                break;
              }
            }
            
            logger.info('[GROUP MESSAGES] Backfill complete, total operations:', allOperations.length);
            
            // Process additional backfilled operations
            logger.info('[GROUP MESSAGES] Processing', allOperations.length - latestHistory.length, 'backfilled operations');
            
            for (let i = 0; i < allOperations.length; i++) {
              // Skip operations we already processed from initial fetch
              const [index] = allOperations[i];
              if (latestHistory.some(([idx]) => idx === index)) continue;
              
              // Check cancellation periodically (every 10 messages)
              if (i % 10 === 0) {
                checkCancellation(signal, `Group messages processing backfill (${i}/${allOperations.length})`);
              }

              const operation = allOperations[i][1];
              
              try {
                const op = operation.op;
                
                // Only process incoming transfers
                if (op[0] !== 'transfer') continue;
                
                const transfer = op[1];
                const memo = transfer.memo;
                const txId = operation.trx_id;
                
                // Skip if already cached
                if (seenTxIds.has(txId)) continue;
                
                // Only process incoming transfers with encrypted memos
                if (transfer.to !== user.username || !memo || !memo.startsWith('#')) {
                  continue;
                }

                // Decrypt the memo
                const decryptedMemo = await decryptMemo(
                  user.username,
                  memo,
                  transfer.from,
                  txId
                );

                if (!decryptedMemo) continue;

                // Parse group message format
                const parsed = parseGroupMessageMemo(decryptedMemo);
                
                // Skip null results (malformed memos)
                if (parsed === null) {
                  logger.warn('[GROUP MESSAGES] Skipping malformed group message memo, txId:', txId);
                  continue;
                }
                
                // Only process messages for this group
                if (!parsed.isGroupMessage || parsed.groupId !== groupId) {
                  continue;
                }

                // Create group message cache entry
                const messageCache: GroupMessageCache = {
                  id: txId,
                  groupId: parsed.groupId,
                  sender: transfer.from,
                  creator: parsed.creator, // Store creator for group discovery
                  content: parsed.content || '',
                  encryptedContent: memo,
                  timestamp: operation.timestamp + 'Z', // Normalize to UTC
                  recipients: [user.username],
                  txIds: [txId],
                  confirmed: true,
                  status: 'confirmed',
                };

                newMessages.push(messageCache);
                seenTxIds.add(txId);

              } catch (parseError) {
                logger.warn('[GROUP MESSAGES] Failed to parse/decrypt backfilled message:', parseError);
                continue;
              }
            }
            
            // Check cancellation before cache writes
            checkCancellation(signal, 'Group messages before backfill cache writes');

            // Cache newly discovered messages from backfill
            if (newMessages.length > latestHistory.length && !signal.aborted) {
              const backfillMessages = newMessages.slice(latestHistory.length);
              logger.info('[GROUP MESSAGES] Discovered', backfillMessages.length, 'additional messages from backfill');
              await cacheGroupMessages(backfillMessages, user.username);
            }
          }
        }

        // Step 7: Update last synced operation (skip if cancelled or already updated)
        if (highestOpIndex > 0 && !signal.aborted && (lastSyncedOp === null || highestOpIndex > lastSyncedOp)) {
          setLastSyncedOperation(user.username, highestOpIndex);
          logger.info('[GROUP MESSAGES] Updated last synced operation to:', highestOpIndex);
        }

        // Step 8: EDGE CASE FIX #3: Deduplicate by ID and sort by timestamp
        const messageMap = new Map<string, GroupMessageCache>();
        
        // Add new messages first (take precedence)
        for (const msg of newMessages) {
          messageMap.set(msg.id, msg);
        }
        
        // Add cached messages (only if not already present)
        for (const msg of cachedMessages) {
          if (!messageMap.has(msg.id)) {
            messageMap.set(msg.id, msg);
          }
        }
        
        // Convert to array and sort by timestamp (oldest first for chronological order)
        const dedupedMessages = Array.from(messageMap.values()).sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // Final cancellation check before returning
        checkCancellation(signal, 'Group messages before return');

        logger.info('[GROUP MESSAGES] ✅ Total messages:', dedupedMessages.length, '(', cachedMessages.length, 'cached +', newMessages.length, 'new)');

        return dedupedMessages;
      } catch (error) {
        logger.error('[GROUP MESSAGES] ❌ Failed to sync group messages:', error);
        
        // Fallback to cached messages on error
        const cachedMessages = await getGroupMessages(groupId, user.username);
        return cachedMessages;
      }
    },
    enabled: !!user?.username && !!groupId,
    staleTime: 10000, // 10 seconds
    refetchInterval: 15000, // Refetch every 15 seconds
  });
}
