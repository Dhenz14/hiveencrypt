import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { scanAutoApprovalRequests } from '@/lib/joinRequestDiscovery';
import { broadcastJoinApprove } from '@/lib/groupBlockchain';
import { verifyPayment } from '@/lib/paymentVerification';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import type { JoinRequest } from '@shared/schema';

/**
 * SECURITY FIX: Background hook for group creators to auto-approve join requests
 * This hook runs ONLY for group creators and automatically approves requests with:
 * - status='approved_free' (free auto-approve groups)
 * - status='pending_payment_verification' (paid auto-approve groups, after payment verification)
 * 
 * This ensures requesters can NEVER approve themselves - only creators can approve.
 * 
 * @param groupId - Group identifier
 * @param creatorUsername - Username of the group creator
 * @param isCreator - Whether current user is the creator (hook only runs if true)
 * @param enabled - Whether to enable auto-approval (default: true)
 */
export function useAutoApproveJoinRequests(
  groupId: string,
  creatorUsername: string,
  isCreator: boolean,
  enabled: boolean = true
) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const processedRequestIds = useRef(new Set<string>());
  const isProcessing = useRef(false);

  // Mutation for auto-approving join requests
  const autoApproveMutation = useMutation({
    mutationFn: async (request: JoinRequest) => {
      if (!user?.username || !isCreator) {
        throw new Error('Only group creator can approve join requests');
      }

      logger.info('[AUTO APPROVE] Processing request:', request.requestId, 'status:', request.status);

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

      return { txId, request };
    },
    onSuccess: ({ request }) => {
      // Mark request as processed to avoid duplicate approvals
      processedRequestIds.current.add(request.requestId);

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['groupDiscovery'] });
      queryClient.invalidateQueries({ queryKey: ['groupMessages', groupId] });
      queryClient.invalidateQueries({ queryKey: ['joinRequests', groupId] });

      logger.info('[AUTO APPROVE] ✅ Auto-approved join request:', request.requestId);

      // Show success toast
      toast({
        title: 'Join Request Auto-Approved',
        description: `@${request.username} has been added to the group${request.memberPayment ? ' (payment verified)' : ''}`,
      });
    },
    onError: (error: Error, request) => {
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

  // Background polling effect - runs every 30 seconds
  useEffect(() => {
    if (!enabled || !isCreator || !user?.username || !groupId) {
      return;
    }

    const pollAutoApprovalRequests = async () => {
      // Prevent concurrent processing
      if (isProcessing.current) {
        return;
      }

      isProcessing.current = true;

      try {
        // Scan for requests needing auto-approval
        const requests = await scanAutoApprovalRequests(groupId, creatorUsername);

        // Filter out already processed requests
        const unprocessedRequests = requests.filter(
          req => !processedRequestIds.current.has(req.requestId)
        );

        if (unprocessedRequests.length > 0) {
          logger.info('[AUTO APPROVE] Found', unprocessedRequests.length, 'unprocessed auto-approval requests');

          // Process requests one at a time (FIFO order, already sorted)
          for (const request of unprocessedRequests) {
            // Only auto-approve if not already processing this request
            if (!autoApproveMutation.isPending) {
              autoApproveMutation.mutate(request);
              // Wait a bit between approvals to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 1000));
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
  }, [enabled, isCreator, user?.username, groupId, creatorUsername]);

  return {
    isProcessing: autoApproveMutation.isPending,
  };
}
