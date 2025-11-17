import { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Moon, Sun, Info, Filter, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
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
import { GroupChatHeader } from '@/components/GroupChatHeader';
import { MessageBubble, SystemMessage } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { NewMessageModal } from '@/components/NewMessageModal';
import { GroupCreationModal } from '@/components/GroupCreationModal';
import { ManageMembersModal } from '@/components/ManageMembersModal';
import { ProfileDrawer } from '@/components/ProfileDrawer';
import { SettingsModal } from '@/components/SettingsModal';
import { HiddenChatsModal } from '@/components/HiddenChatsModal';
import { EmptyState, NoConversationSelected } from '@/components/EmptyState';
import { BlockchainSyncIndicator } from '@/components/BlockchainSyncIndicator';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useHiddenConversations } from '@/contexts/HiddenConversationsContext';
import type { Conversation, Message, Contact, BlockchainSyncStatus } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockchainMessages, useConversationDiscovery } from '@/hooks/useBlockchainMessages';
import { useGroupDiscovery, useGroupMessages, useGroupMessagePreSync } from '@/hooks/useGroupMessages';
import { getConversationKey, getConversation, updateConversation, fixCorruptedMessages, deleteConversation, deleteGroupConversation, cacheGroupConversation } from '@/lib/messageCache';
import { getHiveMemoKey } from '@/lib/hive';
import type { MessageCache, ConversationCache, GroupConversationCache } from '@/lib/messageCache';
import { generateGroupId, broadcastGroupCreation, broadcastGroupUpdate } from '@/lib/groupBlockchain';
import { useMobileLayout } from '@/hooks/useMobileLayout';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

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

const mapGroupCacheToConversation = (group: GroupConversationCache): Conversation => ({
  id: group.groupId,
  contactUsername: `👥 ${group.name} (${group.members.length})`,
  lastMessage: group.lastMessage,
  lastMessageTime: group.lastTimestamp,
  unreadCount: group.unreadCount,
  isEncrypted: true,
});

