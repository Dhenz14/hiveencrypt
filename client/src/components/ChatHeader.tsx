import { MoreVertical, Lock, User, Trash2, ArrowLeft, Shield, ShieldCheck, EyeOff, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useExceptionsList } from '@/hooks/useExceptionsList';
import { useToast } from '@/hooks/use-toast';
import { LightningTipButton } from '@/components/lightning/LightningTipButton';
import { useQuery } from '@tanstack/react-query';
import { getAccountMetadata, parseLightningAddress, inferTipReceivePreference } from '@/lib/accountMetadata';
import { preloadFollowingList, doesUserFollowSync } from '@/lib/hiveFollowing';
import { useAuth } from '@/contexts/AuthContext';

interface ChatHeaderProps {
  contactUsername: string;
  isEncrypted: boolean;
  isOnline?: boolean;
  onViewProfile: () => void;
  onViewBlockchain?: () => void;
  onDeleteLocalData?: () => void;
  onHideChat?: () => void;
  onBackClick?: () => void;
}

export function ChatHeader({ 
  contactUsername, 
  isEncrypted, 
  isOnline,
  onViewProfile,
  onViewBlockchain,
  onDeleteLocalData,
  onHideChat,
  onBackClick
}: ChatHeaderProps) {
  const { user } = useAuth();
  const { isException, toggleException } = useExceptionsList();
  const { toast } = useToast();
  
  // Fetch recipient's metadata for tip button (Lightning Address + tip preference)
  const { data: recipientMetadata } = useQuery({
    queryKey: ['recipientMetadata', contactUsername],
    queryFn: async () => await getAccountMetadata(contactUsername),
    enabled: !!contactUsername,
    staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
  });
  
  // Preload current user's following list for trust indicator
  const { data: followingList, isPending } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username,
    staleTime: 5 * 60 * 1000,  // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
  });
  
  const recipientLightningAddress = parseLightningAddress(recipientMetadata);
  const recipientTipPreference = inferTipReceivePreference(recipientMetadata?.profile?.hive_messenger);
  
  // Check if current user follows this contact
  // Show badge if we have data (even if loading in background)
  const isFollowing = followingList?.includes(contactUsername.toLowerCase()) ?? false;
  
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };
  
  const handleToggleException = () => {
    const wasException = isException(contactUsername);
    toggleException(contactUsername);
    
    if (wasException) {
      // Was in exceptions, now removed
      toast({
        title: 'Filter Removed',
        description: `@${contactUsername} will now need to meet your minimum HBD requirement`,
      });
    } else {
      // Was not in exceptions, now added
      toast({
        title: 'Exception Added',
        description: `@${contactUsername} can now message at 0.001 HBD regardless of your filter`,
      });
    }
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
          <Badge variant="secondary" className="gap-1.5 px-3 h-8 hidden sm:flex">
            <Lock className="w-3 h-3" />
            <span className="text-caption">E2E Encrypted</span>
          </Badge>
        )}
        
        {isFollowing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="gap-1.5 px-3 h-8 hidden md:flex" data-testid="badge-following">
                <UserCheck className="w-3 h-3" />
                <span className="text-caption">Following</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-caption">You follow @{contactUsername}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleException}
              data-testid="button-toggle-exception"
              aria-label={isException(contactUsername) ? 'Remove from exceptions list' : 'Add to exceptions list'}
              className="min-h-11 min-w-11"
            >
              {isException(contactUsername) ? (
                <ShieldCheck className="w-5 h-5 text-primary" />
              ) : (
                <Shield className="w-5 h-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-caption">
              {isException(contactUsername) 
                ? 'On exceptions list (bypasses minimum HBD filter)'
                : 'Click to add to exceptions list'}
            </p>
          </TooltipContent>
        </Tooltip>
        
        {/* Lightning Tip Button - v2.3.0 Feature */}
        <LightningTipButton
          recipientUsername={contactUsername}
          recipientLightningAddress={recipientLightningAddress || undefined}
          recipientTipPreference={recipientTipPreference}
        />
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-chat-menu" className="min-h-11 min-w-11">
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
            {onHideChat && (
              <DropdownMenuItem onClick={onHideChat} data-testid="menu-hide-chat">
                <EyeOff className="w-4 h-4 mr-2" />
                Hide Chat
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
