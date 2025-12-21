import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  BarChart3, 
  Users, 
  MessageSquare, 
  TrendingUp, 
  Calendar,
  ArrowUpDown,
  UserCheck,
  UserX,
  Clock,
  Activity,
  Target
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import type { GroupConversationCache } from '@shared/schema';
import { getGroupMessages } from '@/lib/messageCache';
import { formatDistanceToNow, format, subDays, differenceInDays, startOfDay, isWithinInterval } from 'date-fns';

interface GroupMessageCache {
  id: string;
  groupId: string;
  sender: string;
  content: string;
  timestamp: string;
  recipients: string[];
}

interface CreatorAnalyticsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupConversationCache[];
  currentUsername?: string;
}

type TimeRange = 'all' | '7d' | '30d' | '90d' | '1y';
type SortMode = 'activity' | 'alphabetical' | 'messages';

interface MemberActivity {
  username: string;
  lastMessageAt: string | null;
  messageCount: number;
  status: 'active' | 'quiet' | 'silent';
  daysSinceLastMessage: number | null;
}

export function CreatorAnalytics({
  open,
  onOpenChange,
  groups,
  currentUsername,
}: CreatorAnalyticsProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [isLoading, setIsLoading] = useState(false);
  const [groupMessages, setGroupMessages] = useState<Record<string, GroupMessageCache[]>>({});

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  const creatorGroups = useMemo(() => {
    return groups.filter(g => 
      g.creator === currentUsername && 
      g.paymentSettings?.enabled
    );
  }, [groups, currentUsername]);

  useEffect(() => {
    if (open && creatorGroups.length > 0) {
      setIsLoading(true);
      
      const fetchAllMessages = async () => {
        const messagesMap: Record<string, GroupMessageCache[]> = {};
        
        for (const group of creatorGroups) {
          try {
            const messages = await getGroupMessages(group.groupId, currentUsername);
            messagesMap[group.groupId] = messages as GroupMessageCache[];
          } catch (error) {
            console.error(`Failed to fetch messages for group ${group.groupId}:`, error);
            messagesMap[group.groupId] = [];
          }
        }
        
        setGroupMessages(messagesMap);
        setIsLoading(false);
      };
      
      fetchAllMessages();
    }
  }, [open, creatorGroups, currentUsername]);

  const filteredGroups = useMemo(() => {
    if (selectedGroupId === 'all') return creatorGroups;
    return creatorGroups.filter(g => g.groupId === selectedGroupId);
  }, [creatorGroups, selectedGroupId]);

  const memberActivityData = useMemo<MemberActivity[]>(() => {
    const memberMap: Record<string, MemberActivity> = {};
    const now = new Date();

    for (const group of filteredGroups) {
      for (const member of group.members) {
        if (!memberMap[member]) {
          memberMap[member] = {
            username: member,
            lastMessageAt: null,
            messageCount: 0,
            status: 'silent',
            daysSinceLastMessage: null,
          };
        }
      }

      const messages = groupMessages[group.groupId] || [];
      for (const msg of messages) {
        if (!memberMap[msg.sender]) continue;
        
        memberMap[msg.sender].messageCount += 1;
        const msgTime = new Date(msg.timestamp);
        
        if (!memberMap[msg.sender].lastMessageAt || 
            msgTime > new Date(memberMap[msg.sender].lastMessageAt!)) {
          memberMap[msg.sender].lastMessageAt = msg.timestamp;
        }
      }
    }

    for (const member of Object.values(memberMap)) {
      if (member.lastMessageAt) {
        const lastMsgDate = new Date(member.lastMessageAt);
        member.daysSinceLastMessage = differenceInDays(now, lastMsgDate);
        
        if (member.daysSinceLastMessage <= 7) {
          member.status = 'active';
        } else if (member.daysSinceLastMessage <= 30) {
          member.status = 'quiet';
        } else {
          member.status = 'silent';
        }
      }
    }

    const memberList = Object.values(memberMap);
    
    switch (sortMode) {
      case 'activity':
        return memberList.sort((a, b) => {
          const statusOrder = { active: 0, quiet: 1, silent: 2 };
          const statusDiff = statusOrder[a.status] - statusOrder[b.status];
          if (statusDiff !== 0) return statusDiff;
          return (a.daysSinceLastMessage ?? 999) - (b.daysSinceLastMessage ?? 999);
        });
      case 'alphabetical':
        return memberList.sort((a, b) => a.username.localeCompare(b.username));
      case 'messages':
        return memberList.sort((a, b) => b.messageCount - a.messageCount);
      default:
        return memberList;
    }
  }, [filteredGroups, groupMessages, sortMode]);

  const growthChartData = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    
    switch (timeRange) {
      case '7d':
        startDate = subDays(now, 7);
        break;
      case '30d':
        startDate = subDays(now, 30);
        break;
      case '90d':
        startDate = subDays(now, 90);
        break;
      case '1y':
        startDate = subDays(now, 365);
        break;
      default:
        startDate = new Date(0);
    }

    const joinEvents: { date: Date; username: string }[] = [];
    const paidMemberDates: Set<string> = new Set();

    for (const group of filteredGroups) {
      joinEvents.push({ date: new Date(group.createdAt), username: group.creator });
      
      if (group.memberPayments) {
        for (const payment of group.memberPayments) {
          joinEvents.push({ date: new Date(payment.paidAt), username: payment.username });
          paidMemberDates.add(payment.username);
        }
      }
      
      for (const member of group.members) {
        if (member !== group.creator && !paidMemberDates.has(member)) {
          joinEvents.push({ date: new Date(group.createdAt), username: member });
        }
      }
    }

    joinEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    const seenMembers = new Set<string>();
    const dailyData: Record<string, number> = {};

    for (const event of joinEvents) {
      if (seenMembers.has(event.username)) continue;
      seenMembers.add(event.username);
      
      const dayKey = format(startOfDay(event.date), 'yyyy-MM-dd');
      dailyData[dayKey] = (dailyData[dayKey] || 0) + 1;
    }

    const sortedDays = Object.keys(dailyData).sort();
    let runningTotal = 0;
    const cumulativeData: Record<string, number> = {};
    
    for (const day of sortedDays) {
      runningTotal += dailyData[day];
      cumulativeData[day] = runningTotal;
    }

    const chartData: { date: string; members: number; label: string }[] = [];
    const daysToShow = differenceInDays(now, startDate);
    let lastCount = 0;

    for (let i = 0; i <= daysToShow; i++) {
      const day = subDays(now, daysToShow - i);
      const dayKey = format(startOfDay(day), 'yyyy-MM-dd');
      
      if (cumulativeData[dayKey] !== undefined) {
        lastCount = cumulativeData[dayKey];
      }

      if (isWithinInterval(day, { start: startDate, end: now })) {
        chartData.push({
          date: dayKey,
          members: lastCount,
          label: format(day, 'MMM d'),
        });
      }
    }

    return chartData;
  }, [filteredGroups, timeRange]);

  const engagementMetrics = useMemo(() => {
    let totalMessages = 0;
    let firstMessageDate: Date | null = null;
    let lastMessageDate: Date | null = null;
    const memberMessageCounts: Record<string, number> = {};
    const dailyMessageCounts: Record<string, number> = {};

    for (const group of filteredGroups) {
      const messages = groupMessages[group.groupId] || [];
      totalMessages += messages.length;

      for (const msg of messages) {
        const msgDate = new Date(msg.timestamp);
        
        if (!firstMessageDate || msgDate < firstMessageDate) {
          firstMessageDate = msgDate;
        }
        if (!lastMessageDate || msgDate > lastMessageDate) {
          lastMessageDate = msgDate;
        }

        memberMessageCounts[msg.sender] = (memberMessageCounts[msg.sender] || 0) + 1;

        const dayKey = format(startOfDay(msgDate), 'yyyy-MM-dd');
        dailyMessageCounts[dayKey] = (dailyMessageCounts[dayKey] || 0) + 1;
      }
    }

    const daySpan = firstMessageDate && lastMessageDate 
      ? Math.max(1, differenceInDays(lastMessageDate, firstMessageDate) + 1)
      : 1;
    const avgMessagesPerDay = totalMessages / daySpan;

    const topMembers = Object.entries(memberMessageCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([username, count]) => ({ username, count }));

    const dailyValues = Object.values(dailyMessageCounts);
    const avgDaily = dailyValues.length > 0 
      ? dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length 
      : 0;
    const quietDays = dailyValues.filter(v => v < avgDaily * 0.5).length;

    return {
      totalMessages,
      avgMessagesPerDay: avgMessagesPerDay.toFixed(1),
      topMembers,
      quietDays,
      totalDays: daySpan,
    };
  }, [filteredGroups, groupMessages]);

  const conversionStats = useMemo(() => {
    let totalRequests = 0;
    let approved = 0;
    let pending = 0;
    let rejected = 0;

    for (const group of filteredGroups) {
      if (group.joinRequests) {
        for (const req of group.joinRequests) {
          totalRequests += 1;
          
          if (req.status === 'approved' || req.status === 'approved_free') {
            approved += 1;
          } else if (req.status === 'rejected') {
            rejected += 1;
          } else {
            pending += 1;
          }
        }
      }
    }

    const conversionRate = totalRequests > 0 
      ? ((approved / totalRequests) * 100).toFixed(1)
      : '0.0';

    return {
      totalRequests,
      approved,
      pending,
      rejected,
      conversionRate,
    };
  }, [filteredGroups]);

  const getStatusBadgeVariant = (status: 'active' | 'quiet' | 'silent') => {
    switch (status) {
      case 'active':
        return 'default';
      case 'quiet':
        return 'secondary';
      case 'silent':
        return 'outline';
    }
  };

  const getStatusLabel = (status: 'active' | 'quiet' | 'silent') => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'quiet':
        return 'Quiet';
      case 'silent':
        return 'Silent';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-creator-analytics">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Creator Analytics
          </DialogTitle>
          <DialogDescription>
            Detailed analytics for your paid groups
          </DialogDescription>
        </DialogHeader>

        {creatorGroups.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No Paid Groups</p>
            <p className="text-muted-foreground">Create a paid group to view analytics</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger className="w-[200px]" data-testid="select-analytics-group">
                  <Users className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Paid Groups</SelectItem>
                  {creatorGroups.map(g => (
                    <SelectItem key={g.groupId} value={g.groupId}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <Users className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-total-members">
                      {filteredGroups.reduce((sum, g) => sum + g.members.length, 0)}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">Total Members</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                    <MessageSquare className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-total-messages">
                      {engagementMetrics.totalMessages}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">Messages</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-blue-500 mb-1">
                    <Target className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-conversion-rate">
                      {conversionStats.conversionRate}%
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">Conversion</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-orange-500 mb-1">
                    <Activity className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-avg-messages">
                      {engagementMetrics.avgMessagesPerDay}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">Msgs/Day</p>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="activity" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="self-start">
                <TabsTrigger value="activity" data-testid="tab-member-activity">Member Activity</TabsTrigger>
                <TabsTrigger value="growth" data-testid="tab-growth-chart">Growth</TabsTrigger>
                <TabsTrigger value="engagement" data-testid="tab-engagement">Engagement</TabsTrigger>
                <TabsTrigger value="conversion" data-testid="tab-conversion">Conversion</TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-caption text-muted-foreground">Sort by:</span>
                  <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                    <SelectTrigger className="w-[140px]" data-testid="select-sort-mode">
                      <ArrowUpDown className="w-4 h-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activity">Activity</SelectItem>
                      <SelectItem value="alphabetical">A-Z</SelectItem>
                      <SelectItem value="messages">Messages</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <ScrollArea className="h-[300px]">
                  {isLoading ? (
                    <div className="space-y-2 pr-4">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                          <Skeleton className="w-9 h-9 rounded-full" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-32" />
                          </div>
                          <Skeleton className="h-5 w-16" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 pr-4">
                      {memberActivityData.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>No members found</p>
                        </div>
                      ) : (
                        memberActivityData.map((member) => (
                          <div
                            key={member.username}
                            className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                            data-testid={`member-row-${member.username}`}
                          >
                            <Avatar className="w-9 h-9 flex-shrink-0">
                              <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                                {getInitials(member.username)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-body truncate">@{member.username}</span>
                                <Badge variant={getStatusBadgeVariant(member.status)} className="text-xs h-5">
                                  {getStatusLabel(member.status)}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                                <span>{member.messageCount} messages</span>
                                {member.lastMessageAt && (
                                  <>
                                    <span>•</span>
                                    <span>Last: {formatDistanceToNow(new Date(member.lastMessageAt), { addSuffix: true })}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="growth" className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-caption text-muted-foreground">Time range:</span>
                  <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                    <SelectTrigger className="w-[140px]" data-testid="select-growth-range">
                      <Calendar className="w-4 h-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                      <SelectItem value="1y">Last Year</SelectItem>
                      <SelectItem value="all">All Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-[280px] w-full" data-testid="chart-growth">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Skeleton className="w-full h-full" />
                    </div>
                  ) : growthChartData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No growth data available</p>
                      </div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={growthChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="memberGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="label" 
                          tick={{ fontSize: 12 }} 
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis 
                          tick={{ fontSize: 12 }} 
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                          formatter={(value: number) => [value, 'Members']}
                          labelFormatter={(label) => label}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="members" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          fill="url(#memberGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="engagement" className="flex-1 overflow-hidden">
                <ScrollArea className="h-[340px]">
                  <div className="space-y-4 pr-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          Message Statistics
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-2xl font-bold text-primary" data-testid="text-engagement-total">
                              {engagementMetrics.totalMessages}
                            </p>
                            <p className="text-caption text-muted-foreground">Total Messages</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-blue-500" data-testid="text-engagement-avg">
                              {engagementMetrics.avgMessagesPerDay}
                            </p>
                            <p className="text-caption text-muted-foreground">Avg/Day</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Top 5 Active Members
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {isLoading ? (
                          <div className="space-y-2">
                            {[1, 2, 3].map(i => (
                              <Skeleton key={i} className="h-8 w-full" />
                            ))}
                          </div>
                        ) : engagementMetrics.topMembers.length === 0 ? (
                          <p className="text-muted-foreground text-caption">No message data yet</p>
                        ) : (
                          <div className="space-y-2">
                            {engagementMetrics.topMembers.map((member, idx) => (
                              <div 
                                key={member.username} 
                                className="flex items-center justify-between"
                                data-testid={`top-member-${member.username}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground w-4 text-caption">{idx + 1}.</span>
                                  <span className="font-medium">@{member.username}</span>
                                </div>
                                <Badge variant="secondary">{member.count} msgs</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Activity Overview
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-2xl font-bold" data-testid="text-active-days">
                              {engagementMetrics.totalDays}
                            </p>
                            <p className="text-caption text-muted-foreground">Days of Activity</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-orange-500" data-testid="text-quiet-days">
                              {engagementMetrics.quietDays}
                            </p>
                            <p className="text-caption text-muted-foreground">Quiet Days</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="conversion" className="flex-1 overflow-hidden">
                <ScrollArea className="h-[340px]">
                  <div className="space-y-4 pr-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          Conversion Rate
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <p className="text-4xl font-bold text-primary" data-testid="text-conversion-percentage">
                              {conversionStats.conversionRate}%
                            </p>
                            <p className="text-caption text-muted-foreground">
                              {conversionStats.approved} of {conversionStats.totalRequests} requests approved
                            </p>
                          </div>
                          <div className="w-24 h-24 relative">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                              <circle
                                cx="18"
                                cy="18"
                                r="16"
                                fill="none"
                                stroke="hsl(var(--muted))"
                                strokeWidth="3"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="16"
                                fill="none"
                                stroke="hsl(var(--primary))"
                                strokeWidth="3"
                                strokeDasharray={`${parseFloat(conversionStats.conversionRate)} 100`}
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          Request Breakdown
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                              <UserCheck className="w-5 h-5" />
                              <span className="text-2xl font-bold" data-testid="text-approved-count">
                                {conversionStats.approved}
                              </span>
                            </div>
                            <p className="text-caption text-muted-foreground">Approved</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-yellow-500 mb-1">
                              <Clock className="w-5 h-5" />
                              <span className="text-2xl font-bold" data-testid="text-pending-count">
                                {conversionStats.pending}
                              </span>
                            </div>
                            <p className="text-caption text-muted-foreground">Pending</p>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-red-500 mb-1">
                              <UserX className="w-5 h-5" />
                              <span className="text-2xl font-bold" data-testid="text-rejected-count">
                                {conversionStats.rejected}
                              </span>
                            </div>
                            <p className="text-caption text-muted-foreground">Rejected</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {conversionStats.totalRequests === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No join requests yet</p>
                        <p className="text-caption">Share your group to start receiving requests</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
