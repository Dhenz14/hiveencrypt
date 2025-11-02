import { useState, useEffect } from 'react';
import { Lock, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@shared/schema';
import { requestKeychainDecryption } from '@/lib/encryption';
import { useAuth } from '@/contexts/AuthContext';

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
  showAvatar?: boolean;
  showTimestamp?: boolean;
}

export function MessageBubble({ message, isSent, showAvatar, showTimestamp }: MessageBubbleProps) {
  const { user } = useAuth();
  const [decryptedContent, setDecryptedContent] = useState<string>(
    message.decryptedContent || (message.isEncrypted ? '' : message.content)
  );
  const [isDecrypting, setIsDecrypting] = useState(
    message.isEncrypted && !message.decryptedContent
  );
  const [decryptError, setDecryptError] = useState(false);

  useEffect(() => {
    async function decryptMessage() {
      if (message.decryptedContent) {
        // Strip leading # if present (Hive Keychain encryption requirement)
        const content = message.decryptedContent.startsWith('#') 
          ? message.decryptedContent.substring(1) 
          : message.decryptedContent;
        setDecryptedContent(content);
        setIsDecrypting(false);
        return;
      }

      if (!message.isEncrypted || !user) {
        setDecryptedContent(message.content);
        setIsDecrypting(false);
        return;
      }

      try {
        setIsDecrypting(true);
        setDecryptError(false);

        const decrypted = await requestKeychainDecryption(
          message.content,
          user.username
        );

        // Strip leading # if present (Hive Keychain encryption requirement)
        const content = decrypted.startsWith('#') ? decrypted.substring(1) : decrypted;
        setDecryptedContent(content);
      } catch (error) {
        console.error('Message decryption failed:', error);
        setDecryptError(true);
        setDecryptedContent('[Decryption failed]');
      } finally {
        setIsDecrypting(false);
      }
    }

    decryptMessage();
  }, [message.id, message.decryptedContent, message.content, message.isEncrypted, user]);

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
        <p className={cn(
          'text-body-lg whitespace-pre-wrap break-words',
          decryptError && 'text-muted-foreground italic'
        )}>
          {isDecrypting ? 'Decrypting...' : decryptedContent}
        </p>
        
        <div
          className={cn(
            'flex items-center gap-2 mt-1',
            isSent ? 'justify-end' : 'justify-start'
          )}
        >
          {message.isEncrypted && !decryptError && (
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
