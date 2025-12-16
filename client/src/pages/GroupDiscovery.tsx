import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users, DollarSign, Clock, TrendingUp, Sparkles, ArrowLeft, Loader2, ExternalLink, CheckCircle, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fetchDiscoverableGroups, searchDiscoverableGroups, type DiscoverableGroup } from '@/lib/groupDiscovery';
import { savePendingGroup } from '@/lib/messageCache';
import { JoinGroupButton } from '@/components/JoinGroupButton';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { formatDistanceToNow } from 'date-fns';
import { useGroupDiscovery } from '@/hooks/useGroupMessages';

export default function GroupDiscovery() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'created' | 'trending' | 'hot'>('created');
  const [successGroup, setSuccessGroup] = useState<DiscoverableGroup | null>(null);

  // Fetch user's group memberships to show "Joined" status
  const { data: userGroups = [] } = useGroupDiscovery();
  const userGroupIds = new Set(userGroups.map(g => g.groupId));

  // Fetch groups based on active tab
  const { data: groups, isLoading, error } = useQuery({
    queryKey: ['discoverable-groups', activeTab],
    queryFn: () => fetchDiscoverableGroups(20, activeTab),
    staleTime: 60 * 1000,
  });

  // Search query
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['search-groups', searchQuery],
    queryFn: () => searchDiscoverableGroups(searchQuery, 20),
    enabled: searchQuery.length > 0,
    staleTime: 30 * 1000,
  });

  const displayGroups = searchQuery.length > 0 ? searchResults : groups;

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  const handleJoinSuccess = (group: DiscoverableGroup) => {
    // Save pending group to localStorage so it appears in the Groups tab immediately
    if (user?.username) {
      savePendingGroup({
        groupId: group.groupId,
        groupName: group.groupName,
        creator: group.creator,
        paymentAmount: group.paymentRequired ? group.paymentAmount : undefined,
        requestedAt: new Date().toISOString(),
      }, user.username);
      
      // Invalidate correct group query keys to refresh the groups list in sidebar
      queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user.username] });
      queryClient.invalidateQueries({ queryKey: ['userPendingRequests', group.groupId, user.username] });
    }
    
    // Show success dialog
    setSuccessGroup(group);
  };

  const handleGoToGroup = () => {
    if (successGroup) {
      // Navigate to messages page - the group should appear after creator approves
      setLocation('/');
    }
    setSuccessGroup(null);
  };

  const handleBack = () => {
    setLocation('/');
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Login Required</CardTitle>
            <CardDescription>Please login with Hive Keychain to discover and join groups</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => setLocation('/login')} className="w-full" data-testid="button-login">
              Login with Keychain
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="flex-shrink-0"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate" data-testid="text-page-title">Discover Groups</h1>
              <p className="text-sm text-muted-foreground">Find and join public groups on Hive Messenger</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Content */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search groups by name, description, or creator..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-groups"
          />
        </div>

        {/* Sort Tabs */}
        {!searchQuery && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="created" className="gap-2" data-testid="tab-newest">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Newest</span>
              </TabsTrigger>
              <TabsTrigger value="trending" className="gap-2" data-testid="tab-trending">
                <TrendingUp className="w-4 h-4" />
                <span className="hidden sm:inline">Trending</span>
              </TabsTrigger>
              <TabsTrigger value="hot" className="gap-2" data-testid="tab-hot">
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">Hot</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Loading State */}
        {(isLoading || isSearching) && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">
              {searchQuery ? 'Searching groups...' : 'Loading groups...'}
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="text-center text-destructive">Failed to load groups. Please try again.</p>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!isLoading && !isSearching && displayGroups?.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg mb-2">No Groups Found</h3>
                <p className="text-muted-foreground">
                  {searchQuery 
                    ? 'No groups match your search. Try different keywords.'
                    : 'No public groups have been published yet. Be the first to share your group!'
                  }
                </p>
                <p className="text-xs text-muted-foreground mt-4">
                  Note: Newly published groups may take 1-2 minutes to appear as the blockchain indexes the post.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Groups Grid */}
        {!isLoading && !isSearching && displayGroups && displayGroups.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {displayGroups.map((group) => (
              <Card key={group.groupId} className="hover-elevate transition-all" data-testid={`card-group-${group.groupId}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-12 h-12 flex-shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {getInitials(group.groupName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate" data-testid={`text-group-name-${group.groupId}`}>
                        {group.groupName}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        by @{group.creator}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  {group.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {group.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <Users className="w-3 h-3" />
                      {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                    </Badge>
                    {group.paymentRequired ? (
                      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
                        <DollarSign className="w-3 h-3" />
                        {group.paymentAmount} HBD
                        {group.paymentType === 'recurring' && group.recurringInterval && (
                          <span className="text-xs">/{group.recurringInterval}d</span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-green-500 text-green-600 dark:text-green-400">
                        Free
                      </Badge>
                    )}
                    {group.autoApprove && (
                      <Badge variant="outline" className="gap-1">
                        Auto-Join
                      </Badge>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="pt-0 gap-2 flex-wrap">
                  <JoinGroupButton
                    groupId={group.groupId}
                    groupName={group.groupName}
                    creatorUsername={group.creator}
                    paymentSettings={group.paymentRequired ? {
                      enabled: true,
                      amount: group.paymentAmount || '0',
                      type: group.paymentType || 'one_time',
                      recurringInterval: group.recurringInterval,
                      autoApprove: group.autoApprove,
                    } : undefined}
                    onJoinSuccess={() => handleJoinSuccess(group)}
                    className="flex-1"
                    isMember={userGroupIds.has(group.groupId)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => window.open(`https://ecency.com/@${group.author}/${group.permlink}`, '_blank')}
                    data-testid={`button-view-post-${group.groupId}`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </CardFooter>
                <div className="px-6 pb-4 text-xs text-muted-foreground">
                  Published {formatDistanceToNow(new Date(group.publishedAt), { addSuffix: true })}
                  {group.votes > 0 && ` • ${group.votes} votes`}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Success Dialog */}
      <AlertDialog open={!!successGroup} onOpenChange={(open) => !open && setSuccessGroup(null)}>
        <AlertDialogContent data-testid="dialog-join-success">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <PartyPopper className="w-6 h-6 text-green-500" />
              </div>
              <AlertDialogTitle className="text-xl">Request Sent!</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-3">
              <p>
                Your join request for <strong>"{successGroup?.groupName}"</strong> has been submitted!
              </p>
              {successGroup?.autoApprove ? (
                <div className="flex items-start gap-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">Auto-Approve Enabled</p>
                    <p className="text-sm text-muted-foreground">
                      The group creator's app will automatically approve your request. The group will appear in your Groups tab once approved (usually within a few minutes).
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The group creator will review your request. You'll see the group in your Groups tab once approved.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleGoToGroup} data-testid="button-go-to-messages">
              Go to Messages
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
