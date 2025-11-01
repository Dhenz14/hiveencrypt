import { Activity, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlockchainSyncStatus } from '@shared/schema';

interface BlockchainSyncIndicatorProps {
  status: BlockchainSyncStatus;
  className?: string;
}

export function BlockchainSyncIndicator({ status, className }: BlockchainSyncIndicatorProps) {
  const getIcon = () => {
    switch (status.status) {
      case 'syncing':
        return <Activity className="w-3 h-3 animate-pulse" />;
      case 'synced':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'error':
        return <AlertCircle className="w-3 h-3" />;
      default:
        return null;
    }
  };

  const getText = () => {
    switch (status.status) {
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'Synced';
      case 'error':
        return 'Error';
      default:
        return '';
    }
  };

  const getColor = () => {
    switch (status.status) {
      case 'syncing':
        return 'text-primary';
      case 'synced':
        return 'text-green-600 dark:text-green-500';
      case 'error':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div 
      className={cn(
        'flex items-center gap-1.5 text-caption',
        getColor(),
        className
      )}
      data-testid="blockchain-sync-indicator"
    >
      {getIcon()}
      <span>{getText()}</span>
    </div>
  );
}
