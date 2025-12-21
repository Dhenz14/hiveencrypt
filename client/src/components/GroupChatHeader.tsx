import { Users, ArrowLeft, MoreVertical, Trash2, UserCog, Pencil, LogOut, UserCheck, DollarSign, Globe, TrendingUp, ExternalLink, Settings, Radio } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { preloadFollowingList, doesUserFollowSync } from '@/lib/hiveFollowing';
import { PaymentStatusBadge, PaymentRequiredIndicator } from './PaymentStatusBadge';
import type { PaymentSettings, MemberPayment } from '@shared/schema';

interface GroupChatHeaderProps {
  groupName: string;
  members: string[];
  creator?: string;
  paymentSettings?: PaymentSettings;
  memberPayments?: MemberPayment[];
  onManageMembers?: () => void;
  onDeleteLocalData?: () => void;
  onBackClick?: () => void;
  onEditName?: () => void;
  onLeaveGroup?: () => void;
  onMakePublic?: () => void;
  onViewEarnings?: () => void;
  onOpenSettings?: () => void;
  onOpenBroadcast?: () => void;
  isCreator?: boolean;
  isPublished?: boolean;
  publishedPermlink?: string;
}

export function GroupChatHeader({ 
  groupName,
  members,
  creator,
  paymentSettings,
  memberPayments,
  onManageMembers,
  onDeleteLocalData,
  onBackClick,
  onEditName,
  onLeaveGroup,
  onMakePublic,
  onViewEarnings,
  onOpenSettings,
  onOpenBroadcast,
  isCreator,
  isPublished,
  publishedPermlink
}: GroupChatHeaderProps) {
  const { user } = useAuth();
  
  // Preload current user's following list for trust indicators
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
  
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };
  
  // Check if current user follows a specific member
  // Show badge if we have data (even if loading in background)
  const isFollowingMember = (memberUsername: string): boolean => {
    if (!user?.username || !followingList) return false;
    return followingList.includes(memberUsername.toLowerCase());
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
          <div className="flex items-center gap-2">
            <h2 className="text-headline font-semibold truncate" data-testid="text-group-name">
              {groupName}
            </h2>
            {onEditName && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onEditName}
                className="h-7 w-7 flex-shrink-0"
                data-testid="button-edit-group-name"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
                    {members.map((member) => {
                      const isFollowing = isFollowingMember(member);
                      const isMemberCreator = creator && member.toLowerCase() === creator.toLowerCase();
                      const isCurrentUser = user?.username && member.toLowerCase() === user.username.toLowerCase();
                      return (
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
                          <span className="text-body font-medium truncate flex-1">@{member}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isMemberCreator && (
                              <Badge variant="default" className="px-2 h-5 text-xs" data-testid={`badge-creator-${member}`}>
                                Creator
                              </Badge>
                            )}
                            {isCurrentUser && !isMemberCreator && (
                              <Badge variant="outline" className="px-2 h-5 text-xs" data-testid={`badge-you-${member}`}>
                                You
                              </Badge>
                            )}
                            {isCurrentUser && isMemberCreator && (
                              <Badge variant="outline" className="px-2 h-5 text-xs" data-testid={`badge-you-${member}`}>
                                You
                              </Badge>
                            )}
                            {isFollowing && (
                              <Badge variant="secondary" className="gap-1 px-2 h-5 flex-shrink-0" data-testid={`badge-following-${member}`}>
                                <UserCheck className="w-3 h-3" />
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            
            {/* Payment Status Indicators */}
            {paymentSettings?.enabled && user?.username && (
              <>
                <span className="text-muted-foreground">•</span>
                <PaymentStatusBadge
                  paymentSettings={paymentSettings}
                  memberPayments={memberPayments}
                  username={user.username}
                  showLabel={false}
                  className="text-xs"
                />
              </>
            )}
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
            {isCreator && !isPublished && onMakePublic && (
              <DropdownMenuItem 
                onClick={onMakePublic} 
                data-testid="menu-make-public"
              >
                <Globe className="w-4 h-4 mr-2" />
                Make Public
              </DropdownMenuItem>
            )}
            {isCreator && isPublished && publishedPermlink && creator && (
              <DropdownMenuItem 
                onClick={() => window.open(`https://ecency.com/@${creator}/${publishedPermlink}`, '_blank')}
                data-testid="menu-view-public-post"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View Public Post
              </DropdownMenuItem>
            )}
            {isCreator && paymentSettings?.enabled && onViewEarnings && (
              <DropdownMenuItem 
                onClick={onViewEarnings} 
                data-testid="menu-view-earnings"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Earnings
              </DropdownMenuItem>
            )}
            {isCreator && onOpenSettings && (
              <DropdownMenuItem 
                onClick={onOpenSettings} 
                data-testid="menu-group-settings"
              >
                <Settings className="w-4 h-4 mr-2" />
                Group Settings
              </DropdownMenuItem>
            )}
            {isCreator && onOpenBroadcast && (
              <DropdownMenuItem 
                onClick={onOpenBroadcast} 
                data-testid="menu-broadcast-message"
              >
                <Radio className="w-4 h-4 mr-2" />
                Broadcast Message
              </DropdownMenuItem>
            )}
            {onLeaveGroup && (
              <DropdownMenuItem 
                onClick={onLeaveGroup} 
                data-testid="menu-leave-group"
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Leave Group
              </DropdownMenuItem>
            )}
            {onDeleteLocalData && (
              <DropdownMenuItem 
                onClick={onDeleteLocalData} 
                data-testid="menu-delete-local-data"
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
