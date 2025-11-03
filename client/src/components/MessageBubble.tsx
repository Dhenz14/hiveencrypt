import { useState } from 'react';
import { Lock, Check, CheckCheck, Clock, Unlock, Key, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@shared/schema';
import { useAuth } from '@/contexts/AuthContext';
import { decryptMemo, setMemoKey, saveMemoKeyEncrypted } from '@/lib/hive';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  const [passphraseInput, setPassphraseInput] = useState('');
  const [shouldSaveMemoKey, setShouldSaveMemoKey] = useState(false);
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

    if (shouldSaveMemoKey && !passphraseInput.trim()) {
      toast({
        title: 'Passphrase Required',
        description: 'Please enter a passphrase to encrypt and save your memo key',
        variant: 'destructive',
      });
      return;
    }

    const memoKey = memoKeyInput.trim();
    
    // Store memo key in memory
    setMemoKey(memoKey);
    
    // Optionally save encrypted to localStorage
    if (shouldSaveMemoKey && passphraseInput.trim()) {
      try {
        await saveMemoKeyEncrypted(memoKey, passphraseInput.trim());
        console.log('[MEMO_KEY] Saved encrypted to localStorage');
      } catch (error) {
        console.error('[MEMO_KEY] Failed to save:', error);
        toast({
          title: 'Warning',
          description: 'Failed to save memo key, but will use for this session',
          variant: 'destructive',
        });
      }
    }
    
    setShowMemoKeyDialog(false);
    setMemoKeyInput('');
    setPassphraseInput('');
    setShouldSaveMemoKey(false);
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

        const savedMessage = shouldSaveMemoKey && passphraseInput.trim() 
          ? 'Your memo key is encrypted and saved. You\'ll only need your passphrase next time.'
          : 'Your memo key is saved for this session.';

        toast({
          title: 'Message Decrypted',
          description: savedMessage,
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
        <DialogContent data-testid="dialog-memo-key" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Private Memo Key Required
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <div>
                To decrypt messages, enter your private memo key. This is standard practice on Hive - even Hive.blog and PeakD require manual key entry.
              </div>
              <Alert className="mt-3">
                <AlertDescription className="text-caption">
                  <strong>Where to find your memo key:</strong>
                  <br />
                  Go to{' '}
                  <a 
                    href={`https://wallet.hive.blog/@${user?.username}/permissions`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover-elevate"
                  >
                    wallet.hive.blog/@{user?.username}/permissions
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {' '}and click "Show private key" next to your Memo key.
                </AlertDescription>
              </Alert>
              <div className="text-caption mt-3">
                <strong>Security:</strong> Your memo key never leaves your browser. Optionally save it encrypted with a passphrase for convenience.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="memoKey" className="text-sm font-medium">
                Private Memo Key
              </Label>
              <Input
                id="memoKey"
                data-testid="input-memo-key"
                type="password"
                placeholder="5K..."
                value={memoKeyInput}
                onChange={(e) => setMemoKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !shouldSaveMemoKey) {
                    handleMemoKeySubmit();
                  }
                }}
                className="font-mono text-sm"
                autoFocus
              />
              <p className="text-caption text-tertiary">
                Your private memo key (starts with 5K...)
              </p>
            </div>

            <div className="flex items-start space-x-2 pt-2">
              <Checkbox
                id="saveMemoKey"
                data-testid="checkbox-save-memo"
                checked={shouldSaveMemoKey}
                onCheckedChange={(checked) => setShouldSaveMemoKey(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="saveMemoKey"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Save encrypted for future sessions
                </label>
                <p className="text-caption text-tertiary">
                  Your memo key will be encrypted with a passphrase and stored locally
                </p>
              </div>
            </div>

            {shouldSaveMemoKey && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label htmlFor="passphrase" className="text-sm font-medium">
                  Encryption Passphrase
                </Label>
                <Input
                  id="passphrase"
                  data-testid="input-passphrase"
                  type="password"
                  placeholder="Enter a strong passphrase"
                  value={passphraseInput}
                  onChange={(e) => setPassphraseInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleMemoKeySubmit();
                    }
                  }}
                  className="text-sm"
                />
                <p className="text-caption text-tertiary">
                  Choose a memorable passphrase to unlock your saved memo key
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowMemoKeyDialog(false);
                setMemoKeyInput('');
                setPassphraseInput('');
                setShouldSaveMemoKey(false);
                setPendingDecrypt(null);
                setIsDecrypting(false);
              }}
              data-testid="button-cancel-memo"
            >
              Cancel
            </Button>
            <Button
              onClick={handleMemoKeySubmit}
              disabled={!memoKeyInput.trim() || (shouldSaveMemoKey && !passphraseInput.trim())}
              data-testid="button-submit-memo"
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
