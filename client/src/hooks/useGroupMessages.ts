import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';
import {
  getGroupConversations,
  getGroupMessages,
  cacheGroupConversation,
  cacheGroupMessages,
  type GroupConversationCache,
  type GroupMessageCache,
} from '@/lib/messageCache';
import { discoverUserGroups, parseGroupMessageMemo } from '@/lib/groupBlockchain';
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
 * Hook to discover and fetch all groups the user is a member of
 * Combines blockchain discovery with local cache
 */
export function useGroupDiscovery() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['blockchain-group-conversations', user?.username],
    queryFn: async (): Promise<GroupConversationCache[]> => {
      if (!user?.username) {
        logger.warn('[GROUP DISCOVERY] No username, skipping group discovery');
        return [];
      }

      logger.info('[GROUP DISCOVERY] Discovering groups for:', user.username);

      try {
        // STEP 1: Fetch from local cache first (instant load)
        const cachedGroups = await getGroupConversations(user.username);
        logger.info('[GROUP DISCOVERY] Loaded', cachedGroups.length, 'groups from cache');

        // STEP 2: Discover groups from blockchain
        const blockchainGroups = await discoverUserGroups(user.username);
        logger.info('[GROUP DISCOVERY] Discovered', blockchainGroups.length, 'groups from blockchain');

        // STEP 3: Merge and update cache
        const groupMap = new Map<string, GroupConversationCache>();

        // Add cached groups first
        cachedGroups.forEach(group => {
          groupMap.set(group.groupId, group);
        });

        // Update with blockchain data (newer versions)
        for (const blockchainGroup of blockchainGroups) {
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
            
            // Update cache
            await cacheGroupConversation(groupCache, user.username);
          }
        }

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
 */
export function useGroupMessages(groupId?: string) {
  const { user } = useAuth();
  const { toast } = useToast();

  return useQuery({
    queryKey: ['blockchain-group-messages', user?.username, groupId],
    queryFn: async (): Promise<GroupMessageCache[]> => {
      if (!user?.username || !groupId) {
        return [];
      }

      logger.info('[GROUP MESSAGES] Syncing messages for group:', groupId);

      try {
        // Step 1: Load cached messages first (instant display)
        const cachedMessages = await getGroupMessages(groupId, user.username);
        logger.info('[GROUP MESSAGES] Loaded', cachedMessages.length, 'cached messages');

        // Step 2: Get last synced operation index for pagination
        const lastSyncedOp = getLastSyncedOperation(user.username);
        logger.info('[GROUP MESSAGES] Last synced operation:', lastSyncedOp ?? 'none (first sync)');

        // Step 3: Fetch operations from blockchain with pagination support
        const MAX_BACKFILL = getMaxBackfill();
        let allOperations: Array<[number, any]> = [];
        let highestOpIndex = -1;
        
        // Fetch the latest operations first
        const latestHistory = await optimizedHiveClient.getAccountHistory(
          user.username,
          200,      // limit
          true,     // filterTransfersOnly = true
          -1        // start = -1 (latest)
        );

        logger.info('[GROUP MESSAGES] Fetched', latestHistory.length, 'latest operations');
        
        // Track the highest operation index seen
        if (latestHistory.length > 0) {
          highestOpIndex = Math.max(...latestHistory.map(([idx]) => idx));
          logger.info('[GROUP MESSAGES] Highest operation index:', highestOpIndex);
        }

        allOperations = [...latestHistory];

        // Step 4: Check if we need to backfill and show warning if gap is too large
        if (lastSyncedOp !== null && highestOpIndex > 0) {
          const gap = highestOpIndex - lastSyncedOp;
          logger.info('[GROUP MESSAGES] Operation gap since last sync:', gap);

          if (shouldShowBackfillWarning(lastSyncedOp, highestOpIndex)) {
            logger.warn('[GROUP MESSAGES] ⚠️ Large gap detected, showing backfill warning');
            toast({
              title: "Many New Operations",
              description: `You have ${gap} new operations. Some older messages may not be visible due to backfill limits.`,
              variant: "default",
            });
          }

          // Implement pagination if gap exists but is within backfill limit
          if (gap > 200 && gap <= MAX_BACKFILL) {
            logger.info('[GROUP MESSAGES] Gap within backfill limit, fetching older operations...');
            
            // Calculate how many more operations we need to fetch
            const operationsToFetch = Math.min(gap - 200, MAX_BACKFILL - 200);
            const chunks = Math.ceil(operationsToFetch / 200);
            
            for (let i = 0; i < chunks; i++) {
              const startIndex = highestOpIndex - 200 - (i * 200);
              if (startIndex <= lastSyncedOp) break;
              
              logger.info('[GROUP MESSAGES] Fetching chunk', i + 1, 'of', chunks, 'starting at index:', startIndex);
              
              const olderHistory = await optimizedHiveClient.getAccountHistory(
                user.username,
                200,
                true,
                startIndex
              );
              
              // Filter out operations we already have
              const newOps = olderHistory.filter(([idx]) => 
                !allOperations.some(([existingIdx]) => existingIdx === idx)
              );
              
              allOperations = [...allOperations, ...newOps];
              logger.info('[GROUP MESSAGES] Added', newOps.length, 'new operations from chunk', i + 1);
              
              // Stop if we've reached the last synced operation
              if (olderHistory.some(([idx]) => idx <= lastSyncedOp)) {
                logger.info('[GROUP MESSAGES] Reached last synced operation, stopping backfill');
                break;
              }
            }
            
            logger.info('[GROUP MESSAGES] Backfill complete, total operations:', allOperations.length);
          }
        }

        logger.info('[GROUP MESSAGES] Processing', allOperations.length, 'total operations');

        // Step 5: Parse and decrypt group messages
        const newMessages: GroupMessageCache[] = [];
        const seenTxIds = new Set(cachedMessages.map(m => m.txIds).flat());

        for (const [index, operation] of allOperations) {
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

        // Step 6: Cache newly discovered messages
        if (newMessages.length > 0) {
          logger.info('[GROUP MESSAGES] Discovered', newMessages.length, 'new messages from blockchain');
          await cacheGroupMessages(newMessages, user.username);
        }

        // Step 7: Update last synced operation
        if (highestOpIndex > 0) {
          setLastSyncedOperation(user.username, highestOpIndex);
          logger.info('[GROUP MESSAGES] Updated last synced operation to:', highestOpIndex);
        }

        // Step 8: Merge and sort all messages
        const allMessages = [...cachedMessages, ...newMessages];
        const uniqueMessages = Array.from(
          new Map(allMessages.map(m => [m.id, m])).values()
        ).sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        logger.info('[GROUP MESSAGES] ✅ Total messages:', uniqueMessages.length, '(', cachedMessages.length, 'cached +', newMessages.length, 'new)');

        return uniqueMessages;
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
