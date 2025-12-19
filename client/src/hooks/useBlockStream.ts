import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { blockStreamManager, subscribeToGroupOperations } from '@/lib/blockStream';
import { logger } from '@/lib/logger';

interface BlockStreamState {
  isStreaming: boolean;
  lastBlockNum: number;
  blocksProcessed: number;
  opsProcessed: number;
}

interface UseBlockStreamOptions {
  enabled?: boolean;
  onNewMessage?: (data: any) => void;
  onGroupOperation?: (data: any) => void;
}

export function useBlockStream(options: UseBlockStreamOptions = {}) {
  const { enabled = true, onNewMessage, onGroupOperation } = options;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<BlockStreamState>({
    isStreaming: false,
    lastBlockNum: 0,
    blocksProcessed: 0,
    opsProcessed: 0,
  });

  const handleGroupOp = useCallback((data: any, blockNum: number, txId: string) => {
    logger.info('[BLOCK STREAM HOOK] New operation detected:', data.type, 'block:', blockNum);
    
    if (data.type === 'transfer') {
      queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
      queryClient.invalidateQueries({ queryKey: ['group-messages'] });
      
      if (onNewMessage) {
        onNewMessage({ ...data, blockNum, txId });
      }
    } else if (data.type === 'custom_json') {
      queryClient.invalidateQueries({ queryKey: ['group-discovery'] });
      queryClient.invalidateQueries({ queryKey: ['join-requests'] });
      queryClient.invalidateQueries({ queryKey: ['pending-requests'] });
      
      if (onGroupOperation) {
        onGroupOperation({ ...data, blockNum, txId });
      }
    }

    setState(blockStreamManager.getState());
  }, [queryClient, onNewMessage, onGroupOperation]);

  useEffect(() => {
    if (!enabled || !user?.username) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        setState(prev => ({ ...prev, isStreaming: false }));
      }
      return;
    }

    logger.info('[BLOCK STREAM HOOK] Subscribing for user:', user.username);
    unsubscribeRef.current = subscribeToGroupOperations(user.username, handleGroupOp);
    setState(prev => ({ ...prev, isStreaming: true }));

    return () => {
      if (unsubscribeRef.current) {
        logger.info('[BLOCK STREAM HOOK] Unsubscribing');
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [enabled, user?.username, handleGroupOp]);

  useEffect(() => {
    if (!state.isStreaming) return;

    const interval = setInterval(() => {
      setState(blockStreamManager.getState());
    }, 5000);

    return () => clearInterval(interval);
  }, [state.isStreaming]);

  return {
    isStreaming: state.isStreaming,
    lastBlockNum: state.lastBlockNum,
    blocksProcessed: state.blocksProcessed,
    opsProcessed: state.opsProcessed,
    isActive: blockStreamManager.isActive(),
  };
}

export function useBlockStreamStatus() {
  const [state, setState] = useState<BlockStreamState>(blockStreamManager.getState());

  useEffect(() => {
    const interval = setInterval(() => {
      setState(blockStreamManager.getState());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return state;
}
