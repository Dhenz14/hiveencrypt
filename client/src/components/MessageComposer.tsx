import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Send, Paperclip, Smile, X, Image as ImageIcon, DollarSign, Info, CheckCircle, Lock as LockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { requestTransfer, extractTransactionId } from '@/lib/hive';
import { cacheCustomJsonMessage, cacheMessage, updateConversation, getConversationKey, addOptimisticGroupMessage, confirmGroupMessage, getGroupConversation, cacheGroupConversation, removeOptimisticGroupMessage } from '@/lib/messageCache';
import { processImageForBlockchain } from '@/lib/imageUtils';
import { encryptImagePayload, type ImagePayload } from '@/lib/customJsonEncryption';
import { broadcastImageMessage } from '@/lib/imageChunking';
import { checkSufficientRC, estimateCustomJsonRC, formatRC, getRCWarningLevel } from '@/lib/rcEstimation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { logger } from '@/lib/logger';
import { triggerFastPolling } from '@/hooks/useBlockchainMessages';
import { useRecipientMinimum } from '@/hooks/useRecipientMinimum';
import { DEFAULT_MINIMUM_HBD } from '@/lib/accountMetadata';
import { queryClient } from '@/lib/queryClient';
import { formatGroupMessageMemo } from '@/lib/groupBlockchain';

interface MessageComposerProps {
  onSend?: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  recipientUsername?: string;
  conversationId?: string;
  onMessageSent?: () => void;
  groupId?: string;
  groupMembers?: string[];
  groupCreator?: string; // Creator of the group (for metadata discovery)
}

// Memoized batch progress UI component to prevent unnecessary re-renders
const BatchProgressUI = memo(({ current, total }: { current: number; total: number }) => {
  // Memoize progress percentage calculation
  const progressPercentage = useMemo(() => {
    return total > 0 ? (current / total) * 100 : 0;
  }, [current, total]);

  if (total === 0) return null;

  return (
    <div className="space-y-2" data-testid="batch-progress-container">
      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span>Sending to {total} member{total !== 1 ? 's' : ''}...</span>
        <span>{current} / {total}</span>
      </div>
      <Progress 
        value={progressPercentage} 
        className="h-2"
        data-testid="progress-batch-send"
      />
    </div>
  );
});

BatchProgressUI.displayName = 'BatchProgressUI';

