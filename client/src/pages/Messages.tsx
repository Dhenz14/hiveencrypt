import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Settings, Moon, Sun, Info, Filter, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { JoinGroupButton } from '@/components/JoinGroupButton';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useHiddenConversations } from '@/contexts/HiddenConversationsContext';
import type { Conversation, Message, Contact, BlockchainSyncStatus } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useBlockchainMessages, useConversationDiscovery } from '@/hooks/useBlockchainMessages';
import { useGroupDiscovery, useGroupMessages } from '@/hooks/useGroupMessages';
import { useAutoApproveJoinRequests } from '@/hooks/useAutoApproveJoinRequests';
import { getConversationKey, getConversation, updateConversation, fixCorruptedMessages, deleteConversation, deleteGroupConversation, cacheGroupConversation } from '@/lib/messageCache';
import { getHiveMemoKey } from '@/lib/hive';
import type { MessageCache, ConversationCache, GroupConversationCache } from '@/lib/messageCache';
import type { PaymentSettings } from '@shared/schema';
import { generateGroupId, broadcastGroupCreation, broadcastGroupUpdate, broadcastLeaveGroup } from '@/lib/groupBlockchain';
import { setCustomGroupName } from '@/lib/customGroupNames';
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
  contactUsername: `👥 ${group.name}`,  // Just show group name cleanly
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
  const [location, setLocation] = useLocation();
  
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
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [isLeaveGroupDialogOpen, setIsLeaveGroupDialogOpen] = useState(false);
  const [joinDialogGroup, setJoinDialogGroup] = useState<GroupConversationCache | null>(null);
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
  
  // Group discovery now works directly from blockchain metadata - no pre-sync needed!
  const { data: groupCaches = [], isLoading: isLoadingGroups, isFetching: isFetchingGroups } = useGroupDiscovery();
  
  // SECURITY FIX: Auto-approve join requests for groups where current user is creator
  // Get list of groups where current user is creator
  const creatorGroups = useMemo(() => {
    if (!user?.username) return [];
    return groupCaches.filter(group => group.creator === user.username);
  }, [user?.username, groupCaches]);
  
  // Enable auto-approval for all creator-owned groups
  // We pass the first group (or empty string) and rely on the hook to handle all groups
  // Note: In a production app, you'd want to refactor this to handle multiple groups better
  // For now, we'll call the hook for the first creator group as a proof of concept
  useAutoApproveJoinRequests(
    creatorGroups[0]?.groupId || '',
    creatorGroups[0]?.creator || '',
    creatorGroups.length > 0,
    creatorGroups.length > 0
  );
  
  // TODO: For multiple creator-owned groups, we should refactor the hook to accept an array
  // For now, this handles at least one group as a security fix
  
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

  // Merge 1:1 conversations and group conversations (memoized to prevent infinite renders)
  const directConversations = useMemo<Conversation[]>(() => 
    conversationCaches
      .filter((conv): conv is ConversationCache => conv !== null && conv !== undefined)
      .filter(conv => !isHidden(conv.partnerUsername))
      .map(mapConversationCacheToConversation),
    [conversationCaches, isHidden]
  );
  
  const groupConversations = useMemo<Conversation[]>(() =>
    groupCaches
      .filter((group): group is GroupConversationCache => group !== null && group !== undefined)
      .map(mapGroupCacheToConversation),
    [groupCaches]
  );
  
  // Combine and sort by last message time (memoized to prevent infinite renders)
  const conversations = useMemo<Conversation[]>(() =>
    [...directConversations, ...groupConversations]
      .sort((a, b) => {
        const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
        const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
        return bTime - aTime;
      }),
    [directConversations, groupConversations]
  );
  
  const selectedConversationId = selectedPartner ? getConversationKey(user?.username || '', selectedPartner) : null;
  const selectedConversation = selectedPartner 
    ? conversations.find(c => c.id === selectedConversationId)
    : selectedGroupId
      ? conversations.find(c => c.id === selectedGroupId)
      : undefined;
  
  const selectedGroup = selectedGroupId ? groupCaches.find(g => g.groupId === selectedGroupId) : undefined;
  
  // Map messages based on type (group or direct) - memoized to prevent infinite renders
  const currentMessages = useMemo<Message[]>(() => 
    selectedGroupId
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
        ),
    [selectedGroupId, groupMessageCaches, messageCaches, selectedConversationId]
  );

  // Run timestamp migration and fix corrupted cached messages on mount
  useEffect(() => {
    if (!user?.username) {
      return;
    }
    
    // Run UTC timestamp migration first
    import('@/lib/messageCache').then(async ({ migrateTimestampsToUTC, clearAllCache, fixCorruptedMessages, migrateGroupMessages }) => {
      try {
        // Run migration
        const counts = await migrateTimestampsToUTC(user.username);
        if (counts.messages > 0 || counts.conversations > 0 || counts.customJsonMessages > 0) {
          logger.info('[INIT] ✅ Migrated timestamps to UTC:', counts);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
          queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
        }
        
        // Check cache version for other fixes
        const cacheVersion = localStorage.getItem('hive_cache_version');
        if (cacheVersion !== '7.0') {
          logger.info('[INIT] 🗑️ Cache version outdated, clearing cache...');
          await clearAllCache(user.username);
          localStorage.setItem('hive_cache_version', '7.0');
          logger.info('[INIT] ✅ Cache cleared successfully, version updated to 7.0');
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
          queryClient.invalidateQueries({ queryKey: ['blockchain-conversations', user.username] });
        }
        
        // Regular corruption fix (for content === encryptedContent cases)
        const fixCount = await fixCorruptedMessages(user.username);
        if (fixCount > 0) {
          logger.info(`[INIT] ✅ Fixed ${fixCount} corrupted messages, refreshing...`);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
        }
        
        // Migrate misplaced group messages from messages table to groupMessages table
        const migratedCount = await migrateGroupMessages(user.username);
        if (migratedCount > 0) {
          logger.info(`[INIT] ✅ Migrated ${migratedCount} group messages, refreshing...`);
          queryClient.invalidateQueries({ queryKey: ['blockchain-messages'] });
          queryClient.invalidateQueries({ queryKey: ['blockchain-group-messages'] });
          queryClient.invalidateQueries({ queryKey: ['group-discovery', user.username] });
        }
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

  // Shareable group link system - handle ?groupId=xxx URL parameter
  useEffect(() => {
    // Early return if still loading groups
    if (isLoadingGroups) {
      return;
    }

    // Parse URL search params
    const searchParams = new URLSearchParams(location.split('?')[1] || '');
    const groupIdFromUrl = searchParams.get('groupId');

    // Early return if no groupId in URL or it's empty/invalid
    if (!groupIdFromUrl || !groupIdFromUrl.trim()) {
      return;
    }

    // Early return if user already has a conversation selected (don't interrupt them)
    if (selectedPartner || selectedGroupId) {
      logger.info('[GROUP LINK] User already has a conversation selected, skipping auto-open');
      return;
    }

    logger.info('[GROUP LINK] Processing group link:', groupIdFromUrl);

    // Look for the group in groupCaches
    const foundGroup = groupCaches.find(g => g.groupId === groupIdFromUrl);

    // Clear the URL parameter
    setLocation('/messages');

    if (!foundGroup) {
      // Group not found
      logger.info('[GROUP LINK] Group not found:', groupIdFromUrl);
      toast({
        title: 'Group not found',
        description: 'Group not found or you don\'t have access',
        variant: 'destructive',
      });
      return;
    }

    // Check if user is a member (either in members array or is the creator)
    const isMember = user?.username && (
      foundGroup.members.includes(user.username) || 
      foundGroup.creator === user.username
    );

    if (isMember) {
      // User is a member - auto-select the group
      logger.info('[GROUP LINK] User is member, auto-selecting group:', foundGroup.name);
      setSelectedGroupId(groupIdFromUrl);
      setSelectedPartner(''); // Clear direct message selection
      if (isMobile) {
        setShowChat(true);
      }
      toast({
        title: 'Group opened',
        description: `Opening ${foundGroup.name}`,
      });
    } else {
      // User is NOT a member - show join dialog with JoinGroupButton
      logger.info('[GROUP LINK] User is not member, showing join dialog:', foundGroup.name);
      setJoinDialogGroup(foundGroup);
    }
  }, [location, isLoadingGroups, groupCaches, selectedPartner, selectedGroupId, user?.username, isMobile, setShowChat, toast]);

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

  const handleCreateGroup = async (groupName: string, members: string[], paymentSettings?: PaymentSettings) => {
    try {
      if (!user?.username) {
        throw new Error('You must be logged in to create a group');
      }

      logger.info('[GROUP CREATION] Creating group:', { groupName, members, paymentSettings });

      // Generate unique group ID
      const groupId = generateGroupId();
      const timestamp = new Date().toISOString();

      // Broadcast group creation to blockchain (free - custom_json)
      await broadcastGroupCreation(user.username, groupId, groupName, members, paymentSettings);

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
        paymentSettings,
        memberPayments: [], // Initialize empty payments array
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

  const handleEditGroupName = () => {
    if (!selectedGroup) return;
    setEditNameValue(selectedGroup.name);
    setIsEditNameOpen(true);
  };

  const handleSaveGroupName = async () => {
    if (!user?.username || !selectedGroupId || !editNameValue.trim()) return;

    try {
      const newName = editNameValue.trim();
      
      // Step 1: Save custom name to localStorage
      setCustomGroupName(user.username, selectedGroupId, newName);
      
      // Step 2: Optimistically update React Query cache for immediate UI update
      queryClient.setQueryData(['blockchain-group-conversations', user.username], (oldData: GroupConversationCache[] | undefined) => {
        if (!oldData) return oldData;
        
        return oldData.map(group => 
          group.groupId === selectedGroupId
            ? { ...group, name: newName }
            : group
        );
      });
      
      // Step 3: Update IndexedDB cache for persistence
      const currentGroup = groupCaches.find(g => g.groupId === selectedGroupId);
      if (currentGroup) {
        await cacheGroupConversation({
          ...currentGroup,
          name: newName
        }, user.username);
      }
      
      // Step 4: Invalidate queries to trigger background refetch (don't await - allow immediate UI update)
      queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user.username] });
      
      toast({
        title: 'Group name updated',
        description: `Group renamed to "${newName}"`,
      });
      
      setIsEditNameOpen(false);
    } catch (error) {
      logger.error('[EDIT GROUP NAME] Failed:', error);
      toast({
        title: 'Error',
        description: 'Failed to update group name',
        variant: 'destructive',
      });
    }
  };

  const handleLeaveGroup = () => {
    setIsLeaveGroupDialogOpen(true);
  };

  const handleConfirmLeaveGroup = async () => {
    if (!user?.username || !selectedGroupId || !selectedGroup) return;
    
    try {
      const groupName = selectedGroup.name;
      const groupIdToLeave = selectedGroupId;
      
      logger.info('[LEAVE GROUP] Leaving group:', groupIdToLeave);
      
      // Close dialog and clear selection immediately for better UX (optimistic UI)
      setIsLeaveGroupDialogOpen(false);
      setSelectedGroupId('');
      if (isMobile) {
        setShowChat(false);
      }
      
      // Optimistically remove group from cache
      queryClient.setQueryData(
        ['blockchain-group-conversations', user.username],
        (oldData: GroupConversationCache[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.filter(g => g.groupId !== groupIdToLeave);
        }
      );
      
      // Broadcast leave group operation to blockchain (free - custom_json)
      await broadcastLeaveGroup(user.username, groupIdToLeave);
      
      // Delete local group data
      await deleteGroupConversation(groupIdToLeave, user.username);
      
      // Comprehensive query invalidation to refresh all group-related data
      await queryClient.invalidateQueries({ queryKey: ['blockchain-group-messages', user.username, groupIdToLeave] });
      await queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user.username] });
      await queryClient.invalidateQueries({ queryKey: ['group-discovery', user.username] });
      
      // Show success toast
      toast({
        title: 'Left Group',
        description: `You have left "${groupName}". You will no longer receive messages from this group.`,
      });
      
      logger.info('[LEAVE GROUP] ✅ Successfully left group:', groupIdToLeave);
    } catch (error) {
      logger.error('[LEAVE GROUP] ❌ Failed to leave group:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to leave group';
      
      // Revert optimistic update on error
      await queryClient.invalidateQueries({ queryKey: ['blockchain-group-conversations', user.username] });
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
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
              paymentSettings={selectedGroup.paymentSettings}
              memberPayments={selectedGroup.memberPayments}
              onManageMembers={handleManageMembers}
              onDeleteLocalData={handleDeleteLocalData}
              onEditName={handleEditGroupName}
              onLeaveGroup={handleLeaveGroup}
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
          groupId={selectedGroup.groupId}
          groupName={selectedGroup.name}
          currentMembers={selectedGroup.members}
          creator={selectedGroup.creator}
          currentUsername={user?.username}
          paymentSettings={selectedGroup.paymentSettings}
          memberPayments={selectedGroup.memberPayments}
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

      <Dialog open={isEditNameOpen} onOpenChange={setIsEditNameOpen}>
        <DialogContent data-testid="dialog-edit-group-name">
          <DialogHeader>
            <DialogTitle>Edit Group Name</DialogTitle>
            <DialogDescription>
              Enter a custom name for this group. This is stored locally on your device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="group-name-input" className="text-sm font-medium">
                Group Name
              </label>
              <Input
                id="group-name-input"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                placeholder="Enter group name"
                data-testid="input-group-name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editNameValue.trim()) {
                    handleSaveGroupName();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditNameOpen(false)}
              data-testid="button-cancel-edit-name"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveGroupName}
              disabled={!editNameValue.trim()}
              data-testid="button-save-group-name"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <AlertDialog open={isLeaveGroupDialogOpen} onOpenChange={setIsLeaveGroupDialogOpen}>
        <AlertDialogContent data-testid="dialog-leave-group">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Group?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave "{selectedGroup?.name}"?
              <br /><br />
              You will no longer receive messages from this group, and the leave operation will be recorded on the blockchain.
              <br /><br />
              <strong>Note:</strong> The group creator can add you back if they choose to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-leave">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmLeaveGroup}
              data-testid="button-confirm-leave"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave Group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!joinDialogGroup} onOpenChange={(open) => !open && setJoinDialogGroup(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-join-group">
          <DialogHeader>
            <DialogTitle>Join {joinDialogGroup?.name}</DialogTitle>
            <DialogDescription>
              {joinDialogGroup && (
                <>
                  This group has {joinDialogGroup.members.length} member{joinDialogGroup.members.length !== 1 ? 's' : ''}.
                  {joinDialogGroup.paymentSettings?.enabled && parseFloat(joinDialogGroup.paymentSettings.amount) > 0 && (
                    <>
                      {' '}A payment of {joinDialogGroup.paymentSettings.amount} HBD is required to join.
                    </>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setJoinDialogGroup(null)}
              data-testid="button-cancel-join"
            >
              Cancel
            </Button>
            {joinDialogGroup && (
              <JoinGroupButton
                groupId={joinDialogGroup.groupId}
                groupName={joinDialogGroup.name}
                creatorUsername={joinDialogGroup.creator}
                paymentSettings={joinDialogGroup.paymentSettings}
                onJoinSuccess={() => {
                  setSelectedGroupId(joinDialogGroup.groupId);
                  setSelectedPartner('');
                  if (isMobile) {
                    setShowChat(true);
                  }
                  setJoinDialogGroup(null);
                }}
              />
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
