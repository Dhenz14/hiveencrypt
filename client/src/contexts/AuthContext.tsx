import { createContext, useContext, useState, useEffect } from 'react';
import type { UserSession } from '@shared/schema';
import { hiveClient } from '@/lib/hiveClient';
import { isKeychainInstalled, requestHandshake, requestLogin } from '@/lib/hive';
import { apiRequest } from '@/lib/queryClient';

interface AuthContextType {
  user: UserSession | null;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'hive_messenger_session_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const sessionToken = localStorage.getItem(SESSION_KEY);
      if (sessionToken) {
        try {
          // Validate session with backend
          const response = await fetch('/api/auth/verify', {
            headers: {
              'Authorization': `Bearer ${sessionToken}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.valid && data.username && data.publicMemoKey) {
              setUser({
                username: data.username,
                publicMemoKey: data.publicMemoKey,
                isAuthenticated: true,
                timestamp: new Date().toISOString(),
              });
            } else {
              console.error('Invalid session data from server');
              localStorage.removeItem(SESSION_KEY);
            }
          } else {
            console.log('Session invalid or expired, clearing...');
            localStorage.removeItem(SESSION_KEY);
          }
        } catch (error) {
          console.error('Error validating session:', error);
          localStorage.removeItem(SESSION_KEY);
        }
      }
      setIsLoading(false);
    };
    
    restoreSession();
  }, []);

  const login = async (username: string) => {
    // 1. Check if Keychain extension is available
    if (!isKeychainInstalled()) {
      throw new Error('Please install Hive Keychain extension from https://hive-keychain.com');
    }

    // 2. Verify account exists on blockchain
    const accountExists = await hiveClient.verifyAccountExists(username);
    if (!accountExists) {
      throw new Error('Account not found on Hive blockchain. Please check the username and try again.');
    }

    // 3. Fetch public memo key from blockchain
    const publicMemoKey = await hiveClient.getPublicMemoKey(username);
    if (!publicMemoKey) {
      throw new Error('Unable to retrieve public memo key for this account. Please try again later.');
    }

    // 4. Request Keychain authentication and capture signed proof
    let keychainResponse;
    try {
      await requestHandshake();
      keychainResponse = await requestLogin(username);
    } catch (keychainError: any) {
      if (keychainError?.message?.includes('cancel') || keychainError?.error?.includes('cancel')) {
        throw new Error('Authentication cancelled. Please try again and approve the Keychain request.');
      }
      throw new Error(keychainError?.message || 'Failed to authenticate with Hive Keychain. Please try again.');
    }

    // 5. Extract signature proof from Keychain response
    const keychainProof = {
      signature: keychainResponse.result,
      publicKey: keychainResponse.data?.publicKey || keychainResponse.publicKey,
      message: keychainResponse.data?.message || keychainResponse.message || `Login to Hive Messenger at ${new Date().toISOString()}`
    };

    // 6. Authenticate with backend and get session token
    let sessionToken: string;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          publicMemoKey,
          keychainProof
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Backend authentication failed');
      }

      const data = await response.json();
      sessionToken = data.sessionToken;

      if (!sessionToken) {
        throw new Error('No session token received from server');
      }
    } catch (backendError: any) {
      console.error('Backend authentication error:', backendError);
      throw new Error(backendError.message || 'Failed to authenticate with server');
    }

    // 7. Create session data for local state
    const sessionData: UserSession = {
      username,
      publicMemoKey,
      isAuthenticated: true,
      timestamp: new Date().toISOString(),
    };

    // 8. Store authenticated user in state
    setUser(sessionData);

    // 9. Save only session token to localStorage (not user data)
    localStorage.setItem(SESSION_KEY, sessionToken);
  };

  const logout = async () => {
    const sessionToken = localStorage.getItem(SESSION_KEY);
    
    // Call backend to invalidate session
    if (sessionToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessionToken}`
          }
        });
      } catch (error) {
        console.error('Error logging out on backend:', error);
        // Continue with local logout even if backend call fails
      }
    }
    
    // Clear local state and storage
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
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
