import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Smile, X, Image as ImageIcon, DollarSign, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { requestTransfer } from '@/lib/hive';
import { requestKeychainEncryption } from '@/lib/encryption';
import { addOptimisticMessage, confirmMessage, cacheCustomJsonMessage } from '@/lib/messageCache';
import { processImageForBlockchain } from '@/lib/imageUtils';
import { encryptImagePayload, type ImagePayload } from '@/lib/customJsonEncryption';
import { broadcastImageMessage } from '@/lib/imageChunking';
import { checkSufficientRC, estimateCustomJsonRC, formatRC, getRCWarningLevel } from '@/lib/rcEstimation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { logger } from '@/lib/logger';
import { triggerFastPolling } from '@/hooks/useBlockchainMessages';
import { useRecipientMinimum } from '@/hooks/useRecipientMinimum';
import { DEFAULT_MINIMUM_HBD } from '@/lib/accountMetadata';

interface MessageComposerProps {
  onSend?: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  recipientUsername?: string;
  conversationId?: string;
  onMessageSent?: () => void;
}

export function MessageComposer({ 
  onSend, 
  disabled, 
  placeholder = "Type a message...",
  recipientUsername,
  conversationId,
  onMessageSent
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [rcWarning, setRcWarning] = useState<{ level: 'critical' | 'low' | 'ok'; message: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  
  // v2.0.0: Fetch recipient's minimum HBD requirement
  const { 
    recipientMinimum, 
    isLoading: isLoadingMinimum,
    hasVerifiedMinimum,
    isError: isErrorMinimum,
  } = useRecipientMinimum(recipientUsername);
  
  // v2.0.0: Send amount state (initialize with safe default to avoid NaN)
  const [sendAmount, setSendAmount] = useState(DEFAULT_MINIMUM_HBD);
  
  // Update send amount when recipient minimum changes (after loading)
  useEffect(() => {
    if (!isLoadingMinimum && recipientMinimum) {
      setSendAmount(recipientMinimum);
    }
  }, [recipientMinimum, isLoadingMinimum]);

  // Handle image selection
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 5MB before compression)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast({
        title: 'File Too Large',
        description: 'Please select an image smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }

    setSelectedImage(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Estimate RC cost for image
    if (user) {
      try {
        // Rough estimate: assume 70% compression
        const estimatedSize = Math.floor(file.size * 0.3);
        const chunks = Math.ceil(estimatedSize / 7000);
        const estimatedRC = estimateCustomJsonRC(estimatedSize, chunks);
        
        const { current, percentage } = await checkSufficientRC(user.username, estimatedRC);
        const warningLevel = getRCWarningLevel(percentage);
        
        if (warningLevel === 'critical') {
          setRcWarning({
            level: 'critical',
            message: `Very low RC (${percentage.toFixed(1)}%). Image sending may fail.`
          });
        } else if (warningLevel === 'low') {
          setRcWarning({
            level: 'low',
            message: `Low RC (${percentage.toFixed(1)}%). Estimated cost: ${formatRC(estimatedRC)}`
          });
        } else {
          // Clear warning if RC is sufficient
          setRcWarning(null);
        }
      } catch (error) {
        logger.warn('[RC] Could not estimate RC cost:', error);
      }
    }
  };

  // Remove selected image
  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setRcWarning(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle sending image message
  const handleImageSend = async () => {
    if (!selectedImage || !user || !recipientUsername) return;

    setIsSending(true);

    try {
      // Step 1: Process image (WebP + Gzip + Base64)
      const processingToast = toast({
        title: '🔄 Compressing Image...',
        description: 'Step 1/4: WebP conversion & gzip compression',
        duration: 60000, // Keep visible during processing
      });

      const processedImage = await processImageForBlockchain(selectedImage);
      
      // Show compression results
      toast({
        title: '✅ Compression Complete!',
        description: `Reduced to ${processedImage.compressionStats.totalSavings}% smaller (${processedImage.compressionStats.base64Size} bytes)`,
        duration: 3000,
      });
      
      logger.info('[IMAGE] Processed with compression stats:', processedImage.compressionStats);

      // Step 2: Create payload
      const payload: ImagePayload = {
        imageData: processedImage.base64,
        message: content.trim() || undefined,
        filename: selectedImage.name,
        contentType: processedImage.contentType,
        from: user.username,
        to: recipientUsername,
        timestamp: Date.now()
      };

      // Step 3: Encrypt and hash
      toast({
        title: '🔐 Encrypting...',
        description: 'Step 2/4: Securing with end-to-end encryption',
        duration: 60000,
      });

      const { encrypted, hash } = await encryptImagePayload(payload, user.username);
      logger.sensitive('[IMAGE] Encrypted size:', encrypted.length, 'hash:', hash.substring(0, 16));

      // Step 4: Broadcast to blockchain
      toast({
        title: '📡 Broadcasting...',
        description: 'Step 3/4: Sending to Hive blockchain',
        duration: 60000,
      });

      const txId = await broadcastImageMessage(user.username, encrypted, hash);
      logger.info('[IMAGE] Broadcast success, txId:', txId);

      // Step 5: Cache locally with UNCOMPRESSED base64 for display
      const conversationKey = [user.username, recipientUsername].sort().join('-');
      await cacheCustomJsonMessage({
        txId,
        conversationKey,
        from: user.username,
        to: recipientUsername,
        imageData: processedImage.base64Uncompressed, // Use uncompressed for display
        message: content.trim() || undefined,
        filename: selectedImage.name,
        contentType: processedImage.contentType,
        timestamp: new Date().toISOString(),
        encryptedPayload: encrypted,
        hash,
        isDecrypted: true,
        confirmed: true
      }, user.username);

      // Success!
      toast({
        title: '🎉 Image Sent!',
        description: `Step 4/4: Complete! Saved ${processedImage.compressionStats.totalSavings}% with compression`,
      });

      // Clear state
      setContent('');
      handleRemoveImage();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // Trigger fast polling for 15 seconds to show sent message instantly
      triggerFastPolling();

      // Notify parent
      if (onMessageSent) {
        onMessageSent();
      }

    } catch (error: any) {
      logger.error('[IMAGE] Send failed:', error);
      toast({
        title: 'Image Send Failed',
        description: error?.message || 'Could not send image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // If image is selected, send as image message
    if (selectedImage) {
      return handleImageSend();
    }
    
    if (!content.trim() || disabled || isSending) {
      return;
    }

    // If no conversationId or recipientUsername, fall back to legacy onSend
    if (!conversationId || !recipientUsername) {
      if (onSend) {
        onSend(content.trim());
        setContent('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
      return;
    }

    // Check if user is authenticated
    if (!user) {
      toast({
        title: 'Not Authenticated',
        description: 'Please log in to send messages',
        variant: 'destructive',
      });
      return;
    }

    const messageText = content.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    setIsSending(true);

    // v2.0.0: Step 1: Block sends until recipient minimum is verified (prevent race condition + network bypass)
    if (isLoadingMinimum) {
      toast({
        title: 'Loading Recipient Preferences',
        description: 'Please wait while we check the recipient\'s minimum requirement...',
      });
      setIsSending(false);
      return;
    }
    
    if (!hasVerifiedMinimum) {
      toast({
        title: 'Cannot Verify Minimum',
        description: 'Failed to fetch recipient\'s minimum requirement. Please check your connection and try again.',
        variant: 'destructive',
      });
      setIsSending(false);
      return;
    }
    
    // v2.0.0: Step 2: Validate send amount BEFORE encryption (prevent wasted Keychain prompts)
    // Guard against undefined recipientMinimum (error or disabled query)
    const effectiveRecipientMinimum = recipientMinimum || DEFAULT_MINIMUM_HBD;
    const numericSendAmount = parseFloat(sendAmount);
    const numericMinimum = parseFloat(effectiveRecipientMinimum);
    
    if (isNaN(numericSendAmount) || numericSendAmount < 0.001) {
      toast({
        title: 'Invalid Amount',
        description: 'Send amount must be at least 0.001 HBD',
        variant: 'destructive',
      });
      setIsSending(false);
      return;
    }
    
    if (isNaN(numericMinimum)) {
      // Should never happen due to DEFAULT fallback, but guard anyway
      logger.error('[MessageComposer] Invalid recipient minimum:', recipientMinimum);
      toast({
        title: 'Validation Error',
        description: 'Could not determine recipient minimum. Please try again.',
        variant: 'destructive',
      });
      setIsSending(false);
      return;
    }
    
    if (numericSendAmount < numericMinimum) {
      toast({
        title: 'Amount Below Minimum',
        description: `@${recipientUsername} requires at least ${effectiveRecipientMinimum} HBD. Your amount: ${sendAmount} HBD`,
        variant: 'destructive',
      });
      setIsSending(false);
      return;
    }

    // Optimistic Update: Add message to IndexedDB immediately
    // Note: We store the plaintext for sent messages since we can decrypt them later
    try {
      await addOptimisticMessage(
        user.username,
        recipientUsername,
        messageText, // Store plaintext initially (will be encrypted on blockchain)
        '', // Will be filled with encrypted content after encryption
        tempId
      );

      // Clear the input immediately for instant feedback
      setContent('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // Notify parent to refresh UI
      if (onMessageSent) {
        onMessageSent();
      }
      if (onSend) {
        onSend(messageText);
      }
    } catch (optimisticError) {
      logger.error('Failed to add optimistic message:', optimisticError);
    }

    try {
      // Step 2: Encrypt message using Hive Keychain
      let encryptedMemo: string;
      try {
        // Use the recommended requestKeychainEncryption from encryption.ts
        // Works on desktop Keychain extension AND Keychain Mobile browser
        encryptedMemo = await requestKeychainEncryption(
          messageText,
          user.username,
          recipientUsername
        );
        
        logger.sensitive('[MessageComposer] ✅ Successfully encrypted memo:', {
          hasPrefix: encryptedMemo.startsWith('#'),
          length: encryptedMemo.length,
          preview: encryptedMemo.substring(0, 30) + '...'
        });
      } catch (encryptError: any) {
        logger.error('[MessageComposer] ❌ Encryption error:', encryptError);
        
        const errorMessage = encryptError?.message || String(encryptError);
        
        if (errorMessage.includes('cancel')) {
          toast({
            title: 'Encryption Cancelled',
            description: 'Message encryption was cancelled',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Failed to Encrypt',
            description: errorMessage || 'Could not encrypt the message. Please try again.',
            variant: 'destructive',
          });
        }
        setIsSending(false);
        return;
      }

      // Step 3: Create HBD transfer with encrypted memo
      // NOTE: Keychain may show "private key" warning - this is a FALSE POSITIVE
      // The memo contains encrypted data which triggers Keychain's pattern detection
      // We are NOT sending any private keys - only the encrypted message
      let txId: string | undefined;
      try {
        logger.sensitive('[MessageComposer] Calling requestTransfer with memo:', {
          hasPrefix: encryptedMemo.startsWith('#'),
          memoPreview: encryptedMemo.substring(0, 30) + '...'
        });
        
        const transfer = await requestTransfer(
          user.username,
          recipientUsername,
          sendAmount, // v2.0.0: Use custom amount instead of hardcoded 0.001
          encryptedMemo,
          'HBD'
        );
        
        logger.info('[MessageComposer] Transfer response:', {
          success: transfer.success,
          message: transfer.message,
          error: transfer.error
        });
        
        if (!transfer.success) {
          throw new Error(transfer.message || 'Transfer failed');
        }
        
        txId = transfer.result;
      } catch (transferError: any) {
        logger.error('[MessageComposer] Transfer error caught:', transferError);
        
        // Handle specific error cases
        if (transferError?.error?.includes('cancel') || transferError?.message?.includes('cancel')) {
          toast({
            title: 'Transfer Cancelled',
            description: 'You cancelled the blockchain transfer',
            variant: 'destructive',
          });
        } else if (transferError?.message?.includes('RC') || transferError?.message?.includes('resource')) {
          toast({
            title: 'Insufficient RC',
            description: 'You do not have enough Resource Credits. Please wait and try again later.',
            variant: 'destructive',
          });
        } else if (transferError?.message?.includes('balance') || transferError?.message?.includes('funds')) {
          toast({
            title: 'Insufficient Balance',
            description: 'You need at least 0.001 HBD to send a message',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Transfer Failed',
            description: transferError?.message || 'Failed to broadcast message to blockchain',
            variant: 'destructive',
          });
        }
        setIsSending(false);
        return;
      }

      // Step 3: Confirm message in IndexedDB with real txId and encrypted content
      // Also immediately update the UI
      try {
        await confirmMessage(tempId, txId || '', encryptedMemo, user.username);
      } catch (confirmError: any) {
        logger.error('Failed to confirm message in IndexedDB:', confirmError);
        // Don't show error to user - message was sent successfully
        // The next sync will pick it up from the blockchain
      }

      // Show success message
      toast({
        title: 'Message Sent',
        description: 'Your encrypted message has been sent on the blockchain',
      });

      // Trigger fast polling for 15 seconds to show sent message instantly
      triggerFastPolling();

      // Immediately refresh the UI to show the sent message
      if (onMessageSent) {
        onMessageSent();
      }
    } catch (error: any) {
      logger.error('Unexpected error:', error);
      toast({
        title: 'Error',
        description: error?.message || 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 5 * 24;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [content]);

  return (
    <div className="sticky bottom-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="p-4 space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
        {/* Image Preview */}
        {imagePreview && (
          <div className="relative inline-block">
            <img 
              src={imagePreview} 
              alt="Preview" 
              className="max-h-40 rounded-lg border"
              data-testid="img-preview"
            />
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
              onClick={handleRemoveImage}
              data-testid="button-remove-image"
            >
              <X className="w-3 h-3" />
            </Button>
            {selectedImage && (
              <div className="text-caption text-muted-foreground mt-1">
                {selectedImage.name} ({Math.round(selectedImage.size / 1024)}KB)
              </div>
            )}
          </div>
        )}

        {/* RC Warning */}
        {rcWarning && rcWarning.level !== 'ok' && (
          <Alert variant={rcWarning.level === 'critical' ? 'destructive' : 'default'} data-testid="alert-rc-warning">
            <AlertDescription>{rcWarning.message}</AlertDescription>
          </Alert>
        )}

        {/* v2.0.0: Send Amount Input & Recipient Minimum */}
        {recipientUsername && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span className="text-caption text-muted-foreground">
                Send Amount:
              </span>
              <Input
                type="number"
                step="0.001"
                min="0.001"
                max="1000000.000"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                disabled={disabled || isSending || isLoadingMinimum}
                className="max-w-32 h-8 text-sm"
                data-testid="input-send-amount"
              />
              <span className="text-caption text-muted-foreground">HBD</span>
            </div>
            
            {/* Show recipient minimum info - guard against undefined */}
            {!isLoadingMinimum && recipientMinimum && parseFloat(sendAmount) < parseFloat(recipientMinimum) && (
              <Alert variant="destructive" data-testid="alert-amount-warning">
                <Info className="w-4 h-4" />
                <AlertDescription>
                  @{recipientUsername} requires minimum {recipientMinimum} HBD per message
                </AlertDescription>
              </Alert>
            )}
            
            {!isLoadingMinimum && recipientMinimum && recipientMinimum !== DEFAULT_MINIMUM_HBD && parseFloat(sendAmount) >= parseFloat(recipientMinimum) && (
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <Info className="w-3 h-3" />
                <span>@{recipientUsername}'s minimum: {recipientMinimum} HBD</span>
              </div>
            )}
            
            {isLoadingMinimum && (
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <Info className="w-3 h-3" />
                <span>Checking recipient's minimum...</span>
              </div>
            )}
            
            {isErrorMinimum && !isLoadingMinimum && (
              <Alert variant="destructive" data-testid="alert-minimum-error">
                <Info className="w-4 h-4" />
                <AlertDescription>
                  Could not verify recipient's minimum requirement. Sending disabled.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedImage ? "Add a message (optional)..." : placeholder}
              disabled={disabled}
              className="resize-none min-h-[44px] max-h-[120px] pr-20"
              rows={1}
              data-testid="input-message-content"
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={disabled}
                data-testid="button-emoji"
              >
                <Smile className="w-4 h-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
                data-testid="input-file"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={disabled || isSending}
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-attach"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 flex-shrink-0"
            disabled={(!content.trim() && !selectedImage) || disabled || isSending || isLoadingMinimum || !hasVerifiedMinimum}
            data-testid="button-send"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <Lock className="w-3 h-3" />
          <span>Messages are end-to-end encrypted</span>
        </div>
        </form>
      </div>
    </div>
  );
}

function Lock({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
