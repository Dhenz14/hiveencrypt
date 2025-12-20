import { useQuery, QueryFunctionContext } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';
import {
  getGroupConversations,
  getGroupConversation,
  getGroupMessages,
  getAllGroupMessages,
  cacheGroupConversation,
  cacheGroupMessages,
  type GroupConversationCache,
  type GroupMessageCache,
} from '@/lib/messageCache';
import { 
  discoverUserGroups, 
  parseGroupMessageMemo, 
  setGroupNegativeCache,
  discoverGroupMemberPayments,
  MAX_DEEP_BACKFILL_OPS,
  BACKFILL_CHUNK_SIZE 
} from '@/lib/groupBlockchain';
import { hiveClient as optimizedHiveClient } from '@/lib/hiveClient';
import { decryptMemo } from '@/lib/hive';
import { useToast } from '@/hooks/use-toast';
import {
  getLastSyncedOperation,
  setLastSyncedOperation,
  getMaxBackfill,
  shouldShowBackfillWarning,
} from '@/lib/groupSyncState';
import { getCustomGroupName } from '@/lib/customGroupNames';
import type { Group } from '@shared/schema';

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
 * Helper function to process a single transfer operation
 * Returns GroupMessageCache if valid group message, null otherwise
 */
async function processTransferOperation(
  operation: any,
  index: number,
  groupId: string,
  username: string,
  seenTxIds: Set<string>
): Promise<GroupMessageCache | null> {
  try {
    // Validate operation structure before accessing properties
    if (!operation || !operation.op) {
      logger.debug('[GROUP MESSAGES] ⚠️ Invalid operation structure, skipping');
      return null;
    }
    
    const op = operation.op;
    
    // Only process incoming transfers
    if (op[0] !== 'transfer') return null;
    
    const transfer = op[1];
    const memo = transfer.memo;
    const txId = operation.trx_id;
    
    // Skip if already cached
    if (seenTxIds.has(txId)) {
      logger.debug('[GROUP MESSAGES] Cache hit for txId:', txId);
      return null;
    }
    
    // Only process incoming transfers with encrypted memos
    if (transfer.to !== username || !memo || !memo.startsWith('#')) {
      logger.debug('[GROUP MESSAGES] Skipping non-encrypted transfer from:', transfer.from);
      return null;
    }

    logger.info('[GROUP MESSAGES] 🔐 Attempting to decrypt memo from:', transfer.from, 'txId:', txId.substring(0, 8));

    // Decrypt the memo
    const decryptedMemo = await decryptMemo(
      username,
      memo,
      transfer.from,
      txId
    );

    if (!decryptedMemo) {
      logger.warn('[GROUP MESSAGES] ❌ Failed to decrypt memo from:', transfer.from, 'txId:', txId.substring(0, 8));
      return null;
    }

    logger.info('[GROUP MESSAGES] ✅ Successfully decrypted memo from:', transfer.from);

    // Parse group message format
    const parsed = parseGroupMessageMemo(decryptedMemo);
    
    // Skip null results (malformed memos) - don't crash, just log and continue
    if (parsed === null) {
      logger.warn('[GROUP MESSAGES] ⚠️ Malformed group message memo from:', transfer.from, 'content:', decryptedMemo.substring(0, 50));
      return null;
    }
    
    // Only process messages for this group
    if (!parsed.isGroupMessage) {
      logger.debug('[GROUP MESSAGES] Not a group message, skipping');
      return null;
    }
    
    if (parsed.groupId !== groupId) {
      logger.debug('[GROUP MESSAGES] Different group (', parsed.groupId, '), skipping');
      return null;
    }

    logger.info('[GROUP MESSAGES] 📨 Found group message for group:', groupId, 'from:', transfer.from, 'creator:', parsed.creator);

    // Create group message cache entry
    const messageCache: GroupMessageCache = {
      id: txId,
      groupId: parsed.groupId,
      sender: transfer.from,
      creator: parsed.creator, // Store creator for group discovery
      content: parsed.content || '',
      encryptedContent: memo,
      timestamp: operation.timestamp + 'Z', // Normalize to UTC
      recipients: [username], // This user received it
      txIds: [txId],
      confirmed: true,
      status: 'confirmed',
    };

    return messageCache;
  } catch (parseError: any) {
    const errorMsg = parseError?.message?.toLowerCase() || '';
    
    // USER CANCELLED: Propagate this error so calling loop can stop
    if (errorMsg.includes('cancel')) {
      logger.info('[GROUP MESSAGES] User cancelled decryption - propagating to stop loop');
      throw parseError; // Let the caller handle this
    }
    
    logger.error('[GROUP MESSAGES] ❌ Error processing transfer:', parseError instanceof Error ? parseError.message : String(parseError));
    return null;
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
            
            const op = operation.op;
            if (!op || op[0] !== 'transfer') continue;
            
            transfer = op[1];
            memo = transfer.memo;
            txId = operation.trx_id;
            
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
              timestamp: operation.timestamp + 'Z',
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
      const username = user?.username;
      
      try {
        if (!username) {
          logger.warn('[GROUP DISCOVERY] No username, skipping group discovery');
          return [];
        }

        logger.info('[GROUP DISCOVERY] Discovering groups for:', username);

        // STEP 1: Fetch from local cache first (instant load)
        const cachedGroups = await getGroupConversations(username);
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

        // NOTE: Automatic blockchain transfer scanning removed to prevent Keychain popup spam
        // Groups are discovered from: 1) Cache, 2) Custom_json operations, 3) Cached messages
        // New group messages will be decrypted when user opens a specific group chat
        logger.info('[GROUP DISCOVERY] Skipping automatic blockchain transfer scan (popup spam prevention)');

        // Create group entries for groups discovered from cached messages
        // NOTE: No lookupGroupMetadata calls here to prevent Keychain popup spam
        // Full metadata will be fetched when user opens a specific group
        for (const groupId of Array.from(discoveredGroupIds)) {
          checkCancellation(signal, `Group discovery processing ${groupId}`);

          // Skip if we already have this group from blockchain discovery (custom_json)
          if (blockchainGroups.some(g => g.groupId === groupId)) {
            logger.info('[GROUP DISCOVERY] Group already in blockchainGroups:', groupId);
            continue;
          }

          // Use cached data to build group entry - NO decryption calls
          const knownSenders = Array.from(groupSendersMap.get(groupId) || []);
          const cachedCreator = groupCreatorMap.get(groupId);
          
          // Check if user has set a custom name for this group
          const customName = getCustomGroupName(user.username, groupId);
          const displayName = customName || `Group (${groupId.substring(0, 8)}...)`;
          
          const fallbackGroup: Group = {
            groupId,
            name: displayName,
            members: [user.username, ...knownSenders],
            creator: cachedCreator || knownSenders[0] || user.username,
            createdAt: new Date().toISOString(),
            version: 1,
          };
          
          logger.info('[GROUP DISCOVERY] ✅ Created group from cached messages:', fallbackGroup.name, 'with', fallbackGroup.members.length, 'known members');
          blockchainGroups.push(fallbackGroup);
        }

        logger.info('[GROUP DISCOVERY] Total discovered groups (custom_json + transfers):', blockchainGroups.length);

        // STEP 3: Merge and update cache
        const groupMap = new Map<string, GroupConversationCache>();

        // Add cached groups first (with custom names applied)
        cachedGroups.forEach(group => {
          // Apply custom name to cached groups too (not just blockchain-discovered groups)
          const customName = getCustomGroupName(user.username, group.groupId);
          const updatedGroup = customName 
            ? { ...group, name: customName }
            : group;
          groupMap.set(group.groupId, updatedGroup);
        });

        // Update with blockchain data (ALWAYS overwrite to ensure custom names are applied)
        for (const blockchainGroup of blockchainGroups) {
          // Check cancellation periodically in loop
          checkCancellation(signal, 'Group discovery during merge loop');

          const existing = groupMap.get(blockchainGroup.groupId);
          
          // Check for custom name for this group (applies to ALL groups, not just fallbacks)
          const customName = getCustomGroupName(user.username, blockchainGroup.groupId);
          const displayName = customName || blockchainGroup.name;
          
          // ALWAYS overwrite with blockchain/fallback data (with custom names)
          // This ensures custom name updates replace stale cached entries
          
          // Discover member payments if user is creator and payments are enabled
          let memberPayments = existing?.memberPayments || [];
          const isCreator = blockchainGroup.creator === user.username;
          const hasPaymentSettings = blockchainGroup.paymentSettings?.enabled;
          
          if (isCreator && hasPaymentSettings) {
            try {
              const discoveredPayments = await discoverGroupMemberPayments(
                user.username,
                blockchainGroup.groupId
              );
              if (discoveredPayments.length > 0) {
                memberPayments = discoveredPayments;
                logger.info('[GROUP DISCOVERY] 💰 Found', discoveredPayments.length, 'member payments for group:', displayName);
              }
            } catch (paymentError) {
              logger.warn('[GROUP DISCOVERY] Failed to discover member payments:', paymentError);
            }
          }
          
          const groupCache: GroupConversationCache = {
            groupId: blockchainGroup.groupId,
            name: displayName,  // Use custom name if set, otherwise use blockchain name
            members: blockchainGroup.members,
            creator: blockchainGroup.creator,
            createdAt: blockchainGroup.createdAt,
            version: blockchainGroup.version,
            lastMessage: existing?.lastMessage || '',
            lastTimestamp: existing?.lastTimestamp || blockchainGroup.createdAt,
            unreadCount: existing?.unreadCount || 0,
            lastChecked: existing?.lastChecked || new Date().toISOString(),
            paymentSettings: blockchainGroup.paymentSettings || existing?.paymentSettings,  // Preserve payment settings
            memberPayments,  // Include discovered member payments
          };

          groupMap.set(blockchainGroup.groupId, groupCache);
          
          // Update cache (skip if cancelled)
          if (!signal.aborted) {
            await cacheGroupConversation(groupCache, user.username);
          }
        }

        // Final cancellation check before returning
        checkCancellation(signal, 'Group discovery before return');

        const mergedGroups = Array.from(groupMap.values());
        
        // STEP 4: Update group previews from cached messages (if not already set)
        for (const group of mergedGroups) {
          if (!group.lastMessage || group.lastMessage === '') {
            // Check if we have cached messages for this group
            const cachedMessages = await getGroupMessages(group.groupId, user.username);
            
            if (cachedMessages.length > 0) {
              // Get the most recent message
              const latestMessage = cachedMessages[cachedMessages.length - 1];
              
              // Update the group conversation with the latest message
              group.lastMessage = latestMessage.content;
              group.lastTimestamp = latestMessage.timestamp;
              
              // Save updated group to cache
              await cacheGroupConversation(group, user.username);
              
              logger.info('[GROUP DISCOVERY] 📝 Updated preview for group:', group.name, 'with cached message');
            }
          }
        }
        
        logger.info('[GROUP DISCOVERY] ✅ Total groups:', mergedGroups.length);

        return mergedGroups;
      } catch (error) {
        // Handle query cancellation gracefully (not an error)
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.warn('[GROUP DISCOVERY] ⚠️ Query cancelled by React Query, returning cached data');
          logger.info('[GROUP DISCOVERY] Query cancelled, returning cached groups');
          const cachedGroups = await getGroupConversations(username);
          return cachedGroups;
        }
        
        // Real error - log it prominently
        console.error('[GROUP DISCOVERY] ❌❌❌ CRITICAL ERROR ❌❌❌');
        console.error('[GROUP DISCOVERY] Error object:', error);
        console.error('[GROUP DISCOVERY] Error message:', error instanceof Error ? error.message : String(error));
        console.error('[GROUP DISCOVERY] Error stack:', error instanceof Error ? error.stack : 'No stack');
        
        logger.error('[GROUP DISCOVERY] ❌ Failed to discover groups:', error);
        logger.error('[GROUP DISCOVERY] ❌ Error details:', error instanceof Error ? error.message : String(error));
        logger.error('[GROUP DISCOVERY] ❌ Stack:', error instanceof Error ? error.stack : 'No stack');
        
        // Fallback to cached groups on error
        console.warn('[GROUP DISCOVERY] ⚠️ Attempting fallback to cached groups...');
        logger.warn('[GROUP DISCOVERY] ⚠️ Using fallback: Returning cached groups instead');
        
        try {
          const cachedGroups = await getGroupConversations(username);
          console.warn('[GROUP DISCOVERY] ⚠️ Fallback succeeded, returning', cachedGroups.length, 'cached groups');
          logger.warn('[GROUP DISCOVERY] ⚠️ Fallback returned', cachedGroups.length, 'cached groups');
          return cachedGroups;
        } catch (fallbackError) {
          console.error('[GROUP DISCOVERY] ❌ Fallback also failed:', fallbackError);
          return [];
        }
      }
    },
    enabled: !!user?.username,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes (prevents re-discovery spam)
    gcTime: 10 * 60 * 1000, // Keep in memory for 10 minutes
    refetchInterval: false, // Disable automatic refetching (user can manually refresh)
    refetchOnMount: false, // Don't refetch on mount (use cached data)
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnReconnect: false, // Don't refetch on reconnect
    retry: false, // Don't retry failed requests (prevents popup spam on cancel)
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
        const isFirstSync = lastSyncedOp === null;
        logger.info('[GROUP MESSAGES] Last synced operation:', lastSyncedOp ?? 'none (first sync)');

        // Step 3: Fetch initial operations from blockchain
        // If first sync, fetch 1000 operations to ensure we find older group messages
        // Otherwise, fetch 200 operations (normal incremental sync)
        const initialLimit = isFirstSync ? 1000 : 200;
        logger.info('[GROUP MESSAGES] Fetching', initialLimit, 'operations', isFirstSync ? '(first sync - deep scan)' : '(incremental sync)');
        
        const latestHistory = await optimizedHiveClient.getAccountHistory(
          user.username,
          initialLimit,
          'transfers',  // filter only transfer operations (10-100x faster than unfiltered)
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

        // Step 4: Process initial operations and cache them BEFORE checking backfill limit
        logger.info('[GROUP MESSAGES] Processing initial', latestHistory.length, 'operations');
        const newMessages: GroupMessageCache[] = [];
        const seenTxIds = new Set(cachedMessages.map(m => m.txIds).flat());

        let userCancelledDecryption = false;
        for (let i = 0; i < latestHistory.length; i++) {
          // Check cancellation periodically (every 10 messages)
          if (i % 10 === 0) {
            checkCancellation(signal, `Group messages processing initial ops (${i}/${latestHistory.length})`);
          }

          const [index, operation] = latestHistory[i];
          
          try {
            const messageCache = await processTransferOperation(
              operation,
              index,
              groupId,
              user.username,
              seenTxIds
            );
            
            if (messageCache) {
              newMessages.push(messageCache);
              seenTxIds.add(messageCache.id);
            }
          } catch (opError: any) {
            // User cancelled decryption - stop processing ALL remaining transfers
            if (opError?.message?.toLowerCase().includes('cancel')) {
              logger.info('[GROUP MESSAGES] User cancelled - stopping transfer processing');
              userCancelledDecryption = true;
              break;
            }
            // Other errors: log and continue
            logger.warn('[GROUP MESSAGES] Error processing transfer:', opError?.message);
          }
        }
        
        // If user cancelled, skip backfill and return cached messages only
        if (userCancelledDecryption) {
          logger.info('[GROUP MESSAGES] Returning cached messages only (user cancelled decryption)');
          return cachedMessages;
        }

        // Log statistics after initial scan
        logger.info('[GROUP MESSAGES] 📊 Initial scan stats:', {
          operationsExamined: latestHistory.length,
          newMessagesFound: newMessages.length,
          cachedMessages: cachedMessages.length
        });

        // Check cancellation before cache writes
        checkCancellation(signal, 'Group messages before initial cache writes');

        // Step 5: Cache newly discovered messages from initial operations
        if (newMessages.length > 0 && !signal.aborted) {
          logger.info('[GROUP MESSAGES] 💾 Caching', newMessages.length, 'newly discovered messages');
          await cacheGroupMessages(newMessages, user.username);
          logger.info('[GROUP MESSAGES] ✅ Cache write complete');
          
          // Step 5.1: Update group conversation with latest message (for preview)
          const allMessages = [...cachedMessages, ...newMessages].sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          
          if (allMessages.length > 0) {
            const latestMessage = allMessages[0];
            const groupConv = await getGroupConversation(groupId, user.username);
            
            if (groupConv) {
              groupConv.lastMessage = latestMessage.content;
              groupConv.lastTimestamp = latestMessage.timestamp;
              await cacheGroupConversation(groupConv, user.username);
              logger.info('[GROUP MESSAGES] ✅ Updated group conversation preview');
            }
          }
        }

        // Step 6: NOW check if we should backfill
        const MAX_BACKFILL = getMaxBackfill();
        
        // FIRST SYNC DEEP BACKFILL: Scan up to 5000 operations to discover old group messages
        if (lastSyncedOp === null) {
          logger.info('[GROUP MESSAGES] First sync - starting deep backfill');
          
          // Track the oldest sequence number from initial fetch
          let oldestSeqNum = -1;
          if (latestHistory.length > 0) {
            oldestSeqNum = Math.min(...latestHistory.map(([idx]) => idx));
            logger.info('[GROUP MESSAGES] Oldest sequence from initial scan:', oldestSeqNum);
          }
          
          // Calculate how many more chunks we need
          const totalOpsTarget = MAX_DEEP_BACKFILL_OPS;
          const alreadyFetched = initialLimit;
          const remainingOps = totalOpsTarget - alreadyFetched;
          const chunksToFetch = Math.ceil(remainingOps / BACKFILL_CHUNK_SIZE);
          
          let totalChunksScanned = 0;
          let totalOpsScanned = alreadyFetched;
          
          if (oldestSeqNum > 0 && chunksToFetch > 0) {
            toast({
              title: 'Scanning Message History',
              description: 'Looking for older messages, this may take a moment...',
            });
            
            for (let i = 0; i < chunksToFetch; i++) {
              checkCancellation(signal, `Group messages deep backfill chunk ${i + 1}`);
              
              // Use the oldestSeqNum as the starting point for the next chunk
              const nextStart = oldestSeqNum - 1;
              
              if (nextStart < 0) {
                logger.info('[GROUP MESSAGES] Reached beginning of account history, stopping backfill');
                break;
              }
              
              logger.info('[GROUP MESSAGES] Backfill chunk', i + 1, '/', chunksToFetch, 'starting at sequence:', nextStart);
              
              const olderHistory = await optimizedHiveClient.getAccountHistory(
                user.username,
                BACKFILL_CHUNK_SIZE,
                'transfers',  // filter only transfer operations (10-100x faster than unfiltered)
                nextStart  // Start from the operation BEFORE the oldest we've seen
              );
              
              if (olderHistory.length === 0) {
                logger.info('[GROUP MESSAGES] No more operations, stopping backfill');
                break;
              }
              
              // Update oldestSeqNum for the next iteration
              // Defensive: Validate Math.min result to catch edge cases
              const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
              if (!Number.isFinite(chunkOldest)) {
                logger.error('[GROUP MESSAGES] Invalid sequence number from chunk, stopping backfill');
                break;
              }
              oldestSeqNum = chunkOldest;
              totalChunksScanned++;
              totalOpsScanned += olderHistory.length;
              
              logger.info('[GROUP MESSAGES] Processing chunk', i + 1, '(', olderHistory.length, 'operations), oldest sequence:', oldestSeqNum);
              
              // Process these operations using the helper function
              let backfillCancelled = false;
              for (let j = 0; j < olderHistory.length; j++) {
                // Check cancellation periodically (every 10 messages)
                if (j % 10 === 0) {
                  checkCancellation(signal, `Group messages backfill chunk ${i + 1} (${j}/${olderHistory.length})`);
                }
                
                const [index, operation] = olderHistory[j];
                try {
                  const message = await processTransferOperation(
                    operation,
                    index,
                    groupId,
                    user.username,
                    seenTxIds
                  );
                  
                  if (message) {
                    newMessages.push(message);
                    seenTxIds.add(message.id);
                  }
                } catch (opError: any) {
                  if (opError?.message?.toLowerCase().includes('cancel')) {
                    logger.info('[GROUP MESSAGES] User cancelled - stopping backfill chunk');
                    backfillCancelled = true;
                    break;
                  }
                }
              }
              
              // Stop entire backfill if user cancelled
              if (backfillCancelled) break;
              
              logger.info('[GROUP MESSAGES] Chunk', i + 1, 'complete, total new messages so far:', newMessages.length);
              
              // Stop if we've fetched enough
              if (totalOpsScanned >= totalOpsTarget) {
                logger.info('[GROUP MESSAGES] Reached target of', totalOpsTarget, 'operations, stopping backfill');
                break;
              }
            }
          }
          
          // Cache all newly discovered messages from deep backfill
          checkCancellation(signal, 'Group messages before deep backfill cache write');
          
          if (newMessages.length > 0 && !signal.aborted) {
            logger.info('[GROUP MESSAGES] 💾 Caching', newMessages.length, 'messages from deep backfill');
            await cacheGroupMessages(newMessages, user.username);
            logger.info('[GROUP MESSAGES] ✅ Cache write complete');
            
            // Update group conversation with latest message (for preview)
            const allMessages = [...cachedMessages, ...newMessages].sort((a, b) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            
            if (allMessages.length > 0) {
              const latestMessage = allMessages[0];
              const groupConv = await getGroupConversation(groupId, user.username);
              
              if (groupConv) {
                groupConv.lastMessage = latestMessage.content;
                groupConv.lastTimestamp = latestMessage.timestamp;
                await cacheGroupConversation(groupConv, user.username);
                logger.info('[GROUP MESSAGES] ✅ Updated group conversation preview after backfill');
              }
            }
          }
          
          // Set lastSyncedOp to highestOpIndex
          if (highestOpIndex > 0) {
            setLastSyncedOperation(user.username, highestOpIndex);
          }
          
          logger.info('[GROUP MESSAGES] 📊 Deep backfill stats:', {
            chunksScanned: totalChunksScanned,
            totalOperationsScanned: totalOpsScanned,
            newMessagesFound: newMessages.length
          });
          
          logger.info('[GROUP MESSAGES] ✅ First sync deep backfill complete');
        }
        
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

            // Calculate cache hit rate
            const cacheHitRate = dedupedMessages.length > 0 
              ? ((cachedMessages.length / dedupedMessages.length) * 100).toFixed(1) + '%'
              : '0%';

            logger.info('[GROUP MESSAGES] 📊 Final summary (backfill limit hit):', {
              totalMessages: dedupedMessages.length,
              fromCache: cachedMessages.length,
              newlyDiscovered: newMessages.length,
              cacheHitRate: cacheHitRate
            });
            
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
                  'transfers',  // filter only transfer operations (10-100x faster than unfiltered)
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

              try {
                const messageCache = await processTransferOperation(
                  allOperations[i][1],
                  index,
                  groupId,
                  user.username,
                  seenTxIds
                );
                
                if (messageCache) {
                  newMessages.push(messageCache);
                  seenTxIds.add(messageCache.id);
                }
              } catch (opError: any) {
                if (opError?.message?.toLowerCase().includes('cancel')) {
                  logger.info('[GROUP MESSAGES] User cancelled - stopping incremental backfill');
                  break;
                }
              }
            }
            
            // Log backfill statistics
            logger.info('[GROUP MESSAGES] 📊 Backfill stats:', {
              chunksScanned: chunks,
              totalOperationsScanned: allOperations.length,
              newMessagesFound: newMessages.length
            });
            
            // Check cancellation before cache writes
            checkCancellation(signal, 'Group messages before backfill cache writes');

            // Cache newly discovered messages from backfill
            if (newMessages.length > latestHistory.length && !signal.aborted) {
              const backfillMessages = newMessages.slice(latestHistory.length);
              logger.info('[GROUP MESSAGES] 💾 Caching', backfillMessages.length, 'additional messages from backfill');
              await cacheGroupMessages(backfillMessages, user.username);
              logger.info('[GROUP MESSAGES] ✅ Cache write complete');
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

        // Calculate cache hit rate
        const cacheHitRate = dedupedMessages.length > 0 
          ? ((cachedMessages.length / dedupedMessages.length) * 100).toFixed(1) + '%'
          : '0%';

        logger.info('[GROUP MESSAGES] 📊 Final summary:', {
          totalMessages: dedupedMessages.length,
          fromCache: cachedMessages.length,
          newlyDiscovered: newMessages.length,
          cacheHitRate: cacheHitRate
        });

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

/**
 * Helper: Merge group metadata updates into existing group entries
 * Ensures member arrays are de-duped and creator/version fields persist
 */
function mergeGroupMetadata(existing: Group, update: Partial<Group>): Group {
  return {
    ...existing,
    ...update,
    // Merge and de-dup members
    members: update.members 
      ? Array.from(new Set([...existing.members, ...update.members]))
      : existing.members,
    // Preserve highest version
    version: Math.max(existing.version || 1, update.version || 1),
    // Keep creator if available (prefer update, fallback to existing)
    creator: update.creator || existing.creator,
  };
}

/**
 * Helper: Build minimal-but-complete fallback group
 * Guarantees inviter inclusion and sets metadata from available data
 */
function hydrateFallbackGroup(
  groupId: string,
  username: string,
  inviter: string,
  creator?: string,
  customName?: string | null,
  additionalMembers: string[] = []
): Group {
  // De-dup members: current user, inviter, creator (if different), and any additional
  const memberSet = new Set([username, inviter]);
  if (creator && creator !== inviter) {
    memberSet.add(creator);
  }
  for (const member of additionalMembers) {
    memberSet.add(member);
  }
  
  const members = Array.from(memberSet);
  const displayName = customName || `Group (${groupId.substring(0, 8)}...)`;
  
  return {
    groupId,
    name: displayName,
    members,
    creator: creator || inviter,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}
