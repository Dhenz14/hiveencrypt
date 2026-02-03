import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { UserSession } from '@shared/schema';
import { 
  requestHandshake, 
  requestLogin,
  getAccount 
} from '@/lib/hive';
import { 
  detectKeychainPlatform, 
  isKeychainAvailable,
  clearPlatformCache,
  type KeychainPlatform 
} from '@/lib/keychainDetection';
import { cleanupOrphanedMessages } from '@/lib/messageCache';
import { logger } from '@/lib/logger';

interface AuthContextType {
  user: UserSession | null;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  platform: KeychainPlatform | null;
  needsKeychainRedirect: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'hive_messenger_session';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [platform, setPlatform] = useState<KeychainPlatform | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Abort controller ref for cleanup - prevents state updates after unmount
  const abortedRef = useRef<boolean>(false);
  const mountCountRef = useRef<number>(0);

  // Session restoration function
  const restoreSession = async (aborted: () => boolean): Promise<void> => {
    try {
      const sessionData = localStorage.getItem(SESSION_KEY);
      
      if (!sessionData) {
        logger.debug('[Auth] No stored session found');
        return;
      }
      
      const session = JSON.parse(sessionData);
      logger.info('[Auth] Found stored session for:', session.username);
      
      // Verify account still exists on blockchain
      try {
        const account = await getAccount(session.username);
        
        if (aborted()) {
          logger.debug('[Auth] Session restore aborted (component unmounted)');
          return;
        }
        
        if (account) {
          logger.info('[Auth] Account verified, restoring session for:', session.username);
          setUser(session);
          logger.info('[Auth] Session restored for:', session.username);
          
          // Cleanup orphaned messages after session restore
          try {
            const cleanedCount = await cleanupOrphanedMessages(session.username);
            if (cleanedCount > 0) {
              logger.info('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
            }
          } catch (cleanupError) {
            logger.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
          }
        } else {
          logger.warn('[Auth] Account no longer exists on blockchain, clearing session...');
          localStorage.removeItem(SESSION_KEY);
        }
      } catch (accountError: any) {
        if (aborted()) {
          logger.debug('[Auth] Session restore aborted during account check');
          return;
        }
        
        // Network error or RPC timeout - keep session and restore it anyway
        logger.warn('[Auth] Failed to verify account (network error), restoring session anyway:', accountError.message);
        setUser(session);
        logger.info('[Auth] Session restored despite network error for:', session.username);
      }
    } catch (error) {
      logger.error('[Auth] Error restoring session:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('JSON')) {
        logger.warn('[Auth] Corrupted session data, clearing session');
        localStorage.removeItem(SESSION_KEY);
      }
    }
  };

  // Main initialization effect - runs on each mount
  // Uses abort flag pattern for safe cleanup instead of global state
  useEffect(() => {
    mountCountRef.current++;
    const currentMount = mountCountRef.current;
    abortedRef.current = false;
    
    logger.info('[Auth] AuthProvider mounted (mount #' + currentMount + ')');
    
    // Warn on potential remount issues (debugging aid)
    if (currentMount > 1) {
      logger.warn('[Auth] AuthProvider re-mounted. Mount count:', currentMount);
    }
    
    const initialize = async () => {
      // Helper to check if this effect was cleaned up
      const isAborted = () => abortedRef.current;
      
      try {
        logger.info('[Auth] Starting platform detection...');
        
        // detectKeychainPlatform uses sessionStorage cache internally
        // This prevents expensive re-detection on remounts while allowing fresh detection when needed
        const detectedPlatform = await detectKeychainPlatform();
        
        if (isAborted()) {
          logger.debug('[Auth] Platform detection completed but component unmounted, skipping state update');
          return;
        }
        
        setPlatform(detectedPlatform);
        logger.info('[Auth] Platform set:', detectedPlatform);
        
        // Only restore session if we have Keychain available
        if (detectedPlatform !== 'mobile-redirect') {
          await restoreSession(isAborted);
        }
      } catch (error) {
        if (isAborted()) {
          logger.debug('[Auth] Initialization error but component unmounted');
          return;
        }
        
        logger.error('[Auth] Platform detection error:', error);
        // On desktop without extension, we'll show error in login UI
      }
      
      // Always set loading to false when done, unless aborted
      if (!isAborted()) {
        setIsLoading(false);
        logger.info('[Auth] Initialization complete');
      }
    };
    
    initialize();
    
    // Cleanup: set abort flag to prevent state updates after unmount
    return () => {
      abortedRef.current = true;
      logger.debug('[Auth] AuthProvider cleanup (mount #' + currentMount + ')');
    };
  }, []); // Empty deps - runs on mount

  const login = async (username: string) => {
    logger.info('[Auth] Starting login for:', username, 'platform:', platform);
    
    if (!isKeychainAvailable()) {
      throw new Error('Keychain not available. Please ensure you are using Hive Keychain.');
    }
    
    const account = await getAccount(username);
    if (!account) {
      throw new Error('Account not found on Hive blockchain. Please check the username and try again.');
    }

    const publicMemoKey = account.memo_key;
    if (!publicMemoKey) {
      throw new Error('Unable to retrieve public memo key for this account.');
    }

    try {
      await requestHandshake();
      await requestLogin(username);
      logger.info('[Auth] Keychain authentication successful');
    } catch (keychainError: any) {
      if (keychainError?.message?.includes('cancel') || keychainError?.error?.includes('cancel')) {
        throw new Error('Authentication cancelled. Please try again and approve the Keychain request.');
      }
      throw new Error(keychainError?.message || 'Failed to authenticate with Hive Keychain. Please try again.');
    }

    const sessionData: UserSession = {
      username,
      publicMemoKey,
      isAuthenticated: true,
      timestamp: new Date().toISOString(),
    };

    logger.info('[Auth] Setting user session...');
    setUser(sessionData);
    
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      logger.info('[Auth] Session saved to localStorage');
    } catch (storageError) {
      logger.warn('[Auth] Failed to save session to localStorage:', storageError);
    }
    
    logger.info('[Auth] Login complete!');
    
    try {
      const cleanedCount = await cleanupOrphanedMessages(username);
      if (cleanedCount > 0) {
        logger.info('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
      }
    } catch (cleanupError) {
      logger.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
    }
  };

  const logout = async () => {
    logger.info('[Auth] Logging out...');
    
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    clearPlatformCache();
    
    logger.info('[Auth] Logout complete');
  };

  const needsKeychainRedirect = platform === 'mobile-redirect';

  // Debug logging for state changes
  useEffect(() => {
    logger.debug('[Auth State] user:', user?.username || 'null', 'platform:', platform, 'loading:', isLoading, 'needsRedirect:', needsKeychainRedirect);
  }, [user, platform, isLoading, needsKeychainRedirect]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      logout, 
      isLoading, 
      platform,
      needsKeychainRedirect
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
