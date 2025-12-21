import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  Bell,
  BellOff,
  DollarSign, 
  Clock, 
  UserPlus, 
  UserMinus,
  UserCheck,
  AlertTriangle,
  Trash2,
  CheckCheck,
  Filter,
  ExternalLink
} from 'lucide-react';
import type { GroupConversationCache } from '@shared/schema';
import { formatDistanceToNow } from 'date-fns';

export interface AdminNotification {
  id: string;
  type: 'payment' | 'expiry_warning' | 'expiry' | 'join_request' | 'member_joined' | 'member_left';
  groupId: string;
  groupName: string;
  username?: string;
  amount?: string;
  daysUntilExpiry?: number;
  timestamp: string;
  read: boolean;
}

interface NotificationCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupConversationCache[];
  currentUsername?: string;
  onNavigateToGroup?: (groupId: string) => void;
}

type NotificationFilter = 'all' | AdminNotification['type'];

const STORAGE_KEY_PREFIX = 'hive-messenger-notifications-';

function getStorageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

export function getNotifications(username: string): AdminNotification[] {
  try {
    const stored = localStorage.getItem(getStorageKey(username));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addNotification(
  username: string, 
  notification: Omit<AdminNotification, 'id' | 'timestamp' | 'read'>
): AdminNotification {
  const notifications = getNotifications(username);
  
  const newNotification: AdminNotification = {
    ...notification,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    read: false,
  };
  
  notifications.unshift(newNotification);
  
  const maxNotifications = 100;
  const trimmed = notifications.slice(0, maxNotifications);
  
  localStorage.setItem(getStorageKey(username), JSON.stringify(trimmed));
  
  return newNotification;
}

export function markAsRead(username: string, notificationId: string): void {
  const notifications = getNotifications(username);
  const updated = notifications.map(n => 
    n.id === notificationId ? { ...n, read: true } : n
  );
  localStorage.setItem(getStorageKey(username), JSON.stringify(updated));
}

export function markAsUnread(username: string, notificationId: string): void {
  const notifications = getNotifications(username);
  const updated = notifications.map(n => 
    n.id === notificationId ? { ...n, read: false } : n
  );
  localStorage.setItem(getStorageKey(username), JSON.stringify(updated));
}

export function markAllAsRead(username: string): void {
  const notifications = getNotifications(username);
  const updated = notifications.map(n => ({ ...n, read: true }));
  localStorage.setItem(getStorageKey(username), JSON.stringify(updated));
}

export function clearNotifications(username: string): void {
  localStorage.removeItem(getStorageKey(username));
}

export function getUnreadCount(username: string): number {
  const notifications = getNotifications(username);
  return notifications.filter(n => !n.read).length;
}

export function removeNotification(username: string, notificationId: string): void {
  const notifications = getNotifications(username);
  const filtered = notifications.filter(n => n.id !== notificationId);
  localStorage.setItem(getStorageKey(username), JSON.stringify(filtered));
}

const notificationTypeConfig: Record<AdminNotification['type'], {
  icon: typeof Bell;
  label: string;
  colorClass: string;
  bgClass: string;
}> = {
  payment: {
    icon: DollarSign,
    label: 'Payment',
    colorClass: 'text-green-600 dark:text-green-400',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
  },
  expiry_warning: {
    icon: AlertTriangle,
    label: 'Expiry Warning',
    colorClass: 'text-yellow-600 dark:text-yellow-400',
    bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  expiry: {
    icon: Clock,
    label: 'Expired',
    colorClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
  },
  join_request: {
    icon: UserPlus,
    label: 'Join Request',
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
  },
  member_joined: {
    icon: UserCheck,
    label: 'Member Joined',
    colorClass: 'text-primary',
    bgClass: 'bg-primary/10',
  },
  member_left: {
    icon: UserMinus,
    label: 'Member Left',
    colorClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
  },
};

export function NotificationCenter({
  open,
  onOpenChange,
  groups,
  currentUsername,
  onNavigateToGroup,
}: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [typeFilter, setTypeFilter] = useState<NotificationFilter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  const loadNotifications = useCallback(() => {
    if (currentUsername) {
      setNotifications(getNotifications(currentUsername));
    }
  }, [currentUsername]);

  useEffect(() => {
    if (open) {
      loadNotifications();
    }
  }, [open, loadNotifications]);

  const creatorGroups = useMemo(() => {
    return groups.filter(g => g.creator === currentUsername);
  }, [groups, currentUsername]);

  const filteredNotifications = useMemo(() => {
    let result = [...notifications];
    
    if (typeFilter !== 'all') {
      result = result.filter(n => n.type === typeFilter);
    }
    
    if (groupFilter !== 'all') {
      result = result.filter(n => n.groupId === groupFilter);
    }
    
    result.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return result;
  }, [notifications, typeFilter, groupFilter]);

  const unreadCount = useMemo(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  const handleMarkAsRead = (notificationId: string) => {
    if (!currentUsername) return;
    markAsRead(currentUsername, notificationId);
    loadNotifications();
  };

  const handleMarkAsUnread = (notificationId: string) => {
    if (!currentUsername) return;
    markAsUnread(currentUsername, notificationId);
    loadNotifications();
  };

  const handleMarkAllAsRead = () => {
    if (!currentUsername) return;
    markAllAsRead(currentUsername);
    loadNotifications();
  };

  const handleClearAll = () => {
    if (!currentUsername) return;
    clearNotifications(currentUsername);
    loadNotifications();
  };

  const handleRemove = (notificationId: string) => {
    if (!currentUsername) return;
    removeNotification(currentUsername, notificationId);
    loadNotifications();
  };

  const handleNotificationClick = (notification: AdminNotification) => {
    if (!currentUsername) return;
    markAsRead(currentUsername, notification.id);
    loadNotifications();
    if (onNavigateToGroup) {
      onNavigateToGroup(notification.groupId);
      onOpenChange(false);
    }
  };

  const getNotificationMessage = (notification: AdminNotification): string => {
    switch (notification.type) {
      case 'payment':
        return `@${notification.username} paid ${notification.amount} to join`;
      case 'expiry_warning':
        return `@${notification.username}'s subscription expires in ${notification.daysUntilExpiry} days`;
      case 'expiry':
        return `@${notification.username}'s subscription has expired`;
      case 'join_request':
        return `@${notification.username} requested to join`;
      case 'member_joined':
        return `@${notification.username} joined the group`;
      case 'member_left':
        return `@${notification.username} left the group`;
      default:
        return 'Unknown notification';
    }
  };

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-notification-center">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notification Center
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-2" data-testid="badge-unread-count">
                {unreadCount}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Stay updated on your group activities
          </DialogDescription>
        </DialogHeader>

        {creatorGroups.length === 0 ? (
          <div className="text-center py-12">
            <BellOff className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No Groups</p>
            <p className="text-muted-foreground">Create a group to receive notifications</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as NotificationFilter)}>
                <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="payment">Payments</SelectItem>
                  <SelectItem value="expiry_warning">Expiry Warnings</SelectItem>
                  <SelectItem value="expiry">Expired</SelectItem>
                  <SelectItem value="join_request">Join Requests</SelectItem>
                  <SelectItem value="member_joined">Members Joined</SelectItem>
                  <SelectItem value="member_left">Members Left</SelectItem>
                </SelectContent>
              </Select>

              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-group-filter">
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {creatorGroups.map(g => (
                    <SelectItem key={g.groupId} value={g.groupId}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex-1" />

              <Button 
                variant="outline" 
                size="sm"
                onClick={handleMarkAllAsRead}
                disabled={unreadCount === 0}
                data-testid="button-mark-all-read"
              >
                <CheckCheck className="w-4 h-4 mr-2" />
                Mark All Read
              </Button>

              <Button 
                variant="outline" 
                size="sm"
                onClick={handleClearAll}
                disabled={notifications.length === 0}
                data-testid="button-clear-all"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            </div>

            <Separator />

            <ScrollArea className="flex-1">
              <div className="space-y-2 pr-4">
                {filteredNotifications.length === 0 ? (
                  <div className="text-center py-12">
                    <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium">No Notifications</p>
                    <p className="text-muted-foreground">
                      {typeFilter !== 'all' || groupFilter !== 'all' 
                        ? 'No notifications match your filters'
                        : 'You\'re all caught up!'
                      }
                    </p>
                  </div>
                ) : (
                  filteredNotifications.map((notification) => {
                    const config = notificationTypeConfig[notification.type];
                    const Icon = config.icon;
                    
                    return (
                      <div
                        key={notification.id}
                        className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                          notification.read 
                            ? 'bg-muted/30 hover:bg-muted/50' 
                            : 'bg-muted/70 hover:bg-muted'
                        }`}
                        onClick={() => handleNotificationClick(notification)}
                        data-testid={`notification-item-${notification.id}`}
                      >
                        <div className={`p-2 rounded-full flex-shrink-0 ${config.bgClass}`}>
                          <Icon className={`w-4 h-4 ${config.colorClass}`} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant="outline" className="text-xs">
                              {notification.groupName}
                            </Badge>
                            <Badge 
                              variant="secondary" 
                              className={`text-xs ${config.colorClass} ${config.bgClass}`}
                            >
                              {config.label}
                            </Badge>
                            {!notification.read && (
                              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                            )}
                          </div>
                          
                          <p className={`text-sm ${notification.read ? 'text-muted-foreground' : 'text-foreground'}`}>
                            {getNotificationMessage(notification)}
                          </p>
                          
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                          </p>
                        </div>
                        
                        {notification.username && (
                          <Avatar className="w-8 h-8 flex-shrink-0">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(notification.username)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (notification.read) {
                                handleMarkAsUnread(notification.id);
                              } else {
                                handleMarkAsRead(notification.id);
                              }
                            }}
                            data-testid={`button-toggle-read-${notification.id}`}
                          >
                            {notification.read ? (
                              <Bell className="w-3.5 h-3.5" />
                            ) : (
                              <CheckCheck className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove(notification.id);
                            }}
                            data-testid={`button-remove-${notification.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            {filteredNotifications.length > 0 && (
              <div className="text-center text-xs text-muted-foreground pt-2 border-t">
                Showing {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
                {(typeFilter !== 'all' || groupFilter !== 'all') && ' (filtered)'}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useNotificationCount(username?: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!username) {
      setCount(0);
      return;
    }

    const updateCount = () => {
      setCount(getUnreadCount(username));
    };

    updateCount();

    const interval = setInterval(updateCount, 5000);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === getStorageKey(username)) {
        updateCount();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
    };
  }, [username]);

  return count;
}
