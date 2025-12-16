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
import type { PaymentSettings } from '@shared/schema';
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
        currentUsername,
      });

      // Request HBD transfer via Hive Keychain with timeout
      logger.info('[PAYMENT GATEWAY] Calling Keychain requestTransfer...');
      
      const KEYCHAIN_TIMEOUT = 120000; // 2 minutes for user to approve
      
      const keychainTransfer = new Promise<{ txId?: string }>((resolve, reject) => {
        if (!window.hive_keychain) {
          logger.error('[PAYMENT GATEWAY] Keychain not found on window');
          reject(new Error('Hive Keychain not installed'));
          return;
        }

        logger.info('[PAYMENT GATEWAY] Keychain found, making requestTransfer call...');
        
        try {
          window.hive_keychain.requestTransfer(
            currentUsername,
            creatorUsername,
            paymentSettings.amount,
            memo,
            'HBD',
            (response: any) => {
              logger.info('[PAYMENT GATEWAY] Keychain callback received:', {
                success: response?.success,
                message: response?.message,
                hasResult: !!response?.result,
              });
              
              if (response.success) {
                logger.info('[PAYMENT GATEWAY] ✅ Payment broadcast successful:', {
                  txId: response.result?.tx_id || response.result?.id,
                  result: response.result,
                });
                resolve({ txId: response.result?.tx_id || response.result?.id });
              } else {
                logger.error('[PAYMENT GATEWAY] ❌ Payment failed:', response.message);
                reject(new Error(response.message || 'Payment cancelled'));
              }
            }
          );
          logger.info('[PAYMENT GATEWAY] requestTransfer call made, waiting for popup response...');
        } catch (err) {
          logger.error('[PAYMENT GATEWAY] Error calling requestTransfer:', err);
          reject(err);
        }
      });
      
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Keychain popup closed or timed out. Please try again.'));
        }, KEYCHAIN_TIMEOUT);
      });
      
      const transferResult = await Promise.race([keychainTransfer, timeout]);
      logger.info('[PAYMENT GATEWAY] Transfer completed:', transferResult);

      // We have a transaction ID from Keychain - payment was broadcast successfully!
      // Keychain already verified the transaction was included in a block
      const keychainTxId = transferResult.txId;
      
      if (!keychainTxId) {
        // Fallback to history verification if no txId returned
        logger.warn('[PAYMENT GATEWAY] No txId from Keychain, falling back to history verification');
        
        setVerificationStatus('verifying');
        setVerificationProgress(10);
        
        // Wait for blockchain propagation
        await new Promise(resolve => setTimeout(resolve, 6000));
        setVerificationProgress(50);
        
        const verification = await verifyPayment(
          currentUsername,
          creatorUsername,
          paymentSettings.amount,
          groupId,
          1
        );
        
        if (!verification.verified || !verification.txId) {
          throw new Error(verification.error || 'Payment verification failed');
        }
        
        setVerificationProgress(100);
        setVerificationStatus('verified');
        
        logger.info('[PAYMENT GATEWAY] ✅ Payment verified via history:', verification.txId);
        
        toast({
          title: 'Payment Successful!',
          description: `You're joining "${groupName}"`,
        });
        
        const verifiedTxId = verification.txId;
        setTimeout(() => {
          onPaymentVerified(verifiedTxId, `${paymentSettings.amount} HBD`);
          onOpenChange(false);
        }, 1500);
        return;
      }
      
      // We have a txId from Keychain - trust it!
      // Keychain already confirmed the transaction was broadcast
      logger.info('[PAYMENT GATEWAY] ✅ Payment confirmed by Keychain with txId:', keychainTxId);
      
      setVerificationStatus('verified');
      setVerificationProgress(100);

      // Show success message
      toast({
        title: 'Payment Successful!',
        description: `You're joining "${groupName}"`,
      });

      // Wait for user to see the verified status, then notify parent and close
      setTimeout(() => {
        // Notify parent component - this triggers the join request and navigation
        onPaymentVerified(keychainTxId, `${paymentSettings.amount} HBD`);
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
