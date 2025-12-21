import { useState, useEffect, useMemo } from 'react';
import { 
  Megaphone, 
  Send, 
  Clock, 
  Users, 
  Loader2,
  AlertTriangle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GroupConversationCache } from '@shared/schema';

const MAX_MESSAGE_LENGTH = 500;

interface StoredBroadcast {
  id: string;
  groupId: string;
  groupName: string;
  content: string;
  timestamp: string;
  recipientCount: number;
}

interface BroadcastModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupConversationCache;
  currentUsername?: string;
  onSendMessage: (content: string) => Promise<void>;
}

function getStorageKey(username: string): string {
  return `hive-messenger-broadcasts-${username}`;
}

function loadBroadcasts(username: string): StoredBroadcast[] {
  try {
    const stored = localStorage.getItem(getStorageKey(username));
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('[BROADCAST] Failed to load broadcasts:', error);
  }
  return [];
}

function saveBroadcast(username: string, broadcast: StoredBroadcast): void {
  try {
    const existing = loadBroadcasts(username);
    const updated = [broadcast, ...existing].slice(0, 20);
    localStorage.setItem(getStorageKey(username), JSON.stringify(updated));
  } catch (error) {
    console.error('[BROADCAST] Failed to save broadcast:', error);
  }
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function BroadcastModal({ 
  open, 
  onOpenChange, 
  group,
  currentUsername,
  onSendMessage
}: BroadcastModalProps) {
  const isCreator = currentUsername === group.creator;
  
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recentBroadcasts, setRecentBroadcasts] = useState<StoredBroadcast[]>([]);

  const recipientCount = useMemo(() => {
    return group.members.filter(m => m !== currentUsername).length;
  }, [group.members, currentUsername]);

  const charCount = message.length;
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;
  const canSend = message.trim().length > 0 && !isOverLimit && !isSending && isCreator;

  useEffect(() => {
    if (open && currentUsername) {
      setRecentBroadcasts(loadBroadcasts(currentUsername));
      setMessage('');
      setError(null);
      setSendProgress(0);
    }
  }, [open, currentUsername]);

  const handleSend = async () => {
    if (!canSend || !currentUsername) return;

    setIsSending(true);
    setError(null);
    setSendProgress(10);

    try {
      setSendProgress(30);
      await onSendMessage(message.trim());
      setSendProgress(100);

      const broadcast: StoredBroadcast = {
        id: crypto.randomUUID(),
        groupId: group.groupId,
        groupName: group.name,
        content: message.trim(),
        timestamp: new Date().toISOString(),
        recipientCount,
      };
      saveBroadcast(currentUsername, broadcast);
      setRecentBroadcasts(loadBroadcasts(currentUsername));

      setMessage('');
      
      setTimeout(() => {
        onOpenChange(false);
      }, 500);
    } catch (err: any) {
      setError(err?.message || 'Failed to send broadcast');
      setSendProgress(0);
    } finally {
      setIsSending(false);
    }
  };

  const groupBroadcasts = useMemo(() => {
    return recentBroadcasts.filter(b => b.groupId === group.groupId);
  }, [recentBroadcasts, group.groupId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px]"
        data-testid="dialog-broadcast-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Broadcast to Group
          </DialogTitle>
          <DialogDescription>
            Send a message to all {recipientCount} member{recipientCount !== 1 ? 's' : ''} of {group.name}
          </DialogDescription>
        </DialogHeader>

        {!isCreator ? (
          <Alert variant="destructive" data-testid="alert-not-creator">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You must be the group creator to send broadcasts.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Message</label>
                <span 
                  className={`text-xs ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                  data-testid="text-char-count"
                >
                  {charCount}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>
              <Textarea
                placeholder="Type your broadcast message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[100px] resize-none"
                disabled={isSending}
                data-testid="textarea-broadcast-message"
              />
            </div>

            {message.trim() && (
              <Card data-testid="card-message-preview">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      <Megaphone className="h-3 w-3 mr-1" />
                      Broadcast
                    </Badge>
                    <p className="text-sm break-words" data-testid="text-preview-content">
                      {message.trim()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {error && (
              <Alert variant="destructive" data-testid="alert-send-error">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isSending && (
              <div className="space-y-2" data-testid="container-send-progress">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Sending broadcast...</span>
                  <span>{Math.round(sendProgress)}%</span>
                </div>
                <Progress value={sendProgress} className="h-2" data-testid="progress-send" />
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span data-testid="text-recipient-count">{recipientCount} recipient{recipientCount !== 1 ? 's' : ''}</span>
              </div>
              <Button
                onClick={handleSend}
                disabled={!canSend}
                data-testid="button-send-broadcast"
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Now
                  </>
                )}
              </Button>
            </div>

            {groupBroadcasts.length > 0 && (
              <div className="pt-4 border-t">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Broadcasts
                </h4>
                <ScrollArea className="h-[150px]" data-testid="scroll-recent-broadcasts">
                  <div className="space-y-2 pr-4">
                    {groupBroadcasts.map((broadcast) => (
                      <div 
                        key={broadcast.id}
                        className="p-3 rounded-md bg-muted/50 space-y-1"
                        data-testid={`card-broadcast-${broadcast.id}`}
                      >
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {broadcast.recipientCount} recipient{broadcast.recipientCount !== 1 ? 's' : ''}
                          </span>
                          <span>{formatRelativeTime(broadcast.timestamp)}</span>
                        </div>
                        <p className="text-sm line-clamp-2">{broadcast.content}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
