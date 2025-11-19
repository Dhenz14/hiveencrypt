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
  lookupGroupMetadata, 
  setGroupNegativeCache,
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
    if (!operation || !operation[1] || !operation[1].op) {
      logger.debug('[GROUP MESSAGES] ⚠️ Invalid operation structure, skipping');
      return null;
    }
    
    const op = operation[1].op;
    
    // Only process incoming transfers
    if (op[0] !== 'transfer') return null;
    
    const transfer = op[1];
    const memo = transfer.memo;
    const txId = operation[1].trx_id;
    
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
      timestamp: operation[1].timestamp + 'Z', // Normalize to UTC
      recipients: [username], // This user received it
      txIds: [txId],
      confirmed: true,
      status: 'confirmed',
    };

    return messageCache;
  } catch (parseError) {
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

        // STEP 2.6: ALWAYS scan blockchain transfers to discover groups user was invited to
        // This ensures invite-only groups are never missed, regardless of cache state
        // TODO: Optimize with watermark-based incremental scanning in future update
        logger.info('[GROUP DISCOVERY] Scanning blockchain transfers for group invitations...');
        
        try {
          // Fetch recent transfer history
          const transferHistory = await optimizedHiveClient.getAccountHistory(
            user.username,
            200, // Scan last 200 operations for group messages
            'transfers', // Only transfer operations
            -1 // Latest
          );
          
          logger.info('[GROUP DISCOVERY] Scanning', transferHistory.length, 'blockchain transfers for group messages');
          
          const discoveredMessages: GroupMessageCache[] = [];
          const groupIdsToLookup = new Set<string>();
          const tempGroupMetadata = new Map<string, { members: string[]; creator: string }>();
          
          // Process each transfer to find group messages
          for (const operation of transferHistory) {
            try {
              const op = operation[1]?.op;
              if (!op || op[0] !== 'transfer') continue;
              
              const transfer = op[1];
              const memo = transfer.memo;
              const txId = operation[1].trx_id;
              
              // Only process incoming encrypted transfers
              if (transfer.to !== user.username || !memo || !memo.startsWith('#')) {
                continue;
              }
              
              // Try to decrypt the memo
              const decryptedMemo = await decryptMemo(
                user.username,
                memo,
                transfer.from,
                txId
              );
              
              if (!decryptedMemo) continue;
              
              // Check if this is a group message
              const parsed = parseGroupMessageMemo(decryptedMemo);
              if (parsed && parsed.isGroupMessage && parsed.groupId) {
                const groupId = parsed.groupId;
                const sender = transfer.from;
                
                // Track this group for metadata lookup
                groupIdsToLookup.add(groupId);
                  
                  // Track senders
                  if (!discoveredGroupIds.has(groupId)) {
                    discoveredGroupIds.add(groupId);
                    groupSendersMap.set(groupId, new Set([sender, user.username]));
                    logger.info('[GROUP DISCOVERY] 🆕 Discovered new group from blockchain transfer:', groupId);
                  } else {
                    const senders = groupSendersMap.get(groupId);
                    if (senders) {
                      senders.add(sender);
                      senders.add(user.username);
                    }
                  }
                  
                // Store creator if available
                if (parsed.creator && !groupCreatorMap.has(groupId)) {
                  groupCreatorMap.set(groupId, parsed.creator);
                }
                
                // Build temporary metadata
                if (!tempGroupMetadata.has(groupId)) {
                  tempGroupMetadata.set(groupId, {
                    members: [user.username, sender],
                    creator: parsed.creator || sender
                  });
                } else {
                  const meta = tempGroupMetadata.get(groupId)!;
                  if (!meta.members.includes(sender)) {
                    meta.members.push(sender);
                  }
                }
                  
                // Temporarily store message (will update recipients after metadata lookup)
                const messageCache: GroupMessageCache = {
                  id: txId,
                  groupId: parsed.groupId,
                  sender: transfer.from,
                  creator: parsed.creator,
                  content: parsed.content || '',
                  encryptedContent: memo,
                  timestamp: operation[1].timestamp + 'Z',
                  recipients: [user.username, sender], // Temporary
                  txIds: [txId],
                  confirmed: true,
                  status: 'confirmed',
                };
                
                discoveredMessages.push(messageCache);
              }
            } catch (processError) {
              logger.debug('[GROUP DISCOVERY] Failed to process transfer:', processError);
            }
          }
            
          // Look up full metadata for discovered groups
          if (groupIdsToLookup.size > 0) {
            logger.info('[GROUP DISCOVERY] Looking up metadata for', groupIdsToLookup.size, 'discovered groups');
            
            for (const groupId of Array.from(groupIdsToLookup)) {
              try {
                const meta = tempGroupMetadata.get(groupId);
                if (!meta) {
                  logger.warn('[GROUP DISCOVERY] ⚠️ No temp metadata for group:', groupId, '- skipping');
                  continue;
                }
                
                const creator = meta.creator;
                
                // Look up group metadata from creator's history
                const groupMetadata = await lookupGroupMetadata(groupId, creator);
                  
                if (groupMetadata) {
                  logger.info('[GROUP DISCOVERY] ✅ Found full metadata for group:', groupId, 'with', groupMetadata.members.length, 'members');
                  
                  // Update temp metadata with complete info
                  tempGroupMetadata.set(groupId, {
                    members: groupMetadata.members,
                    creator: groupMetadata.creator
                  });
                    
                    // Update all messages for this group with complete recipient list
                    for (const msg of discoveredMessages) {
                      if (msg.groupId === groupId) {
                        msg.recipients = groupMetadata.members;
                        msg.creator = groupMetadata.creator;
                      }
                    }
                    
                    // Add to blockchainGroups
                    if (!blockchainGroups.some(g => g.groupId === groupId)) {
                      const customName = getCustomGroupName(user.username, groupId);
                      blockchainGroups.push({
                        ...groupMetadata,
                        name: customName || groupMetadata.name
                      });
                      logger.info('[GROUP DISCOVERY] ➕ Added group with complete metadata:', groupMetadata.name);
                    }
                  } else {
                    logger.warn('[GROUP DISCOVERY] ⚠️ Metadata lookup failed for group:', groupId, '- using minimal data');
                    
                    // Add minimal group entry as fallback
                    const customName = getCustomGroupName(user.username, groupId);
                    const displayName = customName || `Group (${groupId.substring(0, 8)}...)`;
                    
                    const minimalGroup: Group = {
                      groupId,
                      name: displayName,
                      members: meta.members,
                      creator: meta.creator,
                      createdAt: new Date().toISOString(),
                      version: 1,
                    };
                    
                    blockchainGroups.push(minimalGroup);
                    logger.info('[GROUP DISCOVERY] ➕ Added minimal group:', minimalGroup.name);
                  }
                } catch (lookupError) {
                  logger.warn('[GROUP DISCOVERY] Failed metadata lookup for group:', groupId, lookupError);
                }
              }
            }
            
            // Cache all discovered messages (now with complete recipient lists where available)
            if (discoveredMessages.length > 0) {
              logger.info('[GROUP DISCOVERY] Caching', discoveredMessages.length, 'discovered group messages');
              await cacheGroupMessages(discoveredMessages, user.username);
            }
            
          logger.info('[GROUP DISCOVERY] ✅ Blockchain scan complete. Total unique groups:', discoveredGroupIds.size);
        } catch (scanError) {
          logger.warn('[GROUP DISCOVERY] ⚠️ Failed to scan blockchain transfers:', scanError);
          // Continue without blockchain scan
        }

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
            
            // FALLBACK: Create a minimal group entry even without full metadata
            // This ensures the group is still visible and usable, just without the full member list
            const knownSenders = Array.from(groupSendersMap.get(groupId) || []);
            
            // Check if user has set a custom name for this group
            const customName = getCustomGroupName(user.username, groupId);
            const displayName = customName || `Group (${groupId.substring(0, 8)}...)`;
            
            const fallbackGroup: Group = {
              groupId,
              name: displayName, // Use custom name if set, otherwise fallback to groupId prefix
              members: [user.username, ...knownSenders], // Include user and all known senders
              creator: cachedCreator || knownSenders[0] || user.username,
              createdAt: new Date().toISOString(), // Use current time as fallback
              version: 1,
            };
            
            logger.info('[GROUP DISCOVERY] ✅ Created fallback group entry:', fallbackGroup.name, customName ? '(custom name)' : '(generated)', 'with', fallbackGroup.members.length, 'members');
            blockchainGroups.push(fallbackGroup);
            
            // Set negative cache to prevent repeated blockchain lookups
            setGroupNegativeCache(groupId);
          }
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
        logger.error('[GROUP DISCOVERY] ❌ Failed to discover groups:', error);
        logger.error('[GROUP DISCOVERY] ❌ Error details:', error instanceof Error ? error.message : String(error));
        logger.error('[GROUP DISCOVERY] ❌ Stack:', error instanceof Error ? error.stack : 'No stack');
        
        // Fallback to cached groups on error
        logger.warn('[GROUP DISCOVERY] ⚠️ Using fallback: Returning cached groups instead');
        const cachedGroups = await getGroupConversations(user.username);
        logger.warn('[GROUP DISCOVERY] ⚠️ Fallback returned', cachedGroups.length, 'cached groups');
        return cachedGroups;
      }
    },
    enabled: !!user?.username,
    staleTime: 0, // Always fresh - run discovery on every mount
    refetchInterval: 30000, // Refetch every 30 seconds
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

        for (let i = 0; i < latestHistory.length; i++) {
          // Check cancellation periodically (every 10 messages)
          if (i % 10 === 0) {
            checkCancellation(signal, `Group messages processing initial ops (${i}/${latestHistory.length})`);
          }

          const [index, operation] = latestHistory[i];
          
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
              for (let j = 0; j < olderHistory.length; j++) {
                // Check cancellation periodically (every 10 messages)
                if (j % 10 === 0) {
                  checkCancellation(signal, `Group messages backfill chunk ${i + 1} (${j}/${olderHistory.length})`);
                }
                
                const [index, operation] = olderHistory[j];
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
              }
              
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
