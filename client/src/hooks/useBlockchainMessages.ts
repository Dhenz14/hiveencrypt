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

interface UseBlockchainMessagesOptions {
  partnerUsername: string;
  enabled?: boolean;
}

export function useBlockchainMessages({
  partnerUsername,
  enabled = true,
}: UseBlockchainMessagesOptions) {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsActive(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // TIER 1 OPTIMIZATION: Pre-populate React Query cache with cached messages for instant display
  // Removed immediate invalidation - let staleTime control when to refetch
  useEffect(() => {
    if (user?.username && partnerUsername && enabled) {
      getMessagesByConversation(user.username, partnerUsername).then(cachedMessages => {
        if (cachedMessages.length > 0) {
          console.log('[MESSAGES] Pre-populating cache with', cachedMessages.length, 'cached messages');
          const queryKey = ['blockchain-messages', user.username, partnerUsername];
          
          // Seed cache with cached data (shows instantly)
          queryClient.setQueryData(queryKey, cachedMessages);
          
          // OPTIMIZATION: Don't immediately invalidate - let staleTime/refetchInterval handle it
          // This prevents excessive refetches on tab switch / component remount
        }
      });
    }
  }, [user?.username, partnerUsername, enabled]);

  const query = useQuery({
    queryKey: ['blockchain-messages', user?.username, partnerUsername],
    queryFn: async () => {
      console.log('[QUERY] Starting blockchain messages query for:', { username: user?.username, partner: partnerUsername });
      
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      // PERFORMANCE FIX: Load cached messages FIRST to display instantly
      const cachedMessages = await getMessagesByConversation(
        user.username,
        partnerUsername
      );
      
      console.log('[QUERY] Retrieved cached messages:', cachedMessages.length);
      cachedMessages.forEach((msg, idx) => {
        console.log(`[QUERY] Cached msg ${idx}:`, { 
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
            console.log('[QUERY] Corrupted (case 0): content starts with # (encrypted memo), msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          // Case 1: content exactly matches encryptedContent (most obvious corruption)
          if (!isCorrupted && msg.content === msg.encryptedContent && msg.encryptedContent) {
            console.log('[QUERY] Corrupted (case 1): content === encryptedContent, msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          // Case 2: content looks like encrypted data (long gibberish without spaces)
          // Encrypted memos are typically 100+ chars of base64-like data
          if (!isCorrupted && msg.content && msg.content.length > 50) {
            const hasSpaces = msg.content.includes(' ');
            const hasCommonWords = /\b(the|is|are|was|were|hello|hi|you|me|we|they)\b/i.test(msg.content);
            const looksLikeEncrypted = !hasSpaces && !hasCommonWords && msg.content.length > 80;
            
            if (looksLikeEncrypted && msg.encryptedContent && msg.encryptedContent.length > 80) {
              console.log('[QUERY] Corrupted (case 2): content looks encrypted, msg:', msg.id.substring(0, 20));
              isCorrupted = true;
            }
          }
          
          // Case 3: content is encrypted placeholder but doesn't match our standard format
          if (!isCorrupted && msg.content && msg.content.includes('[Encrypted') && 
              msg.content !== '[🔒 Encrypted - Click to decrypt]') {
            console.log('[QUERY] Corrupted (case 3): non-standard placeholder, msg:', msg.id.substring(0, 20));
            isCorrupted = true;
          }
          
          if (isCorrupted) {
            console.log('[QUERY] FIXING corrupted message, setting placeholder');
            msg.content = '[🔒 Encrypted - Click to decrypt]';
            cacheMessage(msg, user.username).catch(err => console.error('[QUERY] Failed to fix message:', err));
          }
        }
        
        mergedMessages.set(msg.id, msg);
      });

      try {
        // TIER 2 OPTIMIZATION: Get last synced operation ID for incremental filtering
        const conversationKey = getConversationKey(user.username, partnerUsername);
        const { getLastSyncedOpId, setLastSyncedOpId } = await import('@/lib/messageCache');
        const lastSyncedOpId = await getLastSyncedOpId(conversationKey, user.username);
        
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

          if (msg.from === user.username) {
            // Sent messages CAN be decrypted using sender's memo key (ECDH encryption)
            // Store as encrypted placeholder initially, user can decrypt with Keychain
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
            };

            newMessagesToCache.push(messageCache);
            mergedMessages.set(msg.trx_id, messageCache);
          } else {
            // Received message - store with placeholder, will decrypt on demand
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
            };

            newMessagesToCache.push(messageCache);
            mergedMessages.set(msg.trx_id, messageCache);
          }
        }

        // TIER 1 OPTIMIZATION: Single batched write instead of N individual writes
        if (newMessagesToCache.length > 0) {
          console.log('[QUERY] Batching', newMessagesToCache.length, 'new messages for single IndexedDB write');
          await import('@/lib/messageCache').then(({ cacheMessages }) => 
            cacheMessages(newMessagesToCache, user.username)
          );
        }
        
        // TIER 2: Update last synced operation ID for next incremental sync
        if (highestOpId > (lastSyncedOpId || 0)) {
          await setLastSyncedOpId(conversationKey, highestOpId, user.username);
        }
      } catch (blockchainError) {
        console.error('Failed to fetch from blockchain, using cached data:', blockchainError);
      }

      const allMessages = Array.from(mergedMessages.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      console.log('[QUERY] Returning messages, total count:', allMessages.length);
      allMessages.forEach((msg, idx) => {
        console.log(`[QUERY] Returning msg ${idx}:`, { 
          id: msg.id.substring(0, 15) + '...', 
          from: msg.from, 
          contentPreview: msg.content.substring(0, 50) + '...',
          contentLength: msg.content.length 
        });
      });

      if (allMessages.length > 0) {
        const lastMessage = allMessages[allMessages.length - 1];
        await updateConversation({
          conversationKey: getConversationKey(user.username, partnerUsername),
          partnerUsername,
          lastMessage: lastMessage.content,
          lastTimestamp: lastMessage.timestamp,
          unreadCount: 0,
          lastChecked: new Date().toISOString(),
        }, user.username);
      }

      return allMessages;
    },
    enabled: enabled && !!user?.username && !!partnerUsername,
    refetchInterval: (data) => {
      // TIER 1 OPTIMIZATION: Further reduced polling frequency for better performance
      // Blockchain doesn't update instantly, so less aggressive polling is acceptable
      if (!isActive) return 120000; // 2 minutes when tab is hidden (was 60s)
      return 60000; // 1 minute when active (was 30s)
    },
    staleTime: 30000, // TIER 1 OPTIMIZATION: 30s (was 10s) - cached data valid longer
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
          console.log('[CONV DISCOVERY] Loaded', cached.length, 'cached conversations immediately');
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

      console.log('[CONV DISCOVERY] Starting for user:', user.username);
      
      // PERFORMANCE FIX: Reduced limit from 1000 to 200 (5x faster)
      // 200 transactions = ~100 bilateral transfers = covers most users' conversation history
      const partnerData = await discoverConversations(user.username, 200);
      console.log('[CONV DISCOVERY] Discovered partners with timestamps:', partnerData);

      // PERFORMANCE FIX: Fetch all cached conversations first to avoid unnecessary blockchain calls
      const cachedConversations = await Promise.all(
        partnerData.map(({ username }) => getConversation(user.username, username))
      );

      // Identify which partners need new conversations created
      const uncachedPartners = partnerData.filter((_, index) => !cachedConversations[index]);
      
      console.log('[CONV DISCOVERY] Cached:', cachedConversations.filter(Boolean).length, 
                  'Uncached:', uncachedPartners.length);

      // PERFORMANCE FIX: Create lightweight conversation placeholders WITHOUT fetching messages!
      // This eliminates 50+ blockchain calls per uncached partner (MASSIVE speed boost)
      // Messages will be fetched only when user clicks on the conversation
      const newConversationsData = await Promise.all(
        uncachedPartners.map(async ({ username, lastTimestamp }) => {
          const newConversation = {
            conversationKey: getConversationKey(user.username, username),
            partnerUsername: username,
            lastMessage: `New conversation with @${username}`,
            // Use REAL timestamp from blockchain discovery (accurate ordering!)
            lastTimestamp: lastTimestamp,
            unreadCount: 0,
            lastChecked: new Date().toISOString(),
          };

          console.log('[CONV DISCOVERY] Creating placeholder conversation for:', username, 'timestamp:', lastTimestamp);
          await updateConversation(newConversation, user.username);
          return newConversation;
        })
      );

      // Combine cached and newly created conversations
      const conversations = [
        ...cachedConversations.filter(Boolean),
        ...newConversationsData.filter(Boolean)
      ];

      console.log('[CONV DISCOVERY] Total conversations:', conversations.length);
      return conversations;
    },
    enabled: !!user?.username,
    // PERFORMANCE FIX: Reduced polling frequency (was 30s/60s, now 60s/120s)
    // Conversation discovery doesn't need to be as frequent as message polling
    refetchInterval: isActive ? 60000 : 120000, // 1 min active, 2 min background
    staleTime: 20000, // Increased from 10s to 20s
  });

  return query;
}
