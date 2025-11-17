import { Users, ArrowLeft, MoreVertical, Trash2, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface GroupChatHeaderProps {
  groupName: string;
  members: string[];
  onManageMembers?: () => void;
  onDeleteLocalData?: () => void;
  onBackClick?: () => void;
}

export function GroupChatHeader({ 
  groupName,
  members,
  onManageMembers,
  onDeleteLocalData,
  onBackClick
}: GroupChatHeaderProps) {
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  return (
    <div className="min-h-[calc(4rem+env(safe-area-inset-top))] border-b bg-background px-4 flex items-center justify-between gap-4 pt-[env(safe-area-inset-top)]">
      {onBackClick && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBackClick}
          className="md:hidden flex-shrink-0 min-h-11 min-w-11"
          data-testid="button-back-to-conversations"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
      )}
      
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-headline font-semibold truncate" data-testid="text-group-name">
            {groupName}
          </h2>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <button 
                  className="text-caption text-muted-foreground hover:text-foreground transition-colors text-left"
                  data-testid="button-view-members"
                >
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="p-4 border-b">
                  <h3 className="font-medium text-body">Group Members</h3>
                  <p className="text-caption text-muted-foreground mt-1">
                    {members.length} {members.length === 1 ? 'member' : 'members'}
                  </p>
                </div>
                <ScrollArea className="h-[300px]">
                  <div className="p-2 space-y-1">
                    {members.map((member) => (
                      <div
                        key={member}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                        data-testid={`member-item-${member}`}
                      >
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                            {getInitials(member)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-body font-medium truncate">@{member}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge variant="secondary" className="gap-1.5 px-3 h-8 hidden sm:flex">
          <Users className="w-3 h-3" />
          <span className="text-caption">Group Chat</span>
        </Badge>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              data-testid="button-group-menu"
              className="min-h-11 min-w-11"
            >
              <MoreVertical className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onManageMembers && (
              <DropdownMenuItem 
                onClick={onManageMembers} 
                data-testid="menu-manage-members"
              >
                <UserCog className="w-4 h-4 mr-2" />
                Manage Members
              </DropdownMenuItem>
            )}
            {onDeleteLocalData && (
              <DropdownMenuItem 
                onClick={onDeleteLocalData} 
                data-testid="menu-delete-local-data"
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Local Data
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
