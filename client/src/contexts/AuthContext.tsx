import { createContext, useContext, useState, useEffect } from 'react';
import type { UserSession } from '@shared/schema';
import { hiveClient } from '@/lib/hiveClient';
import { 
  isKeychainInstalled, 
  requestHandshake, 
  requestLogin,
  getAccount 
} from '@/lib/hive';
import { 
  isMobileDevice, 
  authenticateWithHAS, 
  isHASTokenValid,
  type HASAuthData 
} from '@/lib/hasAuth';

interface AuthContextType {
  user: UserSession | null;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  isMobile: boolean;
  hasAuth: HASAuthData | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'hive_messenger_session';
const HAS_TOKEN_KEY = 'hive_messenger_has_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [hasAuth, setHasAuth] = useState<HASAuthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile] = useState(isMobileDevice());

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const sessionData = localStorage.getItem(SESSION_KEY);
        const hasToken = localStorage.getItem(HAS_TOKEN_KEY);
        
        if (sessionData) {
          const session = JSON.parse(sessionData);
          
          // Verify account still exists on blockchain
          const account = await getAccount(session.username);
          if (account) {
            setUser(session);
            
            // Restore HAS token if available and valid
            if (hasToken) {
              const hasAuthData: HASAuthData = JSON.parse(hasToken);
              if (isHASTokenValid(hasAuthData)) {
                setHasAuth(hasAuthData);
              } else {
                console.log('[Auth] HAS token expired, clearing...');
                localStorage.removeItem(HAS_TOKEN_KEY);
              }
            }
          } else {
            console.log('[Auth] Account no longer exists on blockchain, clearing session...');
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(HAS_TOKEN_KEY);
          }
        }
      } catch (error) {
        console.error('[Auth] Error restoring session:', error);
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(HAS_TOKEN_KEY);
      }
      
      setIsLoading(false);
    };
    
    restoreSession();
  }, []);

  const login = async (username: string) => {
    console.log('[Auth] Starting login for:', username, 'isMobile:', isMobile);
    
    // 1. Verify account exists on blockchain (direct call, no server!)
    const account = await getAccount(username);
    if (!account) {
      throw new Error('Account not found on Hive blockchain. Please check the username and try again.');
    }

    // 2. Get public memo key from blockchain
    const publicMemoKey = account.memo_key;
    if (!publicMemoKey) {
      throw new Error('Unable to retrieve public memo key for this account.');
    }

    let authData: HASAuthData | null = null;

    // 3. Authenticate based on device type
    if (isMobile) {
      // Mobile: Use HAS (Hive Authentication Services)
      console.log('[Auth] Mobile device detected, using HAS authentication...');
      
      try {
        authData = await authenticateWithHAS(username, (evt) => {
          console.log('[Auth] HAS waiting:', evt);
          // You can show QR code or status here via a callback/state
        });
        
        console.log('[Auth] HAS authentication successful');
        setHasAuth(authData);
        
        // Store HAS token for future use
        localStorage.setItem(HAS_TOKEN_KEY, JSON.stringify(authData));
      } catch (hasError: any) {
        console.error('[Auth] HAS authentication failed:', hasError);
        throw new Error(hasError?.message || 'Mobile authentication failed. Please try again.');
      }
    } else {
      // Desktop: Use Hive Keychain browser extension
      console.log('[Auth] Desktop device detected, using Hive Keychain...');
      
      if (!isKeychainInstalled()) {
        throw new Error('Please install Hive Keychain extension from https://hive-keychain.com');
      }

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
    }

    // 4. Create session data (100% client-side, no server needed!)
    const sessionData: UserSession = {
      username,
      publicMemoKey,
      isAuthenticated: true,
      timestamp: new Date().toISOString(),
    };

    // 5. Store user session in state and localStorage
    setUser(sessionData);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    
    console.log('[Auth] ✅ Login complete! Session stored locally.');
  };

  const logout = async () => {
    console.log('[Auth] Logging out...');
    
    // Clear all local state and storage
    setUser(null);
    setHasAuth(null);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(HAS_TOKEN_KEY);
    
    console.log('[Auth] ✅ Logout complete');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, isMobile, hasAuth }}>
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
