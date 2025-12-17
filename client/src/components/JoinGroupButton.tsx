import { useState } from 'react';
import { Users, Loader2, DollarSign, CheckCircle } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PaymentGatewayModal } from '@/components/PaymentGatewayModal';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaymentSettings, MemberPayment, GroupConversationCache } from '@shared/schema';
import { GROUP_CUSTOM_JSON_ID } from '@/lib/groupBlockchain';
import { cacheGroupConversation, getGroupConversation, removePendingGroup } from '@/lib/messageCache';
import { logger } from '@/lib/logger';
import { useUserPendingRequests } from '@/hooks/useJoinRequests';

interface JoinGroupButtonProps {
  groupId: string;
  groupName: string;
  creatorUsername: string;
  paymentSettings?: PaymentSettings;
  onJoinSuccess?: () => void;
  variant?: ButtonProps['variant'];
  className?: string;
  isMember?: boolean; // If true, show "Joined" instead of join button
}

export function JoinGroupButton({
  groupId,
  groupName,
  creatorUsername,
  paymentSettings,
  onJoinSuccess,
  variant = 'default',
  className,
  isMember = false,
}: JoinGroupButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [successDetails, setSuccessDetails] = useState<{ isPaid: boolean; amount?: string } | null>(null);

  // Check blockchain for pending requests (replaces localStorage)
  const { data: pendingRequests = [], isLoading: isLoadingPendingRequests } = useUserPendingRequests(
    groupId,
    !!user?.username
  );

  // Determine if user has a pending request
  const hasPendingRequest = pendingRequests.length > 0;
  const pendingRequestId = pendingRequests[0]?.requestId || null;

  // Determine if this is auto-approve or manual approval
  const isAutoApprove = paymentSettings?.autoApprove !== false; // Default to true if undefined
  const requiresPayment = paymentSettings?.enabled && parseFloat(paymentSettings.amount) > 0;

  // Helper function to calculate next due date for recurring payments
  const calculateNextDueDate = (settings: PaymentSettings): string | undefined => {
    if (settings.type === 'recurring' && settings.recurringInterval) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + settings.recurringInterval);
      return nextDate.toISOString();
    }
    return undefined;
  };

  // SECURITY FIX: Requesters can ONLY broadcast join_request, NEVER join_approve
  // The creator will approve via background auto-approval or manual approval
  const joinRequestMutation = useMutation({
    mutationFn: async (payload: { 
      status: 'pending' | 'pending_payment_verification' | 'approved_free'; 
      message?: string;
      memberPayment?: MemberPayment;
      paymentTxId?: string;
    }) => {
      if (!user?.username) throw new Error('Not authenticated');

      // Use payment txId as requestId if available, otherwise generate UUID
      const requestId = payload.paymentTxId || crypto.randomUUID();
      const customJson = {
        action: 'join_request',
        groupId,
        username: user.username,
        requestId,
        status: payload.status,
        message: payload.message,
        memberPayment: payload.memberPayment, // CRITICAL: Include payment proof for paid joins
        timestamp: Date.now(),
      };

      return new Promise<{ txId: string; requestId: string }>((resolve, reject) => {
        if (!window.hive_keychain) {
          reject(new Error('Hive Keychain not installed'));
          return;
        }

        window.hive_keychain.requestCustomJson(
          user.username,
          GROUP_CUSTOM_JSON_ID,
          'Posting',
          JSON.stringify(customJson),
          payload.status === 'pending' ? 'Request to Join Group' : 'Join Group',
          (response: any) => {
            if (response.success) {
              const txId = response.result.id;
              logger.info('[JOIN GROUP] Join request broadcasted:', txId, 'status:', payload.status);
              resolve({ txId, requestId });
            } else {
              logger.error('[JOIN GROUP] Failed to broadcast join request:', response.error);
              reject(new Error(response.error || 'Failed to broadcast join request'));
            }
          }
        );
      });
    },
    onSuccess: (result, variables) => {
      if (!user?.username) return;

      // Invalidate pending requests query to trigger blockchain re-scan
      queryClient.invalidateQueries({ queryKey: ['userPendingRequests', groupId, user.username] });

      // Show appropriate success based on status
      if (variables.status === 'pending') {
        toast({
          title: 'Join Request Sent',
          description: 'Your request has been sent to the group creator for approval.',
        });
      } else if (variables.status === 'pending_payment_verification') {
        // Show success dialog for paid joins
        setSuccessDetails({ 
          isPaid: true, 
          amount: variables.memberPayment?.amount 
        });
        setSuccessDialogOpen(true);
      } else if (variables.status === 'approved_free') {
        // Show success dialog for free auto-approve joins
        setSuccessDetails({ isPaid: false });
        setSuccessDialogOpen(true);
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to process join request',
        variant: 'destructive',
      });
    },
  });

  // Handle free auto-approve join - broadcasts join_request with 'approved_free' status
  // Creator's background process will detect this and broadcast join_approve
  const handleFreeJoin = () => {
    joinRequestMutation.mutate({ status: 'approved_free' });
  };

  // Handle paid auto-approve join
  const handlePaidJoin = () => {
    // SECURITY: Payment modal MUST open BEFORE any blockchain broadcasts
    setPaymentModalOpen(true);
  };

  // Handle payment verified - TRUSTLESS SELF-SERVICE INSTANT JOIN
  // Payment = instant membership, no second Keychain popup required!
  // The payment txId is immutable on-chain proof of membership
  const handlePaymentVerified = async (txId: string, amount: string) => {
    if (!user?.username || !paymentSettings) return;

    logger.info('[JOIN GROUP] 💰 Payment verified - INSTANT membership granted (no second popup needed)');

    // Create memberPayment record with all required fields
    const memberPayment: MemberPayment = {
      username: user.username,
      txId, // Blockchain transaction ID of the payment
      amount, // e.g., "5.000 HBD"
      paidAt: new Date().toISOString(),
      status: 'active',
      nextDueDate: calculateNextDueDate(paymentSettings), // Only set for recurring payments
    };

    // STEP 1: Immediately cache the group locally - user gets instant access
    // This is the key optimization: payment = membership, no waiting
    try {
      // Check if group already exists in cache (from discovery) and merge data
      const existingCache = await getGroupConversation(groupId, user.username);
      
      // Deduplicate member payments by txId to avoid duplicates when creator auto-approves later
      const existingPayments = existingCache?.memberPayments || [];
      const hasDuplicatePayment = existingPayments.some(p => p.txId === memberPayment.txId);
      const mergedPayments = hasDuplicatePayment 
        ? existingPayments 
        : [...existingPayments, memberPayment];
      
      const groupCache: GroupConversationCache = existingCache 
        ? {
            ...existingCache,
            // Add user to members if not already present
            members: existingCache.members?.includes(user.username) 
              ? existingCache.members 
              : [...(existingCache.members || []), user.username],
            // Merge payment records (deduplicated by txId)
            memberPayments: mergedPayments,
          }
        : {
            // New cache entry if group wasn't cached
            groupId,
            name: groupName,
            members: [creatorUsername, user.username],
            creator: creatorUsername,
            version: 1,
            lastMessage: '',
            lastSender: '',
            lastTimestamp: new Date().toISOString(),
            unreadCount: 0,
            paymentSettings,
            memberPayments: [memberPayment],
          };

      await cacheGroupConversation(groupCache, user.username);
      logger.info('[JOIN GROUP] ✅ Group cached locally - user has instant access');
      
      // Remove from pending groups (no more "pending" UI)
      removePendingGroup(groupId, user.username);
      logger.info('[JOIN GROUP] 🧹 Removed from pending groups');
    } catch (cacheError) {
      logger.warn('[JOIN GROUP] Cache failed, but continuing:', cacheError);
    }

    // STEP 2: Show success immediately - no waiting for blockchain
    setSuccessDetails({ 
      isPaid: true, 
      amount: memberPayment.amount 
    });
    setSuccessDialogOpen(true);

    // Invalidate queries to refresh group list
    queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
    queryClient.invalidateQueries({ queryKey: ['group-discovery'] });
    queryClient.invalidateQueries({ queryKey: ['discoverable-groups'] });

    // NOTE: No second Keychain popup needed!
    // The payment transaction IS the on-chain proof of membership.
    // Creator's auto-approve background process will detect the payment and
    // broadcast join_approve to add the user to the members list permanently.
    // Meanwhile, the user has immediate local access via the cached membership.

    // Close payment modal
    setPaymentModalOpen(false);
  };

  // Handle manual approval request
  const handleManualApprovalRequest = () => {
    setRequestDialogOpen(true);
  };

  // Submit manual approval request
  const submitManualRequest = () => {
    joinRequestMutation.mutate({
      status: 'pending',
      message: requestMessage.trim() || undefined,
    });
    setRequestDialogOpen(false);
    setRequestMessage('');
  };

  // Determine button text
  const getButtonText = () => {
    if (hasPendingRequest) {
      return 'Request Pending...';
    }

    if (isAutoApprove) {
      if (requiresPayment && paymentSettings) {
        return `Join Group (${paymentSettings.amount} HBD)`;
      }
      return 'Join Group (Free)';
    }

    return 'Request to Join';
  };

  // Determine button click handler
  const handleClick = () => {
    if (hasPendingRequest) return; // Disabled

    if (isAutoApprove) {
      if (requiresPayment) {
        handlePaidJoin();
      } else {
        handleFreeJoin();
      }
    } else {
      handleManualApprovalRequest();
    }
  };

  const isLoading = joinRequestMutation.isPending || isLoadingPendingRequests;

  // If already a member, show "Joined" status instead of join button
  if (isMember) {
    return (
      <Button
        variant="outline"
        className={className}
        disabled
        data-testid="button-already-joined"
      >
        <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
        Joined
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        className={className}
        onClick={handleClick}
        disabled={isLoading || hasPendingRequest}
        data-testid="button-join-group"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : requiresPayment && isAutoApprove ? (
          <>
            <DollarSign className="w-4 h-4 mr-2" />
            {getButtonText()}
          </>
        ) : (
          <>
            <Users className="w-4 h-4 mr-2" />
            {getButtonText()}
          </>
        )}
      </Button>

      {/* Payment Gateway Modal */}
      {requiresPayment && paymentSettings && user && (
        <PaymentGatewayModal
          open={paymentModalOpen}
          onOpenChange={setPaymentModalOpen}
          groupId={groupId}
          groupName={groupName}
          creatorUsername={creatorUsername}
          paymentSettings={paymentSettings}
          currentUsername={user.username}
          onPaymentVerified={handlePaymentVerified}
        />
      )}

      {/* Manual Approval Request Dialog */}
      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-join-request">
          <DialogHeader>
            <DialogTitle>Request to Join "{groupName}"</DialogTitle>
            <DialogDescription>
              Send a join request to the group creator. You'll be notified when your request is reviewed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="message">Optional Message</Label>
              <Textarea
                id="message"
                placeholder="Why would you like to join this group?"
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                rows={4}
                data-testid="textarea-join-message"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRequestDialogOpen(false)}
              data-testid="button-cancel-request"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitManualRequest}
              disabled={joinRequestMutation.isPending}
              data-testid="button-send-request"
            >
              {joinRequestMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Request'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Confirmation Dialog */}
      <Dialog 
        open={successDialogOpen} 
        onOpenChange={(open) => {
          if (!open) {
            setSuccessDialogOpen(false);
            setSuccessDetails(null);
            onJoinSuccess?.();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-join-success">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-6 h-6" />
              Welcome to {groupName}!
            </DialogTitle>
            <DialogDescription>
              {successDetails?.isPaid ? (
                <>
                  Your payment of {successDetails.amount} has been verified. 
                  You're now a member of this group!
                </>
              ) : (
                <>
                  Your join request has been processed. 
                  You're now a member of this group!
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-center text-muted-foreground">
              Click below to open the group chat and start messaging!
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setSuccessDialogOpen(false);
                setSuccessDetails(null);
                onJoinSuccess?.();
              }}
              className="w-full"
              data-testid="button-open-group"
            >
              <Users className="w-4 h-4 mr-2" />
              Open Group Chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
