import { useState } from 'react';
import { Key, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { loadMemoKeyEncrypted, removeSavedMemoKey } from '@/lib/hive';

interface UnlockMemoKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlock: () => void;
}

export function UnlockMemoKeyDialog({ open, onOpenChange, onUnlock }: UnlockMemoKeyDialogProps) {
  const [passphraseInput, setPassphraseInput] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const { toast } = useToast();

  const handleUnlock = async () => {
    if (!passphraseInput.trim()) {
      toast({
        title: 'Passphrase Required',
        description: 'Please enter your passphrase to unlock your saved memo key',
        variant: 'destructive',
      });
      return;
    }

    setIsUnlocking(true);

    try {
      const decryptedKey = await loadMemoKeyEncrypted(passphraseInput.trim());
      
      if (decryptedKey) {
        toast({
          title: 'Memo Key Unlocked',
          description: 'You can now decrypt messages this session',
        });
        setPassphraseInput('');
        onOpenChange(false);
        onUnlock();
      } else {
        toast({
          title: 'No Saved Memo Key',
          description: 'Please enter your memo key manually',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('[UNLOCK] Failed to decrypt memo key:', error);
      toast({
        title: 'Wrong Passphrase',
        description: 'The passphrase you entered is incorrect. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleForget = () => {
    if (confirm('Are you sure you want to remove your saved encrypted memo key? You\'ll need to enter it again.')) {
      removeSavedMemoKey();
      toast({
        title: 'Memo Key Removed',
        description: 'Your saved memo key has been deleted',
      });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-unlock-memo-key">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Unlock Saved Memo Key
          </DialogTitle>
          <DialogDescription>
            Your memo key is saved encrypted in this browser. Enter your passphrase to unlock it for this session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-passphrase" className="text-sm font-medium">
              Passphrase
            </Label>
            <Input
              id="unlock-passphrase"
              data-testid="input-unlock-passphrase"
              type="password"
              placeholder="Enter your passphrase"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleUnlock();
                }
              }}
              disabled={isUnlocking}
              autoFocus
            />
            <p className="text-caption text-tertiary">
              This is the passphrase you chose when saving your memo key
            </p>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleForget}
            disabled={isUnlocking}
            data-testid="button-forget-memo-key"
          >
            <X className="w-4 h-4 mr-2" />
            Forget Saved Key
          </Button>
          <div className="flex gap-2 flex-1 justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setPassphraseInput('');
                onOpenChange(false);
              }}
              disabled={isUnlocking}
              data-testid="button-cancel-unlock"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUnlock}
              disabled={!passphraseInput.trim() || isUnlocking}
              data-testid="button-submit-unlock"
            >
              {isUnlocking ? 'Unlocking...' : 'Unlock'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
