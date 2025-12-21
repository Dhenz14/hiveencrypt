import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  UserMinus,
  Trash2
} from 'lucide-react';

interface ExpiredMember {
  groupId: string;
  groupName: string;
  username: string;
}

interface ExpiredMembersAlertProps {
  expiredMembers: ExpiredMember[];
  onRemove: (groupId: string, username: string) => void;
  onRemoveAll: () => void;
}

export function ExpiredMembersAlert({
  expiredMembers,
  onRemove,
  onRemoveAll,
}: ExpiredMembersAlertProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (expiredMembers.length === 0) {
    return null;
  }

  const groupedByGroup = expiredMembers.reduce((acc, member) => {
    if (!acc[member.groupId]) {
      acc[member.groupId] = {
        groupName: member.groupName,
        members: [],
      };
    }
    acc[member.groupId].members.push(member.username);
    return acc;
  }, {} as Record<string, { groupName: string; members: string[] }>);

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <Alert 
      variant="destructive" 
      className="mb-4"
      data-testid="alert-expired-members"
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="mb-0">
              Expired Members ({expiredMembers.length})
            </AlertTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemoveAll}
              className="h-7 text-xs"
              data-testid="button-remove-all-expired"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remove All
            </Button>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                data-testid="button-toggle-expired-list"
              >
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        
        <AlertDescription className="mt-1 text-sm">
          Members with expired subscriptions need to be removed or renewed.
        </AlertDescription>

        <CollapsibleContent>
          <ScrollArea className="max-h-60 mt-3">
            <div className="space-y-3">
              {Object.entries(groupedByGroup).map(([groupId, { groupName, members }]) => (
                <div 
                  key={groupId} 
                  className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
                  data-testid={`expired-group-${groupId}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{groupName}</span>
                    <Badge variant="outline" className="text-xs">
                      {members.length} expired
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {members.map((username) => (
                      <div 
                        key={`${groupId}-${username}`}
                        className="flex items-center justify-between py-1"
                        data-testid={`expired-member-${groupId}-${username}`}
                      >
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">
                              {getInitials(username)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">@{username}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemove(groupId, username)}
                          className="h-6 text-xs text-destructive hover:text-destructive"
                          data-testid={`button-remove-${groupId}-${username}`}
                        >
                          <UserMinus className="h-3 w-3 mr-1" />
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  );
}
