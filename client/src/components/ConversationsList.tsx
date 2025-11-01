import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Conversation } from '@shared/schema';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationsListProps {
  conversations: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewMessage: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ConversationsList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  onNewMessage,
  searchQuery,
  onSearchChange,
}: ConversationsListProps) {
  const filteredConversations = conversations.filter(conv =>
    conv.contactUsername.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-10"
            data-testid="input-search-conversations"
          />
        </div>
        <Button
          onClick={onNewMessage}
          className="w-full h-11"
          data-testid="button-new-message"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Message
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-body text-muted-foreground">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!searchQuery && (
              <p className="text-caption text-muted-foreground">
                Start a conversation to begin messaging
              </p>
            )}
          </div>
        ) : (
          <div className="py-2">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className={cn(
                  'w-full px-4 py-3 flex items-start gap-3 hover-elevate transition-colors',
                  selectedConversationId === conversation.id && 'bg-accent/50'
                )}
                data-testid={`conversation-${conversation.contactUsername}`}
              >
                <div className="relative flex-shrink-0">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-primary/10 text-primary font-medium text-body">
                      {getInitials(conversation.contactUsername)}
                    </AvatarFallback>
                  </Avatar>
                  {conversation.unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center px-1 text-caption rounded-full"
                      data-testid={`badge-unread-${conversation.contactUsername}`}
                    >
                      {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                    </Badge>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={cn(
                      'text-body font-medium truncate',
                      conversation.unreadCount > 0 && 'font-semibold'
                    )}>
                      @{conversation.contactUsername}
                    </span>
                    {conversation.lastMessageTime && (
                      <span className="text-caption text-muted-foreground flex-shrink-0">
                        {formatTimestamp(conversation.lastMessageTime)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {conversation.isEncrypted && (
                      <Lock className="w-3 h-3 text-primary flex-shrink-0" />
                    )}
                    <p className={cn(
                      'text-caption truncate',
                      conversation.unreadCount > 0 
                        ? 'text-foreground font-medium' 
                        : 'text-muted-foreground'
                    )}>
                      {conversation.lastMessage || 'No messages yet'}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
