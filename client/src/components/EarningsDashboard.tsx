import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  DollarSign, 
  Clock, 
  TrendingUp, 
  Users, 
  Calendar, 
  ExternalLink, 
  Download, 
  Search,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';
import type { MemberPayment, PaymentSettings, GroupConversationCache } from '@shared/schema';
import { formatDistanceToNow, format, startOfDay, startOfWeek, startOfMonth, isWithinInterval, subDays, subWeeks, subMonths } from 'date-fns';

interface PaymentRecord extends MemberPayment {
  groupId: string;
  groupName: string;
}

interface EarningsDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupConversationCache[];
  currentUsername?: string;
}

type TimeRange = 'all' | '7d' | '30d' | '90d' | '1y';
type TimelineView = 'day' | 'week' | 'month';

export function EarningsDashboard({
  open,
  onOpenChange,
  groups,
  currentUsername,
}: EarningsDashboardProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [timelineView, setTimelineView] = useState<TimelineView>('day');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  const parseAmount = (amountStr: string): number => {
    if (!amountStr) return 0;
    if (!amountStr.includes('HBD')) return 0;
    const match = amountStr.match(/([\d.]+)\s*HBD/i);
    if (!match) return 0;
    const parsed = parseFloat(match[1]);
    return isNaN(parsed) ? 0 : parsed;
  };

  const creatorGroups = useMemo(() => {
    return groups.filter(g => 
      g.creator === currentUsername && 
      g.paymentSettings?.enabled
    );
  }, [groups, currentUsername]);

  const allPayments = useMemo<PaymentRecord[]>(() => {
    const payments: PaymentRecord[] = [];
    
    for (const group of creatorGroups) {
      if (group.memberPayments) {
        for (const payment of group.memberPayments) {
          payments.push({
            ...payment,
            groupId: group.groupId,
            groupName: group.name,
          });
        }
      }
    }
    
    return payments;
  }, [creatorGroups]);

  const filteredPayments = useMemo(() => {
    let result = [...allPayments];
    
    if (selectedGroupId !== 'all') {
      result = result.filter(p => p.groupId === selectedGroupId);
    }
    
    if (timeRange !== 'all') {
      const now = new Date();
      let start: Date;
      
      switch (timeRange) {
        case '7d':
          start = subDays(now, 7);
          break;
        case '30d':
          start = subDays(now, 30);
          break;
        case '90d':
          start = subDays(now, 90);
          break;
        case '1y':
          start = subDays(now, 365);
          break;
        default:
          start = new Date(0);
      }
      
      result = result.filter(p => {
        const paidAt = new Date(p.paidAt);
        return isWithinInterval(paidAt, { start, end: now });
      });
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.username.toLowerCase().includes(query) ||
        p.groupName.toLowerCase().includes(query)
      );
    }
    
    result.sort((a, b) => {
      const dateA = new Date(a.paidAt).getTime();
      const dateB = new Date(b.paidAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    
    return result;
  }, [allPayments, selectedGroupId, timeRange, searchQuery, sortOrder]);

  const timelineData = useMemo(() => {
    const groups: Record<string, { payments: PaymentRecord[]; total: number }> = {};
    
    for (const payment of filteredPayments) {
      const paidAt = new Date(payment.paidAt);
      let key: string;
      
      switch (timelineView) {
        case 'day':
          key = format(startOfDay(paidAt), 'yyyy-MM-dd');
          break;
        case 'week':
          key = format(startOfWeek(paidAt), 'yyyy-MM-dd');
          break;
        case 'month':
          key = format(startOfMonth(paidAt), 'yyyy-MM');
          break;
      }
      
      if (!groups[key]) {
        groups[key] = { payments: [], total: 0 };
      }
      
      groups[key].payments.push(payment);
      groups[key].total += parseAmount(payment.amount);
    }
    
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const dateA = new Date(a + (a.length === 7 ? '-01' : '')).getTime();
      const dateB = new Date(b + (b.length === 7 ? '-01' : '')).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    
    return sortedKeys.map(key => ({
      period: key,
      ...groups[key],
    }));
  }, [filteredPayments, timelineView, sortOrder]);

  const stats = useMemo(() => {
    const totalEarnings = filteredPayments.reduce((sum, p) => sum + parseAmount(p.amount), 0);
    const activeMembers = filteredPayments.filter(p => p.status === 'active').length;
    const expiredMembers = filteredPayments.filter(p => p.status === 'expired').length;
    const uniqueMembers = new Set(filteredPayments.map(p => p.username)).size;
    
    return {
      totalEarnings,
      activeMembers,
      expiredMembers,
      uniqueMembers,
      totalPayments: filteredPayments.length,
    };
  }, [filteredPayments]);

  const perGroupStats = useMemo(() => {
    const groupStats: Record<string, { name: string; total: number; members: number; active: number }> = {};
    
    for (const payment of filteredPayments) {
      if (!groupStats[payment.groupId]) {
        groupStats[payment.groupId] = {
          name: payment.groupName,
          total: 0,
          members: 0,
          active: 0,
        };
      }
      
      groupStats[payment.groupId].total += parseAmount(payment.amount);
      groupStats[payment.groupId].members += 1;
      if (payment.status === 'active') {
        groupStats[payment.groupId].active += 1;
      }
    }
    
    return Object.entries(groupStats)
      .map(([groupId, data]) => ({ groupId, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredPayments]);

  const exportToCSV = () => {
    const headers = ['Date', 'Username', 'Group', 'Amount', 'Status', 'Transaction ID'];
    const rows = filteredPayments.map(p => [
      format(new Date(p.paidAt), 'yyyy-MM-dd HH:mm:ss'),
      p.username,
      p.groupName,
      p.amount,
      p.status,
      p.txId,
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `earnings_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatPeriodLabel = (period: string) => {
    try {
      const date = new Date(period);
      switch (timelineView) {
        case 'day':
          return format(date, 'MMM d, yyyy');
        case 'week':
          return `Week of ${format(date, 'MMM d, yyyy')}`;
        case 'month':
          return format(new Date(period + '-01'), 'MMMM yyyy');
      }
    } catch {
      return period;
    }
  };

  const openTransaction = (txId: string) => {
    window.open(`https://hivescan.info/tx/${txId}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-earnings-dashboard">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Earnings Dashboard
          </DialogTitle>
          <DialogDescription>
            Track your paid group earnings across all groups
          </DialogDescription>
        </DialogHeader>

        {creatorGroups.length === 0 ? (
          <div className="text-center py-12">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No Paid Groups</p>
            <p className="text-muted-foreground">Create a paid group to start tracking earnings</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger className="w-[180px]" data-testid="select-group-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {creatorGroups.map(g => (
                    <SelectItem key={g.groupId} value={g.groupId}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                <SelectTrigger className="w-[140px]" data-testid="select-time-range">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="1y">Last Year</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by username or group..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-payments"
                />
              </div>

              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
                data-testid="button-toggle-sort"
              >
                {sortOrder === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>

              <Button variant="outline" onClick={exportToCSV} data-testid="button-export-csv">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <DollarSign className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-total-earnings">{stats.totalEarnings.toFixed(3)}</span>
                  </div>
                  <p className="text-caption text-muted-foreground">Total HBD</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                    <Users className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-active-members">{stats.activeMembers}</span>
                  </div>
                  <p className="text-caption text-muted-foreground">Active</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <Clock className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-expired-members">{stats.expiredMembers}</span>
                  </div>
                  <p className="text-caption text-muted-foreground">Expired</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-blue-500 mb-1">
                    <TrendingUp className="w-5 h-5" />
                    <span className="text-2xl font-bold" data-testid="text-total-payments">{stats.totalPayments}</span>
                  </div>
                  <p className="text-caption text-muted-foreground">Total Payments</p>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="timeline" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="self-start">
                <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline</TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-history">Payment History</TabsTrigger>
                <TabsTrigger value="groups" data-testid="tab-groups">By Group</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-caption text-muted-foreground">View by:</span>
                  <Select value={timelineView} onValueChange={(v) => setTimelineView(v as TimelineView)}>
                    <SelectTrigger className="w-[120px]" data-testid="select-timeline-view">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <ScrollArea className="h-[300px]">
                  <div className="space-y-3 pr-4">
                    {timelineData.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No payments in this period</p>
                      </div>
                    ) : (
                      timelineData.map(({ period, payments, total }) => (
                        <Card key={period} className="p-3" data-testid={`card-timeline-${period}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{formatPeriodLabel(period)}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{payments.length} payments</Badge>
                              <Badge className="bg-primary">{total.toFixed(3)} HBD</Badge>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {payments.slice(0, 5).map((p, i) => (
                              <Avatar key={`${p.txId}-${i}`} className="w-7 h-7">
                                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                  {getInitials(p.username)}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                            {payments.length > 5 && (
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                                +{payments.length - 5}
                              </div>
                            )}
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="history" className="flex-1 overflow-hidden">
                <ScrollArea className="h-[340px]">
                  <div className="space-y-2 pr-4">
                    {filteredPayments.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No payments found</p>
                      </div>
                    ) : (
                      filteredPayments.map((payment, index) => (
                        <div
                          key={`${payment.txId}-${index}`}
                          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover-elevate"
                          data-testid={`earnings-row-${payment.username}-${index}`}
                        >
                          <Avatar className="w-9 h-9 flex-shrink-0">
                            <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                              {getInitials(payment.username)}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-body truncate">@{payment.username}</span>
                              <Badge variant="outline" className="text-xs">{payment.groupName}</Badge>
                              <Badge 
                                variant={payment.status === 'active' ? 'default' : 'secondary'}
                                className="text-xs h-5"
                              >
                                {payment.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-caption text-muted-foreground">
                              <span>{format(new Date(payment.paidAt), 'MMM d, yyyy HH:mm')}</span>
                              <span>•</span>
                              <span>{formatDistanceToNow(new Date(payment.paidAt), { addSuffix: true })}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="font-semibold text-primary">{payment.amount}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openTransaction(payment.txId)}
                              data-testid={`button-view-tx-${payment.username}`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="groups" className="flex-1 overflow-hidden">
                <ScrollArea className="h-[340px]">
                  <div className="space-y-3 pr-4">
                    {perGroupStats.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No group data available</p>
                      </div>
                    ) : (
                      perGroupStats.map(({ groupId, name, total, members, active }) => (
                        <Card key={groupId} className="p-4" data-testid={`card-group-stats-${groupId}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium text-body">{name}</h4>
                              <p className="text-caption text-muted-foreground">
                                {members} payments • {active} active
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold text-primary">{total.toFixed(3)}</div>
                              <p className="text-caption text-muted-foreground">HBD earned</p>
                            </div>
                          </div>
                        </Card>
                      ))
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
