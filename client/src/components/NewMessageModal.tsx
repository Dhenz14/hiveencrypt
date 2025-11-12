import { useState } from 'react';
import { Search, UserPlus, AlertCircle } from 'lucide-react';
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

interface NewMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartChat: (username: string) => void;
}

export function NewMessageModal({ open, onOpenChange, onStartChat }: NewMessageModalProps) {
  const [username, setUsername] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline">New Message</DialogTitle>
          <DialogDescription className="text-body">
            Start a new encrypted conversation with a Hive user
          </DialogDescription>
        </DialogHeader>

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
