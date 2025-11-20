import { createContext, useContext, useState, useEffect } from 'react';
import type { UserSession } from '@shared/schema';
import { 
  requestHandshake, 
  requestLogin,
  getAccount 
} from '@/lib/hive';
import { 
  detectKeychainPlatform, 
  isKeychainAvailable,
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

  useEffect(() => {
    const initialize = async () => {
      try {
        // Detect platform first
        const detectedPlatform = await detectKeychainPlatform();
        setPlatform(detectedPlatform);
        logger.info('[Auth] Platform detected:', detectedPlatform);
        
        // Only restore session if we have Keychain available
        if (detectedPlatform !== 'mobile-redirect') {
          await restoreSession();
        }
      } catch (error) {
        logger.error('[Auth] Platform detection error:', error);
        // On desktop without extension, we'll show error in login UI
      }
      
      setIsLoading(false);
    };
    
    initialize();
  }, []);
  
  const restoreSession = async () => {
    try {
      const sessionData = localStorage.getItem(SESSION_KEY);
      
      if (sessionData) {
        const session = JSON.parse(sessionData);
        
        // Verify account still exists on blockchain
        // CRITICAL FIX: Don't remove session on network errors, only on account not found
        try {
          const account = await getAccount(session.username);
          if (account) {
            setUser(session);
            logger.info('[Auth] Session restored for:', session.username);
            
            // EDGE CASE FIX #2: Cleanup orphaned messages after session restore
            try {
              const cleanedCount = await cleanupOrphanedMessages(session.username);
              if (cleanedCount > 0) {
                logger.info('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
              }
            } catch (cleanupError) {
              logger.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
              // Don't block login if cleanup fails
            }
          } else {
            // Account truly doesn't exist (got null/undefined response from RPC)
            logger.warn('[Auth] Account no longer exists on blockchain, clearing session...');
            localStorage.removeItem(SESSION_KEY);
          }
        } catch (accountError: any) {
          // Network error or RPC timeout - keep session and restore it anyway
          // User can retry operations when network recovers
          logger.warn('[Auth] Failed to verify account (network error), restoring session anyway:', accountError.message);
          setUser(session);
        }
      }
    } catch (error) {
      // Only remove session if there's a JSON parse error (corrupted session data)
      logger.error('[Auth] Error restoring session:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('JSON')) {
        logger.warn('[Auth] Corrupted session data, clearing session');
        localStorage.removeItem(SESSION_KEY);
      } else {
        logger.warn('[Auth] Temporary error, keeping session');
      }
    }
  };

  const login = async (username: string) => {
    logger.info('[Auth] Starting login for:', username, 'platform:', platform);
    
    // Ensure Keychain is available
    if (!isKeychainAvailable()) {
      throw new Error('Keychain not available. Please ensure you are using Hive Keychain.');
    }
    
    // 1. Verify account exists on blockchain
    const account = await getAccount(username);
    if (!account) {
      throw new Error('Account not found on Hive blockchain. Please check the username and try again.');
    }

    // 2. Get public memo key from blockchain
    const publicMemoKey = account.memo_key;
    if (!publicMemoKey) {
      throw new Error('Unable to retrieve public memo key for this account.');
    }

    // 3. Authenticate with Keychain (works on desktop extension AND Keychain Mobile browser)
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

    // 4. Create session data (100% client-side, no server!)
    const sessionData: UserSession = {
      username,
      publicMemoKey,
      isAuthenticated: true,
      timestamp: new Date().toISOString(),
    };

    // 5. Store user session
    setUser(sessionData);
    
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (storageError) {
      logger.warn('[Auth] Failed to save session to localStorage:', storageError);
      // Continue anyway - session is in memory
    }
    
    logger.info('[Auth] ✅ Login complete! Session stored locally.');
    
    // EDGE CASE FIX #2: Cleanup orphaned messages after login
    try {
      const cleanedCount = await cleanupOrphanedMessages(username);
      if (cleanedCount > 0) {
        logger.info('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
      }
    } catch (cleanupError) {
      logger.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
      // Don't block login if cleanup fails
    }
  };

  const logout = async () => {
    logger.info('[Auth] Logging out...');
    
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    
    logger.info('[Auth] ✅ Logout complete');
  };

  const needsKeychainRedirect = platform === 'mobile-redirect';

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
