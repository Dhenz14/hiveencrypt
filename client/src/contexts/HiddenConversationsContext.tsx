/**
 * HiddenConversationsContext
 * 
 * Centralized state management for hidden conversations and groups
 * Allows users to hide conversations/groups from sidebar without deleting data
 * All data remains in cache - just filtered from UI
 * 
 * Feature: Hide Chat (v2.1.0)
 * Feature: Hide Group (v2.2.0)
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Get localStorage key for user's hidden conversations list
 */
function getHiddenConversationsKey(username: string): string {
  return `hive_messenger_hidden_${username}`;
}

/**
 * Get localStorage key for user's hidden groups list
 */
function getHiddenGroupsKey(username: string): string {
  return `hive_messenger_hidden_groups_${username}`;
}

/**
 * Context value type
 */
export interface HiddenConversationsContextValue {
  // Hidden chats (by username)
  hiddenConversations: string[];
  isHidden: (username: string) => boolean;
  hideConversation: (username: string) => void;
  unhideConversation: (username: string) => void;
  toggleHidden: (username: string) => void;
  unhideAll: () => void;
  
  // Hidden groups (by groupId)
  hiddenGroups: string[];
  isGroupHidden: (groupId: string) => boolean;
  hideGroup: (groupId: string, groupName?: string) => void;
  unhideGroup: (groupId: string) => void;
  toggleGroupHidden: (groupId: string, groupName?: string) => void;
  unhideAllGroups: () => void;
  getHiddenGroupName: (groupId: string) => string | undefined;
  
  isLoading: boolean;
}

/**
 * Hidden group entry with name for display
 */
interface HiddenGroupEntry {
  groupId: string;
  groupName?: string;
}

/**
 * Create context with default undefined value
 */
const HiddenConversationsContext = createContext<HiddenConversationsContextValue | undefined>(undefined);

/**
 * Provider props
 */
interface HiddenConversationsProviderProps {
  children: ReactNode;
}

/**
 * HiddenConversationsProvider - Centralized state management for hidden chats and groups
 * 
 * Features:
 * - Single source of truth for all components
 * - Automatic localStorage persistence
 * - Real-time updates across all consumers
 * - Conversations/groups remain in cache, just hidden from sidebar
 * 
 * @param props Provider props
 */
