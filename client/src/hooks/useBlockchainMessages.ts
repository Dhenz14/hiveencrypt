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
        // Detect corrupted messages: content should NEVER contain base64/encrypted data
        // Valid content patterns:
        // - Encrypted placeholder: "[🔒 Encrypted - Click to decrypt]" (universal for both sent/received)
        // - Decrypted: actual message text (variable, but NOT base64-like)
        const isLikelyCorrupted = 
          msg.content.length > 80 && // Too long for placeholder
          !msg.content.includes('🔒') && // Doesn't have emoji (encrypted placeholder)
          msg.content !== msg.encryptedContent; // Not exact match (already handled)
        
        const needsFixing = isLikelyCorrupted || (msg.content === msg.encryptedContent && msg.encryptedContent);
        
        if (needsFixing) {
          console.log('[QUERY] Fixing corrupted message', {
            reason: isLikelyCorrupted ? 'base64-like content' : 'content === encrypted',
            contentPreview: msg.content.substring(0, 30) + '...',
            contentLength: msg.content.length
          });
          
          // Replace with universal encrypted placeholder (works for both sent and received)
          msg.content = '[🔒 Encrypted - Click to decrypt]';
          
          // Update cache with fixed content
          cacheMessage(msg).catch(err => console.error('[QUERY] Failed to update cached message:', err));
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

            await cacheMessage(messageCache);
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
            await cacheMessage(messageCache);
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
        });
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

      const partners = await discoverConversations(user.username, 1000);

      const conversations = [];
      for (const partner of partners) {
        const conversation = await getConversation(user.username, partner);
        if (conversation) {
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
            
            if (lastMessage.from === user.username) {
              // Cannot decrypt sent messages (no recipient private key)
              // Use placeholder for conversation discovery
              decryptedContent = '[Message sent by you]';
            } else {
              decryptedContent = await decryptMemo(user.username, lastMessage.memo, lastMessage.from);
              if (!decryptedContent) {
                decryptedContent = '[Encrypted message]';
              }
            }

            await updateConversation({
              conversationKey: getConversationKey(user.username, partner),
              partnerUsername: partner,
              lastMessage: decryptedContent,
              lastTimestamp: lastMessage.timestamp,
              unreadCount: 0,
              lastChecked: new Date().toISOString(),
            });

            conversations.push({
              conversationKey: getConversationKey(user.username, partner),
              partnerUsername: partner,
              lastMessage: decryptedContent,
              lastTimestamp: lastMessage.timestamp,
              unreadCount: 0,
              lastChecked: new Date().toISOString(),
            });
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
