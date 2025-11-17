import { useState, useEffect } from 'react';
import { Users, Plus, X, AlertCircle, Crown, Loader2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getHiveMemoKey } from '@/lib/hive';

interface ManageMembersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  currentMembers: string[];
  creator: string;
  currentUsername?: string;
  onUpdateMembers: (newMembers: string[]) => Promise<void>;
}

export function ManageMembersModal({ 
  open, 
  onOpenChange, 
  groupName,
  currentMembers,
  creator,
  currentUsername,
  onUpdateMembers
}: ManageMembersModalProps) {
  const [newMemberInput, setNewMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>(currentMembers);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset members when modal opens with fresh data
  useEffect(() => {
    if (open) {
      setMembers(currentMembers);
      setNewMemberInput('');
      setError(null);
    }
  }, [open, currentMembers]);

  const validateUsername = (username: string): string | null => {
    const clean = username.toLowerCase().trim().replace('@', '');
    
    if (!clean) {
      return 'Username cannot be empty';
    }

    if (clean.length < 3 || clean.length > 16) {
      return 'Username must be between 3 and 16 characters';
    }

    if (!/^[a-z0-9.-]+$/.test(clean)) {
      return 'Invalid username format. Use only lowercase letters, numbers, dots, and hyphens.';
    }

    if (clean === currentUsername) {
      return 'You are already in this group';
    }

    if (members.includes(clean)) {
      return 'Member already in group';
    }

    return null;
  };

  const handleAddMember = async () => {
    const validationError = validateUsername(newMemberInput);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const cleanUsername = newMemberInput.toLowerCase().trim().replace('@', '');
    
    // Validate username exists on Hive blockchain
    setIsValidating(true);
    setError(null);
    
    try {
      const memoKey = await getHiveMemoKey(cleanUsername);
      
      if (!memoKey) {
        setError(`User @${cleanUsername} not found on Hive blockchain`);
        setIsValidating(false);
        return;
      }
      
      // Username exists, add to members
      setMembers([...members, cleanUsername]);
      setNewMemberInput('');
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to verify username';
      setError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveMember = (username: string) => {
    // Prevent removing creator or current user
    if (username === creator) {
      setError('Cannot remove the group creator');
      return;
    }
    
    if (username === currentUsername) {
      setError('Cannot remove yourself from the group');
      return;
    }

    setMembers(members.filter(m => m !== username));
    setError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (members.length < 2) {
      setError('Groups must have at least 2 members');
      return;
    }

    // Check if anything changed
    const added = members.filter(m => !currentMembers.includes(m));
    const removed = currentMembers.filter(m => !members.includes(m));
    
    if (added.length === 0 && removed.length === 0) {
      setError('No changes made to group membership');
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      await onUpdateMembers(members);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update group members');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isUpdating) {
      setNewMemberInput('');
      setError(null);
    }
    onOpenChange(newOpen);
  };

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  // Calculate changes for preview
  const added = members.filter(m => !currentMembers.includes(m));
  const removed = currentMembers.filter(m => !members.includes(m));
  const hasChanges = added.length > 0 || removed.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-manage-members">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Manage Members
          </DialogTitle>
          <DialogDescription>
            Add or remove members from "{groupName}"
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive" data-testid="alert-manage-members-error">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Add New Member */}
          <div className="space-y-2">
            <Label htmlFor="add-member" className="text-caption">
              Add New Member
            </Label>
            <div className="flex gap-2">
              <Input
                id="add-member"
                type="text"
                placeholder="username"
                value={newMemberInput}
                onChange={(e) => {
                  setNewMemberInput(e.target.value);
                  setError(null);
                }}
                onKeyPress={handleKeyPress}
                disabled={isUpdating || isValidating}
                className="h-11 flex-1"
                autoComplete="off"
                data-testid="input-add-member"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddMember}
                disabled={!newMemberInput.trim() || isUpdating || isValidating}
                className="h-11 w-11"
                data-testid="button-add-member"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {isValidating ? 'Verifying username on Hive blockchain...' : 'Press Enter or click + to add a member'}
            </p>
          </div>

          {/* Current Members List */}
          <div className="space-y-2">
            <Label className="text-caption">
              Current Members ({members.length})
            </Label>
            <ScrollArea className="h-[280px] rounded-md border p-3">
              <div className="space-y-2">
                {members.map((member) => {
                  const isCreator = member === creator;
                  const isCurrentUser = member === currentUsername;
                  const canRemove = !isCreator && !isCurrentUser;
                  
                  return (
                    <div
                      key={member}
                      className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                      data-testid={`member-item-${member}`}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                          {getInitials(member)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-medium truncate">
                            @{member}
                          </span>
                          {isCreator && (
                            <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-caption">
                              <Crown className="w-3 h-3" />
                              Creator
                            </Badge>
                          )}
                          {isCurrentUser && (
                            <Badge variant="outline" className="px-2 py-0.5 text-caption">
                              You
                            </Badge>
                          )}
                          {added.includes(member) && (
                            <Badge variant="default" className="bg-green-500 px-2 py-0.5 text-caption">
                              New
                            </Badge>
                          )}
                        </div>
                      </div>

                      {canRemove && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMember(member)}
                          disabled={isUpdating}
                          className="h-8 w-8 flex-shrink-0"
                          data-testid={`button-remove-member-${member}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Changes Preview */}
          {hasChanges && (
            <Alert data-testid="alert-changes-preview">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                {added.length > 0 && (
                  <div className="mb-1">
                    <strong>Adding:</strong> {added.map(m => `@${m}`).join(', ')}
                  </div>
                )}
                {removed.length > 0 && (
                  <div>
                    <strong>Removing:</strong> {removed.map(m => `@${m}`).join(', ')}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isUpdating}
              data-testid="button-cancel-manage"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isUpdating || !hasChanges}
              data-testid="button-save-members"
            >
              {isUpdating ? 'Updating...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
