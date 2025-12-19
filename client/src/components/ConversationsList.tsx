import { Search, Plus, ShieldCheck, Users, Compass, MessageCircle, Clock, Loader2, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Conversation } from '@shared/schema';
import type { PendingGroup } from '@/lib/messageCache';
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
  pendingGroups?: PendingGroup[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewMessage: () => void;
  onNewGroup?: () => void;
  onDiscoverGroups?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoadingGroups?: boolean;
}

export function ConversationsList({
  groups,
  chats,
  pendingGroups = [],
  selectedConversationId,
  onSelectConversation,
  onNewMessage,
  onNewGroup,
  onDiscoverGroups,
  searchQuery,
  onSearchChange,
  isLoadingGroups = false,
}: ConversationsListProps) {
  const { isException } = useExceptionsList();
  
  const filteredGroups = groups.filter(conv =>
    conv.contactUsername.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredChats = chats.filter(conv =>
    conv.contactUsername.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPendingGroups = pendingGroups.filter(pg =>
    pg.groupName.toLowerCase().includes(searchQuery.toLowerCase())
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
            {isGroup && conversation.isPaid && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DollarSign 
                    className="w-3 h-3 text-green-500 flex-shrink-0" 
                    data-testid={`icon-paid-${conversation.id}`}
                    aria-label="Paid group"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Paid group</p>
                </TooltipContent>
              </Tooltip>
            )}
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

  const renderPendingGroupItem = (pg: PendingGroup) => (
    <button
      key={`pending-${pg.groupId}`}
      onClick={() => onSelectConversation(`pending_${pg.groupId}`)}
      className={cn(
        'w-full px-4 py-3 flex items-start gap-3 hover-elevate transition-colors min-h-[56px] opacity-80',
        selectedConversationId === `pending_${pg.groupId}` && 'bg-accent/50'
      )}
      data-testid={`conversation-pending-${pg.groupId}`}
    >
      <div className="relative flex-shrink-0">
        <Avatar className="w-10 h-10">
          <AvatarFallback className="bg-amber-500/20 text-amber-600 dark:text-amber-400 font-medium text-sm">
            <Clock className="w-4 h-4" />
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">
              {pg.groupName}
            </span>
            <Badge 
              variant="outline" 
              className="h-5 px-1.5 text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
              data-testid={`badge-pending-${pg.groupId}`}
            >
              In Review
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            Waiting for approval...
          </p>
        </div>
      </div>
    </button>
  );

  const hasNoResults = filteredGroups.length === 0 && filteredChats.length === 0 && filteredPendingGroups.length === 0 && !isLoadingGroups;
  
  // Always show groups section if loading or if there are groups/pending groups
  const showGroupsSection = isLoadingGroups || filteredGroups.length > 0 || filteredPendingGroups.length > 0;

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
            {showGroupsSection && (
              <div className="mb-2">
                <div className="px-4 py-2 flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Groups
                  </span>
                  {isLoadingGroups ? (
                    <Loader2 className="ml-auto w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                      {filteredGroups.length + filteredPendingGroups.length}
                    </Badge>
                  )}
                </div>
                {filteredPendingGroups.map((pg) => renderPendingGroupItem(pg))}
                {filteredGroups.map((conv) => renderConversationItem(conv, true))}
                {isLoadingGroups && filteredGroups.length === 0 && filteredPendingGroups.length === 0 && (
                  <div className="px-4 py-3 flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading groups...</span>
                  </div>
                )}
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
