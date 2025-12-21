import { useState, useMemo } from 'react';
import { 
  Users, 
  Crown, 
  ExternalLink, 
  Search, 
  Check, 
  X, 
  Clock, 
  DollarSign, 
  Filter,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PaymentStatusBadge } from './PaymentStatusBadge';
import type { PaymentSettings, MemberPayment } from '@shared/schema';
import { format, formatDistanceToNow } from 'date-fns';

interface MemberManagementTableProps {
  members: string[];
  creator: string;
  currentUsername?: string;
  paymentSettings?: PaymentSettings;
  memberPayments?: MemberPayment[];
  onRemoveMember: (username: string) => void;
  onBatchRemove?: (usernames: string[]) => void;
  isUpdating?: boolean;
  addedMembers?: string[];
}

type StatusFilter = 'all' | 'paid' | 'unpaid' | 'expired';
type SortField = 'username' | 'joinDate' | 'amount' | 'status';

export function MemberManagementTable({
  members,
  creator,
  currentUsername,
  paymentSettings,
  memberPayments = [],
  onRemoveMember,
  onBatchRemove,
  isUpdating,
  addedMembers = [],
}: MemberManagementTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('username');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  const getInitials = (username: string) => username.slice(0, 2).toUpperCase();

  const getMemberPayment = (username: string): MemberPayment | undefined => {
    return memberPayments.find(p => p.username.toLowerCase() === username.toLowerCase());
  };

  const getMemberStatus = (username: string): 'paid' | 'unpaid' | 'expired' | 'free' => {
    if (!paymentSettings?.enabled) return 'free';
    const payment = getMemberPayment(username);
    if (!payment) return 'unpaid';
    return payment.status === 'active' ? 'paid' : 'expired';
  };

  const parseAmount = (amountStr: string): number => {
    if (!amountStr) return 0;
    if (!amountStr.includes('HBD')) return 0;
    const match = amountStr.match(/([\d.]+)\s*HBD/i);
    if (!match) return 0;
    const parsed = parseFloat(match[1]);
    return isNaN(parsed) ? 0 : parsed;
  };

  const enrichedMembers = useMemo(() => {
    return members.map(member => {
      const payment = getMemberPayment(member);
      const status = getMemberStatus(member);
      return {
        username: member,
        isCreator: member === creator,
        isCurrentUser: member === currentUsername,
        isNew: addedMembers.includes(member),
        payment,
        status,
        joinDate: payment?.paidAt,
        amount: payment?.amount,
      };
    });
  }, [members, creator, currentUsername, addedMembers, memberPayments, paymentSettings]);

  const filteredMembers = useMemo(() => {
    let result = [...enrichedMembers];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(m => m.username.toLowerCase().includes(query));
    }

    if (statusFilter !== 'all' && paymentSettings?.enabled) {
      result = result.filter(m => m.status === statusFilter);
    }

    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'username':
          comparison = a.username.localeCompare(b.username);
          break;
        case 'joinDate':
          const dateA = a.joinDate ? new Date(a.joinDate).getTime() : 0;
          const dateB = b.joinDate ? new Date(b.joinDate).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case 'amount':
          const amtA = a.amount ? parseAmount(a.amount) : 0;
          const amtB = b.amount ? parseAmount(b.amount) : 0;
          comparison = amtA - amtB;
          break;
        case 'status':
          const statusOrder = { paid: 0, expired: 1, unpaid: 2, free: 3 };
          comparison = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [enrichedMembers, searchQuery, statusFilter, sortField, sortOrder, paymentSettings]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const toggleSelectMember = (username: string) => {
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(username)) {
      newSelected.delete(username);
    } else {
      newSelected.add(username);
    }
    setSelectedMembers(newSelected);
  };

  const toggleSelectAll = () => {
    const removableMembers = filteredMembers.filter(m => !m.isCreator && !m.isCurrentUser);
    if (selectedMembers.size === removableMembers.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(removableMembers.map(m => m.username)));
    }
  };

  const handleBatchRemove = () => {
    if (onBatchRemove && selectedMembers.size > 0) {
      onBatchRemove(Array.from(selectedMembers));
      setSelectedMembers(new Set());
    }
  };

  const exportMemberList = () => {
    const headers = ['Username', 'Status', 'Join Date', 'Amount Paid', 'Transaction ID'];
    const rows = filteredMembers.map(m => [
      m.username,
      m.status,
      m.joinDate ? format(new Date(m.joinDate), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
      m.amount || 'N/A',
      m.payment?.txId || 'N/A',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `members_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openTransaction = (txId: string) => {
    window.open(`https://hivescan.info/tx/${txId}`, '_blank');
  };

  const stats = useMemo(() => {
    const paid = enrichedMembers.filter(m => m.status === 'paid').length;
    const expired = enrichedMembers.filter(m => m.status === 'expired').length;
    const unpaid = enrichedMembers.filter(m => m.status === 'unpaid').length;
    const totalRevenue = memberPayments.reduce((sum, p) => sum + parseAmount(p.amount), 0);
    
    return { paid, expired, unpaid, totalRevenue };
  }, [enrichedMembers, memberPayments]);

  const removableMembers = filteredMembers.filter(m => !m.isCreator && !m.isCurrentUser);

  return (
    <div className="space-y-3">
      {paymentSettings?.enabled && (
        <div className="grid grid-cols-4 gap-2 p-3 bg-muted rounded-lg">
          <div className="text-center">
            <div className="text-lg font-bold text-green-500">{stats.paid}</div>
            <div className="text-caption text-muted-foreground">Paid</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-orange-500">{stats.expired}</div>
            <div className="text-caption text-muted-foreground">Expired</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-muted-foreground">{stats.unpaid}</div>
            <div className="text-caption text-muted-foreground">Unpaid</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{stats.totalRevenue.toFixed(3)}</div>
            <div className="text-caption text-muted-foreground">HBD</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-members"
          />
        </div>

        {paymentSettings?.enabled && (
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[120px] h-9" data-testid="select-status-filter">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Button 
          variant="outline" 
          size="sm"
          onClick={exportMemberList}
          data-testid="button-export-members"
        >
          <Download className="w-3 h-3 mr-1" />
          Export
        </Button>

        {selectedMembers.size > 0 && onBatchRemove && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBatchRemove}
            disabled={isUpdating}
            data-testid="button-batch-remove"
            title="Stage selected members for removal (saves when you click Save Changes)"
          >
            <X className="w-3 h-3 mr-1" />
            Stage Removal ({selectedMembers.size})
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded text-caption text-muted-foreground">
        {onBatchRemove && removableMembers.length > 0 && (
          <Checkbox
            checked={selectedMembers.size === removableMembers.length && removableMembers.length > 0}
            onCheckedChange={toggleSelectAll}
            data-testid="checkbox-select-all"
          />
        )}
        <button 
          onClick={() => toggleSort('username')}
          className="flex items-center gap-1 hover:text-foreground flex-1"
        >
          Member
          {sortField === 'username' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
        {paymentSettings?.enabled && (
          <>
            <button 
              onClick={() => toggleSort('status')}
              className="flex items-center gap-1 hover:text-foreground w-20"
            >
              Status
              {sortField === 'status' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
            <button 
              onClick={() => toggleSort('joinDate')}
              className="flex items-center gap-1 hover:text-foreground w-24"
            >
              Joined
              {sortField === 'joinDate' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
            <button 
              onClick={() => toggleSort('amount')}
              className="flex items-center gap-1 hover:text-foreground w-20"
            >
              Amount
              {sortField === 'amount' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
          </>
        )}
        <div className="w-16">Actions</div>
      </div>

      <ScrollArea className="h-[280px] rounded-md border">
        <div className="p-2 space-y-1">
          {filteredMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No members found</p>
            </div>
          ) : (
            filteredMembers.map((member) => {
              const canRemove = !member.isCreator && !member.isCurrentUser;
              
              return (
                <div
                  key={member.username}
                  className="flex items-center gap-2 p-2 rounded-md hover-elevate"
                  data-testid={`member-row-${member.username}`}
                >
                  {onBatchRemove && canRemove && (
                    <Checkbox
                      checked={selectedMembers.has(member.username)}
                      onCheckedChange={() => toggleSelectMember(member.username)}
                      data-testid={`checkbox-member-${member.username}`}
                    />
                  )}
                  {onBatchRemove && !canRemove && <div className="w-4" />}
                  
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                      {getInitials(member.username)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-body font-medium truncate">@{member.username}</span>
                      {member.isCreator && (
                        <Badge variant="secondary" className="gap-0.5 px-1.5 py-0 text-xs">
                          <Crown className="w-2.5 h-2.5" />
                          Creator
                        </Badge>
                      )}
                      {member.isCurrentUser && (
                        <Badge variant="outline" className="px-1.5 py-0 text-xs">You</Badge>
                      )}
                      {member.isNew && (
                        <Badge className="bg-green-500 px-1.5 py-0 text-xs">New</Badge>
                      )}
                    </div>
                  </div>

                  {paymentSettings?.enabled && (
                    <>
                      <div className="w-20 flex-shrink-0">
                        <Badge 
                          variant={member.status === 'paid' ? 'default' : member.status === 'expired' ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {member.status === 'paid' && <Check className="w-2.5 h-2.5 mr-0.5" />}
                          {member.status === 'expired' && <Clock className="w-2.5 h-2.5 mr-0.5" />}
                          {member.status}
                        </Badge>
                      </div>
                      
                      <div className="w-24 flex-shrink-0 text-caption text-muted-foreground">
                        {member.joinDate ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">
                                {formatDistanceToNow(new Date(member.joinDate), { addSuffix: true })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {format(new Date(member.joinDate), 'MMM d, yyyy HH:mm')}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground/50">--</span>
                        )}
                      </div>
                      
                      <div className="w-20 flex-shrink-0 text-caption font-medium">
                        {member.amount ? (
                          <span className="text-primary">{member.amount}</span>
                        ) : (
                          <span className="text-muted-foreground/50">--</span>
                        )}
                      </div>
                    </>
                  )}

                  <div className="w-16 flex-shrink-0 flex items-center gap-1">
                    {member.payment?.txId && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openTransaction(member.payment!.txId)}
                            data-testid={`button-receipt-${member.username}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View payment receipt</TooltipContent>
                      </Tooltip>
                    )}
                    {canRemove && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => onRemoveMember(member.username)}
                        disabled={isUpdating}
                        data-testid={`button-remove-${member.username}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between text-caption text-muted-foreground flex-wrap gap-2">
        <span>Showing {filteredMembers.length} of {members.length} members</span>
        <div className="flex items-center gap-3">
          {selectedMembers.size > 0 && (
            <span>{selectedMembers.size} selected</span>
          )}
        </div>
      </div>
    </div>
  );
}
