import { useState, useMemo } from 'react';
import { Lock, Check, CheckCheck, Clock, Unlock, ExternalLink, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@shared/schema';
import { useAuth } from '@/contexts/AuthContext';
import { decryptMemo } from '@/lib/hive';
import { updateMessageContent, cacheGroupConversation, cacheGroupMessage, getAllGroupMessages, type GroupMessageCache } from '@/lib/messageCache';
import { parseGroupMessageMemo, lookupGroupMetadata, setGroupNegativeCache } from '@/lib/groupBlockchain';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

interface TipNotification {
  amount: string;
  currency: 'sats' | 'hbd';
  txId?: string;
}

// Helper function to detect and parse tip notifications (both Lightning sats and HBD)
function parseTipNotification(content: string): TipNotification | null {
  // Check for Lightning sats notification
  if (content.startsWith('Lightning Tip Received:')) {
    // Extract sats amount (e.g., "1,000 sats")
    const satsMatch = content.match(/Lightning Tip Received:\s*([0-9,]+)\s*sats/);
    
    // Extract transaction ID from URL (case-insensitive to handle mixed-case tx IDs)
    const txMatch = content.match(/https:\/\/hiveblocks\.com\/tx\/([a-fA-F0-9]+)/);
    
    if (satsMatch) {
      return {
        amount: satsMatch[1],
        currency: 'sats',
        txId: txMatch ? txMatch[1] : undefined,
      };
    }
  }
  
  // Check for HBD tip notification
  if (content.startsWith('Tip Received:')) {
    // Extract HBD amount (e.g., "0.958 HBD")
    const hbdMatch = content.match(/Tip Received:\s*([0-9.]+)\s*HBD/);
    
    // Extract transaction ID from URL (case-insensitive to handle mixed-case tx IDs)
    const txMatch = content.match(/https:\/\/hiveblocks\.com\/tx\/([a-fA-F0-9]+)/);
    
    if (hbdMatch) {
      return {
        amount: hbdMatch[1],
        currency: 'hbd',
        txId: txMatch ? txMatch[1] : undefined,
      };
    }
  }
  
  return null;
}

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
  showAvatar?: boolean;
  showTimestamp?: boolean;
  isGroupMessage?: boolean;
  senderName?: string;
}

