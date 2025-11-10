import { useState } from 'react';
import { Lock, Check, CheckCheck, Clock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@shared/schema';
import { useAuth } from '@/contexts/AuthContext';
import { decryptMemo } from '@/lib/hive';
import { updateMessageContent } from '@/lib/messageCache';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

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

  const isEncryptedPlaceholder = 
    message.content === '[🔒 Encrypted - Click to decrypt]' ||
    message.content.includes('[Encrypted');

  const handleDecrypt = async () => {
    if (!user || !message.encryptedMemo) {
      logger.error('[MessageBubble] Cannot decrypt: missing user or encryptedMemo');
      return;
    }

    logger.sensitive('[MessageBubble] ========== DECRYPT BUTTON CLICKED ==========');
    logger.sensitive('[MessageBubble] Message details:', {
      id: message.id,
      sender: message.sender,
      recipient: message.recipient,
      encryptedMemoPreview: message.encryptedMemo?.substring(0, 40) + '...',
      encryptedMemoLength: message.encryptedMemo?.length,
      currentUser: user.username
    });

    setIsDecrypting(true);
    
    try {
      logger.info('[MessageBubble] Calling decryptMemo with Keychain...');

      const decrypted = await decryptMemo(
        user.username, 
        message.encryptedMemo,
        message.sender,
        message.id  // txId for memo caching
      );
      logger.sensitive('[MessageBubble] decryptMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);

      if (decrypted) {
        logger.info('[DECRYPT] Updating cache with decrypted content, length:', decrypted.length);
        await updateMessageContent(message.id, decrypted, user.username);
        logger.info('[DECRYPT] Cache updated successfully');
        
        // Get partner username from message
        const partnerUsername = message.sender === user.username ? message.recipient : message.sender;
        
        logger.info('[DECRYPT] Invalidating query for:', { username: user.username, partner: partnerUsername });
        
        // Invalidate with the complete query key including partnerUsername
        queryClient.invalidateQueries({ 
          queryKey: ['blockchain-messages', user.username, partnerUsername] 
        });
        
        logger.info('[DECRYPT] Query invalidated, UI should refresh');

        toast({
          title: 'Message Decrypted',
          description: 'Message content is now visible',
        });
      } else {
        throw new Error('Decryption returned null');
      }
    } catch (error: any) {
      logger.error('Decryption error:', error);
      
      let errorMessage = 'Failed to decrypt message';
      if (error?.message?.includes('cancel')) {
        errorMessage = 'Decryption cancelled by user';
      } else if (error?.message?.includes('Keychain')) {
        errorMessage = error?.message || 'Hive Keychain extension not found';
      } else {
        errorMessage = error?.message || 'Failed to decrypt message';
      }
      
      toast({
        title: 'Decryption Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
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
    <div
        className={cn(
          'flex items-end gap-2 max-w-[85%] md:max-w-[480px]',
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
        {isEncryptedPlaceholder ? (
          <div className="flex flex-col gap-2">
            <p className="text-body-lg text-muted-foreground italic">
              🔒 Encrypted Message {isSent && '(Sent)'}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDecrypt}
              disabled={isDecrypting}
              data-testid={`button-decrypt-${message.id}`}
              className="w-full min-h-11"
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
