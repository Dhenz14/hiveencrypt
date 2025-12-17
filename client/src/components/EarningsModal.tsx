import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DollarSign, Clock, TrendingUp, Users, Calendar, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MemberPayment, PaymentSettings } from '@shared/schema';
import { formatDistanceToNow, format } from 'date-fns';

interface EarningsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  memberPayments?: MemberPayment[];
  paymentSettings?: PaymentSettings;
}

export function EarningsModal({
  open,
  onOpenChange,
  groupName,
  memberPayments = [],
  paymentSettings,
}: EarningsModalProps) {
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const parseAmount = (amountStr: string): number => {
    const match = amountStr.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  };

  const totalEarnings = memberPayments.reduce((sum, payment) => {
    return sum + parseAmount(payment.amount);
  }, 0);

  const activeMembers = memberPayments.filter(p => p.status === 'active').length;
  const expiredMembers = memberPayments.filter(p => p.status === 'expired').length;

  const sortedPayments = [...memberPayments].sort((a, b) => {
    return new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime();
  });

  const getMemberDuration = (paidAt: string): string => {
    try {
      return formatDistanceToNow(new Date(paidAt), { addSuffix: false });
    } catch {
      return 'Unknown';
    }
  };

  const formatPaymentDate = (paidAt: string): string => {
    try {
      return format(new Date(paidAt), 'MMM d, yyyy');
    } catch {
      return 'Unknown';
    }
  };

  const openTransaction = (txId: string) => {
    window.open(`https://hivescan.info/tx/${txId}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Group Earnings
          </DialogTitle>
          <DialogDescription>
            Payment history for {groupName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-primary mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-lg font-bold">{totalEarnings.toFixed(3)}</span>
              </div>
              <p className="text-caption text-muted-foreground">Total HBD</p>
            </div>
            
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-lg font-bold">{activeMembers}</span>
              </div>
              <p className="text-caption text-muted-foreground">Active</p>
            </div>
            
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-lg font-bold">{memberPayments.length}</span>
              </div>
              <p className="text-caption text-muted-foreground">Total Paid</p>
            </div>
          </div>

          {paymentSettings?.enabled && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-caption text-muted-foreground">Current Price:</span>
              <Badge variant="secondary">
                {paymentSettings.amount} HBD / {paymentSettings.type === 'recurring' ? 'recurring' : 'one-time'}
              </Badge>
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="text-body font-medium mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Payment History ({memberPayments.length})
            </h4>
            
            {sortedPayments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-body">No payments yet</p>
                <p className="text-caption">Members who pay will appear here</p>
              </div>
            ) : (
              <ScrollArea className="h-[280px]">
                <div className="space-y-2 pr-4">
                  {sortedPayments.map((payment, index) => (
                    <div
                      key={`${payment.username}-${payment.txId}-${index}`}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover-elevate"
                      data-testid={`earnings-row-${payment.username}`}
                    >
                      <Avatar className="w-9 h-9 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                          {getInitials(payment.username)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-body truncate">@{payment.username}</span>
                          <Badge 
                            variant={payment.status === 'active' ? 'default' : 'secondary'}
                            className="text-xs h-5"
                          >
                            {payment.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-caption text-muted-foreground">
                          <span>{formatPaymentDate(payment.paidAt)}</span>
                          <span>•</span>
                          <span>Member for {getMemberDuration(payment.paidAt)}</span>
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
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
