/**
 * ExceptionsContext
 * 
 * Centralized state management for minimum HBD filter exceptions list
 * Ensures all components share the same live exceptions data
 * Updates propagate immediately across all consumers
 * 
 * Feature: Exceptions List (v2.1.0) - Centralized State Fix
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Get localStorage key for user's exceptions list
 */
function getExceptionsKey(username: string): string {
  return `hive_messenger_exceptions_${username}`;
}

/**
 * Context value type
 */
export interface ExceptionsContextValue {
  exceptions: string[];
  isException: (username: string) => boolean;
  addException: (username: string) => void;
  removeException: (username: string) => void;
  toggleException: (username: string) => void;
  isLoading: boolean;
}

/**
 * Create context with default undefined value
 */
const ExceptionsContext = createContext<ExceptionsContextValue | undefined>(undefined);

/**
 * Provider props
 */
interface ExceptionsProviderProps {
  children: ReactNode;
}

/**
 * ExceptionsProvider - Centralized state management for exceptions list
 * 
 * Features:
 * - Single source of truth for all components
 * - Automatic localStorage persistence
 * - Real-time updates across all consumers
 * - Triggers blockchain messages re-evaluation on changes
 * 
 * @param props Provider props
 */
export function ExceptionsProvider({ children }: ExceptionsProviderProps) {
  const { user } = useAuth();
  const [exceptions, setExceptions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load exceptions from localStorage on mount or user change
  useEffect(() => {
    if (!user?.username) {
      setExceptions([]);
      setIsLoading(false);
      return;
    }
    
    try {
      const key = getExceptionsKey(user.username);
      const stored = localStorage.getItem(key);
      
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setExceptions(parsed);
          console.log('[ExceptionsContext] Loaded exceptions:', parsed);
        } else {
          setExceptions([]);
        }
      } else {
        setExceptions([]);
      }
    } catch (error) {
      console.error('[ExceptionsContext] Failed to load exceptions:', error);
      setExceptions([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.username]);
  
  // Save exceptions to localStorage whenever they change
  useEffect(() => {
    if (!user?.username || isLoading) return;
    
    try {
      const key = getExceptionsKey(user.username);
      localStorage.setItem(key, JSON.stringify(exceptions));
      console.log('[ExceptionsContext] Saved exceptions:', exceptions);
      
      // Dispatch custom event to notify blockchain messages hook to re-evaluate
      window.dispatchEvent(new CustomEvent('exceptionsChanged', {
        detail: { exceptions, username: user.username }
      }));
    } catch (error) {
      console.error('[ExceptionsContext] Failed to save exceptions:', error);
    }
  }, [exceptions, user?.username, isLoading]);
  
  /**
   * Check if a username is in the exceptions list
   */
  const isException = useCallback((username: string): boolean => {
    return exceptions.includes(username.toLowerCase());
  }, [exceptions]);
  
  /**
   * Add a username to the exceptions list
   */
  const addException = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    setExceptions(prev => {
      if (prev.includes(normalized)) {
        return prev; // Already in list
      }
      return [...prev, normalized];
    });
    
    console.log('[ExceptionsContext] Added exception:', normalized);
  }, []);
  
  /**
   * Remove a username from the exceptions list
   */
  const removeException = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    setExceptions(prev => prev.filter(u => u !== normalized));
    
    console.log('[ExceptionsContext] Removed exception:', normalized);
  }, []);
  
  /**
   * Toggle exception status for a username
   */
  const toggleException = useCallback((username: string) => {
    const normalized = username.toLowerCase();
    
    if (isException(normalized)) {
      removeException(normalized);
    } else {
      addException(normalized);
    }
  }, [isException, addException, removeException]);
  
  const value: ExceptionsContextValue = {
    exceptions,
    isException,
    addException,
    removeException,
    toggleException,
    isLoading,
  };
  
  return (
    <ExceptionsContext.Provider value={value}>
      {children}
    </ExceptionsContext.Provider>
  );
}

/**
 * Hook to access exceptions context
 * Throws error if used outside provider
 */
export function useExceptions(): ExceptionsContextValue {
  const context = useContext(ExceptionsContext);
  
  if (!context) {
    throw new Error('useExceptions must be used within ExceptionsProvider');
  }
  
  return context;
}
