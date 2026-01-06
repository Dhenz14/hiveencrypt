import { useState, useEffect, useRef } from 'react';
import { Search, UserPlus, AlertCircle, UserCheck, Loader2 } from 'lucide-react';
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
import { hiveClient } from '@/lib/hiveClient';

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Fetch following list for suggested contacts
  const { data: followingList, isPending: isLoadingFollowing } = useQuery({
    queryKey: ['following', user?.username],
    queryFn: async () => {
      if (!user?.username) return [];
      return await preloadFollowingList(user.username);
    },
    enabled: !!user?.username && open,
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
  });
  
  // Username autocomplete query - debounced
  const [debouncedUsername, setDebouncedUsername] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      const clean = username.toLowerCase().trim().replace('@', '');
      if (clean.length >= 2) {
        setDebouncedUsername(clean);
      } else {
        setDebouncedUsername('');
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [username]);
  
  const { data: autocompleteResults, isFetching: isLoadingAutocomplete } = useQuery({
    queryKey: ['lookupAccounts', debouncedUsername],
    queryFn: async () => {
      if (!debouncedUsername || debouncedUsername.length < 2) return [];
      return await hiveClient.lookupAccounts(debouncedUsername, 8);
    },
    enabled: debouncedUsername.length >= 2 && open,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
  
  // Show suggestions dropdown when we have results and user is typing
  useEffect(() => {
    if (autocompleteResults && autocompleteResults.length > 0 && username.length >= 2) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [autocompleteResults, username]);
  
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
      setShowSuggestions(false);
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
      setShowSuggestions(false);
    }
    onOpenChange(newOpen);
  };
  
  const handleSelectSuggested = (suggestedUsername: string) => {
    onStartChat(suggestedUsername);
    setUsername('');
    setShowSuggestions(false);
    onOpenChange(false);
  };
  
  const handleSelectAutocomplete = (selectedUsername: string) => {
    setUsername(selectedUsername);
    setShowSuggestions(false);
    inputRef.current?.focus();
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
              {isLoadingAutocomplete && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin z-10" />
              )}
              <Input
                ref={inputRef}
                id="new-username"
                type="text"
                placeholder="Start typing a username..."
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                onFocus={() => {
                  if (autocompleteResults && autocompleteResults.length > 0 && username.length >= 2) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  // Delay hiding to allow click on suggestion
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                disabled={isValidating}
                className="pl-9 pr-9 h-11"
                autoComplete="off"
                autoFocus
                data-testid="input-new-message-username"
              />
              
              {/* Autocomplete dropdown */}
              {showSuggestions && autocompleteResults && autocompleteResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-[200px] overflow-auto">
                  {autocompleteResults.map((suggestedUser) => (
                    <button
                      key={suggestedUser}
                      type="button"
                      onClick={() => handleSelectAutocomplete(suggestedUser)}
                      className="w-full flex items-center gap-3 p-2 hover:bg-accent text-left"
                      data-testid={`autocomplete-${suggestedUser}`}
                    >
                      <Avatar className="w-6 h-6 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium text-[10px]">
                          {getInitials(suggestedUser)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">@{suggestedUser}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-caption text-muted-foreground">
              Type at least 2 characters to search Hive users
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
