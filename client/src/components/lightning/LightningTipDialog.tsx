import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, Loader2, AlertCircle, Copy, Check, Wallet } from 'lucide-react';
import QRCode from 'qrcode';
import { useToast } from '@/hooks/use-toast';
import { 
  generateLightningInvoice,
  generateV4VReverseInvoice,
  calculateV4VTransfer, 
  decodeBOLT11Invoice,
  getBTCtoHBDRate,
  sendV4VTransfer,
  type LightningInvoice 
} from '@/lib/lightning';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { requestEncode, requestTransfer } from '@/lib/hive';
import type { TipReceivePreference } from '@/lib/accountMetadata';

interface LightningTipDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  recipientUsername: string;
  recipientLightningAddress?: string;
  recipientTipPreference: TipReceivePreference;
}

export function LightningTipDialog({ 
  isOpen, 
  onOpenChange, 
  recipientUsername,
  recipientLightningAddress,
  recipientTipPreference
}: LightningTipDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Request ID to track current invoice generation session
  const requestIdRef = useRef(0);
  
  // UI State
  const [satsAmount, setSatsAmount] = useState('1000');
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [isSendingTip, setIsSendingTip] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'v4v' | 'wallet'>('v4v');
  const [isCopied, setIsCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isPayingWithWebLN, setIsPayingWithWebLN] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Invoice state (stores rich LightningInvoice object)
  const [lightningInvoiceData, setLightningInvoiceData] = useState<LightningInvoice | null>(null);
  const [invoiceAmountSats, setInvoiceAmountSats] = useState<number>(0);
  const [totalHBDCost, setTotalHBDCost] = useState<number>(0);
  const [v4vFee, setV4vFee] = useState<number>(0);
  const [btcHbdRate, setBtcHbdRate] = useState<number>(0);
  
  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      // Increment request ID to invalidate any in-flight requests
      requestIdRef.current += 1;
      
      setSatsAmount('1000');
      setIsGeneratingInvoice(false);
      setInvoiceError(null);
      setLightningInvoiceData(null);
      setInvoiceAmountSats(0);
      setTotalHBDCost(0);
      setV4vFee(0);
      setBtcHbdRate(0);
      setActiveTab('v4v');
      setIsCopied(false);
      setQrDataUrl(null);
    }
  }, [isOpen]);
  
  // Generate QR code when invoice is available
  useEffect(() => {
    if (lightningInvoiceData?.invoice) {
      QRCode.toDataURL(lightningInvoiceData.invoice, {
        errorCorrectionLevel: 'M',
        width: 300,
        margin: 2,
      })
        .then(setQrDataUrl)
        .catch(err => {
          console.error('[LIGHTNING TIP] Failed to generate QR code:', err);
          setQrDataUrl(null);
        });
    } else {
      setQrDataUrl(null);
    }
  }, [lightningInvoiceData]);

  // Clear errors when amount changes
  useEffect(() => {
    setInvoiceError(null);
  }, [satsAmount]);
  
  // Check if WebLN is available
  const hasWebLN = typeof window !== 'undefined' && 'webln' in window;
  
  // Copy invoice to clipboard
  const handleCopyInvoice = async () => {
    if (!lightningInvoiceData?.invoice) return;
    
    try {
      await navigator.clipboard.writeText(lightningInvoiceData.invoice);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast({
        title: 'Invoice Copied',
        description: 'Lightning invoice copied to clipboard',
      });
    } catch (error) {
      console.error('[LIGHTNING TIP] Failed to copy invoice:', error);
      toast({
        title: 'Copy Failed',
        description: 'Failed to copy invoice to clipboard',
        variant: 'destructive',
      });
    }
  };
  
  // Pay with WebLN browser wallet
  const handlePayWithWebLN = async () => {
    if (!lightningInvoiceData?.invoice) return;
    
    setIsPayingWithWebLN(true);
    
    try {
      // @ts-ignore - WebLN types
      await window.webln.enable();
      
      // @ts-ignore - WebLN types
      const result = await window.webln.sendPayment(lightningInvoiceData.invoice);
      
      console.log('[LIGHTNING TIP] WebLN payment successful:', result);
      
      const successMessage = recipientTipPreference === 'hbd'
        ? `${formatNumber(invoiceAmountSats)} sats paid → recipient receives ${totalHBDCost.toFixed(3)} HBD`
        : `${formatNumber(invoiceAmountSats)} sats sent via WebLN`;
      
      toast({
        title: 'Payment Sent',
        description: successMessage,
      });
      
      // Send notification if we have user context and it's an HBD recipient
      // Note: For Lightning recipients, the wallet provider handles the payment directly
      if (user?.username && recipientTipPreference === 'hbd') {
        try {
          console.log('[LIGHTNING TIP] Sending HBD notification to', recipientUsername);
          
          // Note: We don't have the Hive transaction ID yet since V4V.app handles the conversion
          // So we'll send a simpler notification without the Hive tx link
          const notificationMessage = `Tip Received: ${totalHBDCost.toFixed(3)} HBD\n\nSent via Lightning by @${user.username}`;
          
          const encryptResponse = await requestEncode(
            user.username,
            recipientUsername,
            notificationMessage,
            'Memo'
          );
          
          if (encryptResponse.success && encryptResponse.result) {
            await requestTransfer(
              user.username,
              recipientUsername,
              '0.001',
              encryptResponse.result,
              'HBD'
            );
            console.log('[LIGHTNING TIP] HBD notification sent');
          }
        } catch (notifError) {
          console.error('[LIGHTNING TIP] Failed to send notification:', notifError);
          // Don't block success - notification is optional
        }
      }
      
      // Close dialog on success
      onOpenChange(false);
    } catch (error) {
      console.error('[LIGHTNING TIP] WebLN payment failed:', error);
      
      let errorMessage = 'Failed to send payment via WebLN';
      if (error instanceof Error) {
        if (error.message.includes('User rejected')) {
          errorMessage = 'Payment cancelled by user';
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: 'Payment Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsPayingWithWebLN(false);
    }
  };

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

    // Increment request ID at start of new request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;
    
    setIsGeneratingInvoice(true);
    setInvoiceError(null);
    
    try {
      console.log('[LIGHTNING TIP] Starting invoice generation, requestId:', currentRequestId, 'preference:', recipientTipPreference);
      
      let invoiceData: LightningInvoice;
      let invoiceSats: number;
      let fetchedRate = 0;
      let hbdCost = 0;
      let v4vFeeAmount = 0;
      
      if (recipientTipPreference === 'hbd') {
        // HBD preference: Generate V4V reverse bridge invoice (Lightning → HBD)
        console.log('[LIGHTNING TIP] Generating V4V reverse bridge invoice (Lightning → HBD)');
        
        // Get BTC/HBD exchange rate first
        fetchedRate = await getBTCtoHBDRate();
        
        // Convert sats to HBD amount
        const hbdAmount = (amount / 100000000) * fetchedRate;
        
        // Generate invoice via V4V reverse bridge
        invoiceData = await generateV4VReverseInvoice(
          recipientUsername,
          hbdAmount,
          user?.username || 'anonymous'
        );
        
        if (!invoiceData || !invoiceData.invoice) {
          throw new Error('Failed to generate reverse bridge invoice');
        }
        
        console.log('[LIGHTNING TIP] Reverse bridge invoice generated:', invoiceData.invoice.substring(0, 50) + '...');
        
        // Decode invoice to get actual amount (includes V4V fee)
        const decoded = decodeBOLT11Invoice(invoiceData.invoice);
        invoiceSats = decoded.amount || 0;
        
        // Calculate fee breakdown (V4V reverse bridge fee: 50 sats + 0.5%)
        const v4vFeeRate = 0.005; // 0.5%
        const v4vFeeSats = 50 + (amount * v4vFeeRate);
        
        hbdCost = hbdAmount;
        v4vFeeAmount = (v4vFeeSats / 100000000) * fetchedRate;
        
        console.log('[LIGHTNING TIP] Reverse bridge invoice verified:', invoiceSats, 'sats → recipient gets', hbdAmount.toFixed(3), 'HBD');
      } else {
        // Lightning preference: Generate standard Lightning invoice
        console.log('[LIGHTNING TIP] Generating standard Lightning invoice');
        
        if (!recipientLightningAddress) {
          throw new Error('Recipient Lightning Address not available');
        }
        
        // Generate Lightning invoice via LNURL (returns rich object)
        invoiceData = await generateLightningInvoice(
          recipientLightningAddress,
          amount,
          `Hive Messenger tip from @${user?.username || 'anonymous'}`
        );
        
        if (!invoiceData || !invoiceData.invoice) {
          throw new Error('Failed to generate invoice - no invoice returned');
        }
        
        console.log('[LIGHTNING TIP] Invoice generated:', invoiceData.invoice.substring(0, 50) + '...');
        
        // Decode invoice to verify amount
        const decoded = decodeBOLT11Invoice(invoiceData.invoice);
        invoiceSats = decoded.amount || 0;
        
        if (invoiceSats !== amount) {
          throw new Error(`Invoice amount mismatch: requested ${amount} sats, got ${invoiceSats} sats`);
        }
        
        // Get BTC/HBD exchange rate
        fetchedRate = await getBTCtoHBDRate();
        
        // Calculate total HBD cost (invoice amount + V4V.app 0.8% fee for HBD bridge)
        const transfer = calculateV4VTransfer(invoiceData.invoice, invoiceSats, fetchedRate);
        hbdCost = transfer.totalHBD;
        v4vFeeAmount = transfer.v4vFee;
        
        console.log('[LIGHTNING TIP] Invoice verified:', invoiceSats, 'sats =', hbdCost, 'HBD');
      }
      
      console.log('[LIGHTNING TIP] Exchange rate:', fetchedRate, 'HBD per BTC');
      console.log('[LIGHTNING TIP] Fee breakdown: HBD:', hbdCost, 'Fee:', v4vFeeAmount);
      
      // Only update state if this request is still current
      if (requestIdRef.current !== currentRequestId) {
        console.log('[LIGHTNING TIP] Request ID mismatch, skipping state update (stale request)');
        console.log('[LIGHTNING TIP] Current ID:', requestIdRef.current, 'Request ID:', currentRequestId);
        return;
      }
      
      // Store invoice state INCLUDING exchange rate for consistency
      setLightningInvoiceData(invoiceData);
      setInvoiceAmountSats(invoiceSats);
      setTotalHBDCost(hbdCost);
      setV4vFee(v4vFeeAmount);
      setBtcHbdRate(fetchedRate);
      
      const description = recipientTipPreference === 'hbd'
        ? `${formatNumber(invoiceSats)} sats → ${hbdCost.toFixed(3)} HBD`
        : `${formatNumber(invoiceSats)} sats = ${hbdCost.toFixed(3)} HBD`;
      
      toast({
        title: 'Invoice Generated',
        description,
      });
      
    } catch (error) {
      console.error('[LIGHTNING TIP] Invoice generation failed:', error);
      
      // Only show errors if this request is still current
      if (requestIdRef.current !== currentRequestId) {
        console.log('[LIGHTNING TIP] Request ID mismatch in error handler, skipping error display');
        return;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setInvoiceError(errorMessage);
      
      toast({
        title: 'Invoice Generation Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      // Only clear loading state if this request is still current
      if (requestIdRef.current === currentRequestId) {
        setIsGeneratingInvoice(false);
      } else {
        console.log('[LIGHTNING TIP] Request ID mismatch in finally, keeping loading state');
      }
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
      
      // Phase 4: Send encrypted notification message
      try {
        console.log('[LIGHTNING TIP] Sending notification message to', recipientUsername);
        
        // Format tip notification message
        const notificationMessage = `Lightning Tip Received: ${formatNumber(invoiceAmountSats)} sats\n\nTransaction: https://hiveblocks.com/tx/${txId}`;
        
        // Encrypt message using Keychain
        const encryptResponse = await requestEncode(
          user.username,
          recipientUsername,
          notificationMessage,
          'Memo'
        );
        
        if (!encryptResponse.success || !encryptResponse.result) {
          throw new Error('Failed to encrypt notification message');
        }
        
        const encryptedMemo = encryptResponse.result;
        
        // Send notification as minimal HBD transfer with encrypted memo
        await requestTransfer(
          user.username,
          recipientUsername,
          '0.001', // Minimal HBD for notification
          encryptedMemo,
          'HBD'
        );
        
        console.log('[LIGHTNING TIP] Notification sent successfully');
      } catch (notifError) {
        console.error('[LIGHTNING TIP] Failed to send notification:', notifError);
        // Don't block success - notification is optional
      }
      
      // Success feedback
      toast({
        title: 'Tip Sent Successfully',
        description: `${formatNumber(invoiceAmountSats)} sats sent to @${recipientUsername}`,
      });
      
      // Close dialog
      onOpenChange(false);
      
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
            {recipientTipPreference === 'hbd' ? (
              <>
                Send a Lightning tip to @{recipientUsername}. They will receive HBD in their Hive wallet via V4V.app reverse bridge (50 sats + 0.5% fee). You must pay with Lightning.
              </>
            ) : (
              <>
                Send Bitcoin (BTC) satoshis to @{recipientUsername} via Lightning Network. 
                You can pay in HBD through v4v.app bridge (0.8% fee) or with Lightning wallet.
              </>
            )}
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

          {/* Recipient Info */}
          <div className="p-3 bg-muted/30 border rounded-md">
            <div className="flex justify-between items-center">
              <span className="text-caption text-muted-foreground">Recipient:</span>
              <span className="text-caption font-medium">@{recipientUsername}</span>
            </div>
            {recipientTipPreference === 'hbd' ? (
              <div className="flex justify-between items-center mt-1">
                <span className="text-caption text-muted-foreground">Receives as:</span>
                <span className="text-caption font-medium">💰 HBD in Hive wallet</span>
              </div>
            ) : recipientLightningAddress ? (
              <div className="flex justify-between items-center mt-1">
                <span className="text-caption text-muted-foreground">Lightning Address:</span>
                <span className="text-caption font-mono text-xs truncate max-w-[200px]">
                  {recipientLightningAddress}
                </span>
              </div>
            ) : null}
          </div>

          {/* Invoice State - Show tabs only when invoice is generated */}
          {lightningInvoiceData && btcHbdRate > 0 && totalHBDCost > 0 ? (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'v4v' | 'wallet')} className="w-full">
              <TabsList className={`grid w-full ${recipientTipPreference === 'hbd' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {recipientTipPreference === 'lightning' && (
                  <TabsTrigger value="v4v" data-testid="tab-v4v-bridge">
                    V4V.app Bridge
                  </TabsTrigger>
                )}
                <TabsTrigger value="wallet" data-testid="tab-lightning-wallet">
                  <Wallet className="w-4 h-4 mr-2" />
                  Lightning Wallet
                </TabsTrigger>
              </TabsList>
              
              {/* V4V.app Bridge Tab */}
              <TabsContent value="v4v" className="space-y-3 mt-3">
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
                
                <div className="flex gap-2">
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
                </div>
              </TabsContent>
              
              {/* Lightning Wallet Tab */}
              <TabsContent value="wallet" className="space-y-3 mt-3">
                {/* Recipient receives info for HBD preference */}
                {recipientTipPreference === 'hbd' && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                    <p className="text-caption font-medium text-green-700 dark:text-green-400">
                      Recipient will receive: {totalHBDCost.toFixed(3)} HBD in their Hive wallet
                    </p>
                    <p className="text-caption text-muted-foreground mt-1">
                      V4V.app bridge fee: 50 sats + 0.5%
                    </p>
                  </div>
                )}
                
                {/* Invoice Display */}
                <div className="space-y-2">
                  <Label className="text-caption text-muted-foreground">Lightning Invoice</Label>
                  <div className="relative">
                    <div className="p-3 bg-muted/50 border rounded-md font-mono text-xs break-all max-h-24 overflow-y-auto">
                      {lightningInvoiceData.invoice}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyInvoice}
                      className="absolute top-2 right-2 h-8"
                      data-testid="button-copy-invoice"
                    >
                      {isCopied ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {formatNumber(invoiceAmountSats)} sats
                    {recipientTipPreference === 'hbd' && ` → ${totalHBDCost.toFixed(3)} HBD`}
                  </p>
                </div>
                
                {/* QR Code */}
                {qrDataUrl && (
                  <div className="flex justify-center p-4 bg-white dark:bg-muted rounded-md">
                    <img 
                      src={qrDataUrl} 
                      alt="Lightning Invoice QR Code" 
                      className="w-64 h-64"
                      data-testid="img-qr-code"
                    />
                  </div>
                )}
                
                {/* WebLN Button */}
                {hasWebLN && (
                  <Button
                    variant="default"
                    onClick={handlePayWithWebLN}
                    disabled={isPayingWithWebLN}
                    className="w-full h-11"
                    data-testid="button-pay-webln"
                  >
                    {isPayingWithWebLN ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Wallet className="w-4 h-4 mr-2" />
                        Pay with Browser Wallet
                      </>
                    )}
                  </Button>
                )}
                
                <div className="flex gap-2">
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
                    data-testid="button-regenerate-invoice-wallet"
                  >
                    Change Amount
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex gap-2 pt-2">
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
