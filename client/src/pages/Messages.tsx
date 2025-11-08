import { useState, useEffect, useRef } from 'react';
import { Settings, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ConversationsList } from '@/components/ConversationsList';
import { ChatHeader } from '@/components/ChatHeader';
import { MessageBubble, SystemMessage } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { NewMessageModal } from '@/components/NewMessageModal';
import { ProfileDrawer } from '@/components/ProfileDrawer';
import { SettingsModal } from '@/components/SettingsModal';
import { EmptyState, NoConversationSelected } from '@/components/EmptyState';
import { BlockchainSyncIndicator } from '@/components/BlockchainSyncIndicator';
import { ImageMessage } from '@/components/ImageMessage';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { Conversation, Message, Contact, BlockchainSyncStatus } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockchainMessages, useConversationDiscovery } from '@/hooks/useBlockchainMessages';
import { useCustomJsonMessages } from '@/hooks/useCustomJsonMessages';
import { getConversationKey, getConversation, updateConversation, fixCorruptedMessages, deleteConversation } from '@/lib/messageCache';
import { getHiveMemoKey } from '@/lib/hive';
import type { MessageCache, ConversationCache, CustomJsonMessage } from '@/lib/messageCache';

const mapMessageCacheToMessage = (msg: MessageCache, conversationId: string): Message => ({
  id: msg.id,
  conversationId,
  sender: msg.from,
  recipient: msg.to,
  content: msg.content,
  encryptedMemo: msg.encryptedContent,
  decryptedContent: msg.content,
  timestamp: msg.timestamp,
  status: msg.confirmed ? 'confirmed' : 'sending',
  trxId: msg.txId,
  isEncrypted: true,
});

const mapConversationCacheToConversation = (conv: ConversationCache): Conversation => ({
  id: conv.conversationKey,
  contactUsername: conv.partnerUsername,
  lastMessage: conv.lastMessage,
  lastMessageTime: conv.lastTimestamp,
  unreadCount: conv.unreadCount,
  isEncrypted: true,
});

