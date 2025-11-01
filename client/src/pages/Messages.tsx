import { useState, useEffect, useRef } from 'react';
import { Settings, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ConversationsList } from '@/components/ConversationsList';
import { ChatHeader } from '@/components/ChatHeader';
import { MessageBubble, SystemMessage } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { NewMessageModal } from '@/components/NewMessageModal';
import { ProfileDrawer } from '@/components/ProfileDrawer';
import { SettingsModal } from '@/components/SettingsModal';
import { EmptyState, NoConversationSelected } from '@/components/EmptyState';
import { BlockchainSyncIndicator } from '@/components/BlockchainSyncIndicator';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { Conversation, Message, Contact, BlockchainSyncStatus } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export default function Messages() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [syncStatus, setSyncStatus] = useState<BlockchainSyncStatus>({
    status: 'synced',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch messages for selected conversation
  const { data: currentMessages = [], isLoading: isLoadingMessages } = useQuery<Message[]>({
    queryKey: ['/api/conversations', selectedConversationId, 'messages'],
    enabled: !!selectedConversationId,
  });

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages]);

  const handleStartChat = async (username: string) => {
    const existingConversation = conversations.find(
      c => c.contactUsername.toLowerCase() === username.toLowerCase()
    );

    if (existingConversation) {
      setSelectedConversationId(existingConversation.id);
      setIsNewMessageOpen(false);
      toast({
        title: 'Conversation Found',
        description: `Switched to existing conversation with @${username}`,
      });
      return;
    }

    try {
      // Call backend to create/get conversation
      const response = await apiRequest('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ participantUsername: username }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create conversation');
      }

      const conversation: Conversation = await response.json();

      // Update conversations list with real conversation from backend
      setConversations(prev => [conversation, ...prev]);
      setSelectedConversationId(conversation.id);
      setIsNewMessageOpen(false);

      toast({
        title: 'Conversation Started',
        description: `Started encrypted chat with @${username}`,
      });
    } catch (error) {
      console.error('Error starting chat:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start conversation';
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      
      // Re-throw to allow NewMessageModal to handle it
      throw error;
    }
  };

  const handleMessageSent = () => {
    // Refetch messages after a new message is sent
    queryClient.invalidateQueries({ 
      queryKey: ['/api/conversations', selectedConversationId, 'messages'] 
    });
  };

  const handleViewProfile = () => {
    if (selectedConversation) {
      setSelectedContact({
        username: selectedConversation.contactUsername,
        publicKey: selectedConversation.publicKey || '',
        isOnline: false,
      });
      setIsProfileOpen(true);
    }
  };

  const handleViewBlockchain = () => {
    if (selectedConversation) {
      window.open(
        `https://hivehub.dev/@${selectedConversation.contactUsername}`,
        '_blank'
      );
    }
  };

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <div className="w-80 border-r flex flex-col bg-sidebar">
        <div className="h-16 border-b px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="w-9 h-9 flex-shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary font-medium text-caption">
                {user?.username ? getInitials(user.username) : 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-body font-semibold truncate">@{user?.username}</p>
              <BlockchainSyncIndicator status={syncStatus} />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              data-testid="button-toggle-theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              data-testid="button-settings"
            >
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <ConversationsList
          conversations={conversations}
          selectedConversationId={selectedConversationId || undefined}
          onSelectConversation={setSelectedConversationId}
          onNewMessage={() => setIsNewMessageOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      <div className="flex-1 flex flex-col">
        {!selectedConversation ? (
          conversations.length === 0 ? (
            <EmptyState onNewMessage={() => setIsNewMessageOpen(true)} />
          ) : (
            <NoConversationSelected onNewMessage={() => setIsNewMessageOpen(true)} />
          )
        ) : (
          <>
            <ChatHeader
              contactUsername={selectedConversation.contactUsername}
              isEncrypted={selectedConversation.isEncrypted}
              onViewProfile={handleViewProfile}
              onViewBlockchain={handleViewBlockchain}
            />

            <ScrollArea className="flex-1 p-4">
              <div className="max-w-3xl mx-auto space-y-4">
                <SystemMessage text="Encryption keys exchanged. Messages are end-to-end encrypted." />
                
                {isLoadingMessages ? (
                  <div className="space-y-4" data-testid="loading-messages">
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-1/2 ml-auto" />
                  </div>
                ) : currentMessages.length === 0 ? (
                  <div className="text-center py-12" data-testid="empty-messages">
                    <p className="text-muted-foreground text-body">
                      No messages yet. Start the conversation!
                    </p>
                  </div>
                ) : (
                  currentMessages.map((message, index) => {
                    const isSent = message.sender === user?.username;
                    const prevMessage = index > 0 ? currentMessages[index - 1] : null;
                    const showTimestamp = !prevMessage || 
                      new Date(message.timestamp).getTime() - new Date(prevMessage.timestamp).getTime() > 300000;

                    return (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isSent={isSent}
                        showTimestamp={showTimestamp}
                      />
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <MessageComposer
              conversationId={selectedConversation.id}
              recipientUsername={selectedConversation.contactUsername}
              onMessageSent={handleMessageSent}
            />
          </>
        )}
      </div>

      <NewMessageModal
        open={isNewMessageOpen}
        onOpenChange={setIsNewMessageOpen}
        onStartChat={handleStartChat}
      />

      <ProfileDrawer
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        contact={selectedContact}
      />

      <SettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
