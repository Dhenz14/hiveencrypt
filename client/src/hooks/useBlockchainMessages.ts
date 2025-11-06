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

  const query = useQuery({
    queryKey: ['blockchain-messages', user?.username, partnerUsername],
    queryFn: async () => {
      console.log('[QUERY] Starting blockchain messages query for:', { username: user?.username, partner: partnerUsername });
      
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

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
        // PERFORMANCE FIX: Reduced from 1000 to 200 messages per conversation
        // Most conversations have <50 messages, so 200 is plenty for initial load
        const blockchainMessages = await getConversationMessages(
          user.username,
          partnerUsername,
          200
        );

        for (const msg of blockchainMessages) {
          if (mergedMessages.has(msg.trx_id)) {
            continue;
          }

          if (msg.from === user.username) {
            // Sent messages CAN be decrypted using sender's memo key (ECDH encryption)
            // Store as encrypted placeholder initially, user can decrypt with Keychain
            const messageCache: MessageCache = {
              id: msg.trx_id,
              conversationKey: getConversationKey(user.username, partnerUsername),
              from: msg.from,
              to: msg.to,
              content: '[🔒 Encrypted - Click to decrypt]',
              encryptedContent: msg.memo,
              timestamp: msg.timestamp,
              txId: msg.trx_id,
              confirmed: true,
            };

            await cacheMessage(messageCache, user.username);
            mergedMessages.set(msg.trx_id, messageCache);
          } else {
            // Received message - store with placeholder, will decrypt on demand
            const messageCache: MessageCache = {
              id: msg.trx_id,
              conversationKey: getConversationKey(user.username, partnerUsername),
              from: msg.from,
              to: msg.to,
              content: '[🔒 Encrypted - Click to decrypt]',
              encryptedContent: msg.memo,
              timestamp: msg.timestamp,
              txId: msg.trx_id,
              confirmed: true,
            };

            console.log('[QUERY] Caching new received message with placeholder');
            await cacheMessage(messageCache, user.username);
            mergedMessages.set(msg.trx_id, messageCache);
          }
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
      // PERFORMANCE FIX: Reduced polling frequency (was 15s/30s, now 30s/60s)
      // Blockchain doesn't update instantly, so less aggressive polling is fine
      if (!isActive) return 60000; // 1 minute when tab is hidden
      return 30000; // 30 seconds when active
    },
    staleTime: 10000, // Increased from 5s to 10s
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
      // PERFORMANCE FIX: Reduced from 1000 to 200 transactions (most users have <10 conversations)
      // Fetching 1000 transactions can take 10-30 seconds on slow nodes!
      const partners = await discoverConversations(user.username, 200);
      console.log('[CONV DISCOVERY] Discovered partners:', partners);

      // PERFORMANCE FIX: Fetch all cached conversations first to avoid unnecessary blockchain calls
      const cachedConversations = await Promise.all(
        partners.map(partner => getConversation(user.username, partner))
      );

      // Identify which partners need new conversations created
      const uncachedPartners = partners.filter((partner, index) => !cachedConversations[index]);
      
      console.log('[CONV DISCOVERY] Cached:', cachedConversations.filter(Boolean).length, 
                  'Uncached:', uncachedPartners.length);

      // PERFORMANCE FIX: Fetch messages for uncached partners in PARALLEL instead of sequentially
      const newConversationsData = await Promise.all(
        uncachedPartners.map(async (partner) => {
          try {
            // PERFORMANCE FIX: Reduced from 100 to 50 for initial discovery
            // We only need the last message for the conversation list
            const messages = await getConversationMessages(
              user.username,
              partner,
              50
            );

            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1];
              let decryptedContent: string | null = null;
              
              // For conversation discovery, use placeholders to avoid triggering multiple Keychain prompts
              // Users can decrypt individual messages within the conversation view
              if (lastMessage.from === user.username) {
                decryptedContent = '[Encrypted message sent by you]';
              } else {
                decryptedContent = '[Encrypted message]';
              }

              const newConversation = {
                conversationKey: getConversationKey(user.username, partner),
                partnerUsername: partner,
                lastMessage: decryptedContent,
                lastTimestamp: lastMessage.timestamp,
                unreadCount: 0,
                lastChecked: new Date().toISOString(),
              };

              console.log('[CONV DISCOVERY] Creating new conversation for:', partner);
              await updateConversation(newConversation, user.username);
              return newConversation;
            }
          } catch (error) {
            console.error('[CONV DISCOVERY] Error fetching messages for partner:', partner, error);
          }
          return null;
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
