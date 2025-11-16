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
        console.log('[Auth] Platform detected:', detectedPlatform);
        
        // Only restore session if we have Keychain available
        if (detectedPlatform !== 'mobile-redirect') {
          await restoreSession();
        }
      } catch (error) {
        console.error('[Auth] Platform detection error:', error);
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
        const account = await getAccount(session.username);
        if (account) {
          setUser(session);
          console.log('[Auth] Session restored for:', session.username);
          
          // EDGE CASE FIX #2: Cleanup orphaned messages after session restore
          try {
            const cleanedCount = await cleanupOrphanedMessages(session.username);
            if (cleanedCount > 0) {
              console.log('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
            }
          } catch (cleanupError) {
            console.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
            // Don't block login if cleanup fails
          }
        } else {
          console.log('[Auth] Account no longer exists on blockchain, clearing session...');
          localStorage.removeItem(SESSION_KEY);
        }
      }
    } catch (error) {
      console.error('[Auth] Error restoring session:', error);
      localStorage.removeItem(SESSION_KEY);
    }
  };

  const login = async (username: string) => {
    console.log('[Auth] Starting login for:', username, 'platform:', platform);
    
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
      console.log('[Auth] Keychain authentication successful');
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
      console.warn('[Auth] Failed to save session to localStorage:', storageError);
      // Continue anyway - session is in memory
    }
    
    console.log('[Auth] ✅ Login complete! Session stored locally.');
    
    // EDGE CASE FIX #2: Cleanup orphaned messages after login
    try {
      const cleanedCount = await cleanupOrphanedMessages(username);
      if (cleanedCount > 0) {
        console.log('[Auth] Cleaned up', cleanedCount, 'orphaned messages');
      }
    } catch (cleanupError) {
      console.warn('[Auth] Failed to cleanup orphaned messages:', cleanupError);
      // Don't block login if cleanup fails
    }
  };

  const logout = async () => {
    console.log('[Auth] Logging out...');
    
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    
    console.log('[Auth] ✅ Logout complete');
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
