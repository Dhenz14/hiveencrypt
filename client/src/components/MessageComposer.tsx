import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { isKeychainInstalled, requestEncode, requestTransfer } from '@/lib/hive';
import { addOptimisticMessage, confirmMessage } from '@/lib/messageCache';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
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

    // Check if Hive Keychain is installed
    if (!isKeychainInstalled()) {
      toast({
        title: 'Keychain Not Available',
        description: 'Please install Hive Keychain extension to send encrypted messages',
        variant: 'destructive',
      });
      return;
    }

    const messageText = content.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    setIsSending(true);

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
      console.error('Failed to add optimistic message:', optimisticError);
    }

    try {
      // Step 1: Encrypt message using Hive Keychain
      let encryptedMemo: string;
      try {
        const encoded = await requestEncode(
          user.username,
          recipientUsername,
          messageText,
          'Memo'
        );
        
        if (!encoded.success || !encoded.result) {
          throw new Error('Failed to encrypt message');
        }
        
        // Keychain's requestEncodeMessage returns the encrypted content WITHOUT the '#' prefix
        // We need to add it for the Hive blockchain to recognize it as encrypted
        encryptedMemo = encoded.result;
        
        console.log('[MessageComposer] Raw encrypted result:', {
          hasPrefix: encryptedMemo.startsWith('#'),
          length: encryptedMemo.length,
          preview: encryptedMemo.substring(0, 30) + '...'
        });
        
        // Ensure the memo starts with '#' (required for encrypted memos)
        if (!encryptedMemo.startsWith('#')) {
          encryptedMemo = `#${encryptedMemo}`;
          console.log('[MessageComposer] Added # prefix to memo');
        }
      } catch (encryptError: any) {
        console.error('Encryption error:', encryptError);
        
        if (encryptError?.error?.includes('cancel') || encryptError?.message?.includes('cancel')) {
          toast({
            title: 'Encryption Cancelled',
            description: 'Message encryption was cancelled',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Failed to Encrypt',
            description: encryptError?.message || 'Could not encrypt the message. Please try again.',
            variant: 'destructive',
          });
        }
        setIsSending(false);
        return;
      }

      // Step 2: Create 0.001 HBD transfer with encrypted memo
      // NOTE: Keychain may show "private key" warning - this is a FALSE POSITIVE
      // The memo contains encrypted data which triggers Keychain's pattern detection
      // We are NOT sending any private keys - only the encrypted message
      let txId: string | undefined;
      try {
        console.log('[MessageComposer] Calling requestTransfer with memo:', {
          hasPrefix: encryptedMemo.startsWith('#'),
          memoPreview: encryptedMemo.substring(0, 30) + '...'
        });
        
        const transfer = await requestTransfer(
          user.username,
          recipientUsername,
          '0.001',
          encryptedMemo,
          'HBD'
        );
        
        console.log('[MessageComposer] Transfer response:', {
          success: transfer.success,
          message: transfer.message,
          error: transfer.error
        });
        
        if (!transfer.success) {
          throw new Error(transfer.message || 'Transfer failed');
        }
        
        txId = transfer.result;
      } catch (transferError: any) {
        console.error('[MessageComposer] Transfer error caught:', transferError);
        
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
      try {
        await confirmMessage(tempId, txId || '', encryptedMemo, user.username);

        toast({
          title: 'Message Sent',
          description: 'Your encrypted message has been sent on the blockchain',
        });

        // Refresh to show confirmed status
        if (onMessageSent) {
          onMessageSent();
        }
      } catch (confirmError: any) {
        console.error('Failed to confirm message:', confirmError);
        
        toast({
          title: 'Confirmation Failed',
          description: 'Message was sent but failed to update confirmation status',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Unexpected error:', error);
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
    <div className="border-t bg-background p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
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
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={disabled}
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
            disabled={!content.trim() || disabled || isSending}
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
