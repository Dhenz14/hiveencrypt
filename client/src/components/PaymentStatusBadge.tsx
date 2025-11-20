import { DollarSign, Check, AlertTriangle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PaymentSettings, MemberPayment } from '@shared/schema';
import { checkPaymentStatus } from '@/lib/paymentVerification';

interface PaymentStatusBadgeProps {
  paymentSettings?: PaymentSettings;
  memberPayments?: MemberPayment[];
  username: string;
  className?: string;
  showLabel?: boolean;
}

export function PaymentStatusBadge({
  paymentSettings,
  memberPayments,
  username,
  className,
  showLabel = true,
}: PaymentStatusBadgeProps) {
  // No payment required - don't show badge
  if (!paymentSettings?.enabled) {
    return null;
  }

  const status = checkPaymentStatus(memberPayments, username, paymentSettings);

  const getBadgeVariant = () => {
    switch (status.status) {
      case 'paid':
        return 'default';
      case 'expired':
        return 'destructive';
      case 'unpaid':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getBadgeIcon = () => {
    switch (status.status) {
      case 'paid':
        return <Check className="w-3 h-3" />;
      case 'expired':
        return <XCircle className="w-3 h-3" />;
      case 'unpaid':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <DollarSign className="w-3 h-3" />;
    }
  };

  const getBadgeText = () => {
    switch (status.status) {
      case 'paid':
        if (paymentSettings.type === 'recurring' && status.daysUntilDue !== undefined) {
          return showLabel
            ? `Paid • ${status.daysUntilDue}d until due`
            : `${status.daysUntilDue}d`;
        }
        return showLabel ? 'Paid' : '✓';
      case 'expired':
        return showLabel ? 'Payment Due' : '!';
      case 'unpaid':
        return showLabel ? 'Payment Required' : '$';
      default:
        return showLabel ? 'Unknown' : '?';
    }
  };

  return (
    <Badge
      variant={getBadgeVariant()}
      className={cn('flex items-center gap-1', className)}
      data-testid={`badge-payment-status-${status.status}`}
    >
      {getBadgeIcon()}
      <span className="text-caption">{getBadgeText()}</span>
    </Badge>
  );
}

interface PaymentRequiredIndicatorProps {
  paymentSettings: PaymentSettings;
  className?: string;
}

export function PaymentRequiredIndicator({
  paymentSettings,
  className,
}: PaymentRequiredIndicatorProps) {
  if (!paymentSettings.enabled) {
    return null;
  }

  return (
    <Badge variant="secondary" className={cn('flex items-center gap-1', className)}>
      <DollarSign className="w-3 h-3" />
      <span className="text-caption">
        {paymentSettings.amount} HBD{' '}
        {paymentSettings.type === 'recurring' ? '/ recurring' : '/ one-time'}
      </span>
    </Badge>
  );
}
