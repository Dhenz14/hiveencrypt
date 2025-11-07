import { useState } from 'react';
import { LogOut, Moon, Sun, User, Shield, Bell, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { requestHandshake } from '@/lib/hive';
import { useToast } from '@/hooks/use-toast';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [isReauthenticating, setIsReauthenticating] = useState(false);

  const handleLogout = () => {
    logout();
    onOpenChange(false);
  };

  const handleReauthenticate = async () => {
    if (!user) return;
    
    setIsReauthenticating(true);
    try {
      const success = await requestHandshake();
      if (success) {
        toast({
          title: 'Re-authentication Successful',
          description: 'Keychain verification completed',
        });
      } else {
        toast({
          title: 'Re-authentication Failed',
          description: 'Please approve the Keychain request',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Re-authentication error:', error);
      toast({
        title: 'Re-authentication Error',
        description: 'Failed to verify with Keychain',
        variant: 'destructive',
      });
    } finally {
      setIsReauthenticating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="text-headline">Settings</DialogTitle>
          <DialogDescription className="text-body">
            Manage your account and app preferences
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <User className="w-4 h-4" />
                <span>Account</span>
              </div>
              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-body font-medium">@{user?.username}</p>
                    <p className="text-caption text-muted-foreground">Hive Account</p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleLogout}
                  data-testid="button-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <Sun className="w-4 h-4" />
                <span>Appearance</span>
              </div>
              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="dark-mode" className="text-body cursor-pointer">
                      Dark Mode
                    </Label>
                    <p className="text-caption text-muted-foreground">
                      Use dark theme for better visibility at night
                    </p>
                  </div>
                  <Switch
                    id="dark-mode"
                    checked={theme === 'dark'}
                    onCheckedChange={toggleTheme}
                    data-testid="switch-dark-mode"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <Shield className="w-4 h-4" />
                <span>Security</span>
              </div>
              <div className="space-y-3 pl-6">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="keychain-lock" className="text-body">
                        Require Keychain
                      </Label>
                      <p className="text-caption text-muted-foreground">
                        Always verify with Keychain before sending
                      </p>
                    </div>
                    <Switch id="keychain-lock" checked={true} disabled />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReauthenticate}
                    disabled={isReauthenticating}
                    className="w-full"
                    data-testid="button-reauthenticate"
                  >
                    {isReauthenticating ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Re-authenticating...
                      </>
                    ) : (
                      <>
                        <Shield className="w-3 h-3 mr-2" />
                        Re-authenticate with Keychain
                      </>
                    )}
                  </Button>
                  <p className="text-caption text-muted-foreground">
                    Click this if Keychain stopped prompting for verification due to "Don't ask again" setting
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <Bell className="w-4 h-4" />
                <span>Notifications</span>
              </div>
              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="sound-notifications" className="text-body cursor-pointer">
                      Sound Alerts
                    </Label>
                    <p className="text-caption text-muted-foreground">
                      Play sound when new messages arrive
                    </p>
                  </div>
                  <Switch id="sound-notifications" />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4 pb-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <Info className="w-4 h-4" />
                <span>About</span>
              </div>
              <div className="space-y-2 pl-6 text-caption text-muted-foreground">
                <p>Hive Messenger v1.0.0</p>
                <p>
                  Encrypted messaging on the Hive blockchain
                </p>
                <p className="pt-2">
                  <a 
                    href="https://hive.io" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Learn more about Hive
                  </a>
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
