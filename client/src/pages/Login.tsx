import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { Shield, Lock, MessageSquare, CheckCircle2, AlertCircle, Smartphone, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { isKeychainInstalled, requestHandshake } from '@/lib/hive';
import { isMobileDevice } from '@/lib/hasAuth';
import { useToast } from '@/hooks/use-toast';
import QRCodeGenerator from 'qrcode';

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, isMobile } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [keychainStatus, setKeychainStatus] = useState<'checking' | 'installed' | 'missing'>('checking');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [hasAuthUrl, setHasAuthUrl] = useState<string>('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'qr_displayed' | 'waiting' | 'success'>('idle');
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const checkKeychain = async () => {
    const installed = isKeychainInstalled();
    if (installed) {
      // If Keychain extension is detected, mark as installed
      // Handshake is optional - it may fail due to user denial, but extension is still there
      setKeychainStatus('installed');
      // Try handshake in background (non-blocking)
      requestHandshake().catch(() => {
        // Handshake failure doesn't mean Keychain isn't installed
        console.log('Keychain handshake failed, but extension is installed');
      });
    } else {
      setKeychainStatus('missing');
    }
  };

  useEffect(() => {
    checkKeychain();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedUsername = username.toLowerCase().trim();
    
    if (!trimmedUsername) {
      toast({
        title: 'Username required',
        description: 'Please enter your Hive username',
        variant: 'destructive',
      });
      return;
    }

    // Desktop: Check Keychain availability
    if (!isMobile && !isKeychainInstalled()) {
      toast({
        title: 'Hive Keychain Required',
        description: 'Please install the Hive Keychain browser extension from hive-keychain.com',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setAuthStatus('waiting');
    
    try {
      // For mobile HAS auth, pass callback to receive QR code/deep link
      await login(trimmedUsername, async (payload) => {
        console.log('[Login] HAS auth payload received:', payload);
        
        if (payload.deepLink) {
          setHasAuthUrl(payload.deepLink);
          setAuthStatus('qr_displayed');
          
          // Generate QR code for the deep link
          try {
            const qrDataUrl = await QRCodeGenerator.toDataURL(payload.deepLink, {
              width: 256,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#FFFFFF',
              },
            });
            setQrCodeDataUrl(qrDataUrl);
            console.log('[Login] QR code generated successfully');
          } catch (qrError) {
            console.error('[Login] QR code generation failed:', qrError);
          }
        }
      });
      
      setAuthStatus('success');
      toast({
        title: 'Welcome to Hive Messenger!',
        description: `Successfully logged in as @${trimmedUsername}`,
      });
      
      setTimeout(() => setLocation('/'), 500);
    } catch (error: any) {
      console.error('Login failed:', error);
      setAuthStatus('idle');
      
      const errorMessage = error?.message || 'An unexpected error occurred. Please try again.';
      
      // Handle specific error scenarios with appropriate messages
      if (errorMessage.includes('install') || errorMessage.includes('Keychain extension')) {
        toast({
          title: 'Hive Keychain Not Found',
          description: 'Please install Hive Keychain extension from hive-keychain.com',
          variant: 'destructive',
        });
      } else if (errorMessage.includes('not found') || errorMessage.includes('blockchain')) {
        toast({
          title: 'Account Not Found',
          description: 'Account not found on Hive blockchain. Please check the username and try again.',
          variant: 'destructive',
        });
      } else if (errorMessage.includes('cancel')) {
        toast({
          title: 'Authentication Cancelled',
          description: 'You cancelled the authentication request. Please try again and approve the request.',
          variant: 'destructive',
        });
      } else if (errorMessage.includes('memo key')) {
        toast({
          title: 'Memo Key Error',
          description: 'Unable to retrieve public memo key for this account. Please try again later.',
          variant: 'destructive',
        });
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('Failed to')) {
        toast({
          title: 'Network Error',
          description: 'Unable to connect to Hive blockchain. Please check your internet connection and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Login Failed',
          description: errorMessage,
          variant: 'destructive',
        });
      }
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
              {isMobile ? 
                'Authenticate with Hive Keychain Mobile app' : 
                'Connect with Hive Keychain to access your encrypted messages'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mobile Detection Info */}
            {isMobile ? (
              <Alert className="bg-primary/5 border-primary/20">
                <Smartphone className="h-4 w-4 text-primary" />
                <AlertDescription className="text-caption text-foreground">
                  Mobile device detected - Using HAS authentication
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {keychainStatus === 'missing' && (
                  <Alert variant="destructive" className="border-destructive/50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-caption">
                      Hive Keychain extension not detected. Please install it from{' '}
                      <a 
                        href="https://hive-keychain.com" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="font-medium underline"
                        data-testid="link-keychain-install"
                      >
                        hive-keychain.com
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
              </>
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
                  disabled={isLoading}
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
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                    {isMobile ? 'Waiting for app...' : 'Connecting...'}
                  </>
                ) : (
                  <>
                    {isMobile ? <Smartphone className="w-4 h-4 mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                    {isMobile ? 'Authenticate with HAS' : 'Sign in with Keychain'}
                  </>
                )}
              </Button>
            </form>

            {/* QR Code Display for Mobile HAS Authentication */}
            {isMobile && qrCodeDataUrl && authStatus === 'qr_displayed' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-4 p-4 bg-muted/30 rounded-lg border">
                  <div className="flex items-center gap-2 text-caption font-medium">
                    <QrCode className="w-4 h-4 text-primary" />
                    <span>Scan with Hive Keychain Mobile</span>
                  </div>
                  
                  <img 
                    src={qrCodeDataUrl} 
                    alt="HAS Authentication QR Code"
                    className="w-64 h-64 rounded-lg border-2 border-border bg-white p-2"
                  />
                  
                  {hasAuthUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        window.location.href = hasAuthUrl;
                      }}
                      data-testid="button-open-keychain-app"
                    >
                      <Smartphone className="w-4 h-4 mr-2" />
                      Open in Hive Keychain App
                    </Button>
                  )}
                  
                  <p className="text-caption text-muted-foreground text-center">
                    Approve the authentication request in your mobile wallet
                  </p>
                </div>
              </div>
            )}

            {/* Authentication Status Messages */}
            {authStatus === 'waiting' && isMobile && !qrCodeDataUrl && (
              <Alert className="bg-blue-500/5 border-blue-500/20">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <AlertDescription className="text-caption">
                  Preparing authentication request...
                </AlertDescription>
              </Alert>
            )}

            {authStatus === 'waiting' && isMobile && qrCodeDataUrl && (
              <Alert className="bg-blue-500/5 border-blue-500/20">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <AlertDescription className="text-caption">
                  Waiting for approval in your Hive Keychain Mobile app...
                </AlertDescription>
              </Alert>
            )}

            {authStatus === 'success' && (
              <Alert className="bg-green-500/5 border-green-500/20">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-caption">
                  Authentication successful! Redirecting...
                </AlertDescription>
              </Alert>
            )}

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
