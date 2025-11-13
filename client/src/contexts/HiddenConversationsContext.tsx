/**
 * HiddenConversationsContext
 * 
 * Centralized state management for hidden conversations
 * Allows users to hide conversations from sidebar without deleting data
 * All conversation data remains in cache - just filtered from UI
 * 
 * Feature: Hide Chat (v2.1.0)
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
 * Context value type
 */
export interface HiddenConversationsContextValue {
  hiddenConversations: string[];
  isHidden: (username: string) => boolean;
  hideConversation: (username: string) => void;
  unhideConversation: (username: string) => void;
  toggleHidden: (username: string) => void;
  unhideAll: () => void;
  isLoading: boolean;
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
 * HiddenConversationsProvider - Centralized state management for hidden chats
 * 
 * Features:
 * - Single source of truth for all components
 * - Automatic localStorage persistence
 * - Real-time updates across all consumers
 * - Conversations remain in cache, just hidden from sidebar
 * 
 * @param props Provider props
 */
export function HiddenConversationsProvider({ children }: HiddenConversationsProviderProps) {
  const { user } = useAuth();
  const [hiddenConversations, setHiddenConversations] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load hidden conversations from localStorage on mount or user change
  useEffect(() => {
    if (!user?.username) {
      setHiddenConversations([]);
      setIsLoading(false);
      return;
    }
    
    try {
      const key = getHiddenConversationsKey(user.username);
      const stored = localStorage.getItem(key);
      
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHiddenConversations(parsed);
          console.log('[HiddenConversationsContext] Loaded hidden conversations:', parsed);
        } else {
          setHiddenConversations([]);
        }
      } else {
        setHiddenConversations([]);
      }
    } catch (error) {
      console.error('[HiddenConversationsContext] Failed to load hidden conversations:', error);
      setHiddenConversations([]);
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
  
  /**
   * Check if a conversation is hidden
   */
  const isHidden = useCallback((username: string): boolean => {
    return hiddenConversations.includes(username.toLowerCase());
  }, [hiddenConversations]);
  
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
   * Unhide a conversation
   */
  const unhideConversation = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    setHiddenConversations(prev => prev.filter(u => u !== normalized));
    
    console.log('[HiddenConversationsContext] Unhidden conversation:', normalized);
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
   * Unhide all conversations
   */
  const unhideAll = useCallback(() => {
    setHiddenConversations([]);
    console.log('[HiddenConversationsContext] Unhidden all conversations');
  }, []);
  
  const value: HiddenConversationsContextValue = {
    hiddenConversations,
    isHidden,
    hideConversation,
    unhideConversation,
    toggleHidden,
    unhideAll,
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
