import { useState, useEffect } from 'react';
import { Users, Plus, X, AlertCircle, Crown, Loader2, DollarSign, Check, XCircle, ExternalLink, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { getHiveMemoKey } from '@/lib/hive';
import { canInviteToGroup } from '@/lib/accountMetadata';
import { useToast } from '@/hooks/use-toast';
import { PaymentStatusBadge, PaymentRequiredIndicator } from './PaymentStatusBadge';
import { PaymentGatewayModal } from './PaymentGatewayModal';
import type { PaymentSettings, MemberPayment, JoinRequest } from '@shared/schema';
import { getPaymentStats } from '@/lib/paymentVerification';
import { useJoinRequests } from '@/hooks/useJoinRequests';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { broadcastJoinApprove, broadcastJoinReject } from '@/lib/groupBlockchain';
import { formatDistanceToNow } from 'date-fns';

interface ManageMembersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  currentMembers: string[];
  creator: string;
  currentUsername?: string;
  paymentSettings?: PaymentSettings;
  memberPayments?: MemberPayment[];
  onUpdateMembers: (newMembers: string[]) => Promise<void>;
}

export function ManageMembersModal({ 
  open, 
  onOpenChange, 
  groupId,
  groupName,
  currentMembers,
  creator,
  currentUsername,
  paymentSettings,
  memberPayments,
  onUpdateMembers
}: ManageMembersModalProps) {
  const { toast } = useToast();
  const [newMemberInput, setNewMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>(currentMembers);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<JoinRequest | null>(null);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  
  // Manual verification state for legacy requests
  const [manuallyVerifiedRequests, setManuallyVerifiedRequests] = useState<Set<string>>(new Set());
  
  // Calculate payment stats if payments are enabled
  const paymentStats = getPaymentStats(memberPayments, paymentSettings);
  
  // Check if current user is the group creator
  const isCreator = currentUsername === creator;
  
  // Fetch pending join requests (only if user is creator)
  const { data: pendingRequests = [], isLoading: isLoadingRequests } = useJoinRequests(
    groupId,
    creator,
    isCreator && open // Only enable if user is creator and modal is open
  );
  
  // Approve join request mutation
  const approveRequestMutation = useMutation({
    mutationFn: async (request: JoinRequest) => {
      if (!currentUsername) {
        throw new Error('User not authenticated');
      }
      
      const requiresPayment = paymentSettings?.enabled;
      const hasPaymentProof = !!request.memberPayment;
      const isManuallyVerified = manuallyVerifiedRequests.has(request.requestId);
      
      // AUTO-APPROVE PAID: Payment proof already exists
      if (requiresPayment && hasPaymentProof) {
        // Payment already verified - approve immediately with existing payment proof
        const txId = await broadcastJoinApprove(
          currentUsername,
          groupId,
          request.requestId,
          request.username,
          request.memberPayment
        );
        
        return { txId, request, memberPayment: request.memberPayment };
      }
      
      // LEGACY REQUEST: Manually verified by creator
      if (requiresPayment && !hasPaymentProof && isManuallyVerified) {
        // Creator verified payment manually off-chain - approve without payment proof
        const txId = await broadcastJoinApprove(
          currentUsername,
          groupId,
          request.requestId,
          request.username
          // No memberPayment - creator verified manually
        );
        
        return { txId, request, memberPayment: undefined };
      }
      
      // MANUAL APPROVAL PAID: Need to collect payment
      if (requiresPayment && !hasPaymentProof && !isManuallyVerified) {
        // Open payment modal and wait for payment
        setPendingApprovalRequest(request);
        setPaymentCompleted(false);
        setPaymentModalOpen(true);
        return { request, memberPayment: undefined }; // handlePaymentVerified will complete approval
      }
      
      // FREE: Approve immediately without payment
      const txId = await broadcastJoinApprove(
        currentUsername,
        groupId,
        request.requestId,
        request.username
      );
      
      return { txId, request, memberPayment: undefined };
    },
    onSuccess: async ({ request, memberPayment }) => {
      const requiresPayment = paymentSettings?.enabled;
      const hasPaymentProof = !!memberPayment || !!request.memberPayment;
      const isManuallyVerified = manuallyVerifiedRequests.has(request.requestId);
      
      // Only skip UI updates if we're waiting for payment modal
      // Do NOT skip for manual verification approvals!
      if (requiresPayment && !hasPaymentProof && !isManuallyVerified) {
        // Waiting for payment modal - don't update UI yet
        return;
      }
      
      // Update UI for:
      // 1. Auto-approve paid (has payment proof)
      // 2. Manual verification (creator confirmed)
      // 3. Free requests (no payment required)
      // 4. Manual approval after payment modal completes
      
      // Update group members array locally
      if (!members.includes(request.username)) {
        setMembers([...members, request.username]);
      }
      
      // Clear manual verification flag for this request
      if (isManuallyVerified) {
        setManuallyVerifiedRequests(prev => {
          const newSet = new Set(prev);
          newSet.delete(request.requestId);
          return newSet;
        });
      }
      
      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ['groupDiscovery'] });
      await queryClient.invalidateQueries({ queryKey: ['joinRequests', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['userPendingRequests', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['groupMessages', groupId] });
      
      toast({
        title: 'Join Request Approved',
        description: `Approved @${request.username}${memberPayment || request.memberPayment ? ' (payment verified)' : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Approval Failed',
        description: error.message || 'Failed to approve join request',
        variant: 'destructive',
      });
    },
  });
  
  // Reject join request mutation
  const rejectRequestMutation = useMutation({
    mutationFn: async ({ request, reason }: { request: JoinRequest; reason?: string }) => {
      if (!currentUsername) {
        throw new Error('User not authenticated');
      }
      
      // Broadcast join_reject custom_json
      const txId = await broadcastJoinReject(
        currentUsername,
        groupId,
        request.requestId,
        request.username,
        reason
      );
      
      return { txId, request };
    },
    onSuccess: async ({ request }) => {
      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ['joinRequests', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['userPendingRequests', groupId] });
      
      toast({
        title: 'Join Request Rejected',
        description: `Rejected @${request.username}'s request`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Rejection Failed',
        description: error.message || 'Failed to reject join request',
        variant: 'destructive',
      });
    },
  });
  
  // Handle payment verification callback
  const handlePaymentVerified = async (txId: string, amount: string) => {
    if (!pendingApprovalRequest) return;
    
    try {
      // Mark payment as completed FIRST
      setPaymentCompleted(true);
      
      // Create member payment record with payment proof
      const memberPayment: MemberPayment = {
        username: pendingApprovalRequest.username,
        txId,
        amount,
        paidAt: new Date().toISOString(),
        status: 'active',
        // Calculate next due date for recurring payments
        nextDueDate: paymentSettings?.type === 'recurring' && paymentSettings.recurringInterval
          ? new Date(Date.now() + paymentSettings.recurringInterval * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      };
      
      // Attach payment to request and re-approve with payment proof
      const requestWithPayment: JoinRequest = {
        ...pendingApprovalRequest,
        memberPayment,
      };
      
      // Broadcast join_approve with payment record - use mutateAsync to handle errors
      await approveRequestMutation.mutateAsync(requestWithPayment);
      
      // Success - close payment modal and reset state
      setPaymentModalOpen(false);
      setPendingApprovalRequest(null);
      setPaymentCompleted(false);
    } catch (error: any) {
      // Error occurred during approval - show error toast
      toast({
        title: 'Failed to approve request',
        description: error.message || 'An error occurred while approving the join request',
        variant: 'destructive',
      });
      
      // Reset payment state but keep modal open so user can see the error
      setPaymentCompleted(false);
    }
  };
  
  // Handle payment modal close - detects cancellation without payment
  const handlePaymentModalClose = (open: boolean) => {
    if (!open) {
      // Modal is closing - check if payment was completed
      if (!paymentCompleted && pendingApprovalRequest) {
        // Payment was NOT completed - user cancelled or closed modal
        toast({
          title: 'Payment Required',
          description: 'Payment must be completed to approve this request',
          variant: 'destructive',
        });
      }
      
      // Reset payment modal state
      setPaymentModalOpen(false);
      setPendingApprovalRequest(null);
      setPaymentCompleted(false);
    } else {
      // Opening modal
      setPaymentModalOpen(true);
    }
  };
  
  // Handle reject button click
  const handleReject = (request: JoinRequest) => {
    rejectRequestMutation.mutate({ request });
  };

  // Reset members when modal opens with fresh data
  useEffect(() => {
    if (open) {
      setMembers(currentMembers);
      setNewMemberInput('');
      setError(null);
    }
  }, [open, currentMembers]);

  const validateUsername = (username: string): string | null => {
    const clean = username.toLowerCase().trim().replace('@', '');
    
    if (!clean) {
      return 'Username cannot be empty';
    }

    if (clean.length < 3 || clean.length > 16) {
      return 'Username must be between 3 and 16 characters';
    }

    if (!/^[a-z0-9.-]+$/.test(clean)) {
      return 'Invalid username format. Use only lowercase letters, numbers, dots, and hyphens.';
    }

    if (clean === currentUsername) {
      return 'You are already in this group';
    }

    if (members.includes(clean)) {
      return 'Member already in group';
    }

    return null;
  };

  const handleAddMember = async () => {
    const validationError = validateUsername(newMemberInput);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const cleanUsername = newMemberInput.toLowerCase().trim().replace('@', '');
    
    // Validate username exists on Hive blockchain
    setIsValidating(true);
    setError(null);
    
    try {
      const memoKey = await getHiveMemoKey(cleanUsername);
      
      if (!memoKey) {
        setError(`User @${cleanUsername} not found on Hive blockchain`);
        setIsValidating(false);
        return;
      }
      
      // Check if current user can invite this member based on privacy settings
      if (currentUsername) {
        const inviteCheck = await canInviteToGroup(currentUsername, cleanUsername);
        
        if (!inviteCheck.allowed) {
          // Show error toast with the privacy reason
          toast({
            title: 'Cannot Add Member',
            description: inviteCheck.reason || `Unable to add @${cleanUsername} to this group`,
            variant: 'destructive',
          });
          setError(inviteCheck.reason || 'Privacy settings prevent adding this member');
          setIsValidating(false);
          return;
        }
      }
      
      // Username exists and privacy check passed, add to members
      setMembers([...members, cleanUsername]);
      setNewMemberInput('');
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to verify username';
      setError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveMember = (username: string) => {
    // Prevent removing creator or current user
    if (username === creator) {
      setError('Cannot remove the group creator');
      return;
    }
    
    if (username === currentUsername) {
      setError('Cannot remove yourself from the group');
      return;
    }

    setMembers(members.filter(m => m !== username));
    setError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (members.length < 2) {
      setError('Groups must have at least 2 members');
      return;
    }

    // Check if anything changed
    const added = members.filter(m => !currentMembers.includes(m));
    const removed = currentMembers.filter(m => !members.includes(m));
    
    if (added.length === 0 && removed.length === 0) {
      setError('No changes made to group membership');
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      await onUpdateMembers(members);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update group members');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isUpdating) {
      setNewMemberInput('');
      setError(null);
    }
    onOpenChange(newOpen);
  };

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  // Calculate changes for preview
  const added = members.filter(m => !currentMembers.includes(m));
  const removed = currentMembers.filter(m => !members.includes(m));
  const hasChanges = added.length > 0 || removed.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-manage-members">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Manage Members
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <div>Add or remove members from "{groupName}"</div>
            {paymentSettings?.enabled && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <PaymentRequiredIndicator paymentSettings={paymentSettings} />
                <span className="text-muted-foreground">•</span>
                <span className="text-caption">
                  {paymentStats.totalActive} paid · {paymentStats.totalExpired} expired
                </span>
                {paymentStats.upcomingRenewals > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-caption text-orange-600">
                      {paymentStats.upcomingRenewals} renewal{paymentStats.upcomingRenewals !== 1 ? 's' : ''} due
                    </span>
                  </>
                )}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive" data-testid="alert-manage-members-error">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Pending Join Requests Section - Only shown to group creator */}
          {isCreator && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-caption">Pending Join Requests</Label>
                {pendingRequests.length > 0 && (
                  <Badge variant="secondary" className="text-caption">
                    {pendingRequests.length}
                  </Badge>
                )}
              </div>
              
              {isLoadingRequests ? (
                <div className="space-y-3 p-3 border rounded-md">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-9 w-20" />
                      <Skeleton className="h-9 w-20" />
                    </div>
                  ))}
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="p-4 border rounded-md text-center">
                  <p className="text-caption text-muted-foreground">
                    No pending requests
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[200px] rounded-md border p-3">
                  <div className="space-y-3">
                    {pendingRequests.map((request) => (
                      <Card
                        key={request.requestId}
                        className="p-3"
                        data-testid={`card-join-request-${request.username}`}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                              {getInitials(request.username)}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={`https://peakd.com/@${request.username}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-body font-medium hover:underline flex items-center gap-1"
                                data-testid={`link-profile-${request.username}`}
                              >
                                @{request.username}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <span className="text-caption text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(request.requestedAt), { addSuffix: true })}
                              </span>
                            </div>
                            
                            {request.message && (
                              <p className="text-caption text-muted-foreground line-clamp-2">
                                {request.message}
                              </p>
                            )}
                            
                            {paymentSettings?.enabled && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-caption text-muted-foreground">
                                    Payment required: {paymentSettings.amount} HBD
                                  </span>
                                </div>
                                {request.memberPayment ? (
                                  <Badge variant="default" className="text-caption gap-1">
                                    <Check className="w-3 h-3" />
                                    Payment proof verified
                                  </Badge>
                                ) : (
                                  <div className="space-y-2">
                                    <Badge variant="outline" className="text-caption gap-1 border-orange-500 text-orange-600">
                                      <AlertCircle className="w-3 h-3" />
                                      Payment proof missing
                                    </Badge>
                                    <div className="flex items-start gap-2 p-2 bg-muted rounded-md">
                                      <Checkbox
                                        id={`verify-${request.requestId}`}
                                        checked={manuallyVerifiedRequests.has(request.requestId)}
                                        onCheckedChange={(checked) => {
                                          const newSet = new Set(manuallyVerifiedRequests);
                                          if (checked) {
                                            newSet.add(request.requestId);
                                          } else {
                                            newSet.delete(request.requestId);
                                          }
                                          setManuallyVerifiedRequests(newSet);
                                        }}
                                        data-testid={`checkbox-verify-${request.username}`}
                                        className="mt-0.5"
                                      />
                                      <label
                                        htmlFor={`verify-${request.requestId}`}
                                        className="text-caption cursor-pointer leading-tight"
                                      >
                                        I have manually verified payment was received off-chain
                                      </label>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex gap-2 flex-shrink-0">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={() => approveRequestMutation.mutate(request)}
                              disabled={
                                approveRequestMutation.isPending ||
                                rejectRequestMutation.isPending ||
                                (paymentSettings?.enabled && !request.memberPayment && !manuallyVerifiedRequests.has(request.requestId))
                              }
                              data-testid={`button-approve-${request.username}`}
                            >
                              {approveRequestMutation.isPending &&
                              approveRequestMutation.variables?.requestId === request.requestId ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                  Approving...
                                </>
                              ) : (
                                <>
                                  <Check className="w-3 h-3 mr-1" />
                                  Approve
                                </>
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => handleReject(request)}
                              disabled={
                                approveRequestMutation.isPending ||
                                rejectRequestMutation.isPending
                              }
                              data-testid={`button-reject-${request.username}`}
                            >
                              {rejectRequestMutation.isPending &&
                              rejectRequestMutation.variables?.request.requestId === request.requestId ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                  Rejecting...
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3 h-3 mr-1" />
                                  Reject
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Add New Member */}
          <div className="space-y-2">
            <Label htmlFor="add-member" className="text-caption">
              Add New Member
            </Label>
            <div className="flex gap-2">
              <Input
                id="add-member"
                type="text"
                placeholder="username"
                value={newMemberInput}
                onChange={(e) => {
                  setNewMemberInput(e.target.value);
                  setError(null);
                }}
                onKeyPress={handleKeyPress}
                disabled={isUpdating || isValidating}
                className="h-11 flex-1"
                autoComplete="off"
                data-testid="input-add-member"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddMember}
                disabled={!newMemberInput.trim() || isUpdating || isValidating}
                className="h-11 w-11"
                data-testid="button-add-member"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {isValidating ? 'Verifying username on Hive blockchain...' : 'Press Enter or click + to add a member'}
            </p>
          </div>

          {/* Current Members List */}
          <div className="space-y-2">
            <Label className="text-caption">
              Current Members ({members.length})
            </Label>
            <ScrollArea className="h-[280px] rounded-md border p-3">
              <div className="space-y-2">
                {members.map((member) => {
                  const isCreator = member === creator;
                  const isCurrentUser = member === currentUsername;
                  const canRemove = !isCreator && !isCurrentUser;
                  
                  return (
                    <div
                      key={member}
                      className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                      data-testid={`member-item-${member}`}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                          {getInitials(member)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-body font-medium truncate">
                            @{member}
                          </span>
                          {isCreator && (
                            <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-caption">
                              <Crown className="w-3 h-3" />
                              Creator
                            </Badge>
                          )}
                          {isCurrentUser && (
                            <Badge variant="outline" className="px-2 py-0.5 text-caption">
                              You
                            </Badge>
                          )}
                          {added.includes(member) && (
                            <Badge variant="default" className="bg-green-500 px-2 py-0.5 text-caption">
                              New
                            </Badge>
                          )}
                          {paymentSettings?.enabled && !added.includes(member) && (
                            <PaymentStatusBadge
                              paymentSettings={paymentSettings}
                              memberPayments={memberPayments}
                              username={member}
                              showLabel={false}
                              className="text-xs"
                            />
                          )}
                        </div>
                      </div>

                      {canRemove && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMember(member)}
                          disabled={isUpdating}
                          className="h-8 w-8 flex-shrink-0"
                          data-testid={`button-remove-member-${member}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Changes Preview */}
          {hasChanges && (
            <Alert data-testid="alert-changes-preview">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                {added.length > 0 && (
                  <div className="mb-1">
                    <strong>Adding:</strong> {added.map(m => `@${m}`).join(', ')}
                  </div>
                )}
                {removed.length > 0 && (
                  <div>
                    <strong>Removing:</strong> {removed.map(m => `@${m}`).join(', ')}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isUpdating}
              data-testid="button-cancel-manage"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isUpdating || !hasChanges}
              data-testid="button-save-members"
            >
              {isUpdating ? 'Updating...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      
      {/* Payment Gateway Modal for Join Request Approval */}
      {paymentSettings && pendingApprovalRequest && currentUsername && (
        <PaymentGatewayModal
          open={paymentModalOpen}
          onOpenChange={handlePaymentModalClose}
          groupId={groupId}
          groupName={groupName}
          creatorUsername={creator}
          paymentSettings={paymentSettings}
          currentUsername={pendingApprovalRequest.username}
          onPaymentVerified={handlePaymentVerified}
        />
      )}
    </Dialog>
  );
}
