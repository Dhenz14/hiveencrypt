import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { scanAutoApprovalRequests } from '@/lib/joinRequestDiscovery';
import { broadcastJoinApprove } from '@/lib/groupBlockchain';
import { cacheGroupConversation, getGroupConversations, type GroupConversationCache } from '@/lib/messageCache';
import { verifyPayment } from '@/lib/paymentVerification';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import type { JoinRequest, MemberPayment } from '@shared/schema';

interface GroupInfo {
  groupId: string;
  creator: string;
}

/**
 * SECURITY FIX: Background hook for group creators to auto-approve join requests
 * This hook runs ONLY for group creators and automatically approves requests with:
 * - status='approved_free' (free auto-approve groups)
 * - status='pending_payment_verification' (paid auto-approve groups, after payment verification)
 * 
 * OPTIMIZED: Now handles ALL creator-owned groups in a single hook instance
 * 
 * This ensures requesters can NEVER approve themselves - only creators can approve.
 * 
 * @param groups - Array of groups owned by the current user
 * @param enabled - Whether to enable auto-approval (default: true)
 */
export function useAutoApproveJoinRequests(
  groups: GroupInfo[],
  enabled: boolean = true
) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const processedRequestIds = useRef(new Set<string>());
  const isProcessing = useRef(false);

  // Add new member to local cache after successful approval
  const addMemberToCache = useCallback(async (
    groupId: string,
    newMemberUsername: string,
    memberPayment?: MemberPayment
  ) => {
    if (!user?.username) return;

    try {
      // Get current cached groups
      const cachedGroups = await getGroupConversations(user.username);
      const group = cachedGroups.find((g: GroupConversationCache) => g.groupId === groupId);
      
      if (group) {
        // Add new member to the members array if not already present
        const memberLower = newMemberUsername.toLowerCase();
        const alreadyMember = group.members.some((m: string) => m.toLowerCase() === memberLower);
        
        const updatedMembers = alreadyMember 
          ? group.members 
          : [...group.members, newMemberUsername];
        
        // Add payment to memberPayments if present (dedupe by txId to prevent duplicates)
        let updatedPayments = group.memberPayments || [];
        if (memberPayment && memberPayment.txId) {
          const alreadyHasPayment = updatedPayments.some(p => p.txId === memberPayment.txId);
          if (!alreadyHasPayment) {
            updatedPayments = [...updatedPayments, memberPayment];
          }
        }
        
        // Update cache with new member
        await cacheGroupConversation({
          ...group,
          members: updatedMembers,
          memberPayments: updatedPayments,
        }, user.username);
        
        if (!alreadyMember) {
          logger.info('[AUTO APPROVE] ✅ Added member to cache:', newMemberUsername);
        }
      }
    } catch (error) {
      logger.warn('[AUTO APPROVE] Failed to add member to cache:', error);
    }
  }, [user?.username]);

  // Mutation for auto-approving join requests
  const autoApproveMutation = useMutation({
    mutationFn: async ({ request, groupId, creatorUsername }: { 
      request: JoinRequest; 
      groupId: string; 
      creatorUsername: string;
    }) => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }

      logger.info('[AUTO APPROVE] Processing request:', request.requestId, 'status:', request.status, 'for group:', groupId);

      // For pending_payment_verification, verify payment on blockchain first
      if (request.status === 'pending_payment_verification' && request.memberPayment) {
        logger.info('[AUTO APPROVE] Verifying payment on blockchain:', request.memberPayment.txId);
        
        // Extract amount value from "5.000 HBD" format
        const amountValue = request.memberPayment.amount.split(' ')[0];
        
        // Verify payment using the blockchain verifier
        const paymentResult = await verifyPayment(
          request.username, // payer
          creatorUsername, // recipient (group creator)
          amountValue, // expected amount (e.g., "5.000")
          groupId, // memo should contain groupId
          24 // max age in hours
        );

        if (!paymentResult.verified) {
          throw new Error(`Payment verification failed: ${paymentResult.error || 'Unknown error'}`);
        }

        logger.info('[AUTO APPROVE] ✅ Payment verified successfully:', paymentResult.txId);
      }

      // Broadcast join_approve from creator's account
      const txId = await broadcastJoinApprove(
        user.username, // approverUsername (creator)
        groupId,
        request.requestId,
        request.username, // requestUsername (user being approved)
        request.memberPayment // Include payment proof if present
      );

      return { txId, request, groupId };
    },
    onSuccess: async ({ request, groupId }) => {
      // Mark request as processed to avoid duplicate approvals
      processedRequestIds.current.add(request.requestId);

      // Add member to local cache immediately after successful approval
      // This prevents the "new member message not visible" issue
      await addMemberToCache(groupId, request.username, request.memberPayment);

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['groupDiscovery'] });
      queryClient.invalidateQueries({ queryKey: ['groupMessages', groupId] });
      queryClient.invalidateQueries({ queryKey: ['joinRequests', groupId] });
      queryClient.invalidateQueries({ queryKey: ['userPendingRequests', groupId] });

      logger.info('[AUTO APPROVE] ✅ Auto-approved join request:', request.requestId, 'for group:', groupId);

      // Show success toast
      toast({
        title: 'Join Request Auto-Approved',
        description: `@${request.username} has been added to the group${request.memberPayment ? ' (payment verified)' : ''}`,
      });
    },
    onError: (error: Error, { request }) => {
      logger.error('[AUTO APPROVE] ❌ Failed to auto-approve request:', error);

      // Don't show toast for verification failures (silent fail to avoid spam)
      // Manual approval is still available in ManageMembersModal
      if (!error.message.includes('Payment verification failed')) {
        toast({
          title: 'Auto-Approval Failed',
          description: `Failed to auto-approve @${request.username}: ${error.message}`,
          variant: 'destructive',
        });
      }
    },
  });

  // Background polling effect - runs every 30 seconds for ALL creator groups
  useEffect(() => {
    if (!enabled || !user?.username || groups.length === 0) {
      return;
    }

    const pollAutoApprovalRequests = async () => {
      // Prevent concurrent processing
      if (isProcessing.current) {
        return;
      }

      isProcessing.current = true;

      try {
        // Collect all requests from all groups first
        const allPendingRequests: Array<{ request: JoinRequest; groupId: string; creatorUsername: string }> = [];
        
        // Scan ALL creator-owned groups for pending auto-approval requests
        for (const { groupId, creator } of groups) {
          // Verify current user is the creator (security check)
          if (creator !== user.username) {
            continue;
          }

          try {
            // Scan for requests needing auto-approval for this group
            const requests = await scanAutoApprovalRequests(groupId, creator);

            // Filter out already processed requests
            const unprocessedRequests = requests.filter(
              req => !processedRequestIds.current.has(req.requestId)
            );

            // Add to collection
            for (const request of unprocessedRequests) {
              allPendingRequests.push({ request, groupId, creatorUsername: creator });
            }
          } catch (groupError) {
            logger.error('[AUTO APPROVE] Error scanning group:', groupId, groupError);
          }
        }
        
        // Process all collected requests sequentially
        if (allPendingRequests.length > 0) {
          logger.info('[AUTO APPROVE] Processing', allPendingRequests.length, 'total requests across all groups');
          
          for (const { request, groupId, creatorUsername } of allPendingRequests) {
            // Skip if already processed (double-check)
            if (processedRequestIds.current.has(request.requestId)) {
              continue;
            }
            
            try {
              // Use mutateAsync to properly await each approval
              await autoApproveMutation.mutateAsync({ request, groupId, creatorUsername });
              // Wait between approvals to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (approvalError) {
              // Log error but continue processing other requests
              logger.error('[AUTO APPROVE] Error processing request:', request.requestId, approvalError);
            }
          }
        }
      } catch (error) {
        logger.error('[AUTO APPROVE] Error polling for auto-approval requests:', error);
      } finally {
        isProcessing.current = false;
      }
    };

    // Run immediately on mount
    pollAutoApprovalRequests();

    // Then poll every 30 seconds
    const intervalId = setInterval(pollAutoApprovalRequests, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, user?.username, groups, autoApproveMutation]);

  return {
    isProcessing: autoApproveMutation.isPending,
  };
}

// Legacy single-group version for backward compatibility (deprecated)
export function useAutoApproveJoinRequestsSingle(
  groupId: string,
  creatorUsername: string,
  isCreator: boolean,
  enabled: boolean = true
) {
  const groups = isCreator && groupId ? [{ groupId, creator: creatorUsername }] : [];
  return useAutoApproveJoinRequests(groups, enabled);
}
