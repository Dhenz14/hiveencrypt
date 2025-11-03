import { useState } from 'react';
import { Lock, Check, CheckCheck, Clock, Unlock, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@shared/schema';
import { useAuth } from '@/contexts/AuthContext';
import { decryptMemo, setMemoKey } from '@/lib/hive';
import { updateMessageContent } from '@/lib/messageCache';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
  showAvatar?: boolean;
  showTimestamp?: boolean;
}

export function MessageBubble({ message, isSent, showAvatar, showTimestamp }: MessageBubbleProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showMemoKeyDialog, setShowMemoKeyDialog] = useState(false);
  const [memoKeyInput, setMemoKeyInput] = useState('');
  const [pendingDecrypt, setPendingDecrypt] = useState<{username: string, encryptedMemo: string, sender: string} | null>(null);

  const isEncryptedPlaceholder = 
    message.content === '[🔒 Encrypted - Click to decrypt]' ||
    message.content.includes('[Encrypted');

  const handleDecrypt = async () => {
    if (!user || !message.encryptedMemo) {
      console.error('[MessageBubble] Cannot decrypt: missing user or encryptedMemo');
      return;
    }

    console.log('[MessageBubble] ========== DECRYPT BUTTON CLICKED ==========');
    console.log('[MessageBubble] Message details:', {
      id: message.id,
      sender: message.sender,
      recipient: message.recipient,
      encryptedMemoPreview: message.encryptedMemo?.substring(0, 40) + '...',
      encryptedMemoLength: message.encryptedMemo?.length,
      currentUser: user.username
    });

    setIsDecrypting(true);
    
    try {
      console.log('[MessageBubble] Calling decryptMemo with:', {
        username: user.username,
        encryptedMemo: message.encryptedMemo,
        sender: message.sender
      });

      const decrypted = await decryptMemo(
        user.username, 
        message.encryptedMemo,
        message.sender
      );
      console.log('[MessageBubble] decryptMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);

      if (decrypted) {
        const cleanContent = decrypted.startsWith('#') ? decrypted.substring(1) : decrypted;
        
        console.log('[DECRYPT] Updating cache with decrypted content, length:', cleanContent.length);
        await updateMessageContent(message.id, cleanContent);
        console.log('[DECRYPT] Cache updated successfully');
        
        // Get partner username from message
        const partnerUsername = message.sender === user.username ? message.recipient : message.sender;
        
        console.log('[DECRYPT] Invalidating query for:', { username: user.username, partner: partnerUsername });
        
        // Invalidate with the complete query key including partnerUsername
        queryClient.invalidateQueries({ 
          queryKey: ['blockchain-messages', user.username, partnerUsername] 
        });
        
        console.log('[DECRYPT] Query invalidated, UI should refresh');

        toast({
          title: 'Message Decrypted',
          description: 'Message content is now visible',
        });
      } else {
        throw new Error('Decryption returned null');
      }
    } catch (error: any) {
      console.error('Decryption error:', error);
      
      // If memo key is required, show dialog
      if (error?.message === 'MEMO_KEY_REQUIRED') {
        setPendingDecrypt({
          username: user.username,
          encryptedMemo: message.encryptedMemo,
          sender: message.sender
        });
        setShowMemoKeyDialog(true);
        setIsDecrypting(false);
        return;
      }
      
      let errorMessage = 'Failed to decrypt message';
      if (error?.message?.includes('cancel')) {
        errorMessage = 'Decryption cancelled';
      } else if (error?.message?.includes('Invalid memo key')) {
        errorMessage = 'Invalid memo key. Please check and try again.';
      } else {
        errorMessage = error?.message || 'Failed to decrypt message';
      }
      
      toast({
        title: 'Decryption Failed',
        description: errorMessage,
        variant: 'destructive',
      });
      setIsDecrypting(false);
    }
  };

  const handleMemoKeySubmit = async () => {
    if (!memoKeyInput.trim() || !pendingDecrypt) {
      toast({
        title: 'Invalid Input',
        description: 'Please enter your private memo key',
        variant: 'destructive',
      });
      return;
    }

    // Store memo key in memory
    setMemoKey(memoKeyInput.trim());
    setShowMemoKeyDialog(false);
    setMemoKeyInput('');
    setIsDecrypting(true);

    try {
      const decrypted = await decryptMemo(
        pendingDecrypt.username,
        pendingDecrypt.encryptedMemo,
        pendingDecrypt.sender
      );

      if (decrypted) {
        const cleanContent = decrypted.startsWith('#') ? decrypted.substring(1) : decrypted;
        
        await updateMessageContent(message.id, cleanContent);
        
        const partnerUsername = message.sender === user!.username ? message.recipient : message.sender;
        
        queryClient.invalidateQueries({ 
          queryKey: ['blockchain-messages', user!.username, partnerUsername] 
        });

        toast({
          title: 'Message Decrypted',
          description: 'Message content is now visible. Your memo key is saved for this session.',
        });
      }
    } catch (error: any) {
      let errorMessage = error?.message || 'Failed to decrypt message';
      toast({
        title: 'Decryption Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setPendingDecrypt(null);
      setIsDecrypting(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getStatusIcon = () => {
    switch (message.status) {
      case 'sending':
        return <Clock className="w-3 h-3" />;
      case 'sent':
        return <Check className="w-3 h-3" />;
      case 'confirmed':
        return <CheckCheck className="w-3 h-3" />;
      case 'failed':
        return <span className="text-caption text-destructive">Failed</span>;
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={showMemoKeyDialog} onOpenChange={setShowMemoKeyDialog}>
        <DialogContent data-testid="dialog-memo-key">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Private Memo Key Required
            </DialogTitle>
            <DialogDescription>
              To decrypt messages, you need to enter your private memo key. This key is stored temporarily in memory and will be cleared when you close this session.
              <br /><br />
              <strong>Security Note:</strong> Your memo key is never sent to any server and stays only in your browser's memory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="memo-key">Private Memo Key</Label>
              <Input
                id="memo-key"
                type="password"
                placeholder="Enter your private memo key (starts with 5...)"
                value={memoKeyInput}
                onChange={(e) => setMemoKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleMemoKeySubmit()}
                data-testid="input-memo-key"
                autoFocus
              />
              <p className="text-sm text-muted-foreground">
                You can find your memo key in Hive Keychain or your wallet settings.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowMemoKeyDialog(false);
                setMemoKeyInput('');
                setPendingDecrypt(null);
              }}
              data-testid="button-cancel-memo-key"
            >
              Cancel
            </Button>
            <Button
              onClick={handleMemoKeySubmit}
              disabled={!memoKeyInput.trim()}
              data-testid="button-submit-memo-key"
            >
              Decrypt Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          'flex items-end gap-2 max-w-[90%] md:max-w-[480px]',
          isSent ? 'ml-auto flex-row-reverse' : 'mr-auto'
        )}
        data-testid={`message-${message.id}`}
      >
      <div
        className={cn(
          'px-4 py-3 rounded-2xl shadow-sm',
          isSent
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card text-card-foreground rounded-bl-md border border-card-border'
        )}
      >
        {isEncryptedPlaceholder && !isSent ? (
          <div className="flex flex-col gap-2">
            <p className="text-body-lg text-muted-foreground italic">
              🔒 Encrypted Message
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDecrypt}
              disabled={isDecrypting}
              data-testid={`button-decrypt-${message.id}`}
              className="w-full"
            >
              {isDecrypting ? (
                <>
                  <Lock className="w-4 h-4 mr-2 animate-pulse" />
                  Decrypting...
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4 mr-2" />
                  Decrypt Message
                </>
              )}
            </Button>
          </div>
        ) : (
          <p className={cn(
            'text-body-lg whitespace-pre-wrap break-words',
            message.content === 'Your encrypted message' && 'text-muted-foreground italic'
          )}>
            {message.content}
          </p>
        )}
        
        <div
          className={cn(
            'flex items-center gap-2 mt-1',
            isSent ? 'justify-end' : 'justify-start'
          )}
        >
          {message.isEncrypted && !isEncryptedPlaceholder && (
            <Lock className="w-3 h-3 opacity-70" />
          )}
          <span className={cn(
            'text-caption',
            isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}>
            {formatTime(message.timestamp)}
          </span>
          {isSent && (
            <span className={cn(
              'opacity-70',
              message.status === 'failed' && 'opacity-100'
            )}>
              {getStatusIcon()}
            </span>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

interface SystemMessageProps {
  text: string;
}

export function SystemMessage({ text }: SystemMessageProps) {
  return (
    <div className="flex justify-center my-4" data-testid="system-message">
      <div className="px-4 py-2 rounded-lg bg-muted/50 text-caption text-muted-foreground max-w-md text-center">
        {text}
      </div>
    </div>
  );
}
