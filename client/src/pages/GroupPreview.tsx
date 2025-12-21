import { useState, useEffect } from 'react';
import { useParams, useLocation, useSearch } from 'wouter';
import { ArrowLeft, Users, DollarSign, Calendar, User, Loader2, ExternalLink, Clock, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { JoinGroupButton } from '@/components/JoinGroupButton';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { fetchDiscoverableGroups, type DiscoverableGroup } from '@/lib/groupDiscovery';
import { useGroupDiscovery } from '@/hooks/useGroupMessages';
import { formatDistanceToNow } from 'date-fns';
import { logger } from '@/lib/logger';

const REFERRAL_CLICKS_KEY = 'hive-messenger-referral-clicks';

interface ReferralClickData {
  refCode: string;
  clickCount: number;
  joinedMembers: string[];
  lastClick: string;
}

interface ReferralClickStore {
  [groupId: string]: ReferralClickData[];
}

function storeReferralClick(groupId: string, refCode: string) {
  try {
    if (typeof window === 'undefined') return;
    
    const stored = localStorage.getItem(REFERRAL_CLICKS_KEY);
    const data: ReferralClickStore = stored ? JSON.parse(stored) : {};
    
    if (!data[groupId]) {
      data[groupId] = [];
    }
    
    const existing = data[groupId].find(r => r.refCode === refCode);
    if (existing) {
      existing.clickCount += 1;
      existing.lastClick = new Date().toISOString();
    } else {
      data[groupId].push({
        refCode,
        clickCount: 1,
        joinedMembers: [],
        lastClick: new Date().toISOString(),
      });
    }
    
    localStorage.setItem(REFERRAL_CLICKS_KEY, JSON.stringify(data));
    logger.info('[GROUP PREVIEW] Stored referral click:', { groupId, refCode });
  } catch (error) {
    logger.warn('[GROUP PREVIEW] Failed to store referral click:', error);
  }
}

export function recordReferralJoin(groupId: string, username: string) {
  try {
    if (typeof window === 'undefined') return;
    
    const stored = localStorage.getItem(REFERRAL_CLICKS_KEY);
    const data: ReferralClickStore = stored ? JSON.parse(stored) : {};
    
    if (!data[groupId] || data[groupId].length === 0) return;
    
    const latestReferral = data[groupId].reduce((latest, current) => 
      new Date(current.lastClick) > new Date(latest.lastClick) ? current : latest
    );
    
    if (!latestReferral.joinedMembers.includes(username)) {
      latestReferral.joinedMembers.push(username);
      localStorage.setItem(REFERRAL_CLICKS_KEY, JSON.stringify(data));
      logger.info('[GROUP PREVIEW] Recorded referral join:', { groupId, username, refCode: latestReferral.refCode });
    }
  } catch (error) {
    logger.warn('[GROUP PREVIEW] Failed to record referral join:', error);
  }
}

export default function GroupPreview() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId || '';
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { user } = useAuth();

  const [refCode, setRefCode] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(searchString);
    const ref = urlParams.get('ref');
    if (ref && groupId) {
      setRefCode(ref);
      storeReferralClick(groupId, ref);
    }
  }, [searchString, groupId]);

  const { data: userGroups = [], isLoading: isLoadingUserGroups } = useGroupDiscovery();
  const userGroupIds = new Set(userGroups.map(g => g.groupId));
  const isMember = userGroupIds.has(groupId);

  const { data: allGroups, isLoading: isLoadingGroups, error } = useQuery({
    queryKey: ['discoverable-groups-all'],
    queryFn: () => fetchDiscoverableGroups(100, 'created'),
    staleTime: 60 * 1000,
    enabled: !!groupId,
  });

  const group = allGroups?.find(g => g.groupId === groupId);

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  const handleJoinSuccess = () => {
    setLocation('/');
  };

  const handleBack = () => {
    setLocation('/');
  };

  const handleLogin = () => {
    setLocation('/login');
  };

  const isLoading = isLoadingGroups || isLoadingUserGroups;

  if (!groupId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Invalid Group Link</CardTitle>
            <CardDescription>No group ID was provided in the URL.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={handleBack} className="w-full" data-testid="button-back-home">
              Go to Messages
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Skeleton className="h-6 w-48" />
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-4">
                <Skeleton className="w-16 h-16 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            </CardContent>
            <CardFooter>
              <Skeleton className="h-10 w-full" />
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-background sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-lg font-semibold">Group Not Found</h1>
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Group Not Available</CardTitle>
              <CardDescription>
                This group may not be published for discovery, or the link may be invalid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertDescription>
                  The group with ID <code className="text-xs bg-muted px-1 py-0.5 rounded">{groupId}</code> could not be found. 
                  It may be a private group that isn't publicly listed.
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter className="gap-2 flex-wrap">
              <Button onClick={handleBack} variant="outline" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Messages
              </Button>
              <Button onClick={() => setLocation('/discover')} data-testid="button-discover">
                Browse Public Groups
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  const memberAvatars = group.memberCount > 0 
    ? Array.from({ length: Math.min(group.memberCount, 5) }, (_, i) => i)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold truncate" data-testid="text-header-title">
                Join Group
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <Card data-testid="card-group-preview">
          <CardHeader>
            <div className="flex items-start gap-4">
              <Avatar className="w-16 h-16 flex-shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xl">
                  {getInitials(group.groupName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-xl" data-testid="text-group-name">
                  {group.groupName}
                </CardTitle>
                <CardDescription className="flex items-center gap-1 mt-1">
                  <User className="w-3 h-3" />
                  <span>Created by </span>
                  <a
                    href={`https://hive.blog/@${group.creator}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                    data-testid="link-creator-profile"
                  >
                    @{group.creator}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {group.description && (
              <p className="text-muted-foreground" data-testid="text-group-description">
                {group.description}
              </p>
            )}

            <div className="flex flex-wrap gap-3" data-testid="badges-group-info">
              <Badge variant="secondary" className="gap-1">
                <Users className="w-3 h-3" />
                {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Calendar className="w-3 h-3" />
                {formatDistanceToNow(new Date(group.publishedAt), { addSuffix: true })}
              </Badge>
              {group.autoApprove && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="w-3 h-3" />
                  Auto-Join
                </Badge>
              )}
            </div>

            {group.paymentRequired && (
              <Card className="bg-muted/50" data-testid="card-payment-info">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground" data-testid="text-payment-amount">
                        {group.paymentAmount} HBD to join
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {group.paymentType === 'recurring' && group.recurringInterval ? (
                          <>Recurring payment every {group.recurringInterval} days</>
                        ) : (
                          <>One-time payment</>
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!group.paymentRequired && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20" data-testid="card-free-info">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                <p className="text-green-700 dark:text-green-300 font-medium">
                  Free to join
                </p>
              </div>
            )}

            {memberAvatars.length > 0 && (
              <div data-testid="section-member-avatars">
                <p className="text-sm text-muted-foreground mb-2">Members</p>
                <div className="flex -space-x-2">
                  {memberAvatars.map((_, index) => (
                    <Avatar
                      key={index}
                      className="w-8 h-8 border-2 border-background"
                    >
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {index === 0 ? getInitials(group.creator) : '?'}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {group.memberCount > 5 && (
                    <div className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">
                        +{group.memberCount - 5}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {refCode && (
              <div className="text-sm text-muted-foreground" data-testid="text-referral-info">
                Referred by: <span className="font-medium">@{refCode}</span>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-3">
            {isMember ? (
              <div className="w-full">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled
                  data-testid="button-already-member"
                >
                  <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                  You're a member
                </Button>
                <p className="text-sm text-muted-foreground text-center mt-2">
                  This group is already in your messages.
                </p>
              </div>
            ) : user ? (
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
                onJoinSuccess={handleJoinSuccess}
                className="w-full"
              />
            ) : (
              <div className="w-full space-y-3">
                <Button
                  onClick={handleLogin}
                  className="w-full"
                  data-testid="button-login-to-join"
                >
                  <User className="w-4 h-4 mr-2" />
                  Login with Keychain to Join
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  You need to login with Hive Keychain to join this group.
                </p>
              </div>
            )}
          </CardFooter>
        </Card>

        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            onClick={() => window.open(`https://ecency.com/@${group.author}/${group.permlink}`, '_blank')}
            className="text-muted-foreground"
            data-testid="button-view-hive-post"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View on Hive
          </Button>
        </div>
      </div>
    </div>
  );
}
