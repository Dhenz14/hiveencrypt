import { MessageSquare, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onNewMessage: () => void;
}

export function EmptyState({ onNewMessage }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center h-full bg-background">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10">
          <MessageSquare className="w-10 h-10 text-primary" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-headline font-semibold">No Messages Yet</h3>
          <p className="text-body text-muted-foreground">
            Start a conversation to begin sending encrypted messages on the Hive blockchain
          </p>
        </div>

        <Button onClick={onNewMessage} size="lg" data-testid="button-empty-new-message">
          <UserPlus className="w-4 h-4 mr-2" />
          New Message
        </Button>

        <div className="pt-4 space-y-2 text-caption text-muted-foreground">
          <p className="font-medium">Features:</p>
          <ul className="space-y-1">
            <li>🔒 End-to-end encrypted messages</li>
            <li>⛓️ Stored on Hive blockchain</li>
            <li>🔑 Your keys, your data</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function NoConversationSelected({ onNewMessage }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center h-full bg-background border-l">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50">
          <MessageSquare className="w-8 h-8 text-muted-foreground" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-headline font-semibold">Select a conversation</h3>
          <p className="text-body text-muted-foreground">
            Choose a conversation from the list or start a new one
          </p>
        </div>

        <Button onClick={onNewMessage} variant="outline" data-testid="button-select-new-message">
          <UserPlus className="w-4 h-4 mr-2" />
          New Message
        </Button>
      </div>
    </div>
  );
}
