import { EyeOff, Eye, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHiddenConversations } from '@/contexts/HiddenConversationsContext';
import { useToast } from '@/hooks/use-toast';

interface HiddenChatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HiddenChatsModal({ open, onOpenChange }: HiddenChatsModalProps) {
  const { 
    hiddenConversations, 
    unhideConversation, 
    unhideAll,
    hiddenGroups,
    unhideGroup,
    unhideAllGroups,
    getHiddenGroupName
  } = useHiddenConversations();
  const { toast } = useToast();

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const handleUnhide = (username: string) => {
    unhideConversation(username);
    toast({
      title: 'Chat Unhidden',
      description: `@${username} is now visible in your conversations`,
    });
  };

  const handleUnhideGroup = (groupId: string) => {
    const groupName = getHiddenGroupName(groupId);
    unhideGroup(groupId);
    toast({
      title: 'Group Unhidden',
      description: `"${groupName || 'Group'}" is now visible in your conversations`,
    });
  };

  const handleUnhideAll = () => {
    unhideAll();
    toast({
      title: 'All Chats Unhidden',
      description: 'All hidden conversations are now visible',
    });
  };

  const handleUnhideAllGroups = () => {
    unhideAllGroups();
    toast({
      title: 'All Groups Unhidden',
      description: 'All hidden groups are now visible',
    });
  };

  const totalHidden = hiddenConversations.length + hiddenGroups.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-hidden-chats">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EyeOff className="w-5 h-5" />
            Hidden Items
          </DialogTitle>
          <DialogDescription>
            Manage conversations and groups hidden from your sidebar.
          </DialogDescription>
        </DialogHeader>

        {totalHidden === 0 ? (
          <div className="py-8 text-center">
            <EyeOff className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-body text-muted-foreground">No hidden items</p>
            <p className="text-caption text-muted-foreground mt-1">
              Hidden chats and groups will appear here
            </p>
          </div>
        ) : (
          <Tabs defaultValue="chats" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chats" data-testid="tab-hidden-chats">
                Chats ({hiddenConversations.length})
              </TabsTrigger>
              <TabsTrigger value="groups" data-testid="tab-hidden-groups">
                Groups ({hiddenGroups.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="chats" className="mt-4">
              {hiddenConversations.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-caption text-muted-foreground">No hidden chats</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="max-h-[300px] pr-4">
                    <div className="space-y-2">
                      {hiddenConversations.map((username) => (
                        <div
                          key={username}
                          className="flex items-center justify-between p-3 rounded-md border hover-elevate"
                          data-testid={`hidden-chat-${username}`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <Avatar className="w-10 h-10 flex-shrink-0">
                              <AvatarFallback className="bg-primary/10 text-primary font-medium">
                                {getInitials(username)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-body font-medium truncate">@{username}</p>
                              <p className="text-caption text-muted-foreground">Hidden conversation</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnhide(username)}
                            data-testid={`button-unhide-${username}`}
                            className="flex-shrink-0 gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            Unhide
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="flex justify-end pt-4 border-t mt-4">
                    <Button
                      variant="outline"
                      onClick={handleUnhideAll}
                      data-testid="button-unhide-all-chats"
                    >
                      Unhide All Chats ({hiddenConversations.length})
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
            
            <TabsContent value="groups" className="mt-4">
              {hiddenGroups.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-caption text-muted-foreground">No hidden groups</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="max-h-[300px] pr-4">
                    <div className="space-y-2">
                      {hiddenGroups.map((groupId) => (
                        <div
                          key={groupId}
                          className="flex items-center justify-between p-3 rounded-md border hover-elevate"
                          data-testid={`hidden-group-${groupId}`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <Avatar className="w-10 h-10 flex-shrink-0">
                              <AvatarFallback className="bg-primary/20 text-primary font-medium">
                                <Users className="w-4 h-4" />
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-body font-medium truncate">
                                {getHiddenGroupName(groupId) || 'Unknown Group'}
                              </p>
                              <p className="text-caption text-muted-foreground">Hidden group</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnhideGroup(groupId)}
                            data-testid={`button-unhide-group-${groupId}`}
                            className="flex-shrink-0 gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            Unhide
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="flex justify-end pt-4 border-t mt-4">
                    <Button
                      variant="outline"
                      onClick={handleUnhideAllGroups}
                      data-testid="button-unhide-all-groups"
                    >
                      Unhide All Groups ({hiddenGroups.length})
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