export function MessageComposer({ 
  onSend, 
  disabled, 
  placeholder = "Type a message...",
  recipientUsername,
  conversationId,
  onMessageSent,
  groupId,
  groupMembers,
  groupCreator
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [rcWarning, setRcWarning] = useState<{ level: 'critical' | 'low' | 'ok'; message: string } | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // CRITICAL: Use ref for synchronous double-click protection (state updates are async!)
  const isSendingRef = useRef(false);
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

  // Clear image state when switching to group chats (images not supported in groups)
  useEffect(() => {
    if (groupId) {
      setSelectedImage(null);
      setImagePreview(null);
      setRcWarning(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [groupId]);

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
    // CRITICAL: Use ref for synchronous double-click protection (state is async!)
    if (isSendingRef.current || !selectedImage || !user || !recipientUsername) return;
    isSendingRef.current = true;
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
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  // Handle sending to group chat (batch send to all members)
  const handleGroupSend = async () => {
    // CRITICAL: Use ref for synchronous double-click protection (state is async!)
    if (isSendingRef.current) {
      return;
    }
    
    if (!user || !groupId || !groupMembers || groupMembers.length === 0) {
      toast({
        title: 'Invalid Group',
        description: 'Group information is missing',
        variant: 'destructive',
      });
      return;
    }

    const messageText = content.trim();
    if (!messageText) return;

    // Set sending state NOW to block any further submissions (both ref and state)
    isSendingRef.current = true;
    setIsSending(true);

    // RC Validation: Check if user has sufficient RC for batch sending
    try {
      const recipientCount = groupMembers.filter(m => m !== user.username).length;
      
      if (recipientCount > 0) {
        // Estimate RC cost per transfer (rough estimate: 200M RC per transfer)
        const estimatedRCPerTransfer = 200000000;
        const totalEstimatedRC = estimatedRCPerTransfer * recipientCount;
        
        const { current, percentage } = await checkSufficientRC(user.username, totalEstimatedRC);
        const warningLevel = getRCWarningLevel(percentage);
        
        logger.info('[GROUP SEND] RC Check:', {
          recipientCount,
          estimatedRC: totalEstimatedRC,
          currentRC: current,
          percentage: percentage.toFixed(1) + '%',
          warningLevel
        });
        
        if (warningLevel === 'critical') {
          toast({
            title: 'Very Low RC',
            description: `Your RC is critically low (${percentage.toFixed(1)}%). Group sending may fail. Please wait for RC to regenerate.`,
            variant: 'destructive',
          });
          isSendingRef.current = false;
          setIsSending(false);
          return;
        } else if (warningLevel === 'low') {
          toast({
            title: 'Low RC Warning',
            description: `Your RC is low (${percentage.toFixed(1)}%). Sending to ${recipientCount} members will use approximately ${formatRC(totalEstimatedRC)} RC.`,
          });
        }
      }
    } catch (rcError) {
      logger.warn('[GROUP SEND] Could not check RC:', rcError);
      // Don't block sending if RC check fails
    }
    setBatchProgress({ current: 0, total: groupMembers.length });

    // Clear input immediately for instant feedback
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // Step 1: Generate tempId and format message with group prefix (includes creator for discovery)
      const tempId = crypto.randomUUID();
      const creator = groupCreator || user.username; // Fallback to current user if creator unknown
      const formattedMessage = formatGroupMessageMemo(groupId, creator, messageText);
      
      logger.info('[GROUP SEND] Starting batch send:', {
        groupId,
        creator,
        memberCount: groupMembers.length,
        tempId,
      });

      // Step 2: Add optimistic message to cache
      await addOptimisticGroupMessage(
        groupId,
        user.username,
        groupMembers,
        messageText,
        formattedMessage,
        tempId,
        user.username
      );

      // Step 3: Encrypt and send to each member
      const txIds: string[] = [];
      const failedRecipients: string[] = [];
      const remainingRecipients: string[] = [];
      const attemptedRecipients: string[] = []; // Track who we actually attempted to send to (RC may be consumed)
      let rcDepleted = false;
      let completedAttempts = 0; // Track actual completed attempts (success or failure)
      
      // Calculate total recipients (excluding self)
      const totalRecipients = groupMembers.filter(m => m !== user.username).length;
      
      for (let i = 0; i < groupMembers.length; i++) {
        const member = groupMembers[i];
        
        // Skip sending to yourself
        if (member === user.username) {
          logger.info('[GROUP SEND] Skipping self:', member);
          continue;
        }

        // Per-send RC validation: Check RC before EACH individual send
        try {
          const { percentage } = await checkSufficientRC(user.username, 200000000);
          
          // If RC drops below 10% during batch, stop sending
          if (percentage < 10) {
            logger.warn('[GROUP SEND] RC critically low mid-batch, stopping sends');
            rcDepleted = true;
            
            // Add remaining members to the remaining list (not attempted, no RC consumed)
            for (let j = i; j < groupMembers.length; j++) {
              if (groupMembers[j] !== user.username) {
                remainingRecipients.push(groupMembers[j]);
              }
            }
            break;
          }
          
          // If RC is between 10-30%, log warning but continue
          if (percentage < 30) {
            logger.warn('[GROUP SEND] Low RC mid-batch:', percentage.toFixed(1) + '%');
          }
        } catch (rcError) {
          logger.warn('[GROUP SEND] Could not check RC for member:', member, rcError);
          // Don't block if RC check fails
        }

        // Mark as attempted (transfer will be attempted, RC may be consumed)
        attemptedRecipients.push(member);

        try {
          // OPTIMIZED: Single Keychain popup - prepare memo with # prefix for auto-encryption
          const memoToEncrypt = `#${formattedMessage}`;
          
          logger.info('[GROUP SEND] Sending to member (auto-encrypt):', member);
          
          // Single Keychain call - Keychain auto-encrypts memos starting with #
          const transfer = await requestTransfer(
            user.username,
            member,
            DEFAULT_MINIMUM_HBD,
            memoToEncrypt, // Keychain will encrypt this automatically
            'HBD'
          );

          if (transfer.success && transfer.result) {
            const txId = extractTransactionId(transfer.result);
            txIds.push(txId);
            logger.info('[GROUP SEND] ✅ Sent to', member, '- txId:', txId);
          } else {
            // Transfer was attempted but failed (RC likely consumed)
            failedRecipients.push(member);
            logger.error('[GROUP SEND] ❌ Failed to send to', member);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // EDGE CASE FIX #1: Detect user abort/cancellation
          const isUserAbort = errorMessage.toLowerCase().includes('cancel') ||
                              errorMessage.toLowerCase().includes('denied') ||
                              errorMessage.toLowerCase().includes('abort');
          
          if (isUserAbort) {
            // User cancelled - abort entire batch and rollback
            logger.warn('[GROUP SEND] User cancelled, rolling back entire batch');
            await removeOptimisticGroupMessage(tempId, user.username);
            
            // EDGE CASE FIX #1: Use actual successful txIds count for accurate reporting
            const successfulSends = txIds.length;
            
            toast({ 
              title: 'Cancelled', 
              description: successfulSends > 0 
                ? `Group message cancelled. Successfully sent to ${successfulSends} member(s).`
                : 'Group message cancelled.',
              variant: 'default'
            });
            
            isSendingRef.current = false;
            setIsSending(false);
            setBatchProgress({ current: 0, total: 0 });
            return; // Exit immediately, don't confirm anything
          }
          
          // For non-abort errors, track as failed recipient
          failedRecipients.push(member);
          logger.error('[GROUP SEND] ❌ Error sending to', member, ':', error);
        }

        // Update progress based on actual completed attempts (not loop iteration)
        completedAttempts++;
        setBatchProgress({ current: completedAttempts, total: totalRecipients });
      }

      // Step 4: Handle results based on what was attempted
      // CRITICAL FIX: Don't rollback if any attempts were made (RC was consumed)
      // Only rollback if NO attempts were made (no RC consumed)
      if (attemptedRecipients.length === 0) {
        // NO attempts made - safe to rollback (no RC consumed)
        logger.warn('[GROUP SEND] No attempts made, rolling back optimistic message');
        await removeOptimisticGroupMessage(tempId, user.username);
        
        toast({
          title: 'Send Failed',
          description: 'No transfers were attempted. Message not saved.',
          variant: 'destructive',
        });
        
        return;
      }

      // Step 5: Confirm the group message with results
      // This handles all cases where attempts were made:
      // - All succeeded (txIds.length === attemptedRecipients.length, failedRecipients.length === 0)
      // - Some failed (txIds.length > 0, failedRecipients.length > 0)
      // - All failed (txIds.length === 0, failedRecipients.length === attemptedRecipients.length)
      await confirmGroupMessage(tempId, txIds, failedRecipients, user.username);

      // Step 6: Update group conversation cache with last message
      const timestamp = new Date().toISOString();
      const groupConv = await getGroupConversation(groupId, user.username);
      if (groupConv) {
        groupConv.lastMessage = messageText;
        groupConv.lastTimestamp = timestamp;
        await cacheGroupConversation(groupConv, user.username);
        logger.info('[GROUP SEND] Updated group conversation cache');
      }

      // Step 7: Show appropriate toast based on results
      if (rcDepleted && remainingRecipients.length > 0) {
        // RC depleted mid-batch
        toast({
          title: 'RC Depleted',
          description: `Sent to ${txIds.length} of ${txIds.length + remainingRecipients.length} members. Remaining: ${remainingRecipients.join(', ')}`,
          variant: 'destructive',
        });
      } else if (failedRecipients.length === 0) {
        // Full success
        const { percentage } = await checkSufficientRC(user.username, 0).catch(() => ({ percentage: 100 }));
        
        if (percentage < 30) {
          toast({
            title: 'Group Message Sent',
            description: `Successfully sent to ${txIds.length} member${txIds.length !== 1 ? 's' : ''}. RC now at ${percentage.toFixed(1)}%`,
          });
        } else {
          toast({
            title: 'Group Message Sent',
            description: `Successfully sent to ${txIds.length} member${txIds.length !== 1 ? 's' : ''}`,
          });
        }
      } else {
        // Partial failure
        toast({
          title: 'Partial Send',
          description: `Sent to ${txIds.length} member${txIds.length !== 1 ? 's' : ''}, failed: ${failedRecipients.join(', ')}`,
          variant: 'destructive',
        });
      }

      // Step 8: Invalidate group caches with correct query keys
      queryClient.invalidateQueries({
        queryKey: ['blockchain-group-messages', user.username, groupId],
      });
      queryClient.invalidateQueries({
        queryKey: ['blockchain-group-conversations', user.username],
      });

      // Trigger fast polling
      triggerFastPolling();

      // Notify parent
      if (onMessageSent) {
        onMessageSent();
      }

    } catch (error: any) {
      logger.error('[GROUP SEND] Unexpected error:', error);
      toast({
        title: 'Group Send Failed',
        description: error?.message || 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      setBatchProgress({ current: 0, total: 0 });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // CRITICAL: Use ref for synchronous double-click protection (state is async!)
    if (isSendingRef.current) {
      return;
    }
    
    // If image is selected AND not in a group, send as image message
    // (images are not supported in groups, so ignore residual image state)
    if (selectedImage && !groupId) {
      return handleImageSend();
    }
    
    if (!content.trim() || disabled) {
      return;
    }

    // Route to group send if groupId is provided
    if (groupId) {
      return handleGroupSend();
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
    
    // Set sending state NOW to block any further submissions (both ref and state)
    isSendingRef.current = true;
    setIsSending(true);

    // v2.0.0: Step 1: Block sends until recipient minimum is verified (prevent race condition + network bypass)
    if (isLoadingMinimum) {
      toast({
        title: 'Loading Recipient Preferences',
        description: 'Please wait while we check the recipient\'s minimum requirement...',
      });
      isSendingRef.current = false;
      setIsSending(false);
      return;
    }
    
    if (!hasVerifiedMinimum) {
      toast({
        title: 'Cannot Verify Minimum',
        description: 'Failed to fetch recipient\'s minimum requirement. Please check your connection and try again.',
        variant: 'destructive',
      });
      isSendingRef.current = false;
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
      isSendingRef.current = false;
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
      isSendingRef.current = false;
      setIsSending(false);
      return;
    }
    
    // v2.1.0: Allow sending at DEFAULT_MINIMUM_HBD (0.001) even if below recipient's minimum
    // This assumes the sender is exempted by the recipient (stored in recipient's localStorage)
    // Use precise integer thousandths comparison to avoid floating-point precision issues
    const thousandthsRaw = numericSendAmount * 1000;
    const thousandthsRounded = Math.round(thousandthsRaw);
    const isValidPrecision = Math.abs(thousandthsRaw - thousandthsRounded) < 1e-9;
    const isDefaultAmount = isValidPrecision && thousandthsRounded === 1;
    
    if (numericSendAmount < numericMinimum && !isDefaultAmount) {
      toast({
        title: 'Amount Below Minimum',
        description: `@${recipientUsername} requires at least ${effectiveRecipientMinimum} HBD. Your amount: ${sendAmount} HBD`,
        variant: 'destructive',
      });
      isSendingRef.current = false;
      setIsSending(false);
      return;
    }

    // Clear the input immediately for instant feedback
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // OPTIMIZED: Single Keychain popup - encryption + transfer combined
      // Prepare memo with # prefix for auto-encryption by Keychain
      const memoToEncrypt = `#${messageText}`;
      
      console.log('[SEND] Broadcasting encrypted transfer to blockchain...', {
        from: user.username,
        to: recipientUsername,
        amount: sendAmount + ' HBD'
      });
      
      logger.info('[MessageComposer] Single-step send (# prefix auto-encrypts):', {
        from: user.username,
        to: recipientUsername,
        amount: sendAmount
      });
      
      // Single Keychain call - Keychain auto-encrypts memos starting with #
      let txId: string | undefined;
      try {
        const transfer = await requestTransfer(
          user.username,
          recipientUsername,
          sendAmount, // v2.0.0: Use custom amount instead of hardcoded 0.001
          memoToEncrypt, // Keychain will encrypt this automatically
          'HBD'
        );
        
        console.log('[SEND] Transfer response received:', {
          success: transfer.success,
          hasTxId: !!transfer.result
        });
        
        logger.info('[MessageComposer] Transfer response:', {
          success: transfer.success,
          message: transfer.message,
          error: transfer.error
        });
        
        if (!transfer.success) {
          throw new Error(transfer.message || 'Transfer failed');
        }
        
        txId = extractTransactionId(transfer.result);
        console.log('[SEND] ✅ Message sent successfully! TxID:', txId);
        
        // OPTIMISTIC UPDATE: Cache sent message locally for instant display
        if (txId) {
          try {
            const conversationKey = getConversationKey(user.username, recipientUsername);
            const timestamp = new Date().toISOString();
            
            // Create optimistic message cache
            // Note: Keychain encrypted the memo automatically (# prefix), so we store the # prefix
            await cacheMessage({
              id: txId,
              conversationKey,
              from: user.username,
              to: recipientUsername,
              content: messageText, // Store decrypted text for immediate display
              encryptedContent: memoToEncrypt, // Store with # prefix (Keychain auto-encrypted)
              timestamp,
              txId,
              confirmed: false, // Not yet confirmed on blockchain
              isDecrypted: true, // We know the content (we just sent it)
              amount: `${sendAmount} HBD`,
            }, user.username);
            
            // Update conversation cache (safe field merging to preserve lastChecked)
            const { getConversation: getConv } = await import('@/lib/messageCache');
            const existingConv = await getConv(user.username, recipientUsername);
            
            // Build conversation update - ONLY touch lastMessage and lastTimestamp
            // Preserve all other fields (especially lastChecked and unreadCount) from existing conversation
            const conversationUpdate = existingConv ? {
              // Existing conversation: spread all existing fields first (preserves lastChecked, unreadCount)
              ...existingConv,
              // Then override only the fields we want to update
              lastMessage: messageText,
              lastTimestamp: timestamp,
            } : {
              // New conversation: set all required fields
              conversationKey,
              partnerUsername: recipientUsername,
              lastMessage: messageText,
              lastTimestamp: timestamp,
              unreadCount: 0,
              lastChecked: timestamp, // First message = "seen" at send time
            };
            
            await updateConversation(conversationUpdate, user.username);
            
            // Invalidate React Query caches to trigger re-render
            queryClient.invalidateQueries({ 
              queryKey: ['blockchain-messages', user.username, recipientUsername] 
            });
            queryClient.invalidateQueries({ 
              queryKey: ['blockchain-conversations', user.username] 
            });
            
            logger.info('[SEND] ✅ Optimistically cached sent message:', txId.substring(0, 16));
          } catch (cacheError) {
            // Don't fail the send if caching fails - polling will pick it up
            logger.error('[SEND] Failed to cache optimistic message:', {
              error: cacheError instanceof Error ? cacheError.message : String(cacheError),
              stack: cacheError instanceof Error ? cacheError.stack : undefined
            });
          }
        }
      } catch (transferError: any) {
        console.error('[SEND] ❌ Blockchain transfer failed:', transferError);
        logger.error('[MessageComposer] Transfer error caught:', transferError);
        
        const errorMessage = transferError?.message || String(transferError);
        
        // Check for extension context invalidation (Bug #3 fix)
        if (errorMessage.includes('Extension context invalidated') || 
            errorMessage.includes('context invalidated')) {
          toast({
            title: 'Keychain Extension Reloaded',
            description: 'Please refresh the page and try again. (Keychain extension was updated/reloaded)',
            variant: 'destructive',
            duration: 10000, // Show longer for user to read
          });
          isSendingRef.current = false;
          setIsSending(false);
          return;
        }
        
        // Handle specific error cases
        if (transferError?.error?.includes('cancel') || errorMessage.includes('cancel')) {
          toast({
            title: 'Transfer Cancelled',
            description: 'You cancelled the blockchain transfer',
            variant: 'destructive',
          });
        } else if (errorMessage.includes('RC') || errorMessage.includes('resource')) {
          toast({
            title: 'Insufficient RC',
            description: 'You do not have enough Resource Credits. Please wait and try again later.',
            variant: 'destructive',
          });
        } else if (errorMessage.includes('balance') || errorMessage.includes('funds')) {
          toast({
            title: 'Insufficient Balance',
            description: 'You need at least 0.001 HBD to send a message',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Transfer Failed',
            description: errorMessage || 'Failed to broadcast message to blockchain',
            variant: 'destructive',
          });
        }
        isSendingRef.current = false;
        setIsSending(false);
        return;
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
      isSendingRef.current = false;
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
              className="absolute -top-2 -right-2 min-h-11 min-w-11 rounded-full"
              onClick={handleRemoveImage}
              data-testid="button-remove-image"
            >
              <X className="w-4 h-4" />
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

        {/* Batch Send Progress UI - Memoized to prevent lag */}
        <BatchProgressUI current={batchProgress.current} total={batchProgress.total} />

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
                className="max-w-32 h-11 text-base"
                data-testid="input-send-amount"
              />
              <span className="text-caption text-muted-foreground">HBD</span>
            </div>
            
            {/* v2.1.0: Show exemption indicator when sending at default amount below recipient's minimum */}
            {!isLoadingMinimum && recipientMinimum && parseFloat(sendAmount) < parseFloat(recipientMinimum) && (
              <>
                {parseFloat(sendAmount) === parseFloat(DEFAULT_MINIMUM_HBD) ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md" data-testid="alert-exemption-indicator">
                    <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-caption text-green-700 dark:text-green-300">
                      {sendAmount} HBD - You may be exempted from their {recipientMinimum} HBD minimum!
                    </span>
                  </div>
                ) : (
                  <Alert variant="destructive" data-testid="alert-amount-warning">
                    <Info className="w-4 h-4" />
                    <AlertDescription>
                      @{recipientUsername} requires minimum {recipientMinimum} HBD per message
                    </AlertDescription>
                  </Alert>
                )}
              </>
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
                className="min-h-11 min-w-11"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="min-h-11 min-w-11"
                    disabled={disabled || isSending || !!groupId}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-attach"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                {groupId && (
                  <TooltipContent>
                    <p>Image sending in groups coming soon</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 flex-shrink-0"
            disabled={(!content.trim() && !selectedImage) || disabled || isSending || (!!recipientUsername && (isLoadingMinimum || !hasVerifiedMinimum))}
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
