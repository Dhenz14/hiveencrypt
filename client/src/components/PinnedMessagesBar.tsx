import { useState } from 'react';
import { Pin, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PinnedMessage } from '@shared/schema';

interface PinnedMessagesBarProps {
  pinnedMessages: PinnedMessage[];
  isCreator: boolean;
  onUnpin: (messageId: string) => void;
  onScrollTo: (messageId: string) => void;
}

export function PinnedMessagesBar({
  pinnedMessages,
  isCreator,
  onUnpin,
  onScrollTo,
}: PinnedMessagesBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!pinnedMessages || pinnedMessages.length === 0) {
    return null;
  }

  const sortedMessages = [...pinnedMessages].sort(
    (a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime()
  );

  const visibleMessages = isExpanded ? sortedMessages : sortedMessages.slice(0, 3);
  const hasMore = sortedMessages.length > 3;

  return (
    <div
      className="border-b bg-muted/50 px-3 py-2"
      data-testid="pinned-messages-bar"
    >
      <div className="flex items-center gap-2 mb-1">
        <Pin className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Pinned Messages ({pinnedMessages.length})
        </span>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 ml-auto"
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid="button-toggle-pinned-expand"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Show all
              </>
            )}
          </Button>
        )}
      </div>

      <div className="space-y-1">
        {visibleMessages.map((message) => (
          <div
            key={message.messageId}
            className={cn(
              "flex items-start gap-2 p-2 rounded-md",
              "bg-background/50 hover-elevate cursor-pointer"
            )}
            onClick={() => onScrollTo(message.messageId)}
            data-testid={`pinned-message-${message.messageId}`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" data-testid={`text-pinned-content-${message.messageId}`}>
                {message.content}
              </p>
              <p className="text-xs text-muted-foreground">
                Pinned by {message.pinnedBy}
              </p>
            </div>
            {isCreator && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin(message.messageId);
                }}
                data-testid={`button-unpin-${message.messageId}`}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
