import { useState, useEffect, useRef } from 'react';
import { Settings, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
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

export default function Messages() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [syncStatus, setSyncStatus] = useState<BlockchainSyncStatus>({
    status: 'synced',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);
  const currentMessages = selectedConversationId ? messages[selectedConversationId] || [] : [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages]);

  const handleStartChat = (username: string) => {
    const existingConversation = conversations.find(
      c => c.contactUsername.toLowerCase() === username.toLowerCase()
    );

    if (existingConversation) {
      setSelectedConversationId(existingConversation.id);
      toast({
        title: 'Conversation Found',
        description: `Switched to existing conversation with @${username}`,
      });
      return;
    }

    const tempId = `conv-${Date.now()}-${username}`;
    const newConversation: Conversation = {
      id: tempId,
      contactUsername: username,
      unreadCount: 0,
      isEncrypted: true,
      publicKey: `STM${Math.random().toString(36).substr(2, 50)}`,
    };

    setConversations(prev => [newConversation, ...prev]);
    setMessages(prev => ({ ...prev, [tempId]: [] }));
    setSelectedConversationId(tempId);

    toast({
      title: 'Conversation Started',
      description: `Started encrypted chat with @${username}`,
    });
  };

  const handleSendMessage = async (content: string) => {
    if (!selectedConversationId || !selectedConversation) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      conversationId: selectedConversationId,
      sender: user!.username,
      recipient: selectedConversation.contactUsername,
      content,
      encryptedMemo: `#encrypted-${content}`,
      timestamp: new Date().toISOString(),
      status: 'sending',
      isEncrypted: true,
    };

    setMessages(prev => ({
      ...prev,
      [selectedConversationId]: [...(prev[selectedConversationId] || []), newMessage],
    }));

    setConversations(prev =>
      prev.map(conv =>
        conv.id === selectedConversationId
          ? {
              ...conv,
              lastMessage: content.slice(0, 50),
              lastMessageTime: newMessage.timestamp,
            }
          : conv
      )
    );

    setTimeout(() => {
      setMessages(prev => ({
        ...prev,
        [selectedConversationId]: prev[selectedConversationId].map(msg =>
          msg.id === newMessage.id ? { ...msg, status: 'sent' } : msg
        ),
      }));

      setTimeout(() => {
        setMessages(prev => ({
          ...prev,
          [selectedConversationId]: prev[selectedConversationId].map(msg =>
            msg.id === newMessage.id ? { ...msg, status: 'confirmed' } : msg
          ),
        }));
      }, 1000);
    }, 500);

    toast({
      title: 'Message Sent',
      description: 'Your encrypted message has been sent',
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
                
                {currentMessages.map((message, index) => {
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
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <MessageComposer
              onSend={handleSendMessage}
              recipientUsername={selectedConversation.contactUsername}
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