export default function Messages() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isMobile, showChat, setShowChat } = useMobileLayout();
  const { isHidden, hideConversation, hiddenConversations } = useHiddenConversations();
  
  const [selectedPartner, setSelectedPartner] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isGroupCreationOpen, setIsGroupCreationOpen] = useState(false);
  const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isHiddenChatsOpen, setIsHiddenChatsOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [syncStatus, setSyncStatus] = useState<BlockchainSyncStatus>({
    status: 'synced',
  });

  // State for sidebar sizes - initialized once from localStorage
  const [sidebarSizes, setSidebarSizes] = useState<number[]>(() => {
    if (typeof window === 'undefined' || isMobile) return [22, 78];
    
    try {
      const saved = localStorage.getItem('hive-messenger-sidebar-layout');
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          Array.isArray(parsed) && 
          parsed.length === 2 &&
          parsed.every(n => typeof n === 'number' && n > 0) &&
          Math.abs(parsed[0] + parsed[1] - 100) < 0.1
        ) {
          return parsed as number[];
        }
      }
    } catch (error) {
      console.error('[ResizableSidebar] Failed to load layout:', error);
    }
    return [22, 78];
  });

  // Static mount key - only changes when component mounts, not during resize
  const mountKey = useMemo(() => Math.random().toString(), []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversationCaches = [], isLoading: isLoadingConversations, isFetching: isFetchingConversations } = useConversationDiscovery();
  
  // Pre-sync group messages before discovery (solves chicken-and-egg problem)
  const { data: preSyncCount, isLoading: isPreSyncing, isSuccess: preSyncComplete } = useGroupMessagePreSync();
  
  // Only run group discovery after pre-sync completes
  const { data: groupCaches = [], isLoading: isLoadingGroups, isFetching: isFetchingGroups } = useGroupDiscovery(preSyncComplete);
  
  // PHASE 4.1: Hook now returns { messages, hiddenCount }
  const { data: messageData, isLoading: isLoadingMessages, isFetching: isFetchingMessages } = useBlockchainMessages({
    partnerUsername: selectedPartner,
    enabled: !!selectedPartner && !selectedGroupId,
  });
  
  // Group messages (when a group is selected)
  const { data: groupMessageCaches = [], isLoading: isLoadingGroupMessages, isFetching: isFetchingGroupMessages } = useGroupMessages(selectedGroupId);
  
  // Extract messages and hiddenCount from new shape
  const messageCaches = messageData?.messages || [];
  const hiddenCount = messageData?.hiddenCount || 0;

  // Merge 1:1 conversations and group conversations
  const directConversations: Conversation[] = conversationCaches
    .filter((conv): conv is ConversationCache => conv !== null && conv !== undefined)
    .filter(conv => !isHidden(conv.partnerUsername))
    .map(mapConversationCacheToConversation);
  
  const groupConversations: Conversation[] = groupCaches
    .filter((group): group is GroupConversationCache => group !== null && group !== undefined)
    .map(mapGroupCacheToConversation);
  
  // Combine and sort by last message time
  const conversations: Conversation[] = [...directConversations, ...groupConversations]
    .sort((a, b) => {
      const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return bTime - aTime;
    });
  
  // Debug logging (dev only, contains sensitive usernames)
  if (conversations.length > 0) {
    logger.sensitive('[MESSAGES PAGE] Mapped conversations:', conversations.map(c => ({
      id: c.id,
      contactUsername: c.contactUsername,
      lastMessage: c.lastMessage?.substring(0, 30) || ''
    })));
  }
  
  const selectedConversationId = selectedPartner ? getConversationKey(user?.username || '', selectedPartner) : null;
  const selectedConversation = selectedPartner 
    ? conversations.find(c => c.id === selectedConversationId)
    : selectedGroupId
      ? conversations.find(c => c.id === selectedGroupId)
      : undefined;
  
  const selectedGroup = selectedGroupId ? groupCaches.find(g => g.groupId === selectedGroupId) : undefined;
  
  // Map messages based on type (group or direct)
  const currentMessages: Message[] = selectedGroupId
    ? groupMessageCaches.map(msg => ({
        id: msg.id,
        conversationId: msg.groupId,
        sender: msg.sender,
        recipient: '', // Groups don't have a single recipient
        content: msg.content,
        encryptedMemo: msg.encryptedContent,
        decryptedContent: msg.content,
        timestamp: msg.timestamp,
        status: msg.confirmed ? 'confirmed' : 'sending',
        isEncrypted: true,
      }))
    : messageCaches.map(msg => 
        mapMessageCacheToMessage(msg, selectedConversationId || '')
      );

  logger.info('[MESSAGES PAGE] Text messages:', currentMessages.length, 'Hidden:', hiddenCount);

  // Run timestamp migration and fix corrupted cached messages on mount
  useEffect(() => {
    logger.info('[INIT] ⚡ Migration useEffect triggered, user:', user?.username);
    
    if (!user?.username) {
      logger.info('[INIT] ⚠️ No username, skipping migration');
      return;
    }
    
    logger.info('[INIT] ✅ Username verified, starting migration checks for:', user.username);
    
    // Run UTC timestamp migration first
    import('@/lib/messageCache').then(async ({ migrateTimestampsToUTC, clearAllCache, fixCorruptedMessages }) => {
      logger.info('[INIT] 📦 messageCache module loaded successfully');
      
      try {
        // Run migration
        logger.info('[INIT] 🔄 Running UTC timestamp migration...');
        const counts = await migrateTimestampsToUTC(user.username);
        if (counts.messages > 0 || counts.conversations > 0 || counts.customJsonMessages > 0) {
          logger.info('[INIT] ✅ Migrated timestamps to UTC:', counts);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
          queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
        } else {
          logger.info('[INIT] ℹ️ No timestamps needed migration (already completed or no messages)');
        }
        
        // Check cache version for other fixes
        const cacheVersion = localStorage.getItem('hive_cache_version');
        logger.info('[INIT] 🔍 Checking cache version:', cacheVersion, 'vs expected: 7.0');
        if (cacheVersion !== '7.0') {
          logger.info('[INIT] 🗑️ Cache version outdated, clearing cache...');
          await clearAllCache(user.username);
          localStorage.setItem('hive_cache_version', '7.0');
          logger.info('[INIT] ✅ Cache cleared successfully, version updated to 7.0');
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
          queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
        }
        
        // Regular corruption fix (for content === encryptedContent cases)
        logger.info('[INIT] 🔍 Checking for corrupted messages...');
        const fixCount = await fixCorruptedMessages(user.username);
        if (fixCount > 0) {
          logger.info(`[INIT] ✅ Fixed ${fixCount} corrupted messages, refreshing...`);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
        } else {
          logger.info('[INIT] ℹ️ No corrupted messages found');
        }
        
        logger.info('[INIT] ✅ ALL MIGRATION CHECKS COMPLETE');
      } catch (error) {
        logger.error('[INIT] ❌ Migration failed, clearing cache as fallback:', error);
        await clearAllCache(user.username);
        localStorage.setItem('hive_cache_version', '7.0');
        queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
        queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
      }
    }).catch((importError) => {
      logger.error('[INIT] ❌ CRITICAL: Failed to import messageCache module:', importError);
    });
  }, [user?.username, queryClient]);

  // Invalidate group discovery after pre-sync completes to show newly cached groups
  useEffect(() => {
    if (preSyncComplete && preSyncCount !== undefined && preSyncCount > 0) {
      logger.info('[GROUP PRESYNC] ✅ Pre-sync completed with', preSyncCount, 'messages, invalidating group discovery');
      queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user?.username] });
    }
  }, [preSyncComplete, preSyncCount, user?.username, queryClient]);

  useEffect(() => {
    if (isFetchingConversations || isFetchingMessages) {
      setSyncStatus({ status: 'syncing' });
    } else {
      setSyncStatus({ status: 'synced', lastSyncTime: new Date().toISOString() });
    }
  }, [isFetchingConversations, isFetchingMessages]);

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
      if (isMobile) {
        setShowChat(true);
      }
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
      const timestamp = new Date().toISOString();
      const newConvCache: ConversationCache = {
        conversationKey,
        partnerUsername: username,
        lastMessage: '',
        lastTimestamp: timestamp,
        unreadCount: 0,
        lastChecked: timestamp,
      };
      
      await updateConversation(newConvCache, user?.username);

      // CRITICAL: Optimistically update query cache so conversation appears immediately
      queryClient.setQueryData(
        ['blockchain-conversations', user?.username],
        (oldData: ConversationCache[] | undefined) => {
          if (!oldData) return [newConvCache];
          // Check if already exists (shouldn't, but be safe)
          const exists = oldData.some(c => c.conversationKey === conversationKey);
          if (exists) return oldData;
          // Add to front of list (most recent)
          return [newConvCache, ...oldData];
        }
      );

      setSelectedPartner(username);
      setIsNewMessageOpen(false);
      if (isMobile) {
        setShowChat(true);
      }

      // DON'T invalidate here - it would trigger a refetch that overwrites the optimistic update
      // The conversation will appear from optimistic data until the first message is sent,
      // at which point handleMessageSent will invalidate and fetch the real blockchain data

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

  const handleCreateGroup = async (groupName: string, members: string[]) => {
    try {
      if (!user?.username) {
        throw new Error('You must be logged in to create a group');
      }

      logger.info('[GROUP CREATION] Creating group:', { groupName, members });

      // Generate unique group ID
      const groupId = generateGroupId();
      const timestamp = new Date().toISOString();

      // Broadcast group creation to blockchain (free - custom_json)
      await broadcastGroupCreation(user.username, groupId, groupName, members);

      // Create group cache entry
      const groupCache: GroupConversationCache = {
        groupId,
        name: groupName,
        members,
        creator: user.username,
        createdAt: timestamp,
        version: 1,
        lastMessage: '',
        lastTimestamp: timestamp,
        unreadCount: 0,
        lastChecked: timestamp,
      };

      // Save to IndexedDB
      await cacheGroupConversation(groupCache, user.username);

      // Optimistically update query cache (TODO: integrate with conversation list)
      queryClient.setQueryData(
        ['blockchain-group-conversations', user.username],
        (oldData: GroupConversationCache[] | undefined) => {
          if (!oldData) return [groupCache];
          return [groupCache, ...oldData];
        }
      );

      // Select the new group
      setSelectedGroupId(groupId);
      setSelectedPartner(''); // Clear direct message selection
      setIsGroupCreationOpen(false);
      if (isMobile) {
        setShowChat(true);
      }

      toast({
        title: 'Group Created',
        description: `Created group "${groupName}" with ${members.length} members`,
      });

      logger.info('[GROUP CREATION] ✅ Group created successfully:', groupId);
    } catch (error) {
      logger.error('[GROUP CREATION] ❌ Failed to create group:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create group';
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      
      throw error;
    }
  };

  const handleManageMembers = () => {
    setIsManageMembersOpen(true);
  };

  const handleUpdateMembers = async (newMembers: string[]) => {
    try {
      if (!user?.username || !selectedGroup) {
        throw new Error('No group selected');
      }

      const added = newMembers.filter(m => !selectedGroup.members.includes(m));
      const removed = selectedGroup.members.filter(m => !newMembers.includes(m));

      logger.info('[GROUP UPDATE] Updating group members:', { 
        groupId: selectedGroup.groupId, 
        added, 
        removed 
      });

      // Increment version number
      const newVersion = selectedGroup.version + 1;

      // Broadcast group update to blockchain (free - custom_json)
      await broadcastGroupUpdate(
        user.username,
        selectedGroup.groupId,
        selectedGroup.name,
        newMembers,
        newVersion
      );

      // Update group cache entry
      const updatedGroupCache: GroupConversationCache = {
        ...selectedGroup,
        members: newMembers,
        version: newVersion,
      };

      // Save to IndexedDB
      await cacheGroupConversation(updatedGroupCache, user.username);

      // Update query cache
      queryClient.setQueryData(
        ['blockchain-group-conversations', user.username],
        (oldData: GroupConversationCache[] | undefined) => {
          if (!oldData) return [updatedGroupCache];
          return oldData.map(g => 
            g.groupId === selectedGroup.groupId ? updatedGroupCache : g
          );
        }
      );

      // Invalidate queries to force refetch and sync
      await queryClient.invalidateQueries({ 
        queryKey: ['blockchain-group-conversations', user.username],
        refetchType: 'active'
      });

      // Close modal
      setIsManageMembersOpen(false);

      // Build description message
      const changes: string[] = [];
      if (added.length > 0) {
        changes.push(`Added: ${added.map(m => `@${m}`).join(', ')}`);
      }
      if (removed.length > 0) {
        changes.push(`Removed: ${removed.map(m => `@${m}`).join(', ')}`);
      }

      toast({
        title: 'Group Updated',
        description: changes.join('. '),
      });

      logger.info('[GROUP UPDATE] ✅ Group updated successfully:', selectedGroup.groupId);
    } catch (error) {
      logger.error('[GROUP UPDATE] ❌ Failed to update group:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update group members';
      
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
      queryKey: ['blockchain-conversations', user?.username],
      refetchType: 'active'
    });
    await queryClient.invalidateQueries({ 
      queryKey: ['blockchain-group-conversations', user?.username],
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

  const handleHideChat = () => {
    if (!selectedPartner) return;
    
    hideConversation(selectedPartner);
    
    toast({
      title: 'Chat Hidden',
      description: `@${selectedPartner} has been hidden from your conversations. You can unhide it from the Hidden Chats menu.`,
    });
    
    // Clear selection and go back to conversation list on mobile
    setSelectedPartner('');
    if (isMobile) {
      setShowChat(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!user?.username) return;
    
    try {
      if (selectedGroupId) {
        // Capture group name before clearing selection
        const groupName = selectedGroup?.name || 'Unknown Group';
        
        // Delete group conversation
        logger.info('[DELETE] Deleting group conversation:', selectedGroupId);
        await deleteGroupConversation(selectedGroupId, user.username);
        
        // Invalidate queries to refresh the UI
        await queryClient.invalidateQueries({ queryKey: ['blockchain-group-messages', user.username, selectedGroupId] });
        await queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user.username] });
        
        // Show toast before clearing selection
        toast({
          title: 'Local data deleted',
          description: `Group chat "${groupName}" has been removed from local storage. Messages will need to be decrypted again.`,
        });
        
        // Close dialog first
        setIsDeleteDialogOpen(false);
        
        // Clear selection and go back to conversation list
        setSelectedGroupId('');
        if (isMobile) {
          setShowChat(false);
        }
      } else if (selectedPartner) {
        // Capture username before clearing selection
        const username = selectedPartner;
        
        // Delete 1-to-1 conversation
        logger.info('[DELETE] Deleting conversation with:', username);
        await deleteConversation(user.username, username);
        
        // Invalidate queries to refresh the UI
        await queryClient.invalidateQueries({ queryKey: ['blockchain-messages', user.username, username] });
        await queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
        
        // Show toast before clearing selection
        toast({
          title: 'Local data deleted',
          description: `Conversation with @${username} has been removed from local storage. Messages will need to be decrypted again.`,
        });
        
        // Close dialog first
        setIsDeleteDialogOpen(false);
        
        // Clear selection and go back to conversation list
        setSelectedPartner('');
        if (isMobile) {
          setShowChat(false);
        }
      }
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

  // Sidebar content component (reused in mobile and desktop layouts)
  const sidebarContent = (
    <>
      <div className="min-h-[calc(4rem+env(safe-area-inset-top))] border-b px-4 flex items-center justify-between gap-3 pt-[env(safe-area-inset-top)]">
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
            className="min-h-11 min-w-11"
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
            onClick={() => setIsHiddenChatsOpen(true)}
            data-testid="button-hidden-chats"
            className="min-h-11 min-w-11 relative"
          >
            <EyeOff className="w-5 h-5" />
            {hiddenConversations.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">
                {hiddenConversations.length}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            data-testid="button-settings"
            className="min-h-11 min-w-11"
          >
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <ConversationsList
        conversations={conversations}
        selectedConversationId={selectedConversationId || selectedGroupId || undefined}
        onSelectConversation={(id) => {
          // Check if it's a group conversation
          const groupConv = groupCaches.find(g => g.groupId === id);
          if (groupConv) {
            setSelectedGroupId(id);
            setSelectedPartner(''); // Clear direct message selection
            if (isMobile) {
              setShowChat(true);
            }
          } else {
            // It's a direct conversation
            const conversation = conversationCaches.find(c => c.conversationKey === id);
            if (conversation) {
              setSelectedPartner(conversation.partnerUsername);
              setSelectedGroupId(''); // Clear group selection
              if (isMobile) {
                setShowChat(true);
              }
            }
          }
        }}
        onNewMessage={() => setIsNewMessageOpen(true)}
        onNewGroup={() => setIsGroupCreationOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
    </>
  );

  // Chat content component (reused in mobile and desktop layouts)
  const chatContent = (
    <>
      {!selectedConversation ? (
        conversations.length === 0 ? (
          <EmptyState onNewMessage={() => setIsNewMessageOpen(true)} />
        ) : (
          <NoConversationSelected onNewMessage={() => setIsNewMessageOpen(true)} />
        )
      ) : (
        <>
          {selectedGroup ? (
            <GroupChatHeader
              groupName={selectedGroup.name}
              members={selectedGroup.members}
              onManageMembers={handleManageMembers}
              onDeleteLocalData={handleDeleteLocalData}
              onBackClick={isMobile ? () => setShowChat(false) : undefined}
            />
          ) : (
            <ChatHeader
              contactUsername={selectedConversation.contactUsername}
              isEncrypted={selectedConversation.isEncrypted}
              onViewProfile={handleViewProfile}
              onViewBlockchain={handleViewBlockchain}
              onDeleteLocalData={handleDeleteLocalData}
              onHideChat={handleHideChat}
              onBackClick={isMobile ? () => setShowChat(false) : undefined}
            />
          )}

          {/* PHASE 4.3: Hidden Message Banner with Accessibility */}
          {hiddenCount > 0 && (
            <div className="border-b bg-muted/50 px-4 py-2">
              <Alert 
                variant="default" 
                className="border-0 bg-transparent p-0" 
                data-testid="alert-hidden-messages"
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2" id="hidden-count-description">
                    <Info className="w-4 h-4 text-muted-foreground" />
                    <AlertDescription className="text-caption text-muted-foreground">
                      {hiddenCount} {hiddenCount === 1 ? 'message' : 'messages'} hidden by minimum HBD filter
                    </AlertDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSettingsOpen(true)}
                    className="h-7 text-caption"
                    data-testid="button-adjust-filter"
                    aria-label="Adjust minimum HBD filter settings"
                    aria-describedby="hidden-count-description"
                  >
                    Adjust Filter
                  </Button>
                </div>
              </Alert>
            </div>
          )}

          <ScrollArea className="flex-1 p-4 pb-[env(safe-area-inset-bottom)]">
            <div className="max-w-3xl mx-auto space-y-3">
              <SystemMessage text="Encryption keys exchanged. Messages are end-to-end encrypted." />
              
              {isLoadingMessages ? (
                <div className="space-y-4" data-testid="loading-messages">
                  <Skeleton className="h-16 w-3/4" />
                  <Skeleton className="h-16 w-2/3 ml-auto" />
                  <Skeleton className="h-16 w-3/4" />
                  <Skeleton className="h-16 w-1/2 ml-auto" />
                </div>
              ) : currentMessages.length === 0 ? (
                hiddenCount > 0 ? (
                  <div className="text-center py-12 space-y-4" data-testid="empty-filtered-messages">
                    <div className="flex justify-center">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Filter className="w-6 h-6 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-body font-medium">All Messages Filtered</p>
                      <p className="text-caption text-muted-foreground max-w-sm mx-auto">
                        {hiddenCount} {hiddenCount === 1 ? 'message is' : 'messages are'} hidden by your minimum HBD filter. Lower your filter to see {hiddenCount === 1 ? 'it' : 'them'}.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setIsSettingsOpen(true)}
                      data-testid="button-adjust-filter-empty"
                      aria-label="Open settings to adjust filter"
                    >
                      <Filter className="w-4 h-4 mr-2" />
                      Adjust Filter Settings
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-12" data-testid="empty-messages">
                    <p className="text-muted-foreground text-body">
                      No messages yet. Start the conversation!
                    </p>
                  </div>
                )
              ) : (
                currentMessages.map((message, index) => {
                  const prevMessage = index > 0 ? currentMessages[index - 1] : null;
                  const showTimestamp = !prevMessage || 
                    new Date(message.timestamp).getTime() - new Date(prevMessage.timestamp).getTime() > 300000;

                  const isSent = message.sender === user?.username;
                  const isGroupMessage = !!selectedGroupId;
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isSent={isSent}
                      showTimestamp={showTimestamp}
                      isGroupMessage={isGroupMessage}
                      senderName={message.sender}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <MessageComposer
            conversationId={selectedConversation.id}
            recipientUsername={selectedGroup ? undefined : selectedConversation.contactUsername}
            groupId={selectedGroup?.groupId}
            groupMembers={selectedGroup?.members}
            groupCreator={selectedGroup?.creator}
            onMessageSent={handleMessageSent}
          />
        </>
      )}
    </>
  );

  return (
    <div className="h-screen overflow-hidden bg-background">
      {isMobile ? (
        // Mobile: Flex layout with conditional show/hide
        <div className="flex h-full">
          <div className={cn(
            "w-full flex flex-col bg-sidebar border-r",
            showChat && "hidden"
          )}>
            {sidebarContent}
          </div>

          <div className={cn(
            "flex-1 flex flex-col",
            !showChat && "hidden"
          )}>
            {chatContent}
          </div>
        </div>
      ) : (
        // Desktop: Resizable panels with one-time hydration from localStorage
        <ResizablePanelGroup 
          key={mountKey}
          direction="horizontal"
          onLayout={(sizes: number[]) => {
            setSidebarSizes(sizes);
            localStorage.setItem('hive-messenger-sidebar-layout', JSON.stringify(sizes));
          }}
        >
          <ResizablePanel defaultSize={sidebarSizes[0]} minSize={18} maxSize={40}>
            <div className="flex flex-col h-full bg-sidebar border-r">
              {sidebarContent}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Resize sidebar" />
          <ResizablePanel defaultSize={sidebarSizes[1]}>
            <div className="flex flex-col h-full">
              {chatContent}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <NewMessageModal
        open={isNewMessageOpen}
        onOpenChange={setIsNewMessageOpen}
        onStartChat={handleStartChat}
      />

      <GroupCreationModal
        open={isGroupCreationOpen}
        onOpenChange={setIsGroupCreationOpen}
        onCreateGroup={handleCreateGroup}
        currentUsername={user?.username}
      />

      {selectedGroup && (
        <ManageMembersModal
          open={isManageMembersOpen}
          onOpenChange={setIsManageMembersOpen}
          groupName={selectedGroup.name}
          currentMembers={selectedGroup.members}
          creator={selectedGroup.creator}
          currentUsername={user?.username}
          onUpdateMembers={handleUpdateMembers}
        />
      )}

      <ProfileDrawer
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        contact={selectedContact}
      />

      <SettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      <HiddenChatsModal
        open={isHiddenChatsOpen}
        onOpenChange={setIsHiddenChatsOpen}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-conversation">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedGroupId ? 'Group' : 'Conversation'} Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all locally stored messages {selectedGroupId 
                ? `for "${selectedGroup?.name}"` 
                : `with @${selectedPartner}`} from your device. 
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
