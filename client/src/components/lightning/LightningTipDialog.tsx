import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  generateLightningInvoice, 
  calculateV4VTransfer, 
  decodeBOLT11Invoice,
  getBTCtoHBDRate,
  sendV4VTransfer,
  type LightningInvoice 
} from '@/lib/lightning';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface LightningTipDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  recipientUsername: string;
  recipientLightningAddress: string;
}

export function LightningTipDialog({ 
  isOpen, 
  onOpenChange, 
  recipientUsername,
  recipientLightningAddress
}: LightningTipDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // UI State
  const [satsAmount, setSatsAmount] = useState('1000');
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [isSendingTip, setIsSendingTip] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  
  // Invoice state (stores rich LightningInvoice object)
  const [lightningInvoiceData, setLightningInvoiceData] = useState<LightningInvoice | null>(null);
  const [invoiceAmountSats, setInvoiceAmountSats] = useState<number>(0);
  const [totalHBDCost, setTotalHBDCost] = useState<number>(0);
  const [v4vFee, setV4vFee] = useState<number>(0);
  const [btcHbdRate, setBtcHbdRate] = useState<number>(0);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSatsAmount('1000');
      setIsGeneratingInvoice(false);
      setInvoiceError(null);
      setLightningInvoiceData(null);
      setInvoiceAmountSats(0);
      setTotalHBDCost(0);
      setV4vFee(0);
      setBtcHbdRate(0);
    }
  }, [isOpen]);

  // Clear errors when amount changes
  useEffect(() => {
    setInvoiceError(null);
  }, [satsAmount]);

  const handleGenerateInvoice = async () => {
    const amount = parseInt(satsAmount);
    
    // Validation
    if (!amount || amount < 1) {
      setInvoiceError('Please enter a valid amount (minimum 1 sat)');
      return;
    }
    
    if (amount > 100000000) {
      setInvoiceError('Amount too large (maximum 100,000,000 sats)');
      return;
    }

    setIsGeneratingInvoice(true);
    setInvoiceError(null);
    
    try {
      console.log('[LIGHTNING TIP] Generating invoice for', amount, 'sats to', recipientLightningAddress);
      
      // Generate Lightning invoice via LNURL (returns rich object)
      const invoiceData = await generateLightningInvoice(
        recipientLightningAddress,
        amount,
        `Hive Messenger tip from @${recipientUsername}`
      );
      
      if (!invoiceData || !invoiceData.invoice) {
        throw new Error('Failed to generate invoice - no invoice returned');
      }
      
      console.log('[LIGHTNING TIP] Invoice generated:', invoiceData.invoice.substring(0, 50) + '...');
      
      // Decode invoice to verify amount
      const decoded = decodeBOLT11Invoice(invoiceData.invoice);
      const invoiceSats = decoded.amount || 0;
      
      if (invoiceSats !== amount) {
        throw new Error(`Invoice amount mismatch: requested ${amount} sats, got ${invoiceSats} sats`);
      }
      
      // Get BTC/HBD exchange rate
      const fetchedRate = await getBTCtoHBDRate();
      
      // Calculate total HBD cost (invoice amount + V4V.app 0.8% fee)
      const transfer = calculateV4VTransfer(invoiceData.invoice, invoiceSats, fetchedRate);
      
      console.log('[LIGHTNING TIP] Invoice verified:', invoiceSats, 'sats =', transfer.totalHBD, 'HBD');
      console.log('[LIGHTNING TIP] Exchange rate:', fetchedRate, 'HBD per BTC');
      console.log('[LIGHTNING TIP] Fee breakdown:', transfer);
      
      // Store invoice state INCLUDING exchange rate for consistency
      setLightningInvoiceData(invoiceData);
      setInvoiceAmountSats(invoiceSats);
      setTotalHBDCost(transfer.totalHBD);
      setV4vFee(transfer.v4vFee);
      setBtcHbdRate(fetchedRate);
      
      toast({
        title: 'Invoice Generated',
        description: `${formatNumber(invoiceSats)} sats = ${transfer.totalHBD.toFixed(3)} HBD`,
      });
      
    } catch (error) {
      console.error('[LIGHTNING TIP] Invoice generation failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setInvoiceError(errorMessage);
      
      toast({
        title: 'Invoice Generation Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const handleSendTip = async () => {
    // Guard: Ensure we have complete invoice data with valid rate
    if (!lightningInvoiceData || btcHbdRate <= 0 || totalHBDCost <= 0) {
      toast({
        title: 'Invalid State',
        description: 'Please regenerate the invoice before sending',
        variant: 'destructive',
      });
      return;
    }

    // Guard: Ensure user is authenticated
    if (!user?.username) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to send tips',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingTip(true);
    
    try {
      console.log('[LIGHTNING TIP] Sending tip via v4v.app:', {
        recipient: recipientUsername,
        sats: invoiceAmountSats,
        hbd: totalHBDCost,
      });
      
      // Send HBD to v4v.app with invoice in memo
      const txId = await sendV4VTransfer(
        user.username,
        lightningInvoiceData.invoice,
        totalHBDCost,
        invoiceAmountSats
      );
      
      console.log('[LIGHTNING TIP] Transfer successful! Transaction:', txId);
      
      // Success feedback
      toast({
        title: 'Tip Sent Successfully',
        description: `${formatNumber(invoiceAmountSats)} sats sent to @${recipientUsername}`,
      });
      
      // Close dialog
      onOpenChange(false);
      
      // TODO: Phase 4 - Send encrypted notification message
      
    } catch (error) {
      console.error('[LIGHTNING TIP] Transfer failed:', error);
      
      toast({
        title: 'Transfer Failed',
        description: error instanceof Error ? error.message : 'Failed to send tip',
        variant: 'destructive',
      });
    } finally {
      setIsSendingTip(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-lightning-tip">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Send Lightning Tip
          </DialogTitle>
          <DialogDescription>
            Send Bitcoin (BTC) satoshis to @{recipientUsername} via Lightning Network. 
            You'll pay in HBD through v4v.app bridge (0.8% fee).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="sats-amount">Amount (satoshis)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sats-amount"
                type="number"
                value={satsAmount}
                onChange={(e) => setSatsAmount(e.target.value)}
                disabled={isGeneratingInvoice || !!lightningInvoiceData}
                placeholder="1000"
                min="1"
                max="100000000"
                className="h-11"
                data-testid="input-sats-amount"
              />
              <span className="text-caption text-muted-foreground whitespace-nowrap">sats</span>
            </div>
            <p className="text-caption text-muted-foreground">
              1 sat = 0.00000001 BTC
            </p>
          </div>

          {/* Error Message */}
          {invoiceError && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-caption text-destructive">{invoiceError}</p>
            </div>
          )}

          {/* Invoice Info - Only show if we have BOTH invoice AND rate */}
          {lightningInvoiceData && btcHbdRate > 0 && totalHBDCost > 0 && (
            <div className="space-y-2 p-3 bg-muted/50 border rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-caption text-muted-foreground">Lightning Invoice:</span>
                <span className="text-caption font-medium text-green-600 dark:text-green-500">
                  {formatNumber(invoiceAmountSats)} sats
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-caption text-muted-foreground">V4V.app Fee (0.8%):</span>
                <span className="text-caption font-medium">
                  {v4vFee.toFixed(6)} HBD
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-body font-medium">Total HBD Cost:</span>
                <span className="text-body font-bold text-primary">
                  {totalHBDCost.toFixed(3)} HBD
                </span>
              </div>
              <div className="flex justify-between items-center text-caption text-muted-foreground mt-1">
                <span>Exchange Rate:</span>
                <span>{formatNumber(btcHbdRate)} HBD/BTC</span>
              </div>
            </div>
          )}

          {/* Recipient Info */}
          <div className="p-3 bg-muted/30 border rounded-md">
            <div className="flex justify-between items-center">
              <span className="text-caption text-muted-foreground">Recipient:</span>
              <span className="text-caption font-medium">@{recipientUsername}</span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-caption text-muted-foreground">Lightning Address:</span>
              <span className="text-caption font-mono text-xs truncate max-w-[200px]">
                {recipientLightningAddress}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            {!lightningInvoiceData || btcHbdRate <= 0 || totalHBDCost <= 0 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1 h-11"
                  data-testid="button-cancel-tip"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleGenerateInvoice}
                  disabled={isGeneratingInvoice || !satsAmount || parseInt(satsAmount) < 1}
                  className="flex-1 h-11"
                  data-testid="button-generate-invoice"
                >
                  {isGeneratingInvoice ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Generate Invoice
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setLightningInvoiceData(null);
                    setInvoiceAmountSats(0);
                    setTotalHBDCost(0);
                    setV4vFee(0);
                    setBtcHbdRate(0);
                  }}
                  className="flex-1 h-11"
                  data-testid="button-regenerate-invoice"
                >
                  Change Amount
                </Button>
                <Button
                  variant="default"
                  onClick={handleSendTip}
                  disabled={isSendingTip}
                  className="flex-1 h-11"
                  data-testid="button-send-tip"
                >
                  {isSendingTip ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Send {totalHBDCost.toFixed(3)} HBD
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
