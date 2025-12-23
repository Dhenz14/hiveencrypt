import { useState } from 'react';
import { Users, Plus, X, AlertCircle, DollarSign } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { PaymentSettings } from '@shared/schema';

interface GroupCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (groupName: string, members: string[], paymentSettings?: PaymentSettings) => Promise<void>;
  currentUsername?: string;
}

export function GroupCreationModal({ 
  open, 
  onOpenChange, 
  onCreateGroup,
  currentUsername 
}: GroupCreationModalProps) {
  const [groupName, setGroupName] = useState('');
  const [newMemberInput, setNewMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Payment settings state
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState<'one_time' | 'recurring'>('one_time');
  const [recurringInterval, setRecurringInterval] = useState('30');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [autoApprove, setAutoApprove] = useState(true);

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
      return 'Cannot add yourself to the group';
    }

    if (members.includes(clean)) {
      return 'Member already added';
    }

    return null;
  };

  const handleAddMember = () => {
    const validationError = validateUsername(newMemberInput);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const cleanUsername = newMemberInput.toLowerCase().trim().replace('@', '');
    setMembers([...members, cleanUsername]);
    setNewMemberInput('');
    setError(null);
  };

  const handleRemoveMember = (username: string) => {
    setMembers(members.filter(m => m !== username));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!groupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    if (groupName.trim().length > 50) {
      setError('Group name must be 50 characters or less');
      return;
    }

    if (members.length < 1) {
      setError('Please add at least 1 member to the group');
      return;
    }

    // Validate payment settings if enabled
    if (paymentEnabled) {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) {
        setError('Please enter a valid payment amount greater than 0');
        return;
      }
      if (amount < 0.001) {
        setError('Minimum payment amount is 0.001 HBD');
        return;
      }
      if (paymentType === 'recurring') {
        const interval = parseInt(recurringInterval);
        if (isNaN(interval) || interval < 1) {
          setError('Please enter a valid recurring interval (minimum 1 day)');
          return;
        }
      }
    }

    setIsCreating(true);
    setError(null);

    try {
      // Build payment settings object if enabled
      const paymentSettings: PaymentSettings | undefined = paymentEnabled ? {
        enabled: true,
        amount: parseFloat(paymentAmount).toFixed(3),
        type: paymentType,
        recurringInterval: paymentType === 'recurring' ? parseInt(recurringInterval) : undefined,
        description: paymentDescription.trim() || undefined,
        autoApprove: autoApprove,
      } : undefined;

      // CRITICAL: Include the creator in the members array so they can see their own group
      const allMembers = currentUsername 
        ? [currentUsername, ...members.filter(m => m !== currentUsername)] 
        : members;
      await onCreateGroup(groupName.trim(), allMembers, paymentSettings);
      
      // Reset form
      setGroupName('');
      setMembers([]);
      setNewMemberInput('');
      setPaymentEnabled(false);
      setPaymentAmount('');
      setPaymentType('one_time');
      setRecurringInterval('30');
      setPaymentDescription('');
      setAutoApprove(true);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setGroupName('');
      setMembers([]);
      setNewMemberInput('');
      setPaymentEnabled(false);
      setPaymentAmount('');
      setPaymentType('one_time');
      setRecurringInterval('30');
      setPaymentDescription('');
      setAutoApprove(true);
      setError(null);
      setIsCreating(false); // Reset loading state when modal closes
    }
    onOpenChange(newOpen);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-headline flex items-center gap-2">
            <Users className="w-5 h-5" />
            New Group Chat
          </DialogTitle>
          <DialogDescription className="text-body">
            Create a group conversation with multiple members
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Group Name Input */}
          <div className="space-y-2">
            <Label htmlFor="group-name" className="text-caption">
              Group Name
            </Label>
            <Input
              id="group-name"
              type="text"
              placeholder="Weekend Plans, Team Chat..."
              value={groupName}
              onChange={(e) => {
                setGroupName(e.target.value);
                setError(null);
              }}
              disabled={isCreating}
              className="h-11"
              autoComplete="off"
              autoFocus
              maxLength={50}
              data-testid="input-group-name"
            />
            <p className="text-caption text-muted-foreground">
              {groupName.length}/50 characters
            </p>
          </div>

          {/* Add Members Section */}
          <div className="space-y-2">
            <Label htmlFor="add-member" className="text-caption">
              Add Members
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
                disabled={isCreating}
                className="h-11 flex-1"
                autoComplete="off"
                data-testid="input-add-member"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddMember}
                disabled={!newMemberInput.trim() || isCreating}
                className="h-11 w-11"
                data-testid="button-add-member"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              Press Enter or click + to add a member
            </p>
          </div>

          {/* Members List */}
          {members.length > 0 && (
            <div className="space-y-2">
              <Label className="text-caption">
                Members ({members.length})
              </Label>
              <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-md min-h-[60px]">
                {members.map((member) => (
                  <Badge
                    key={member}
                    variant="secondary"
                    className="pl-3 pr-2 py-1.5 text-sm hover-elevate"
                    data-testid={`badge-member-${member}`}
                  >
                    @{member}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveMember(member)}
                      disabled={isCreating}
                      className="ml-2 h-4 w-4 p-0 hover:bg-transparent"
                      data-testid={`button-remove-member-${member}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Payment Settings Section */}
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="payment-enabled" className="text-caption flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Require Payment to Join
                </Label>
                <p className="text-caption text-muted-foreground">
                  Members must pay to access this group
                </p>
              </div>
              <Switch
                id="payment-enabled"
                checked={paymentEnabled}
                onCheckedChange={setPaymentEnabled}
                disabled={isCreating}
                data-testid="switch-payment-enabled"
              />
            </div>

            {paymentEnabled && (
              <div className="space-y-4 pl-4 border-l-2">
                {/* Payment Amount */}
                <div className="space-y-2">
                  <Label htmlFor="payment-amount" className="text-caption">
                    Payment Amount (HBD)
                  </Label>
                  <Input
                    id="payment-amount"
                    type="number"
                    step="0.001"
                    min="0.001"
                    placeholder="5.000"
                    value={paymentAmount}
                    onChange={(e) => {
                      setPaymentAmount(e.target.value);
                      setError(null);
                    }}
                    disabled={isCreating}
                    className="h-11"
                    data-testid="input-payment-amount"
                  />
                  <p className="text-caption text-muted-foreground">
                    Minimum: 0.001 HBD
                  </p>
                </div>

                {/* Payment Type */}
                <div className="space-y-2">
                  <Label className="text-caption">Payment Type</Label>
                  <RadioGroup
                    value={paymentType}
                    onValueChange={(value) => setPaymentType(value as 'one_time' | 'recurring')}
                    disabled={isCreating}
                    data-testid="radio-payment-type"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="one_time" id="one-time" data-testid="radio-one-time" />
                      <Label htmlFor="one-time" className="cursor-pointer">
                        One-Time Payment
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="recurring" id="recurring" data-testid="radio-recurring" />
                      <Label htmlFor="recurring" className="cursor-pointer">
                        Recurring Payment
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Recurring Interval (only show if recurring selected) */}
                {paymentType === 'recurring' && (
                  <div className="space-y-2">
                    <Label htmlFor="recurring-interval" className="text-caption">
                      Billing Cycle (Days)
                    </Label>
                    <Input
                      id="recurring-interval"
                      type="number"
                      min="1"
                      placeholder="30"
                      value={recurringInterval}
                      onChange={(e) => {
                        setRecurringInterval(e.target.value);
                        setError(null);
                      }}
                      disabled={isCreating}
                      className="h-11"
                      data-testid="input-recurring-interval"
                    />
                    <p className="text-caption text-muted-foreground">
                      Members will be charged every {recurringInterval || '30'} days
                    </p>
                  </div>
                )}

                {/* Payment Description (optional) */}
                <div className="space-y-2">
                  <Label htmlFor="payment-description" className="text-caption">
                    Payment Description (Optional)
                  </Label>
                  <Textarea
                    id="payment-description"
                    placeholder="Premium content access, exclusive updates..."
                    value={paymentDescription}
                    onChange={(e) => setPaymentDescription(e.target.value)}
                    disabled={isCreating}
                    maxLength={200}
                    rows={3}
                    data-testid="textarea-payment-description"
                  />
                  <p className="text-caption text-muted-foreground">
                    {paymentDescription.length}/200 characters
                  </p>
                </div>

                {/* Auto-Approve After Payment */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-approve" className="text-caption">
                        Auto-approve after payment
                      </Label>
                      <p className="text-caption text-muted-foreground">
                        When enabled, users join instantly after payment. When disabled, you must manually approve each join request before they can pay.
                      </p>
                    </div>
                    <Switch
                      id="auto-approve"
                      checked={autoApprove}
                      onCheckedChange={setAutoApprove}
                      disabled={isCreating}
                      data-testid="switch-auto-approve"
                    />
                  </div>
                </div>

                {/* Payment Preview Alert */}
                <Alert>
                  <DollarSign className="h-4 w-4" />
                  <AlertDescription className="text-caption">
                    <strong>Payment Summary:</strong><br />
                    Members will pay <strong>{paymentAmount || '0.000'} HBD</strong> {paymentType === 'recurring' ? `every ${recurringInterval || '30'} days` : 'once'} to join this group.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">{error}</AlertDescription>
            </Alert>
          )}

          {/* Cost Warning */}
          {members.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">
                Group messages will cost {(members.length * 0.001).toFixed(3)} HBD per message
                ({members.length} members × 0.001 HBD)
              </AlertDescription>
            </Alert>
          )}

          {/* Large Group Warning - Show when >5 members */}
          {members.length > 5 && (
            <Alert data-testid="alert-large-group-warning">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">
                Creating groups with {members.length} members will require {members.length} separate Keychain approvals when sending messages. Consider keeping groups under 5 members for better experience.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isCreating}
              className="h-11"
              data-testid="button-cancel-group"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!groupName.trim() || members.length < 2 || isCreating}
              className="h-11"
              data-testid="button-create-group"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 mr-2" />
                  Create Group Chat
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
