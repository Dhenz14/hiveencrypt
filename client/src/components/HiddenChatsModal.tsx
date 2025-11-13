import { EyeOff, Eye } from 'lucide-react';
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
import { useHiddenConversations } from '@/contexts/HiddenConversationsContext';
import { useToast } from '@/hooks/use-toast';

interface HiddenChatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HiddenChatsModal({ open, onOpenChange }: HiddenChatsModalProps) {
  const { hiddenConversations, unhideConversation, unhideAll } = useHiddenConversations();
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

  const handleUnhideAll = () => {
    unhideAll();
    toast({
      title: 'All Chats Unhidden',
      description: 'All hidden conversations are now visible',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-hidden-chats">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EyeOff className="w-5 h-5" />
            Hidden Chats
          </DialogTitle>
          <DialogDescription>
            Manage conversations hidden from your sidebar. Unhide them to see them again.
          </DialogDescription>
        </DialogHeader>

        {hiddenConversations.length === 0 ? (
          <div className="py-8 text-center">
            <EyeOff className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-body text-muted-foreground">No hidden chats</p>
            <p className="text-caption text-muted-foreground mt-1">
              Hidden conversations will appear here
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[400px] pr-4">
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

            <div className="flex justify-end pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleUnhideAll}
                data-testid="button-unhide-all"
              >
                Unhide All ({hiddenConversations.length})
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
