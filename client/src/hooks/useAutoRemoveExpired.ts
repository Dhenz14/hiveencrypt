import { useState, useEffect, useRef, useCallback } from 'react';
import { updateExpiredPayments } from '@/lib/paymentVerification';
import { addNotification } from '@/components/NotificationCenter';
import { logger } from '@/lib/logger';
import type { GroupConversationCache, MemberPayment } from '@shared/schema';

interface ExpiredMember {
  groupId: string;
  username: string;
  expiredAt: string;
}

interface UseAutoRemoveExpiredOptions {
  groups: GroupConversationCache[];
  currentUsername?: string;
  onRemoveMember: (groupId: string, username: string) => Promise<void>;
  enabled: boolean;
}

interface UseAutoRemoveExpiredReturn {
  expiredMembers: ExpiredMember[];
  isProcessing: boolean;
  lastCheck: string | null;
  removeExpired: (groupId: string) => Promise<void>;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY_PREFIX = 'hive-messenger-expiry-notifications-';

function getNotifiedStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

function getNotifiedMembers(username: string): Set<string> {
  try {
    const stored = localStorage.getItem(getNotifiedStorageKey(username));
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function addNotifiedMember(username: string, memberKey: string): void {
  const notified = getNotifiedMembers(username);
  notified.add(memberKey);
  localStorage.setItem(
    getNotifiedStorageKey(username),
    JSON.stringify(Array.from(notified))
  );
}

function createMemberKey(groupId: string, memberUsername: string): string {
  return `${groupId}:${memberUsername}`;
}

export function useAutoRemoveExpired(
  options: UseAutoRemoveExpiredOptions
): UseAutoRemoveExpiredReturn {
  const { groups, currentUsername, onRemoveMember, enabled } = options;
  
  const [expiredMembers, setExpiredMembers] = useState<ExpiredMember[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  
  const processingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkForExpiredMembers = useCallback(() => {
    if (!currentUsername || !enabled) {
      setExpiredMembers([]);
      return;
    }

    const creatorGroups = groups.filter(g => g.creator === currentUsername);
    if (creatorGroups.length === 0) {
      setExpiredMembers([]);
      setLastCheck(new Date().toISOString());
      return;
    }

    const allExpired: ExpiredMember[] = [];
    const notifiedMembers = getNotifiedMembers(currentUsername);

    for (const group of creatorGroups) {
      if (!group.paymentSettings?.enabled || !group.memberPayments) {
        continue;
      }

      const updatedPayments = updateExpiredPayments(group.memberPayments);
      
      for (const payment of updatedPayments) {
        if (payment.status === 'expired') {
          const memberKey = createMemberKey(group.groupId, payment.username);
          
          allExpired.push({
            groupId: group.groupId,
            username: payment.username,
            expiredAt: payment.nextDueDate || new Date().toISOString(),
          });

          if (!notifiedMembers.has(memberKey)) {
            addNotification(currentUsername, {
              type: 'expiry',
              groupId: group.groupId,
              groupName: group.name,
              username: payment.username,
            });
            
            addNotifiedMember(currentUsername, memberKey);
            
            logger.info('[AUTO REMOVE EXPIRED] Sent expiry notification:', {
              groupId: group.groupId,
              username: payment.username,
            });
          }
        }
      }
    }

    setExpiredMembers(allExpired);
    setLastCheck(new Date().toISOString());

    logger.info('[AUTO REMOVE EXPIRED] Check complete:', {
      groupsChecked: creatorGroups.length,
      expiredFound: allExpired.length,
    });
  }, [groups, currentUsername, enabled]);

  const removeExpired = useCallback(async (groupId: string) => {
    if (processingRef.current || !currentUsername) {
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const groupExpired = expiredMembers.filter(m => m.groupId === groupId);
      
      logger.info('[AUTO REMOVE EXPIRED] Removing expired members:', {
        groupId,
        count: groupExpired.length,
      });

      for (const member of groupExpired) {
        try {
          await onRemoveMember(groupId, member.username);
          
          addNotification(currentUsername, {
            type: 'member_left',
            groupId,
            groupName: groups.find(g => g.groupId === groupId)?.name || 'Unknown Group',
            username: member.username,
          });
          
          logger.info('[AUTO REMOVE EXPIRED] Removed expired member:', {
            groupId,
            username: member.username,
          });
        } catch (error) {
          logger.error('[AUTO REMOVE EXPIRED] Failed to remove member:', {
            groupId,
            username: member.username,
            error,
          });
        }
      }

      setExpiredMembers(prev => prev.filter(m => m.groupId !== groupId));
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [expiredMembers, currentUsername, onRemoveMember, groups]);

  useEffect(() => {
    if (!enabled || !currentUsername) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    checkForExpiredMembers();

    intervalRef.current = setInterval(checkForExpiredMembers, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, currentUsername, checkForExpiredMembers]);

  useEffect(() => {
    if (enabled && currentUsername && groups.length > 0) {
      checkForExpiredMembers();
    }
  }, [groups, enabled, currentUsername, checkForExpiredMembers]);

  return {
    expiredMembers,
    isProcessing,
    lastCheck,
    removeExpired,
  };
}
