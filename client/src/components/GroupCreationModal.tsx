import { useState } from 'react';
import { Users, Plus, X, AlertCircle } from 'lucide-react';
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

interface GroupCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (groupName: string, members: string[]) => Promise<void>;
  currentUsername?: string;
}

export function GroupCreationModal({ 
  open, 
  onOpenChange, 
  onCreateGroup,
  currentUsername 
}: GroupCreationModalProps) {
  const [groupName, setGroupName] = useState('');
  const [newMemberInput, setNewMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      return 'Cannot add yourself to the group';
    }

    if (members.includes(clean)) {
      return 'Member already added';
    }

    return null;
  };

  const handleAddMember = () => {
    const validationError = validateUsername(newMemberInput);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const cleanUsername = newMemberInput.toLowerCase().trim().replace('@', '');
    setMembers([...members, cleanUsername]);
    setNewMemberInput('');
    setError(null);
  };

  const handleRemoveMember = (username: string) => {
    setMembers(members.filter(m => m !== username));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!groupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    if (groupName.trim().length > 50) {
      setError('Group name must be 50 characters or less');
      return;
    }

    if (members.length < 2) {
      setError('Groups must have at least 2 members (excluding yourself)');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await onCreateGroup(groupName.trim(), members);
      
      // Reset form
      setGroupName('');
      setMembers([]);
      setNewMemberInput('');
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setGroupName('');
      setMembers([]);
      setNewMemberInput('');
      setError(null);
    }
    onOpenChange(newOpen);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline flex items-center gap-2">
            <Users className="w-5 h-5" />
            New Group Chat
          </DialogTitle>
          <DialogDescription className="text-body">
            Create a group conversation with multiple members
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Group Name Input */}
          <div className="space-y-2">
            <Label htmlFor="group-name" className="text-caption">
              Group Name
            </Label>
            <Input
              id="group-name"
              type="text"
              placeholder="Weekend Plans, Team Chat..."
              value={groupName}
              onChange={(e) => {
                setGroupName(e.target.value);
                setError(null);
              }}
              disabled={isCreating}
              className="h-11"
              autoComplete="off"
              autoFocus
              maxLength={50}
              data-testid="input-group-name"
            />
            <p className="text-caption text-muted-foreground">
              {groupName.length}/50 characters
            </p>
          </div>

          {/* Add Members Section */}
          <div className="space-y-2">
            <Label htmlFor="add-member" className="text-caption">
              Add Members
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
                disabled={isCreating}
                className="h-11 flex-1"
                autoComplete="off"
                data-testid="input-add-member"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddMember}
                disabled={!newMemberInput.trim() || isCreating}
                className="h-11 w-11"
                data-testid="button-add-member"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              Press Enter or click + to add a member
            </p>
          </div>

          {/* Members List */}
          {members.length > 0 && (
            <div className="space-y-2">
              <Label className="text-caption">
                Members ({members.length})
              </Label>
              <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-md min-h-[60px]">
                {members.map((member) => (
                  <Badge
                    key={member}
                    variant="secondary"
                    className="pl-3 pr-2 py-1.5 text-sm hover-elevate"
                    data-testid={`badge-member-${member}`}
                  >
                    @{member}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveMember(member)}
                      disabled={isCreating}
                      className="ml-2 h-4 w-4 p-0 hover:bg-transparent"
                      data-testid={`button-remove-member-${member}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">{error}</AlertDescription>
            </Alert>
          )}

          {/* Cost Warning */}
          {members.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">
                Group messages will cost {(members.length * 0.001).toFixed(3)} HBD per message
                ({members.length} members × 0.001 HBD)
              </AlertDescription>
            </Alert>
          )}

          {/* Large Group Warning - Show when >5 members */}
          {members.length > 5 && (
            <Alert variant="warning" data-testid="alert-large-group-warning">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-caption">
                Creating groups with {members.length} members will require {members.length} separate Keychain approvals when sending messages. Consider keeping groups under 5 members for better experience.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isCreating}
              className="h-11"
              data-testid="button-cancel-group"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!groupName.trim() || members.length < 2 || isCreating}
              className="h-11"
              data-testid="button-create-group"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 mr-2" />
                  Create Group Chat
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
