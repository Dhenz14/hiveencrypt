import { useState, useEffect } from 'react';
import { Users, Loader2, DollarSign } from 'lucide-react';
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
import type { PaymentSettings, MemberPayment } from '@shared/schema';
import { GROUP_CUSTOM_JSON_ID } from '@/lib/groupBlockchain';
import { logger } from '@/lib/logger';

interface JoinGroupButtonProps {
  groupId: string;
  groupName: string;
  creatorUsername: string;
  paymentSettings?: PaymentSettings;
  onJoinSuccess?: () => void;
  variant?: ButtonProps['variant'];
  className?: string;
}

export function JoinGroupButton({
  groupId,
  groupName,
  creatorUsername,
  paymentSettings,
  onJoinSuccess,
  variant = 'default',
  className,
}: JoinGroupButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  // Check localStorage for pending requests
  useEffect(() => {
    if (!user?.username) return;
    const pendingKey = `pending_join_${groupId}_${user.username}`;
    const pending = localStorage.getItem(pendingKey);
    if (pending) {
      setPendingRequestId(pending);
    }
  }, [groupId, user?.username]);

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

  // Mutation for broadcasting join_request (both pending and approved status)
  const joinRequestMutation = useMutation({
    mutationFn: async (payload: { 
      status: 'pending' | 'approved'; 
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
              logger.info('[JOIN GROUP] Join request broadcasted:', txId, payload.memberPayment ? 'with payment proof' : 'free join');
              resolve({ txId, requestId }); // Return both txId and requestId for correlation
            } else {
              logger.error('[JOIN GROUP] Failed to broadcast join request:', response.error);
              reject(new Error(response.error || 'Failed to broadcast join request'));
            }
          }
        );
      });
    },
    onSuccess: (result, variables) => {
      if (!user?.username) return; // Safety check

      if (variables.status === 'pending') {
        // Store pending request in localStorage
        const pendingKey = `pending_join_${groupId}_${user.username}`;
        localStorage.setItem(pendingKey, result.requestId);
        setPendingRequestId(result.requestId);

        toast({
          title: 'Join Request Sent',
          description: 'Join request sent to group creator',
        });
      } else if (variables.memberPayment) {
        // Auto-approved PAID join - payment proof included
        // Now broadcast join_approve to complete the process
        logger.info('[JOIN GROUP] ✅ Join request with payment broadcasted, now broadcasting join_approve');
        joinApproveMutation.mutate({
          requestId: result.requestId, // CRITICAL: Use the same requestId for correlation
          memberPayment: variables.memberPayment,
          approverUsername: user.username, // In auto-approve, user approves themselves
        });
      } else {
        // Auto-approved FREE join - also broadcast join_approve for consistency
        logger.info('[JOIN GROUP] ✅ Free join request broadcasted, now broadcasting join_approve');
        joinApproveMutation.mutate({
          requestId: result.requestId, // CRITICAL: Use the same requestId for correlation
          approverUsername: user.username, // In auto-approve, user approves themselves
        });
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

  // Mutation for broadcasting join_approve (after payment or auto-approve)
  const joinApproveMutation = useMutation({
    mutationFn: async (params: {
      requestId: string;
      memberPayment?: MemberPayment;
      approverUsername: string;
    }) => {
      if (!user?.username) throw new Error('Not authenticated');

      const customJson = {
        action: 'join_approve',
        groupId, // CRITICAL: Include groupId for group identification
        requestId: params.requestId, // CRITICAL: Must match join_request requestId
        username: user.username, // User being approved to join
        approverUsername: params.approverUsername, // Who approved (creator/moderator or user in auto-approve)
        memberPayment: params.memberPayment, // Payment proof (if payment was made)
        timestamp: Date.now(), // Approval timestamp
      };

      return new Promise<string>((resolve, reject) => {
        if (!window.hive_keychain) {
          reject(new Error('Hive Keychain not installed'));
          return;
        }

        window.hive_keychain.requestCustomJson(
          user.username,
          GROUP_CUSTOM_JSON_ID,
          'Posting',
          JSON.stringify(customJson),
          'Approve Group Join',
          (response: any) => {
            if (response.success) {
              const txId = response.result.id;
              logger.info('[JOIN GROUP] Join approved:', txId, 'with approverUsername:', params.approverUsername);
              resolve(txId);
            } else {
              logger.error('[JOIN GROUP] Failed to approve join:', response.error);
              reject(new Error(response.error || 'Failed to approve join'));
            }
          }
        );
      });
    },
    onSuccess: () => {
      // CRITICAL: Invalidate all three caches to ensure UI updates everywhere
      queryClient.invalidateQueries({ queryKey: ['groupDiscovery'] });
      queryClient.invalidateQueries({ queryKey: ['groupMessages', groupId] });
      queryClient.invalidateQueries({ queryKey: ['joinRequests', groupId] }); // FIX: Added missing invalidation

      toast({
        title: 'Success',
        description: `Joined "${groupName}"!`,
      });

      onJoinSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to complete join',
        variant: 'destructive',
      });
    },
  });

  // Handle free auto-approve join
  const handleFreeJoin = () => {
    joinRequestMutation.mutate({ status: 'approved' });
  };

  // Handle paid auto-approve join
  const handlePaidJoin = () => {
    // SECURITY: Payment modal MUST open BEFORE any blockchain broadcasts
    setPaymentModalOpen(true);
  };

  // Handle payment verified - CRITICAL SECURITY FIX
  // Payment happens FIRST, then we broadcast join_request with payment proof
  const handlePaymentVerified = (txId: string, amount: string) => {
    if (!user?.username || !paymentSettings) return;

    logger.info('[JOIN GROUP] 💰 Payment verified, creating memberPayment record');

    // Create memberPayment record with all required fields
    const memberPayment: MemberPayment = {
      username: user.username,
      txId, // Blockchain transaction ID of the payment
      amount, // e.g., "5.000 HBD"
      paidAt: new Date().toISOString(),
      status: 'active',
      nextDueDate: calculateNextDueDate(paymentSettings), // Only set for recurring payments
    };

    logger.info('[JOIN GROUP] 📝 Broadcasting join_request with payment proof:', {
      txId,
      amount,
      nextDueDate: memberPayment.nextDueDate,
    });

    // SECURITY FIX: Broadcast join_request with status='approved' AND memberPayment
    // This ensures payment proof is recorded on the blockchain BEFORE user is added to group
    joinRequestMutation.mutate({
      status: 'approved',
      memberPayment, // CRITICAL: Include payment proof
      paymentTxId: txId, // Use payment txId as requestId
    });

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
    if (pendingRequestId) {
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
    if (pendingRequestId) return; // Disabled

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

  const isLoading = joinRequestMutation.isPending || joinApproveMutation.isPending;

  return (
    <>
      <Button
        variant={variant}
        className={className}
        onClick={handleClick}
        disabled={isLoading || !!pendingRequestId}
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
    </>
  );
}
