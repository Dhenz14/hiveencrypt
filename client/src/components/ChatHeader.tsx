import { MoreVertical, Lock, User, Trash2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ChatHeaderProps {
  contactUsername: string;
  isEncrypted: boolean;
  isOnline?: boolean;
  onViewProfile: () => void;
  onViewBlockchain?: () => void;
  onDeleteLocalData?: () => void;
  onBackClick?: () => void;
}

export function ChatHeader({ 
  contactUsername, 
  isEncrypted, 
  isOnline,
  onViewProfile,
  onViewBlockchain,
  onDeleteLocalData,
  onBackClick
}: ChatHeaderProps) {
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  return (
    <div className="h-16 border-b bg-background px-4 flex items-center justify-between gap-4">
      {onBackClick && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBackClick}
          className="md:hidden flex-shrink-0"
          data-testid="button-back-to-conversations"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
      )}
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="w-10 h-10 flex-shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary font-medium">
            {getInitials(contactUsername)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="text-headline font-semibold truncate">
            @{contactUsername}
          </h2>
          {isOnline !== undefined && (
            <p className="text-caption text-muted-foreground">
              {isOnline ? 'Online' : 'Offline'}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {isEncrypted && (
          <Badge variant="secondary" className="gap-1.5 px-3 h-8">
            <Lock className="w-3 h-3" />
            <span className="text-caption">E2E Encrypted</span>
          </Badge>
        )}
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-chat-menu">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onViewProfile} data-testid="menu-view-profile">
              <User className="w-4 h-4 mr-2" />
              View Profile
            </DropdownMenuItem>
            {onViewBlockchain && (
              <DropdownMenuItem onClick={onViewBlockchain} data-testid="menu-view-blockchain">
                <Lock className="w-4 h-4 mr-2" />
                View on Blockchain
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
