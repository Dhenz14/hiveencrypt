import { useState, useEffect } from 'react';
import { 
  Settings, 
  DollarSign, 
  UserCheck, 
  MessageSquare, 
  AlertTriangle,
  Loader2
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import type { PaymentSettings, GroupConversationCache } from '@shared/schema';

interface WelcomeMessageSettings {
  enabled: boolean;
  message: string;
}

interface GroupSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupConversationCache;
  currentUsername?: string;
  onUpdateSettings: (updatedSettings: Partial<GroupConversationCache> & { welcomeMessage?: WelcomeMessageSettings }) => Promise<void>;
}

export function GroupSettingsModal({ 
  open, 
  onOpenChange, 
  group,
  currentUsername,
  onUpdateSettings
}: GroupSettingsModalProps) {
  const isCreator = currentUsername === group.creator;
  
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('payment');
  
  const [paymentEnabled, setPaymentEnabled] = useState(group.paymentSettings?.enabled ?? false);
  const [paymentAmount, setPaymentAmount] = useState(group.paymentSettings?.amount ?? '');
  const [paymentType, setPaymentType] = useState<'one_time' | 'recurring'>(group.paymentSettings?.type ?? 'one_time');
  const [recurringInterval, setRecurringInterval] = useState(String(group.paymentSettings?.recurringInterval ?? 30));
  const [paymentDescription, setPaymentDescription] = useState(group.paymentSettings?.description ?? '');
  
  const [autoApproveFree, setAutoApproveFree] = useState(group.paymentSettings?.autoApprove ?? true);
  const [autoApprovePaid, setAutoApprovePaid] = useState(group.paymentSettings?.autoApprove ?? true);
  
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  
  const [disablePaymentDialogOpen, setDisablePaymentDialogOpen] = useState(false);
  const [convertToFreeDialogOpen, setConvertToFreeDialogOpen] = useState(false);
  const [pendingPaymentToggle, setPendingPaymentToggle] = useState(false);

  useEffect(() => {
    if (open) {
      setPaymentEnabled(group.paymentSettings?.enabled ?? false);
      setPaymentAmount(group.paymentSettings?.amount ?? '');
      setPaymentType(group.paymentSettings?.type ?? 'one_time');
      setRecurringInterval(String(group.paymentSettings?.recurringInterval ?? 30));
      setPaymentDescription(group.paymentSettings?.description ?? '');
      setAutoApproveFree(group.paymentSettings?.autoApprove ?? true);
      setAutoApprovePaid(group.paymentSettings?.autoApprove ?? true);
      setError(null);
    }
  }, [open, group]);

  const handlePaymentToggle = (checked: boolean) => {
    if (!checked && group.paymentSettings?.enabled) {
      setPendingPaymentToggle(true);
      setDisablePaymentDialogOpen(true);
    } else {
      setPaymentEnabled(checked);
    }
  };

  const confirmDisablePayments = () => {
    setPaymentEnabled(false);
    setDisablePaymentDialogOpen(false);
    setPendingPaymentToggle(false);
  };

  const cancelDisablePayments = () => {
    setDisablePaymentDialogOpen(false);
    setPendingPaymentToggle(false);
  };

  const handleCancelRecurring = () => {
    setPaymentType('one_time');
  };

  const handleConvertToFree = async () => {
    setIsSaving(true);
    setError(null);
    
    try {
      await onUpdateSettings({
        paymentSettings: undefined,
      });
      setPaymentEnabled(false);
      setConvertToFreeDialogOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to convert group to free');
    } finally {
      setIsSaving(false);
    }
  };

  const validatePaymentSettings = (): string | null => {
    if (paymentEnabled) {
      const amount = parseFloat(paymentAmount);
      if (isNaN(amount) || amount <= 0) {
        return 'Payment amount must be a positive number';
      }
      if (amount < 0.001) {
        return 'Minimum payment amount is 0.001 HBD';
      }
      if (paymentType === 'recurring') {
        const interval = parseInt(recurringInterval);
        if (isNaN(interval) || interval < 1) {
          return 'Recurring interval must be at least 1 day';
        }
      }
    }
    return null;
  };

  const handleSavePaymentSettings = async () => {
    const validationError = validatePaymentSettings();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const newPaymentSettings: PaymentSettings | undefined = paymentEnabled ? {
        enabled: true,
        amount: parseFloat(paymentAmount).toFixed(3),
        type: paymentType,
        recurringInterval: paymentType === 'recurring' ? parseInt(recurringInterval) : undefined,
        description: paymentDescription.trim() || undefined,
        autoApprove: paymentType === 'one_time' ? autoApproveFree : autoApprovePaid,
      } : undefined;

      await onUpdateSettings({
        paymentSettings: newPaymentSettings,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save payment settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveApprovalSettings = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const currentSettings = group.paymentSettings;
      if (currentSettings) {
        await onUpdateSettings({
          paymentSettings: {
            ...currentSettings,
            autoApprove: currentSettings.type === 'one_time' ? autoApproveFree : autoApprovePaid,
          },
        });
      } else {
        await onUpdateSettings({
          paymentSettings: {
            enabled: false,
            amount: '0',
            type: 'one_time',
            autoApprove: autoApproveFree,
          },
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save approval settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWelcomeMessage = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onUpdateSettings({
        welcomeMessage: {
          enabled: welcomeEnabled,
          message: welcomeMessage.trim(),
        },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save welcome message');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isCreator) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Group Settings
            </DialogTitle>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Only the group creator can manage settings.
            </AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Group Settings
            </DialogTitle>
            <DialogDescription>
              Manage settings for "{group.name}"
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4" data-testid="settings-tabs">
              <TabsTrigger value="payment" data-testid="tab-payment">
                <DollarSign className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="approval" data-testid="tab-approval">
                <UserCheck className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="welcome" data-testid="tab-welcome">
                <MessageSquare className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="danger" data-testid="tab-danger">
                <AlertTriangle className="w-4 h-4" />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="payment" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Payment Settings
                  </CardTitle>
                  <CardDescription>
                    Configure payment requirements for joining this group
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="settings-payment-enabled" className="text-sm">
                        Require Payment to Join
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {paymentEnabled ? 'Payment is required' : 'Group is free to join'}
                      </p>
                    </div>
                    <Switch
                      id="settings-payment-enabled"
                      checked={paymentEnabled}
                      onCheckedChange={handlePaymentToggle}
                      disabled={isSaving}
                      data-testid="switch-settings-payment-enabled"
                    />
                  </div>

                  {paymentEnabled && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label htmlFor="settings-payment-amount" className="text-sm">
                          Payment Amount (HBD)
                        </Label>
                        <Input
                          id="settings-payment-amount"
                          type="number"
                          step="0.001"
                          min="0.001"
                          placeholder="5.000"
                          value={paymentAmount}
                          onChange={(e) => {
                            setPaymentAmount(e.target.value);
                            setError(null);
                          }}
                          disabled={isSaving}
                          data-testid="input-settings-payment-amount"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm">Payment Type</Label>
                        <RadioGroup
                          value={paymentType}
                          onValueChange={(value) => setPaymentType(value as 'one_time' | 'recurring')}
                          disabled={isSaving}
                          data-testid="radio-settings-payment-type"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="one_time" id="settings-one-time" data-testid="radio-settings-one-time" />
                            <Label htmlFor="settings-one-time" className="cursor-pointer">
                              One-Time Payment
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="recurring" id="settings-recurring" data-testid="radio-settings-recurring" />
                            <Label htmlFor="settings-recurring" className="cursor-pointer">
                              Recurring Payment
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {paymentType === 'recurring' && (
                        <div className="space-y-2">
                          <Label htmlFor="settings-recurring-interval" className="text-sm">
                            Billing Cycle (Days)
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="settings-recurring-interval"
                              type="number"
                              min="1"
                              placeholder="30"
                              value={recurringInterval}
                              onChange={(e) => {
                                setRecurringInterval(e.target.value);
                                setError(null);
                              }}
                              disabled={isSaving}
                              className="flex-1"
                              data-testid="input-settings-recurring-interval"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCancelRecurring}
                              disabled={isSaving}
                              data-testid="button-cancel-recurring"
                            >
                              Cancel Recurring
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Members charged every {recurringInterval || '30'} days
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="settings-payment-description" className="text-sm">
                          Description (Optional)
                        </Label>
                        <Textarea
                          id="settings-payment-description"
                          placeholder="What members get for their payment..."
                          value={paymentDescription}
                          onChange={(e) => setPaymentDescription(e.target.value)}
                          disabled={isSaving}
                          maxLength={200}
                          rows={2}
                          data-testid="textarea-settings-payment-description"
                        />
                        <p className="text-sm text-muted-foreground">
                          {paymentDescription.length}/200
                        </p>
                      </div>
                    </div>
                  )}

                  {error && activeTab === 'payment' && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleSavePaymentSettings}
                    disabled={isSaving}
                    className="w-full"
                    data-testid="button-save-payment-settings"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Payment Settings'
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="approval" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    Auto-Approval Settings
                  </CardTitle>
                  <CardDescription>
                    Configure how new member requests are handled
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-sm font-medium">Current Mode:</span>
                    <Badge variant={group.paymentSettings?.enabled ? 'default' : 'secondary'}>
                      {group.paymentSettings?.enabled ? 'Paid Group' : 'Free Group'}
                    </Badge>
                  </div>

                  {!group.paymentSettings?.enabled ? (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-approve-free" className="text-sm">
                          Auto-approve join requests
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Members join instantly without manual approval
                        </p>
                      </div>
                      <Switch
                        id="auto-approve-free"
                        checked={autoApproveFree}
                        onCheckedChange={setAutoApproveFree}
                        disabled={isSaving}
                        data-testid="switch-auto-approve-free"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-approve-paid" className="text-sm">
                          Auto-approve after payment
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Members join instantly after payment verification
                        </p>
                      </div>
                      <Switch
                        id="auto-approve-paid"
                        checked={autoApprovePaid}
                        onCheckedChange={setAutoApprovePaid}
                        disabled={isSaving}
                        data-testid="switch-auto-approve-paid"
                      />
                    </div>
                  )}

                  <Alert>
                    <UserCheck className="h-4 w-4" />
                    <AlertDescription>
                      {group.paymentSettings?.enabled ? (
                        autoApprovePaid 
                          ? 'Members will be added automatically after their payment is verified.'
                          : 'You will need to manually approve each paid member.'
                      ) : (
                        autoApproveFree
                          ? 'New members will be added automatically when they request to join.'
                          : 'You will need to manually approve each join request.'
                      )}
                    </AlertDescription>
                  </Alert>

                  {error && activeTab === 'approval' && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleSaveApprovalSettings}
                    disabled={isSaving}
                    className="w-full"
                    data-testid="button-save-approval-settings"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Approval Settings'
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="welcome" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Welcome Message
                  </CardTitle>
                  <CardDescription>
                    Set a message shown to new members when they join
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="welcome-enabled" className="text-sm">
                        Enable Welcome Message
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Show a message to new members
                      </p>
                    </div>
                    <Switch
                      id="welcome-enabled"
                      checked={welcomeEnabled}
                      onCheckedChange={setWelcomeEnabled}
                      disabled={isSaving}
                      data-testid="switch-welcome-enabled"
                    />
                  </div>

                  {welcomeEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="welcome-message" className="text-sm">
                          Welcome Message
                        </Label>
                        <Textarea
                          id="welcome-message"
                          placeholder="Welcome to the group! Here are some guidelines..."
                          value={welcomeMessage}
                          onChange={(e) => setWelcomeMessage(e.target.value)}
                          disabled={isSaving}
                          maxLength={500}
                          rows={4}
                          data-testid="textarea-welcome-message"
                        />
                        <p className="text-sm text-muted-foreground">
                          {welcomeMessage.length}/500
                        </p>
                      </div>

                      {welcomeMessage.trim() && (
                        <div className="space-y-2">
                          <Label className="text-sm">Preview</Label>
                          <Card className="bg-muted">
                            <CardContent className="p-3">
                              <div className="flex items-start gap-2">
                                <Badge variant="secondary" className="shrink-0">
                                  Welcome
                                </Badge>
                                <p className="text-sm whitespace-pre-wrap">
                                  {welcomeMessage}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </>
                  )}

                  {error && activeTab === 'welcome' && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleSaveWelcomeMessage}
                    disabled={isSaving}
                    className="w-full"
                    data-testid="button-save-welcome-message"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Welcome Message'
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="danger" className="space-y-4 mt-4">
              <Card className="border-destructive/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-4 h-4" />
                    Danger Zone
                  </CardTitle>
                  <CardDescription>
                    Irreversible actions that affect your group
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {group.paymentSettings?.enabled && (
                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">Convert to Free Group</p>
                        <p className="text-sm text-muted-foreground">
                          Remove payment requirement. Existing payments remain valid.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => setConvertToFreeDialogOpen(true)}
                        disabled={isSaving}
                        data-testid="button-convert-to-free"
                      >
                        Convert
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center justify-between p-3 border rounded-md opacity-60">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Delete Group</p>
                      <p className="text-sm text-muted-foreground">
                        Groups cannot be deleted as they are stored on the blockchain.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      disabled
                      data-testid="button-delete-group"
                    >
                      Delete
                    </Button>
                  </div>

                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Group data is stored on the Hive blockchain and cannot be permanently deleted. 
                      You can leave the group or remove all members instead.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disablePaymentDialogOpen} onOpenChange={setDisablePaymentDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Payments?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make your group free to join. Existing member payments will remain on record, 
              but new members won't need to pay. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDisablePayments} data-testid="button-cancel-disable-payment">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisablePayments} data-testid="button-confirm-disable-payment">
              Disable Payments
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={convertToFreeDialogOpen} onOpenChange={setConvertToFreeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to Free Group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all payment requirements from your group. 
              Existing member payment records will be preserved, but no new payments will be required.
              This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-convert-free">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConvertToFree}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-convert-free"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Converting...
                </>
              ) : (
                'Convert to Free'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
