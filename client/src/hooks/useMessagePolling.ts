import { useEffect, useRef, useState } from 'react';
import { queryClient } from '@/lib/queryClient';

interface UseMessagePollingOptions {
  username: string;
  sessionToken: string | null;
  enabled: boolean;
  interval?: number;
  onNewMessages?: (count: number) => void;
}

export function useMessagePolling({
  username,
  sessionToken,
  enabled,
  interval = 30000,
  onNewMessages,
}: UseMessagePollingOptions) {
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<string | null>(null);

  const pollMessages = async () => {
    if (!username || !sessionToken || isPolling) return;

    setIsPolling(true);
    setError(null);

    try {
      const queryParams = lastCheckedRef.current 
        ? `?lastChecked=${encodeURIComponent(lastCheckedRef.current)}`
        : '';

      const response = await fetch(`/api/messages/poll${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Polling failed: ${response.statusText}`);
      }

      const data = await response.json();
      const { newMessages, lastChecked } = data;

      lastCheckedRef.current = lastChecked;
      setLastPollTime(new Date(lastChecked));

      if (newMessages > 0) {
        const conversationsResponse = await fetch(`/api/conversations/${username}`, {
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
          },
        });

        if (conversationsResponse.ok) {
          const conversations = await conversationsResponse.json();
          
          for (const conversation of conversations) {
            const messagesResponse = await fetch(`/api/conversations/${conversation.id}/messages`, {
              headers: {
                'Authorization': `Bearer ${sessionToken}`,
              },
            });

            if (messagesResponse.ok) {
              const messages = await messagesResponse.json();
              
              const encryptedMessages = messages.filter(
                (msg: any) => msg.isEncrypted && !msg.decryptedContent && msg.recipient === username
              );

              for (const msg of encryptedMessages) {
                try {
                  if (typeof window !== 'undefined' && window.hive_keychain) {
                    const decrypted = await new Promise<string>((resolve, reject) => {
                      window.hive_keychain.requestDecodeMemo(
                        username,
                        msg.content,
                        (response: any) => {
                          if (response.success) {
                            resolve(response.result);
                          } else {
                            reject(new Error(response.message || 'Decryption failed'));
                          }
                        }
                      );
                    });

                    await fetch(`/api/messages/${msg.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${sessionToken}`,
                      },
                      body: JSON.stringify({ decryptedContent: decrypted }),
                    });
                  }
                } catch (decryptError) {
                  console.error('Failed to decrypt message:', decryptError);
                }
              }
            }
          }
        }

        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        
        if (onNewMessages) {
          onNewMessages(newMessages);
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsPolling(false);
    }
  };

  useEffect(() => {
    if (!enabled || !username || !sessionToken) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    pollMessages();

    intervalRef.current = setInterval(pollMessages, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, username, sessionToken, interval]);

  return {
    isPolling,
    lastPollTime,
    error,
    manualPoll: pollMessages,
  };
}
