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
        const blockchainMessages = await getConversationMessages(
          user.username,
          partnerUsername,
          1000
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
      if (!isActive) return 30000;
      return 15000;
    },
    staleTime: 5000,
  });

  return query;
}

export function useConversationDiscovery() {
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
    queryKey: ['blockchain-conversations', user?.username],
    queryFn: async () => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      console.log('[CONV DISCOVERY] Starting for user:', user.username);
      const partners = await discoverConversations(user.username, 1000);
      console.log('[CONV DISCOVERY] Discovered partners:', partners);

      const conversations = [];
      for (const partner of partners) {
        console.log('[CONV DISCOVERY] Processing partner:', partner);
        const conversation = await getConversation(user.username, partner);
        if (conversation) {
          console.log('[CONV DISCOVERY] Found cached conversation:', {
            partnerUsername: conversation.partnerUsername,
            lastMessage: conversation.lastMessage.substring(0, 30)
          });
          conversations.push(conversation);
        } else {
          const messages = await getConversationMessages(
            user.username,
            partner,
            100
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

            console.log('[CONV DISCOVERY] Creating new conversation:', {
              currentUser: user.username,
              partner: partner,
              conversationKey: newConversation.conversationKey,
              partnerUsername: newConversation.partnerUsername
            });

            await updateConversation(newConversation, user.username);
            conversations.push(newConversation);
          }
        }
      }

      return conversations;
    },
    enabled: !!user?.username,
    refetchInterval: isActive ? 30000 : 60000,
    staleTime: 10000,
  });

  return query;
}
