import { useEffect, useRef, useState } from 'react';
import { getAccountHistory, filterEncryptedMessages } from '@/lib/hive';
import type { Message } from '@shared/schema';
import { decryptMemo } from '@/lib/encryption';

interface UseMessagePollingOptions {
  username: string;
  enabled: boolean;
  interval?: number; // in milliseconds
  onNewMessages?: (messages: any[]) => void;
}

export function useMessagePolling({
  username,
  enabled,
  interval = 30000, // 30 seconds
  onNewMessages,
}: UseMessagePollingOptions) {
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const pollMessages = async () => {
    if (!username || isPolling) return;

    setIsPolling(true);
    setError(null);

    try {
      const history = await getAccountHistory(username, -1, 100);
      const encryptedMessages = filterEncryptedMessages(history, username);
      
      setLastPollTime(new Date());
      
      if (encryptedMessages.length > 0 && onNewMessages) {
        onNewMessages(encryptedMessages);
      }
    } catch (err) {
      console.error('Polling error:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsPolling(false);
    }
  };

  useEffect(() => {
    if (!enabled || !username) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial poll
    pollMessages();

    // Set up interval
    intervalRef.current = setInterval(pollMessages, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, username, interval]);

  return {
    isPolling,
    lastPollTime,
    error,
    manualPoll: pollMessages,
  };
}
