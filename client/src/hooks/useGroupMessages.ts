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
 */
export function useGroupMessages(groupId?: string) {
  const { user } = useAuth();

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

        // Step 2: Scan blockchain for incoming transfers
        const history = await optimizedHiveClient.getAccountHistory(
          user.username,
          200,      // limit
          true,     // filterTransfersOnly = true (we want transfer operations)
          -1        // start = -1 (latest)
        );

        logger.info('[GROUP MESSAGES] Scanned', history.length, 'transfer operations');

        // Step 3: Parse and decrypt group messages
        const newMessages: GroupMessageCache[] = [];
        const seenTxIds = new Set(cachedMessages.map(m => m.txIds).flat());

        for (const [index, operation] of history) {
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

        // Step 4: Cache newly discovered messages
        if (newMessages.length > 0) {
          logger.info('[GROUP MESSAGES] Discovered', newMessages.length, 'new messages from blockchain');
          await cacheGroupMessages(newMessages, user.username);
        }

        // Step 5: Merge and sort all messages
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
