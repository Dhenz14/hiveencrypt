import { Search, Plus, ShieldCheck, Users, Compass, MessageCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Conversation } from '@shared/schema';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExceptionsList } from '@/hooks/useExceptionsList';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ConversationsListProps {
  groups: Conversation[];
  chats: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewMessage: () => void;
  onNewGroup?: () => void;
  onDiscoverGroups?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ConversationsList({
  groups,
  chats,
  selectedConversationId,
  onSelectConversation,
  onNewMessage,
  onNewGroup,
  onDiscoverGroups,
  searchQuery,
  onSearchChange,
}: ConversationsListProps) {
  const { isException } = useExceptionsList();
  
  const filteredGroups = groups.filter(conv =>
    conv.contactUsername.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredChats = chats.filter(conv =>
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

  const truncatePreview = (text: string, maxLength: number = 50): string => {
    if (!text) return '';
    
    const firstLine = text.split('\n')[0].trim();
    
    if (firstLine.length <= maxLength) {
      return firstLine;
    }
    
    return firstLine.substring(0, maxLength).trim() + '...';
  };

  const renderConversationItem = (conversation: Conversation, isGroup: boolean) => (
    <button
      key={conversation.id}
      onClick={() => onSelectConversation(conversation.id)}
      className={cn(
        'w-full px-4 py-3 flex items-start gap-3 hover-elevate transition-colors min-h-[56px]',
        selectedConversationId === conversation.id && 'bg-accent/50'
      )}
      data-testid={`conversation-${conversation.contactUsername}`}
    >
      <div className="relative flex-shrink-0">
        <Avatar className="w-10 h-10">
          <AvatarFallback className={cn(
            "font-medium text-sm",
            isGroup ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"
          )}>
            {isGroup ? <Users className="w-4 h-4" /> : getInitials(conversation.contactUsername)}
          </AvatarFallback>
        </Avatar>
        {conversation.unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center px-1 text-[10px] rounded-full"
            data-testid={`badge-unread-${conversation.contactUsername}`}
          >
            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
          </Badge>
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              'text-sm font-medium truncate',
              conversation.unreadCount > 0 && 'font-semibold'
            )}>
              {isGroup ? conversation.contactUsername : `@${conversation.contactUsername}`}
            </span>
            {!isGroup && isException(conversation.contactUsername) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShieldCheck 
                    className="w-3 h-3 text-primary flex-shrink-0" 
                    data-testid={`icon-exception-${conversation.contactUsername}`}
                    aria-label="On exceptions list"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">On exceptions list</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {conversation.lastMessageTime && (
            <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 font-normal">
              {formatTimestamp(conversation.lastMessageTime)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          {conversation.isEncrypted && (
            <Lock className="w-3 h-3 text-primary flex-shrink-0" />
          )}
          <p 
            className={cn(
              'text-xs flex-1 min-w-0 truncate',
              conversation.unreadCount > 0 
                ? 'text-foreground font-medium' 
                : 'text-muted-foreground'
            )}
            title={conversation.lastMessage || 'No messages yet'}
          >
            {truncatePreview(conversation.lastMessage || 'No messages yet')}
          </p>
        </div>
      </div>
    </button>
  );

  const hasNoResults = filteredGroups.length === 0 && filteredChats.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-10"
            data-testid="input-search-conversations"
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={onNewMessage}
            className="flex-1 h-9"
            size="sm"
            data-testid="button-new-message"
          >
            <Plus className="w-4 h-4 mr-1" />
            Chat
          </Button>
          {onNewGroup && (
            <Button
              onClick={onNewGroup}
              variant="outline"
              className="flex-1 h-9"
              size="sm"
              data-testid="button-new-group"
            >
              <Users className="w-4 h-4 mr-1" />
              Group
            </Button>
          )}
        </div>
        {onDiscoverGroups && (
          <Button
            onClick={onDiscoverGroups}
            variant="ghost"
            className="w-full h-8"
            size="sm"
            data-testid="button-discover-groups"
          >
            <Compass className="w-4 h-4 mr-2" />
            Discover Groups
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {hasNoResults ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-muted-foreground">
                Start a conversation to begin messaging
              </p>
            )}
          </div>
        ) : (
          <div className="py-1">
            {filteredGroups.length > 0 && (
              <div className="mb-2">
                <div className="px-4 py-2 flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Groups
                  </span>
                  <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                    {filteredGroups.length}
                  </Badge>
                </div>
                {filteredGroups.map((conv) => renderConversationItem(conv, true))}
              </div>
            )}

            {filteredChats.length > 0 && (
              <div>
                <div className="px-4 py-2 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Chats
                  </span>
                  <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                    {filteredChats.length}
                  </Badge>
                </div>
                {filteredChats.map((conv) => renderConversationItem(conv, false))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
