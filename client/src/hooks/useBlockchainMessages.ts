import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  getConversationMessages,
  decryptMemo,
  discoverConversations,
} from '@/lib/hive';
import {
  getMessagesByConversation,
  cacheMessage,
  updateConversation,
  getConversation,
  getConversationKey,
  type MessageCache,
} from '@/lib/messageCache';
import { queryClient } from '@/lib/queryClient';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { getAccountMetadata, parseMinimumHBD, DEFAULT_MINIMUM_HBD } from '@/lib/accountMetadata';
import { useExceptionsList } from '@/hooks/useExceptionsList';

interface UseBlockchainMessagesOptions {
  partnerUsername: string;
  enabled?: boolean;
}

export function useBlockchainMessages({
  partnerUsername,
  enabled = true,
}: UseBlockchainMessagesOptions) {
  const { user } = useAuth();
  const { isException } = useExceptionsList(); // Check if contact is on exceptions list (from context)
  const [isActive, setIsActive] = useState(true);
  const [lastSendTime, setLastSendTime] = useState<number>(0);
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());
  
  // Listen for exceptions changes and invalidate query to trigger re-evaluation
  useEffect(() => {
    const handleExceptionsChanged = (event: CustomEvent) => {
      if (user?.username && event.detail?.username === user.username) {
        console.log('[useBlockchainMessages] Exceptions changed, invalidating query for re-evaluation');
        queryClient.invalidateQueries({ 
          queryKey: ['blockchain-messages', user.username, partnerUsername] 
        });
      }
    };
    
    window.addEventListener('exceptionsChanged', handleExceptionsChanged as EventListener);
    
    return () => {
      window.removeEventListener('exceptionsChanged', handleExceptionsChanged as EventListener);
    };
  }, [user?.username, partnerUsername]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsActive(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Track user activity for adaptive polling
  useEffect(() => {
    const handleActivity = () => {
      setLastActivityTime(Date.now());
    };
    
    // Update activity time on mouse/keyboard events
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keypress', handleActivity);
    
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keypress', handleActivity);
    };
  }, []);

  // Register fast polling trigger for MessageComposer
  useEffect(() => {
    registerFastPollingTrigger(() => setLastSendTime(Date.now()));
    return () => registerFastPollingTrigger(() => {});
  }, []);

  // TIER 1 OPTIMIZATION: Pre-populate React Query cache with cached messages for instant display
  // Removed immediate invalidation - let staleTime control when to refetch
  useEffect(() => {
    if (user?.username && partnerUsername && enabled) {
      getMessagesByConversation(user.username, partnerUsername).then(cachedMessages => {
        if (cachedMessages.length > 0) {
          // PHASE 4.1: Filter out hidden messages for instant display
          const visibleCached = cachedMessages.filter(msg => !msg.hidden);
          const hiddenCachedCount = cachedMessages.length - visibleCached.length;
          
          logger.info('[MESSAGES] Pre-populating cache with', visibleCached.length, 'visible messages (', hiddenCachedCount, 'hidden)');
          const queryKey = ['blockchain-messages', user.username, partnerUsername];
          
          // Seed cache with cached data (shows instantly) - new format with hiddenCount
          queryClient.setQueryData(queryKey, {
            messages: visibleCached,
            hiddenCount: hiddenCachedCount,
          });
          
          // OPTIMIZATION: Don't immediately invalidate - let staleTime/refetchInterval handle it
          // This prevents excessive refetches on tab switch / component remount
        }
      });
    }
  }, [user?.username, partnerUsername, enabled]);

  const query = useQuery({
    queryKey: ['blockchain-messages', user?.username, partnerUsername],
    queryFn: async () => {
      logger.info('[QUERY] Starting blockchain messages query for:', { username: user?.username, partner: partnerUsername });
      
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      // PHASE 4.1: Load user's minimum HBD preference ONCE per query
      let userMinimumHBD = DEFAULT_MINIMUM_HBD;
      let messagePrivacy: 'everyone' | 'following' | 'disabled' = 'everyone'; // Default to everyone
      let userFollowingList: string[] = [];
      
      try {
        const metadata = await getAccountMetadata(user.username);
        userMinimumHBD = parseMinimumHBD(metadata);
        messagePrivacy = metadata.profile?.hive_messenger?.message_privacy || 'everyone';
        logger.info('[FILTER] User minimum HBD:', userMinimumHBD, 'Message privacy:', messagePrivacy);
        
        // Load following list if privacy is 'following' (for efficient checking)
        if (messagePrivacy === 'following') {
          const { getFollowingList } = await import('@/lib/hiveFollowing');
          userFollowingList = await getFollowingList(user.username);
          logger.info('[FILTER] Loaded following list:', userFollowingList.length, 'accounts');
        }
      } catch (error) {
        logger.warn('[FILTER] Failed to load user preferences, using defaults:', error);
      }

      // Helper: Parse HBD amount string to number for comparison
      const parseHBDAmount = (amountString: string): number => {
        // Amount format: "0.001 HBD" or "1.000 HBD"
        const parts = amountString.trim().split(' ');
        if (parts.length === 2 && parts[1] === 'HBD') {
          return parseFloat(parts[0]);
        }
        return 0;
      };

      const userMinimumAmount = parseHBDAmount(userMinimumHBD);

      // PERFORMANCE FIX: Load cached messages FIRST to display instantly
      const cachedMessages = await getMessagesByConversation(
        user.username,
        partnerUsername
      );
      
      logger.info('[QUERY] Retrieved cached messages:', cachedMessages.length);
      cachedMessages.forEach((msg, idx) => {
        logger.sensitive(`[QUERY] Cached msg ${idx}:`, { 
          id: msg.id.substring(0, 15) + '...', 
          from: msg.from, 
          contentPreview: msg.content.substring(0, 50) + '...',
          contentLength: msg.content.length 
        });
      });

      const mergedMessages = new Map<string, MessageCache>();
      cachedMessages.forEach((msg) => {
        // Detect and fix corrupted messages where content contains encrypted data
        // If message is marked as decrypted, trust it - user manually decrypted it
        if (!msg.isDecrypted) {
          let isCorrupted = false;
          
          // Case 0: content starts with # (encrypted memo format) - THIS IS THE MOST OBVIOUS CASE!
          if (msg.content && msg.content.startsWith('#')) {
            logger.info('[QUERY] Corrupted (case 0): content starts with # (encrypted memo), msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          // Case 1: content exactly matches encryptedContent (most obvious corruption)
          if (!isCorrupted && msg.content === msg.encryptedContent && msg.encryptedContent) {
            logger.info('[QUERY] Corrupted (case 1): content === encryptedContent, msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          // Case 2: content looks like encrypted data (long gibberish without spaces)
          // Encrypted memos are typically 100+ chars of base64-like data
          if (!isCorrupted && msg.content && msg.content.length > 50) {
            const hasSpaces = msg.content.includes(' ');
            const hasCommonWords = /\b(the|is|are|was|were|hello|hi|you|me|we|they)\b/i.test(msg.content);
            const looksLikeEncrypted = !hasSpaces && !hasCommonWords && msg.content.length > 80;
            
            if (looksLikeEncrypted && msg.encryptedContent && msg.encryptedContent.length > 80) {
              logger.info('[QUERY] Corrupted (case 2): content looks encrypted, msg:', msg.id.substring(0, 20));
              isCorrupted = true;
            }
          }
          
          // Case 3: content is encrypted placeholder but doesn't match our standard format
          if (!isCorrupted && msg.content && msg.content.includes('[Encrypted') && 
              msg.content !== '[🔒 Encrypted - Click to decrypt]') {
            logger.info('[QUERY] Corrupted (case 3): non-standard placeholder, msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          if (isCorrupted) {
            logger.info('[QUERY] FIXING corrupted message, setting placeholder');
            msg.content = '[🔒 Encrypted - Click to decrypt]';
            cacheMessage(msg, user.username).catch(err => logger.error('[QUERY] Failed to fix message:', err));
          }
        }
        
        mergedMessages.set(msg.id, msg);
      });

      try {
        // TIER 2 OPTIMIZATION: Get last synced operation ID for incremental filtering
        const conversationKey = getConversationKey(user.username, partnerUsername);
        const { getLastSyncedOpId, setLastSyncedOpId } = await import('@/lib/messageCache');
        let lastSyncedOpId = await getLastSyncedOpId(conversationKey, user.username);
        
        // CRITICAL FIX: If no cached messages exist, ignore lastSyncedOpId to fetch ALL messages
        // This handles case where user cleared messages but metadata persisted
        if (cachedMessages.length === 0) {
          logger.info('[QUERY] No cached messages - fetching ALL from blockchain (ignoring lastSyncedOpId)');
          lastSyncedOpId = null;
        }
        
        // TIER 2: Fetch latest operations and filter client-side for new ones
        // (Hive API's start parameter goes backwards, so we filter instead)
        const blockchainMessages = await getConversationMessages(
          user.username,
          partnerUsername,
          200,  // Always fetch last 200, filter for new ones
          lastSyncedOpId
        );

        // TIER 1 OPTIMIZATION: Batch all new messages for single IndexedDB transaction
        const newMessagesToCache: MessageCache[] = [];
        let highestOpId = lastSyncedOpId || 0;

        for (const msg of blockchainMessages) {
          // TIER 2: Track highest operation ID for incremental sync
          if (msg.index > highestOpId) {
            highestOpId = msg.index;
          }
          
          if (mergedMessages.has(msg.trx_id)) {
            continue;
          }

          // CRITICAL: Skip group messages - they should ONLY appear in group conversations
          // Check if memo looks like a group message (will be handled by group discovery)
          if (msg.memo && msg.memo.startsWith('#')) {
            // This is an encrypted memo that MIGHT be a group message
            // We can't check without decrypting, but group discovery will handle it
            // For now, we cache it and the migration will move it if needed
            logger.info('[QUERY] Found encrypted memo, caching as placeholder (migration will fix if group message):', msg.trx_id.substring(0, 20));
          }

          if (msg.from === user.username) {
            // Sent messages CAN be decrypted using sender's memo key (ECDH encryption)
            // Store as encrypted placeholder initially, user can decrypt with Keychain
            // PHASE 4.1: NEVER filter sent messages - user always sees their own messages
            const messageCache: MessageCache = {
              id: msg.trx_id,
              conversationKey,
              from: msg.from,
              to: msg.to,
              content: '[🔒 Encrypted - Click to decrypt]',
              encryptedContent: msg.memo,
              timestamp: msg.timestamp,
              txId: msg.trx_id,
              confirmed: true,
              amount: msg.amount, // Store HBD transfer amount
            };

            newMessagesToCache.push(messageCache);
            mergedMessages.set(msg.trx_id, messageCache);
          } else {
            // Received message - store with placeholder, will decrypt on demand
            // PHASE 4.1 + EXCEPTIONS: Filter received messages below user's minimum HBD threshold
            // UNLESS sender is on exceptions list (whitelisted contacts always visible)
            // PRIVACY: Also filter based on message_privacy setting and following status
            const messageAmount = parseHBDAmount(msg.amount || '0.000 HBD');
            const senderIsException = isException(msg.from);
            
            let shouldHide = !senderIsException && messageAmount < userMinimumAmount;
            
            // Privacy filtering (only if not already hidden by HBD filter)
            if (!shouldHide && messagePrivacy === 'disabled') {
              // Disabled: Hide all incoming messages (except exceptions)
              shouldHide = !senderIsException;
              if (shouldHide) {
                logger.info('[PRIVACY] Hiding message (privacy=disabled):', {
                  txId: msg.trx_id.substring(0, 20),
                  from: msg.from
                });
              }
            } else if (!shouldHide && messagePrivacy === 'following') {
              // Following-only: Hide if recipient doesn't follow sender (except exceptions)
              const recipientFollowsSender = userFollowingList.includes(msg.from.toLowerCase());
              shouldHide = !senderIsException && !recipientFollowsSender;
              if (shouldHide) {
                logger.info('[PRIVACY] Hiding message (privacy=following, not followed):', {
                  txId: msg.trx_id.substring(0, 20),
                  from: msg.from
                });
              }
            }
            
            if (shouldHide && messageAmount < userMinimumAmount) {
              logger.info('[FILTER] Hiding message below minimum:', {
                txId: msg.trx_id.substring(0, 20),
                from: msg.from,
                amount: msg.amount,
                minimum: userMinimumHBD
              });
            } else if (senderIsException && (messageAmount < userMinimumAmount || messagePrivacy !== 'everyone')) {
              logger.info('[FILTER] Showing message from exception despite filters:', {
                txId: msg.trx_id.substring(0, 20),
                from: msg.from,
                amount: msg.amount,
                privacy: messagePrivacy
              });
            }
            
            const messageCache: MessageCache = {
              id: msg.trx_id,
              conversationKey,
              from: msg.from,
              to: msg.to,
              content: '[🔒 Encrypted - Click to decrypt]',
              encryptedContent: msg.memo,
              timestamp: msg.timestamp,
              txId: msg.trx_id,
              confirmed: true,
              amount: msg.amount, // Store HBD transfer amount
              hidden: shouldHide, // Mark as hidden if below minimum AND not exception
            };

            newMessagesToCache.push(messageCache);
            mergedMessages.set(msg.trx_id, messageCache);
          }
        }

        // TIER 1 OPTIMIZATION: Single batched write instead of N individual writes
        if (newMessagesToCache.length > 0) {
          logger.info('[QUERY] Batching', newMessagesToCache.length, 'new messages for single IndexedDB write');
          await import('@/lib/messageCache').then(({ cacheMessages }) => 
            cacheMessages(newMessagesToCache, user.username)
          );
        }
        
        // TIER 2: Update last synced operation ID for next incremental sync
        if (highestOpId > (lastSyncedOpId || 0)) {
          await setLastSyncedOpId(conversationKey, highestOpId, user.username);
        }
      } catch (blockchainError) {
        logger.error('Failed to fetch from blockchain, using cached data:', blockchainError);
      }

      // PHASE 4 FIX + EXCEPTIONS: Re-evaluate ALL messages (cached + new) against current user minimum
      // This ensures that when user changes their minimum threshold OR exceptions list, cached messages are updated
      logger.info('[PHASE4] Re-evaluating', mergedMessages.size, 'messages against current minimum:', userMinimumHBD);
      let reEvaluatedCount = 0;
      
      mergedMessages.forEach((msg, id) => {
        if (msg.from !== user.username) {
          // RECEIVED message: Re-evaluate against current minimum, exceptions AND privacy settings
          const msgAmount = parseHBDAmount(msg.amount || '0.000 HBD');
          const senderIsException = isException(msg.from);
          
          // First check HBD minimum (unless exception)
          let isHidden = !senderIsException && msgAmount < userMinimumAmount;
          
          // Then apply privacy filters (only if not already hidden)
          if (!isHidden && messagePrivacy === 'disabled') {
            // Disabled: Hide all incoming messages (except exceptions)
            isHidden = !senderIsException;
          } else if (!isHidden && messagePrivacy === 'following') {
            // Following-only: Hide if recipient doesn't follow sender (except exceptions)
            const recipientFollowsSender = userFollowingList.includes(msg.from.toLowerCase());
            isHidden = !senderIsException && !recipientFollowsSender;
          }
          
          // Only update if hidden state changed
          if (msg.hidden !== isHidden) {
            mergedMessages.set(id, { ...msg, hidden: isHidden });
            reEvaluatedCount++;
            logger.info('[PHASE4] Updated hidden flag:', {
              txId: msg.id.substring(0, 20),
              from: msg.from,
              amount: msg.amount,
              isException: senderIsException,
              oldHidden: msg.hidden,
              newHidden: isHidden
            });
          }
        } else {
          // SENT message: Always visible (never hide sent messages)
          if (msg.hidden !== false) {
            mergedMessages.set(id, { ...msg, hidden: false });
            reEvaluatedCount++;
          }
        }
      });
      
      logger.info('[PHASE4] Re-evaluated', reEvaluatedCount, 'messages with changed hidden state');

      const allMessages = Array.from(mergedMessages.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // PHASE 4.1: Filter out hidden messages and track count
      const visibleMessages = allMessages.filter(msg => !msg.hidden);
      const hiddenCount = allMessages.length - visibleMessages.length;

      logger.info('[QUERY] Total messages:', allMessages.length, 'Visible:', visibleMessages.length, 'Hidden:', hiddenCount);

      if (visibleMessages.length > 0) {
        const lastMessage = visibleMessages[visibleMessages.length - 1];
        await updateConversation({
          conversationKey: getConversationKey(user.username, partnerUsername),
          partnerUsername,
          lastMessage: lastMessage.content,
          lastTimestamp: lastMessage.timestamp,
          unreadCount: 0,
          lastChecked: new Date().toISOString(),
        }, user.username);
      }

      // PHASE 4.1: Return object with filtered messages and hidden count
      return {
        messages: visibleMessages,
        hiddenCount,
      };
    },
    enabled: enabled && !!user?.username && !!partnerUsername,
    refetchInterval: (data) => {
      const now = Date.now();
      const timeSinceLastSend = now - lastSendTime;
      const timeSinceActivity = now - lastActivityTime;
      
      // Background tab: slow polling
      if (!isActive) return 45000; // 45 seconds
      
      // Burst mode: Fast polling for 15 seconds after sending a message
      if (timeSinceLastSend < 15000) {
        return 3000; // 3 seconds for instant feedback
      }
      
      // Active conversation: Recent activity (typing, viewing)
      if (timeSinceActivity < 60000) {
        return 5000; // 5 seconds - optimal balance
      }
      
      // Idle conversation: No recent activity
      return 15000; // 15 seconds - slower but still responsive
    },
    staleTime: 12000, // 12 seconds - serves cached data, reduces redundant fetches
    gcTime: 300000, // TIER 1 OPTIMIZATION: 5 minutes (was default) - keep in memory longer
    refetchOnWindowFocus: 'always', // Still refetch on focus for freshness
  });

  return query;
}

export function useConversationDiscovery() {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(true);
  const [cachedConversations, setCachedConversations] = useState<any[]>([]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsActive(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // PERFORMANCE FIX: Load cached conversations immediately on mount
  useEffect(() => {
    if (user?.username) {
      import('@/lib/messageCache').then(({ getConversations }) => {
        getConversations(user.username).then(cached => {
          logger.debug('[CONV DISCOVERY] Loaded', cached.length, 'cached conversations immediately');
          setCachedConversations(cached);
        });
      });
    }
  }, [user?.username]);

  const query = useQuery({
    queryKey: ['blockchain-conversations', user?.username],
    // PERFORMANCE FIX: Return cached data immediately if available
    initialData: cachedConversations.length > 0 ? cachedConversations : undefined,
    queryFn: async () => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      logger.debug('[CONV DISCOVERY] Starting progressive discovery for user:', user.username);
      
      // TIER 3 OPTIMIZATION: Progressive Loading - Two-phase discovery
      // Phase 1: Quick scan of recent 50 operations (5-7 seconds)
      // Phase 2: Full scan of 200 operations in background (runs after returning Phase 1 results)
      
      // ========== PHASE 1: Quick Initial Scan (50 operations) ==========
      logger.debug('[PROGRESSIVE] Phase 1: Fetching recent 50 operations (quick scan)...');
      const phase1Start = performance.now();
      
      const phase1Partners = await discoverConversations(user.username, 50);
      logger.debug('[PROGRESSIVE] Phase 1 discovered', phase1Partners.length, 'partners in', 
                  Math.round(performance.now() - phase1Start), 'ms');

      // Process Phase 1 partners
      const phase1Cached = await Promise.all(
        phase1Partners.map(({ username }) => getConversation(user.username, username))
      );

      const phase1Uncached = phase1Partners.filter((_, index) => !phase1Cached[index]);
      
      logger.debug('[PROGRESSIVE] Phase 1 - Cached:', phase1Cached.filter(Boolean).length, 
                  'Uncached:', phase1Uncached.length);

      // Create placeholders for Phase 1 uncached partners
      const phase1NewConversations = await Promise.all(
        phase1Uncached.map(async ({ username, lastTimestamp }) => {
          const newConversation = {
            conversationKey: getConversationKey(user.username, username),
            partnerUsername: username,
            lastMessage: `New conversation with @${username}`,
            lastTimestamp: lastTimestamp,
            unreadCount: 0,
            lastChecked: new Date().toISOString(),
          };

          await updateConversation(newConversation, user.username);
          return newConversation;
        })
      );

      // Return Phase 1 results immediately (5-7 seconds total)
      const phase1Conversations = [
        ...phase1Cached.filter(Boolean),
        ...phase1NewConversations.filter(Boolean)
      ];

      logger.debug('[PROGRESSIVE] Phase 1 complete:', phase1Conversations.length, 
                  'conversations ready to display');

      // ========== PHASE 2: Background Full Scan (200 operations) ==========
      // Launch Phase 2 in background - don't await, let it run async
      (async () => {
        try {
          logger.debug('[PROGRESSIVE] Phase 2: Starting background scan of 200 operations...');
          const phase2Start = performance.now();
          const queryKey = ['blockchain-conversations', user.username];
          
          const allPartners = await discoverConversations(user.username, 200);
          logger.debug('[PROGRESSIVE] Phase 2 discovered', allPartners.length, 'total partners in',
                      Math.round(performance.now() - phase2Start), 'ms');

          // Find NEW partners not in Phase 1
          const phase1Usernames = new Set(phase1Partners.map(p => p.username));
          const newPartners = allPartners.filter(p => !phase1Usernames.has(p.username));
          
          if (newPartners.length === 0) {
            logger.debug('[PROGRESSIVE] Phase 2: No additional partners found beyond Phase 1');
            return;
          }

          logger.debug('[PROGRESSIVE] Phase 2: Found', newPartners.length, 'additional partners');

          // Process new partners
          const newCached = await Promise.all(
            newPartners.map(({ username }) => getConversation(user.username, username))
          );

          const newUncached = newPartners.filter((_, index) => !newCached[index]);

          const newConversationsData = await Promise.all(
            newUncached.map(async ({ username, lastTimestamp }) => {
              const newConversation = {
                conversationKey: getConversationKey(user.username, username),
                partnerUsername: username,
                lastMessage: `New conversation with @${username}`,
                lastTimestamp: lastTimestamp,
                unreadCount: 0,
                lastChecked: new Date().toISOString(),
              };

              await updateConversation(newConversation, user.username);
              return newConversation;
            })
          );

          const phase2NewConversations = [
            ...newCached.filter(Boolean),
            ...newConversationsData.filter(Boolean)
          ];

          logger.debug('[PROGRESSIVE] Phase 2 complete: Found', phase2NewConversations.length, 
                      'additional conversations');

          // RACE CONDITION FIX: Use functional setQueryData to merge with current cache
          // This prevents Phase 2 from overwriting newer refetch results
          queryClient.setQueryData(queryKey, (currentData: any) => {
            if (!currentData) {
              logger.warn('[PROGRESSIVE] Phase 2: Cache cleared, skipping update');
              return currentData;
            }

            // Build set of existing conversation keys to avoid duplicates
            const existingKeys = new Set(
              currentData.map((c: any) => c.conversationKey)
            );

            // Only add conversations that don't already exist in current cache
            const trulyNewConversations = phase2NewConversations.filter(
              c => c && !existingKeys.has(c.conversationKey)
            );

            if (trulyNewConversations.length === 0) {
              logger.debug('[PROGRESSIVE] Phase 2: All conversations already in cache');
              return currentData;
            }

            logger.debug('[PROGRESSIVE] Phase 2: Adding', trulyNewConversations.length, 
                        'new conversations to cache');

            return [...currentData, ...trulyNewConversations];
          });
        } catch (error) {
          logger.error('[PROGRESSIVE] Phase 2 error:', error);
        }
      })();

      // Return Phase 1 results immediately (user sees conversations in 5-7 seconds)
      return phase1Conversations;
    },
    enabled: !!user?.username,
    refetchInterval: (data) => {
      // Conversation list updates less frequently than messages
      if (!isActive) return 90000; // 90 seconds when hidden
      return 20000; // 20 seconds when active
    },
    staleTime: 20000, // Increased from 10s to 20s
  });

  return query;
}

// Create a singleton ref to store the setLastSendTime function
let triggerFastPollingCallback: (() => void) | null = null;

export const registerFastPollingTrigger = (callback: () => void) => {
  triggerFastPollingCallback = callback;
};

export const triggerFastPolling = () => {
  if (triggerFastPollingCallback) {
    triggerFastPollingCallback();
  }
};
