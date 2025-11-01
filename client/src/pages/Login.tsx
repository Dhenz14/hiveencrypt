import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Shield, Lock, MessageSquare, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { isKeychainInstalled, requestHandshake, requestLogin } from '@/lib/hive';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keychainStatus, setKeychainStatus] = useState<'checking' | 'installed' | 'missing'>('checking');

  const checkKeychain = async () => {
    const installed = isKeychainInstalled();
    if (installed) {
      await requestHandshake();
      setKeychainStatus('installed');
    } else {
      setKeychainStatus('missing');
    }
  };

  useEffect(() => {
    checkKeychain();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim()) {
      toast({
        title: 'Username required',
        description: 'Please enter your Hive username',
        variant: 'destructive',
      });
      return;
    }

    if (keychainStatus !== 'installed') {
      toast({
        title: 'Hive Keychain Required',
        description: 'Please install the Hive Keychain browser extension to continue',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    
    try {
      await requestLogin(username.toLowerCase().trim());
      login(username.toLowerCase().trim());
      toast({
        title: 'Welcome to Hive Messenger!',
        description: `Successfully logged in as @${username}`,
      });
      setLocation('/');
    } catch (error: any) {
      console.error('Login failed:', error);
      toast({
        title: 'Login Failed',
        description: error?.message || 'Failed to authenticate with Hive Keychain. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <MessageSquare className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-display font-semibold tracking-tight">Hive Messenger</h1>
          <p className="text-body text-muted-foreground max-w-sm mx-auto">
            Encrypted, decentralized messaging on the Hive blockchain
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-headline">Sign in to continue</CardTitle>
            <CardDescription className="text-body">
              Connect with Hive Keychain to access your encrypted messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {keychainStatus === 'missing' && (
              <Alert variant="destructive" className="border-destructive/50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-caption">
                  Hive Keychain extension not detected. Please install it from{' '}
                  <a 
                    href="https://hivekeychain.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-medium underline"
                    data-testid="link-keychain-install"
                  >
                    hivekeychain.com
                  </a>
                </AlertDescription>
              </Alert>
            )}

            {keychainStatus === 'installed' && (
              <Alert className="bg-primary/5 border-primary/20">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <AlertDescription className="text-caption text-foreground">
                  Hive Keychain detected and ready
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-caption">Hive Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="yourusername"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading || keychainStatus !== 'installed'}
                  className="h-11"
                  autoComplete="username"
                  data-testid="input-username"
                />
                <p className="text-caption text-muted-foreground">
                  Enter your Hive username without the @ symbol
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isLoading || keychainStatus !== 'installed'}
                data-testid="button-login"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mr-2" />
                    Sign in with Keychain
                  </>
                )}
              </Button>
            </form>

            <div className="pt-4 border-t space-y-3">
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <Shield className="w-4 h-4 text-primary" />
                <span>End-to-end encrypted messaging</span>
              </div>
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Your keys never leave your browser</span>
              </div>
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span>Powered by Hive blockchain</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-caption text-muted-foreground">
          Don't have a Hive account?{' '}
          <a 
            href="https://signup.hive.io" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary font-medium hover:underline"
            data-testid="link-signup"
          >
            Create one here
          </a>
        </p>
      </div>
    </div>
  );
}