export function HiddenConversationsProvider({ children }: HiddenConversationsProviderProps) {
  const { user } = useAuth();
  const [hiddenConversations, setHiddenConversations] = useState<string[]>([]);
  const [hiddenGroupEntries, setHiddenGroupEntries] = useState<HiddenGroupEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load hidden conversations from localStorage on mount or user change
  useEffect(() => {
    if (!user?.username) {
      setHiddenConversations([]);
      setHiddenGroupEntries([]);
      setIsLoading(false);
      return;
    }
    
    try {
      // Load hidden conversations
      const convKey = getHiddenConversationsKey(user.username);
      const storedConv = localStorage.getItem(convKey);
      
      if (storedConv) {
        const parsed = JSON.parse(storedConv);
        if (Array.isArray(parsed)) {
          setHiddenConversations(parsed);
          console.log('[HiddenConversationsContext] Loaded hidden conversations:', parsed);
        } else {
          setHiddenConversations([]);
        }
      } else {
        setHiddenConversations([]);
      }
      
      // Load hidden groups
      const groupKey = getHiddenGroupsKey(user.username);
      const storedGroups = localStorage.getItem(groupKey);
      
      if (storedGroups) {
        const parsed = JSON.parse(storedGroups);
        if (Array.isArray(parsed)) {
          setHiddenGroupEntries(parsed);
          console.log('[HiddenConversationsContext] Loaded hidden groups:', parsed);
        } else {
          setHiddenGroupEntries([]);
        }
      } else {
        setHiddenGroupEntries([]);
      }
    } catch (error) {
      console.error('[HiddenConversationsContext] Failed to load hidden data:', error);
      setHiddenConversations([]);
      setHiddenGroupEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.username]);
  
  // Save hidden conversations to localStorage whenever they change
  useEffect(() => {
    if (!user?.username || isLoading) return;
    
    try {
      const key = getHiddenConversationsKey(user.username);
      localStorage.setItem(key, JSON.stringify(hiddenConversations));
      console.log('[HiddenConversationsContext] Saved hidden conversations:', hiddenConversations);
      
      // Dispatch custom event to notify components to re-render
      window.dispatchEvent(new CustomEvent('hiddenConversationsChanged', {
        detail: { hiddenConversations, username: user.username }
      }));
    } catch (error) {
      console.error('[HiddenConversationsContext] Failed to save hidden conversations:', error);
    }
  }, [hiddenConversations, user?.username, isLoading]);
  
  // Save hidden groups to localStorage whenever they change
  useEffect(() => {
    if (!user?.username || isLoading) return;
    
    try {
      const key = getHiddenGroupsKey(user.username);
      localStorage.setItem(key, JSON.stringify(hiddenGroupEntries));
      console.log('[HiddenConversationsContext] Saved hidden groups:', hiddenGroupEntries);
      
      // Dispatch custom event to notify components to re-render
      window.dispatchEvent(new CustomEvent('hiddenGroupsChanged', {
        detail: { hiddenGroups: hiddenGroupEntries, username: user.username }
      }));
    } catch (error) {
      console.error('[HiddenConversationsContext] Failed to save hidden groups:', error);
    }
  }, [hiddenGroupEntries, user?.username, isLoading]);
  
  // Computed hiddenGroups array (just IDs for easy checking)
  const hiddenGroups = hiddenGroupEntries.map(e => e.groupId);
  
  /**
   * Check if a conversation is hidden
   */
  const isHidden = useCallback((username: string): boolean => {
    return hiddenConversations.includes(username.toLowerCase());
  }, [hiddenConversations]);
  
  /**
   * Check if a group is hidden
   */
  const isGroupHidden = useCallback((groupId: string): boolean => {
    return hiddenGroupEntries.some(e => e.groupId === groupId);
  }, [hiddenGroupEntries]);
  
  /**
   * Get hidden group name for display
   */
  const getHiddenGroupName = useCallback((groupId: string): string | undefined => {
    return hiddenGroupEntries.find(e => e.groupId === groupId)?.groupName;
  }, [hiddenGroupEntries]);
  
  /**
   * Hide a conversation
   */
  const hideConversation = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    setHiddenConversations(prev => {
      if (prev.includes(normalized)) {
        return prev; // Already hidden
      }
      return [...prev, normalized];
    });
    
    console.log('[HiddenConversationsContext] Hidden conversation:', normalized);
  }, []);
  
  /**
   * Hide a group
   */
  const hideGroup = useCallback((groupId: string, groupName?: string) => {
    setHiddenGroupEntries(prev => {
      if (prev.some(e => e.groupId === groupId)) {
        return prev; // Already hidden
      }
      return [...prev, { groupId, groupName }];
    });
    
    console.log('[HiddenConversationsContext] Hidden group:', groupId, groupName);
  }, []);
  
  /**
   * Unhide a conversation
   */
  const unhideConversation = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    setHiddenConversations(prev => prev.filter(u => u !== normalized));
    
    console.log('[HiddenConversationsContext] Unhidden conversation:', normalized);
  }, []);
  
  /**
   * Unhide a group
   */
  const unhideGroup = useCallback((groupId: string) => {
    setHiddenGroupEntries(prev => prev.filter(e => e.groupId !== groupId));
    
    console.log('[HiddenConversationsContext] Unhidden group:', groupId);
  }, []);
  
  /**
   * Toggle hidden status for a conversation
   */
  const toggleHidden = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    if (isHidden(normalized)) {
      unhideConversation(normalized);
    } else {
      hideConversation(normalized);
    }
  }, [isHidden, hideConversation, unhideConversation]);
  
  /**
   * Toggle hidden status for a group
   */
  const toggleGroupHidden = useCallback((groupId: string, groupName?: string) => {
    if (isGroupHidden(groupId)) {
      unhideGroup(groupId);
    } else {
      hideGroup(groupId, groupName);
    }
  }, [isGroupHidden, hideGroup, unhideGroup]);
  
  /**
   * Unhide all conversations
   */
  const unhideAll = useCallback(() => {
    setHiddenConversations([]);
    console.log('[HiddenConversationsContext] Unhidden all conversations');
  }, []);
  
  /**
   * Unhide all groups
   */
  const unhideAllGroups = useCallback(() => {
    setHiddenGroupEntries([]);
    console.log('[HiddenConversationsContext] Unhidden all groups');
  }, []);
  
  const value: HiddenConversationsContextValue = {
    // Chats
    hiddenConversations,
    isHidden,
    hideConversation,
    unhideConversation,
    toggleHidden,
    unhideAll,
    
    // Groups
    hiddenGroups,
    isGroupHidden,
    hideGroup,
    unhideGroup,
    toggleGroupHidden,
    unhideAllGroups,
    getHiddenGroupName,
    
    isLoading,
  };
  
  return (
    <HiddenConversationsContext.Provider value={value}>
      {children}
    </HiddenConversationsContext.Provider>
  );
}

/**
 * Hook to access hidden conversations context
 * Throws error if used outside provider
 */
export function useHiddenConversations(): HiddenConversationsContextValue {
  const context = useContext(HiddenConversationsContext);
  
  if (!context) {
    throw new Error('useHiddenConversations must be used within HiddenConversationsProvider');
  }
  
  return context;
}
