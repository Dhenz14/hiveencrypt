import { useState } from 'react';
import { Search, UserPlus, AlertCircle, UserCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { preloadFollowingList } from '@/lib/hiveFollowing';

interface NewMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartChat: (username: string) => void;
}

export function NewMessageModal({ open, onOpenChange, onStartChat }: NewMessageModalProps) {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch following list for suggested contacts
  const { data: followingList, isPending: isLoadingFollowing } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username && open,  // Only fetch when modal is open
    staleTime: 0,  // Always refetch to ensure suggested contacts are current
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',  // Force refetch when modal opens
    placeholderData: (previousData) => previousData,  // Retain previous data during refetch
  });
  
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cleanUsername = username.toLowerCase().trim().replace('@', '');
    
    if (!cleanUsername) {
      setError('Please enter a username');
      return;
    }

    if (cleanUsername.length < 3 || cleanUsername.length > 16) {
      setError('Username must be between 3 and 16 characters');
      return;
    }

    if (!/^[a-z0-9.-]+$/.test(cleanUsername)) {
      setError('Invalid username format. Use only lowercase letters, numbers, dots, and hyphens.');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      onStartChat(cleanUsername);
      setUsername('');
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start conversation');
    } finally {
      setIsValidating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setUsername('');
      setError(null);
    }
    onOpenChange(newOpen);
  };
  
  const handleSelectSuggested = (suggestedUsername: string) => {
    onStartChat(suggestedUsername);
    setUsername('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline">New Message</DialogTitle>
          <DialogDescription className="text-body">
            Start a new encrypted conversation with a Hive user
          </DialogDescription>
        </DialogHeader>

        {/* Suggested Contacts Section */}
        {followingList && followingList.length > 0 ? (
          <div className="space-y-2">
            <Label className="text-caption">Suggested Contacts</Label>
            <ScrollArea className="h-[200px] border rounded-md">
              <div className="p-2 space-y-1">
                {followingList.slice(0, 50).map((followedUser) => (
                  <button
                    key={followedUser}
                    type="button"
                    onClick={() => handleSelectSuggested(followedUser)}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover-elevate text-left"
                    data-testid={`suggested-contact-${followedUser}`}
                  >
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                        {getInitials(followedUser)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-body font-medium truncate flex-1">@{followedUser}</span>
                    <UserCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
              </div>
            </ScrollArea>
            <p className="text-caption text-muted-foreground">
              Or enter a username manually below
            </p>
          </div>
        ) : isLoadingFollowing ? (
          <div className="space-y-2">
            <Label className="text-caption">Suggested Contacts</Label>
            <div className="h-[200px] border rounded-md flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-caption text-muted-foreground">Loading your following list...</p>
              </div>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-username" className="text-caption">
              Recipient Username
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                id="new-username"
                type="text"
                placeholder="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                disabled={isValidating}
                className="pl-9 h-11"
                autoComplete="off"
                autoFocus
                data-testid="input-new-message-username"
              />
            </div>
            <p className="text-caption text-muted-foreground">
              Enter the Hive username (without @)
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isValidating}
              className="h-11"
              data-testid="button-cancel-new-message"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!username.trim() || isValidating}
              className="h-11"
              data-testid="button-start-chat"
            >
              {isValidating ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  Validating...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Start Chat
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
