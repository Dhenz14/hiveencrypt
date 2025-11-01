import { createContext, useContext, useState, useEffect } from 'react';
import type { UserSession } from '@shared/schema';

interface AuthContextType {
  user: UserSession | null;
  login: (username: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('hive-messenger-user');
    if (stored) {
      try {
        const userData = JSON.parse(stored);
        setUser(userData);
      } catch (error) {
        console.error('Error loading user session:', error);
        localStorage.removeItem('hive-messenger-user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (username: string) => {
    const userData: UserSession = {
      username,
      isAuthenticated: true,
    };
    setUser(userData);
    localStorage.setItem('hive-messenger-user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('hive-messenger-user');
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
