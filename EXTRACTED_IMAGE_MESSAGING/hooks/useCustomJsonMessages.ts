import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getCustomJsonMessages } from '@/lib/hive';
import {
  getCustomJsonMessagesByConversation,
  cacheCustomJsonMessages,
  getCustomJsonMessageByTxId,
  getConversationKey,
  type CustomJsonMessage,
} from '@/lib/messageCache';
import { queryClient } from '@/lib/queryClient';
import { useEffect, useState } from 'react';

interface UseCustomJsonMessagesOptions {
  partnerUsername: string;
  enabled?: boolean;
}

export function useCustomJsonMessages({
  partnerUsername,
  enabled = true,
}: UseCustomJsonMessagesOptions) {
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

  // Pre-populate React Query cache with cached image messages for instant display
  useEffect(() => {
    if (user?.username && partnerUsername && enabled) {
      getCustomJsonMessagesByConversation(user.username, partnerUsername).then(cachedMessages => {
        if (cachedMessages.length > 0) {
          console.log('[CUSTOM JSON HOOK] Pre-populating cache with', cachedMessages.length, 'cached image messages');
          const queryKey = ['custom-json-messages', user.username, partnerUsername];
          
          // Seed cache with cached data (shows instantly)
          queryClient.setQueryData(queryKey, cachedMessages);
        }
      });
    }
  }, [user?.username, partnerUsername, enabled]);

  const query = useQuery({
    queryKey: ['custom-json-messages', user?.username, partnerUsername],
    queryFn: async () => {
      console.log('[CUSTOM JSON QUERY] Starting query for:', { username: user?.username, partner: partnerUsername });
      
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      // OPTIMIZATION: Load cached messages FIRST to display instantly
      const cachedMessages = await getCustomJsonMessagesByConversation(
        user.username,
        partnerUsername
      );
      
      console.log('[CUSTOM JSON QUERY] Retrieved cached messages:', cachedMessages.length);

      const mergedMessages = new Map<string, CustomJsonMessage>();
      cachedMessages.forEach((msg) => {
        mergedMessages.set(msg.txId, msg);
      });

      try {
        // Fetch latest operations from blockchain
        const blockchainOperations = await getCustomJsonMessages(
          user.username,
          partnerUsername,
          200  // Fetch last 200 operations
        );

        console.log('[CUSTOM JSON QUERY] Retrieved', blockchainOperations.length, 'operations from blockchain');

        // Batch all new messages for single IndexedDB transaction
        const newMessagesToCache: CustomJsonMessage[] = [];

        for (const op of blockchainOperations) {
          if (mergedMessages.has(op.txId)) {
            continue; // Already cached
          }

          // Convert operation to CustomJsonMessage format
          const conversationKey = getConversationKey(user.username, partnerUsername);
          const customJsonMessage: CustomJsonMessage = {
            txId: op.txId,
            sessionId: op.sessionId,
            conversationKey,
            from: op.from,
            to: op.to,
            timestamp: op.timestamp,
            encryptedPayload: op.encryptedPayload,
            hash: op.hash,
            chunks: op.chunks,
            isDecrypted: false,
            confirmed: true, // Blockchain operations are always confirmed
          };

          newMessagesToCache.push(customJsonMessage);
          mergedMessages.set(op.txId, customJsonMessage);
        }

        // OPTIMIZATION: Batch cache all new messages in single transaction
        if (newMessagesToCache.length > 0) {
          console.log('[CUSTOM JSON QUERY] Caching', newMessagesToCache.length, 'new image messages');
          await cacheCustomJsonMessages(newMessagesToCache, user.username);
        }

        // Return all messages sorted by timestamp
        const allMessages = Array.from(mergedMessages.values()).sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        console.log('[CUSTOM JSON QUERY] Returning', allMessages.length, 'total image messages');
        return allMessages;

      } catch (error) {
        console.error('[CUSTOM JSON QUERY] Failed to fetch from blockchain:', error);
        // Return cached messages on error
        return Array.from(mergedMessages.values()).sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }
    },
    enabled: enabled && !!user?.username && !!partnerUsername,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchInterval: isActive ? 60000 : false, // Auto-refetch every 60s when active
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return query;
}
