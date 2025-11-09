import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Smartphone, ExternalLink, Copy, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { getKeychainMobileDeepLink, getCurrentAppUrl } from '@/lib/keychainDetection';

/**
 * KeychainRedirect Component
 * 
 * Shown to users on regular mobile browsers (Safari, Chrome)
 * Explains they need to use Keychain Mobile browser and provides:
 * 1. Deep link button to open in Keychain Mobile
 * 2. Copy URL button as fallback
 * 3. Installation instructions if they don't have the app
 */
export function KeychainRedirect() {
  const [copied, setCopied] = useState(false);
  
  const deepLink = getKeychainMobileDeepLink();
  const appUrl = getCurrentAppUrl();
  
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('[KeychainRedirect] Failed to copy URL:', error);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Smartphone className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Open in Keychain Mobile</CardTitle>
          <CardDescription>
            For the best mobile experience, Hive Messenger requires the Hive Keychain Mobile browser
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription className="text-sm">
              Hive Keychain Mobile provides secure access to your Hive account with encrypted message viewing. 
              Your private keys never leave your device.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground font-medium">Follow these steps:</p>
            
            <div className="space-y-2 text-sm">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <p className="text-foreground">
                  Tap the button below to open this app in Keychain Mobile
                </p>
              </div>
              
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <p className="text-foreground">
                  If you don't have the app yet, install it from the App Store or Google Play
                </p>
              </div>
              
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <p className="text-foreground">
                  In Keychain Mobile, tap the menu and select "Browser" to access Hive apps
                </p>
              </div>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="flex-col gap-3">
          <Button 
            className="w-full" 
            size="lg"
            asChild
            data-testid="button-open-keychain"
          >
            <a href={deepLink}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in Keychain Mobile
            </a>
          </Button>
          
          <Button 
            variant="outline" 
            className="w-full"
            onClick={handleCopyUrl}
            data-testid="button-copy-url"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                URL Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy App URL
              </>
            )}
          </Button>
          
          <div className="w-full pt-4 border-t space-y-2">
            <p className="text-xs text-muted-foreground text-center font-medium">
              Don't have Keychain Mobile?
            </p>
            <div className="flex gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="flex-1 text-xs"
                asChild
                data-testid="link-ios-store"
              >
                <a 
                  href="https://apps.apple.com/us/app/hive-keychain/id1552190010" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  iOS App Store
                </a>
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="flex-1 text-xs"
                asChild
                data-testid="link-android-store"
              >
                <a 
                  href="https://play.google.com/store/apps/details?id=com.mobilekeychain" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Google Play
                </a>
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