export function MessageBubble({ message, isSent, showAvatar, showTimestamp, isGroupMessage, senderName }: MessageBubbleProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDecrypting, setIsDecrypting] = useState(false);

  const isEncryptedPlaceholder = 
    message.content === '[🔒 Encrypted - Click to decrypt]' ||
    message.content.includes('[Encrypted');
  
  // PERF-1: Memoize tip notification parsing to prevent re-renders
  const tipNotification = useMemo(() => {
    return !isEncryptedPlaceholder ? parseTipNotification(message.content) : null;
  }, [isEncryptedPlaceholder, message.content]);

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
        // Check if this is a group message FIRST (to strip prefix before caching)
        const parsed = parseGroupMessageMemo(decrypted);
        
        // CRITICAL: Cache only the actual message content (strip group: prefix)
        const contentToCache = (parsed && parsed.isGroupMessage && parsed.content) 
          ? parsed.content 
          : decrypted;
        
        logger.info('[DECRYPT] Updating cache with content (prefix stripped if group), length:', contentToCache.length);
        await updateMessageContent(message.id, contentToCache, user.username);
        logger.info('[DECRYPT] Cache updated successfully');
        
        if (parsed && parsed.isGroupMessage && parsed.groupId) {
          logger.info('[GROUP AUTO-DISCOVERY] Detected group message for groupId:', parsed.groupId);
          
          try {
            let groupMetadata = null;
            
            // NEW: If memo includes creator, try that FIRST (most reliable)
            if (parsed.creator) {
              logger.info('[GROUP AUTO-DISCOVERY] Trying creator from memo:', parsed.creator);
              groupMetadata = await lookupGroupMetadata(parsed.groupId, parsed.creator);
              
              if (groupMetadata) {
                logger.info('[GROUP AUTO-DISCOVERY] ✅ Found metadata from creator in memo:', parsed.creator);
              }
            }
            
            // Fallback: If creator lookup failed or no creator in memo, try all known senders
            if (!groupMetadata) {
              const allGroupMessages = await getAllGroupMessages(user.username);
              const sendersForGroup = new Set<string>();
              sendersForGroup.add(message.sender); // Try current sender
              
              // Add other known senders from cache
              for (const msg of allGroupMessages) {
                if (msg.groupId === parsed.groupId) {
                  sendersForGroup.add(msg.sender);
                }
              }
              
              logger.info('[GROUP AUTO-DISCOVERY] Trying', sendersForGroup.size, 'fallback senders');
              
              // Try each sender until we find metadata
              for (const sender of Array.from(sendersForGroup)) {
                groupMetadata = await lookupGroupMetadata(parsed.groupId, sender);
                if (groupMetadata) {
                  logger.info('[GROUP AUTO-DISCOVERY] ✅ Found metadata from fallback sender:', sender);
                  break;
                }
              }
              
              // If all senders failed, set negative cache to prevent repeated attempts
              if (!groupMetadata) {
                logger.warn('[GROUP AUTO-DISCOVERY] ❌ All', sendersForGroup.size, 'senders failed for group:', parsed.groupId);
                setGroupNegativeCache(parsed.groupId);
              }
            }
            
            if (groupMetadata) {
              logger.info('[GROUP AUTO-DISCOVERY] ✅ Found group:', groupMetadata.name);
              
              // CRITICAL: Only cache if metadata lookup succeeded
              // Cache the group conversation FIRST
              await cacheGroupConversation({
                groupId: groupMetadata.groupId,
                name: groupMetadata.name,
                members: groupMetadata.members,
                creator: groupMetadata.creator,
                createdAt: groupMetadata.createdAt,
                version: groupMetadata.version,
                lastMessage: parsed.content || '',
                lastTimestamp: message.timestamp,
                unreadCount: 0,
                lastChecked: new Date().toISOString(),
              }, user.username);
              
              // Then cache the group message (only after conversation exists)
              const groupMessage: GroupMessageCache = {
                id: message.id,
                groupId: parsed.groupId,
                sender: message.sender,
                creator: parsed.creator, // Store creator for group discovery
                content: parsed.content || '',
                encryptedContent: message.encryptedMemo,
                timestamp: message.timestamp,
                recipients: [user.username],
                txIds: [message.id],
                confirmed: true,
                status: 'confirmed',
              };
              
              await cacheGroupMessage(groupMessage, user.username);
              
              // Invalidate group conversations query to show the new group
              queryClient.invalidateQueries({ 
                queryKey: ['blockchain-group-conversations', user.username] 
              });
              
              toast({
                title: 'Group Discovered!',
                description: `You've been added to "${groupMetadata.name}"`,
              });
              
              logger.info('[GROUP AUTO-DISCOVERY] ✅ Group cached and UI updated');
            } else {
              logger.warn('[GROUP AUTO-DISCOVERY] ⚠️ Could not resolve group metadata for groupId:', parsed.groupId);
              // Don't cache anything if metadata lookup failed - avoid pollution
            }
          } catch (groupError) {
            logger.error('[GROUP AUTO-DISCOVERY] Failed to discover group:', groupError);
            // Don't cache anything on error - avoid pollution and repeated failed lookups
          }
        }
        
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

  const getBlockchainExplorerUrl = (txId: string) => {
    // Use hiveblockexplorer.com - confirmed working and reliable (maintained by @penguinpablo)
    // Alternative explorers: hive.ausbit.dev (open source), hivexplorer.com
    return `https://hiveblockexplorer.com/tx/${txId}`;
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
        {/* Show sender name for group messages (only for messages not sent by current user) */}
        {isGroupMessage && !isSent && senderName && (
          <div className="mb-1">
            <span className="text-caption font-semibold text-muted-foreground">
              @{senderName}
            </span>
          </div>
        )}
        
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
        ) : tipNotification ? (
          // Tip Notification Display (Lightning sats or HBD)
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-full bg-yellow-500/20">
                <Zap className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              </div>
              <span className="font-semibold">
                {tipNotification.currency === 'sats' ? 'Lightning Tip Received' : 'Tip Received'}
              </span>
            </div>
            <p className="text-2xl font-bold">
              {tipNotification.amount} {tipNotification.currency === 'sats' ? 'sats' : 'HBD'}
            </p>
            {tipNotification.txId && (
              <a
                href={`https://hivescan.info/tx/${tipNotification.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-caption hover-elevate transition-colors underline"
                data-testid={`link-tip-transaction-${message.id}`}
              >
                View Transaction <ExternalLink className="w-3 h-3" />
              </a>
            )}
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
          
          {/* Blockchain verification link - only show for confirmed messages */}
          {message.status === 'confirmed' && message.trxId && (
            <a
              href={getBlockchainExplorerUrl(message.trxId)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center gap-1 opacity-70 hover-elevate transition-opacity',
                isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
              title="View on Hive blockchain"
              data-testid={`link-blockchain-${message.id}`}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
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
