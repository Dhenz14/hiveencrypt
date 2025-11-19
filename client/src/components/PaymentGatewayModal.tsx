import { useState, useEffect } from 'react';
import { DollarSign, Check, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { PaymentSettings } from '@/lib/groupBlockchain';
import { generatePaymentMemo, verifyPayment } from '@/lib/paymentVerification';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

interface PaymentGatewayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  creatorUsername: string;
  paymentSettings: PaymentSettings;
  currentUsername: string;
  onPaymentVerified: (txId: string, amount: string) => void;
}

export function PaymentGatewayModal({
  open,
  onOpenChange,
  groupId,
  groupName,
  creatorUsername,
  paymentSettings,
  currentUsername,
  onPaymentVerified,
}: PaymentGatewayModalProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'pending' | 'verifying' | 'verified' | 'failed'>('idle');
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setIsProcessing(false);
      setVerificationStatus('idle');
      setVerificationProgress(0);
      setError(null);
    }
  }, [open]);

  const handlePayment = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      setVerificationStatus('pending');

      // Generate payment memo
      const memo = generatePaymentMemo(groupId, currentUsername);
      logger.info('[PAYMENT GATEWAY] Initiating payment:', {
        to: creatorUsername,
        amount: paymentSettings.amount,
        memo,
      });

      // Request HBD transfer via Hive Keychain
      await new Promise((resolve, reject) => {
        if (!window.hive_keychain) {
          reject(new Error('Hive Keychain not installed'));
          return;
        }

        window.hive_keychain.requestTransfer(
          currentUsername,
          creatorUsername,
          paymentSettings.amount,
          memo,
          'HBD',
          (response: any) => {
            if (response.success) {
              logger.info('[PAYMENT GATEWAY] Payment sent:', response.result);
              resolve(response.result);
            } else {
              logger.error('[PAYMENT GATEWAY] Payment failed:', response.message);
              reject(new Error(response.message || 'Payment cancelled'));
            }
          }
        );
      });

      // Start verification process
      setVerificationStatus('verifying');
      setVerificationProgress(10);

      // Wait for blockchain confirmation (3 seconds for Hive)
      await new Promise(resolve => setTimeout(resolve, 3000));
      setVerificationProgress(40);

      // Verify payment on blockchain
      logger.info('[PAYMENT GATEWAY] Verifying payment on blockchain...');
      const verification = await verifyPayment(
        currentUsername,
        creatorUsername,
        paymentSettings.amount,
        groupId,
        1 // Maximum 1 hour old (should be seconds old)
      );

      setVerificationProgress(80);

      if (!verification.verified || !verification.txId) {
        throw new Error(verification.error || 'Payment verification failed');
      }

      setVerificationProgress(100);
      setVerificationStatus('verified');

      logger.info('[PAYMENT GATEWAY] ✅ Payment verified:', verification.txId);

      // Notify parent component
      onPaymentVerified(verification.txId, `${paymentSettings.amount} HBD`);

      // Show success message
      toast({
        title: 'Payment Successful',
        description: `Paid ${paymentSettings.amount} HBD to join "${groupName}"`,
      });

      // Close modal after short delay
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch (err: any) {
      logger.error('[PAYMENT GATEWAY] Payment error:', err);
      setVerificationStatus('failed');
      
      const errorMessage = err.message || 'Payment processing failed';
      setError(errorMessage);

      toast({
        title: 'Payment Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusMessage = () => {
    switch (verificationStatus) {
      case 'pending':
        return 'Waiting for Keychain approval...';
      case 'verifying':
        return 'Verifying payment on blockchain...';
      case 'verified':
        return 'Payment verified successfully!';
      case 'failed':
        return 'Payment verification failed';
      default:
        return '';
    }
  };

  const getStatusIcon = () => {
    switch (verificationStatus) {
      case 'pending':
      case 'verifying':
        return <Loader2 className="w-5 h-5 animate-spin" />;
      case 'verified':
        return <Check className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      default:
        return <DollarSign className="w-5 h-5" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Pay to Join Group
          </DialogTitle>
          <DialogDescription className="text-body">
            This group requires payment to access
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Group Info */}
          <div className="p-4 bg-muted rounded-md space-y-2">
            <div className="flex justify-between">
              <span className="text-caption text-muted-foreground">Group:</span>
              <span className="font-medium">{groupName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-caption text-muted-foreground">Creator:</span>
              <span className="font-medium">@{creatorUsername}</span>
            </div>
          </div>

          {/* Payment Details */}
          <div className="p-4 border-2 rounded-md space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-caption text-muted-foreground">Amount:</span>
              <span className="text-xl font-bold">{paymentSettings.amount} HBD</span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-caption text-muted-foreground">Payment Type:</span>
              <Badge variant="secondary">
                {paymentSettings.type === 'one_time' ? 'One-Time' : 'Recurring'}
              </Badge>
            </div>

            {paymentSettings.type === 'recurring' && paymentSettings.recurringInterval && (
              <div className="flex justify-between items-center">
                <span className="text-caption text-muted-foreground">Billing Cycle:</span>
                <span className="text-sm">Every {paymentSettings.recurringInterval} days</span>
              </div>
            )}

            {paymentSettings.description && (
              <div className="pt-2 border-t">
                <p className="text-caption text-muted-foreground">{paymentSettings.description}</p>
              </div>
            )}
          </div>

          {/* Verification Status */}
          {verificationStatus !== 'idle' && (
            <Alert variant={verificationStatus === 'verified' ? 'default' : verificationStatus === 'failed' ? 'destructive' : 'default'}>
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <AlertDescription className="text-caption">
                  {getStatusMessage()}
                </AlertDescription>
              </div>
              
              {verificationStatus === 'verifying' && (
                <Progress value={verificationProgress} className="mt-2" />
              )}
            </Alert>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">{error}</AlertDescription>
            </Alert>
          )}

          {/* Payment Info */}
          {verificationStatus === 'idle' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">
                Clicking "Pay Now" will open Hive Keychain to complete the payment. 
                The payment will be verified automatically on the blockchain.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing || verificationStatus === 'verifying'}
            className="h-11"
            data-testid="button-cancel-payment"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handlePayment}
            disabled={isProcessing || verificationStatus === 'verified'}
            className="h-11"
            data-testid="button-pay-now"
          >
            {verificationStatus === 'verified' ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                Verified
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <DollarSign className="w-4 h-4 mr-2" />
                Pay {paymentSettings.amount} HBD
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