export default function Messages() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedPartner, setSelectedPartner] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [syncStatus, setSyncStatus] = useState<BlockchainSyncStatus>({
    status: 'synced',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversationCaches = [], isLoading: isLoadingConversations, isFetching: isFetchingConversations } = useConversationDiscovery();
  
  const { data: messageCaches = [], isLoading: isLoadingMessages, isFetching: isFetchingMessages } = useBlockchainMessages({
    partnerUsername: selectedPartner,
    enabled: !!selectedPartner,
  });

  // Fetch image messages (custom_json operations)
  const { data: imageMessages = [], isLoading: isLoadingImageMessages, isFetching: isFetchingImageMessages } = useCustomJsonMessages({
    partnerUsername: selectedPartner,
    enabled: !!selectedPartner,
  });

  const conversations: Conversation[] = conversationCaches
    .filter((conv): conv is ConversationCache => conv !== null && conv !== undefined)
    .map(mapConversationCacheToConversation);
  
  // Debug logging
  if (conversations.length > 0) {
    console.log('[MESSAGES PAGE] Mapped conversations:', conversations.map(c => ({
      id: c.id,
      contactUsername: c.contactUsername,
      lastMessage: c.lastMessage?.substring(0, 30) || ''
    })));
  }
  
  const selectedConversationId = selectedPartner ? getConversationKey(user?.username || '', selectedPartner) : null;
  const selectedConversation = conversations.find(c => c.contactUsername === selectedPartner);
  
  const currentMessages: Message[] = messageCaches.map(msg => 
    mapMessageCacheToMessage(msg, selectedConversationId || '')
  );

  console.log('[MESSAGES PAGE] Text messages:', currentMessages.length, 'Image messages:', imageMessages.length);

  // Merge text messages and image messages, sorted by timestamp
  type MergedMessage = 
    | { type: 'text'; data: Message }
    | { type: 'image'; data: CustomJsonMessage };

  const allMessages: MergedMessage[] = [
    ...currentMessages.map(msg => ({ type: 'text' as const, data: msg })),
    ...imageMessages.map(img => ({ type: 'image' as const, data: img }))
  ].sort((a, b) => {
    const timeA = new Date(a.data.timestamp).getTime();
    const timeB = new Date(b.data.timestamp).getTime();
    return timeA - timeB;
  });

  console.log('[MESSAGES PAGE] Total merged messages:', allMessages.length);

  // Fix corrupted cached messages on mount and clear base64-corrupted cache
  useEffect(() => {
    if (user?.username) {
      // One-time cleanup: clear cache to remove old base64-corrupted messages
      const cacheVersion = localStorage.getItem('hive_cache_version');
      if (cacheVersion !== '6.0') {
        console.log('[INIT] Cache version outdated, clearing all corrupted data...');
        import('@/lib/messageCache').then(({ clearAllCache }) => {
          clearAllCache(user.username).then(() => {
            localStorage.setItem('hive_cache_version', '6.0');
            console.log('[INIT] Cache cleared successfully');
            queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
            queryClient.invalidateQueries({ queryKey: ['blockchain-conversations'] });
          });
        });
        return;
      }
      
      // Regular corruption fix (for content === encryptedContent cases)
      fixCorruptedMessages(user.username).then(count => {
        if (count > 0) {
          console.log(`[INIT] Fixed ${count} corrupted messages, refreshing...`);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
        }
      }).catch(err => {
        console.error('[INIT] Failed to fix corrupted messages:', err);
      });
    }
  }, [user?.username, queryClient]);

  useEffect(() => {
    if (isFetchingConversations || isFetchingMessages || isFetchingImageMessages) {
      setSyncStatus({ status: 'syncing' });
    } else {
      setSyncStatus({ status: 'synced', lastSyncTime: new Date().toISOString() });
    }
  }, [isFetchingConversations, isFetchingMessages, isFetchingImageMessages]);

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
      setSelectedPartner(username);
      setIsNewMessageOpen(false);
      toast({
        title: 'Conversation Found',
        description: `Switched to existing conversation with @${username}`,
      });
      return;
    }

    try {
      const memoKey = await getHiveMemoKey(username);
      
      if (!memoKey) {
        throw new Error(`User @${username} not found on Hive blockchain`);
      }

      const conversationKey = getConversationKey(user?.username || '', username);
      await updateConversation({
        conversationKey,
        partnerUsername: username,
        lastMessage: '',
        lastTimestamp: new Date().toISOString(),
        unreadCount: 0,
        lastChecked: new Date().toISOString(),
      }, user?.username);

      setSelectedPartner(username);
      setIsNewMessageOpen(false);

      queryClient.invalidateQueries({ queryKey: ['blockchain-conversations'] });

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
      
      throw error;
    }
  };

  const handleMessageSent = async () => {
    // Force immediate refetch to show the sent message instantly
    await queryClient.invalidateQueries({ 
      queryKey: ['blockchain-messages', user?.username, selectedPartner],
      refetchType: 'active' // Force refetch of active queries
    });
    await queryClient.invalidateQueries({ 
      queryKey: ['custom-json-messages', user?.username, selectedPartner],
      refetchType: 'active' // Force refetch of image messages
    });
    await queryClient.invalidateQueries({ 
      queryKey: ['blockchain-conversations'],
      refetchType: 'active'
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

  const handleDeleteLocalData = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!user?.username || !selectedPartner) return;
    
    try {
      console.log('[DELETE] Deleting conversation with:', selectedPartner);
      await deleteConversation(user.username, selectedPartner);
      
      // Invalidate queries to refresh the UI with correct query keys
      await queryClient.invalidateQueries({ queryKey: ['blockchain-messages', user.username, selectedPartner] });
      await queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
      
      toast({
        title: 'Local data deleted',
        description: `Conversation with @${selectedPartner} has been removed from local storage. Messages will need to be decrypted again.`,
      });
      
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error('[DELETE] Failed to delete conversation:', error);
      toast({
        title: 'Failed to delete',
        description: 'An error occurred while deleting the conversation data.',
        variant: 'destructive',
      });
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
          onSelectConversation={(id) => {
            const conversation = conversations.find(c => c.id === id);
            if (conversation) {
              setSelectedPartner(conversation.contactUsername);
            }
          }}
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
              onDeleteLocalData={handleDeleteLocalData}
            />

            <ScrollArea className="flex-1 p-4">
              <div className="max-w-3xl mx-auto space-y-4">
                <SystemMessage text="Encryption keys exchanged. Messages are end-to-end encrypted." />
                
                {isLoadingMessages || isLoadingImageMessages ? (
                  <div className="space-y-4" data-testid="loading-messages">
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="h-16 w-1/2 ml-auto" />
                  </div>
                ) : allMessages.length === 0 ? (
                  <div className="text-center py-12" data-testid="empty-messages">
                    <p className="text-muted-foreground text-body">
                      No messages yet. Start the conversation!
                    </p>
                  </div>
                ) : (
                  allMessages.map((item, index) => {
                    const prevItem = index > 0 ? allMessages[index - 1] : null;
                    const showTimestamp = !prevItem || 
                      new Date(item.data.timestamp).getTime() - new Date(prevItem.data.timestamp).getTime() > 300000;

                    if (item.type === 'text') {
                      const message = item.data;
                      const isSent = message.sender === user?.username;
                      return (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          isSent={isSent}
                          showTimestamp={showTimestamp}
                        />
                      );
                    } else {
                      // Image message
                      const imageMsg = item.data;
                      return (
                        <ImageMessage
                          key={imageMsg.txId}
                          message={imageMsg}
                          currentUsername={user?.username || ''}
                        />
                      );
                    }
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

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-conversation">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all locally stored messages with @{selectedPartner} from your device. 
              Messages will be re-encrypted and require decryption again. 
              <br /><br />
              <strong>This does NOT delete messages from the blockchain.</strong> They remain permanently stored and can be decrypted again anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Local Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
