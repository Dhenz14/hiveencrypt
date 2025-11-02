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
      return;
    }

    setIsDecrypting(true);
    
    try {
      const decrypted = await decryptMemo(
        user.username, 
        message.encryptedMemo,
        message.sender
      );

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
      
      let errorMessage = 'Failed to decrypt message';
      if (error?.message?.includes('cancel')) {
        errorMessage = 'Decryption cancelled';
      } else if (error?.message?.includes('requestDecodeMemo not available')) {
        errorMessage = 'Keychain decryption not available. Please use latest Hive Keychain.';
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
