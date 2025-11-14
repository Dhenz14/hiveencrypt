import { useState, useEffect } from 'react';
import { LogOut, Moon, Sun, User, Shield, Bell, Info, Filter, Lightbulb, Zap } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { requestHandshake } from '@/lib/hive';
import { useToast } from '@/hooks/use-toast';
import { useMinimumHBD } from '@/hooks/useMinimumHBD';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { formatHBDAmount, MIN_MINIMUM_HBD, MAX_MINIMUM_HBD, isValidLightningAddress } from '@/lib/accountMetadata';
import { verifyLightningAddress } from '@/lib/lightning';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  
  // Auto-decrypt setting (localStorage-based, default: off)
  const [autoDecrypt, setAutoDecrypt] = useState(() => {
    if (!user?.username) return false;
    const stored = localStorage.getItem(`hive_messenger_auto_decrypt_${user.username}`);
    return stored === 'true';
  });
  
  // Save auto-decrypt preference to localStorage
  const handleAutoDecryptToggle = (checked: boolean) => {
    if (!user?.username) return;
    setAutoDecrypt(checked);
    localStorage.setItem(`hive_messenger_auto_decrypt_${user.username}`, String(checked));
    
    toast({
      title: checked ? 'Auto-decrypt Enabled' : 'Auto-decrypt Disabled',
      description: checked 
        ? 'New received messages will automatically decrypt' 
        : 'Messages will show encrypted placeholders',
    });
  };
  
  // Message Filter state
  const {
    currentMinimum,
    isLoading: isLoadingMinimum,
    updateMinimum,
    isUpdating,
    resetToDefault,
  } = useMinimumHBD();
  
  const [minHBDInput, setMinHBDInput] = useState(currentMinimum);
  
  // Update input when current minimum changes
  useEffect(() => {
    setMinHBDInput(currentMinimum);
  }, [currentMinimum]);
  
  // Lightning Address state (v2.2.0)
  const {
    currentAddress,
    isLoading: isLoadingLightning,
    updateAddress,
    isUpdating: isUpdatingLightning,
    removeAddress,
  } = useLightningAddress();
  
  const [lightningInput, setLightningInput] = useState(currentAddress || '');
  const [lightningError, setLightningError] = useState<string | null>(null);
  const [lightningWarning, setLightningWarning] = useState<string | null>(null);
  const [isVerifyingLightning, setIsVerifyingLightning] = useState(false);
  
  // Update input when current address changes
  useEffect(() => {
    setLightningInput(currentAddress || '');
  }, [currentAddress]);
  
  // Validate Lightning Address on input change
  const handleLightningInputChange = (value: string) => {
    setLightningInput(value);
    
    // Clear errors and warnings on input change (allows retry)
    setLightningError(null);
    setLightningWarning(null);
    
    // Clear if empty (allows removal)
    if (!value.trim()) {
      return;
    }
    
    // Validate format
    if (!isValidLightningAddress(value)) {
      setLightningError('Invalid format. Use: user@domain.com');
    }
  };

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
                    onClick={handleReauthenticate}
                    disabled={isReauthenticating}
                    className="w-full h-11"
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

            {/* Message Filter Section - v2.0.0 Feature */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-body font-medium">
                <Filter className="w-4 h-4" />
                <span>Messages</span>
              </div>
              <div className="space-y-4 pl-6">
                {/* Auto-Decrypt Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-decrypt" className="text-body cursor-pointer">
                      Auto-Decrypt Messages
                    </Label>
                    <p className="text-caption text-muted-foreground">
                      Automatically decrypt received messages using Keychain
                    </p>
                  </div>
                  <Switch
                    id="auto-decrypt"
                    checked={autoDecrypt}
                    onCheckedChange={handleAutoDecryptToggle}
                    data-testid="switch-auto-decrypt"
                  />
                </div>
                <p className="text-caption text-muted-foreground flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    When enabled, new messages are decrypted immediately. When disabled, you must click each message to decrypt it manually.
                  </span>
                </p>
                
                <Separator />
                {/* Minimum HBD Filter */}
                <div className="space-y-2">
                  <Label htmlFor="min-hbd" className="text-body">
                    Minimum HBD Filter
                  </Label>
                  <p className="text-caption text-muted-foreground">
                    Set minimum HBD amount others must send to message you. Acts as an economic anti-spam filter.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="min-hbd"
                      type="number"
                      step="0.001"
                      min={MIN_MINIMUM_HBD}
                      max={MAX_MINIMUM_HBD}
                      value={minHBDInput}
                      onChange={(e) => setMinHBDInput(e.target.value)}
                      disabled={isLoadingMinimum || isUpdating}
                      placeholder="0.001"
                      className="max-w-32 h-11"
                      data-testid="input-minimum-hbd"
                    />
                    <span className="text-caption text-muted-foreground">HBD</span>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Current: <span className="font-medium">{currentMinimum} HBD</span> · Default: 0.001 HBD · Max: 1,000,000 HBD
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    onClick={async () => {
                      try {
                        const amount = parseFloat(minHBDInput);
                        const formattedAmount = formatHBDAmount(amount);
                        await updateMinimum(formattedAmount);
                      } catch (error: any) {
                        toast({
                          title: 'Invalid Amount',
                          description: error?.message || 'Please enter a valid HBD amount',
                          variant: 'destructive',
                        });
                      }
                    }}
                    disabled={isUpdating || minHBDInput === currentMinimum}
                    className="flex-1 h-11"
                    data-testid="button-save-minimum"
                  >
                    {isUpdating ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save Preference'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await resetToDefault();
                      setMinHBDInput('0.001');
                    }}
                    disabled={isUpdating || currentMinimum === '0.001'}
                    className="h-11"
                    data-testid="button-reset-minimum"
                  >
                    Reset
                  </Button>
                </div>
                <div className="flex items-start gap-2 text-caption text-muted-foreground">
                  <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Messages below your threshold won't appear in your inbox, but remain on the blockchain. Lower your filter anytime to see them.
                  </p>
                </div>
                
                <Separator />
                
                {/* Lightning Address - v2.2.0 Feature */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    <Label htmlFor="lightning-address" className="text-body">
                      Lightning Address
                    </Label>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    Enable Lightning Network tips. Others can send you Bitcoin (BTC) satoshis via Lightning.
                  </p>
                  <div className="space-y-2">
                    <Input
                      id="lightning-address"
                      type="text"
                      value={lightningInput}
                      onChange={(e) => handleLightningInputChange(e.target.value)}
                      disabled={isLoadingLightning || isUpdatingLightning || isVerifyingLightning}
                      placeholder="user@getalby.com"
                      className="h-11"
                      data-testid="input-lightning-address"
                    />
                    {lightningError && (
                      <p className="text-caption text-destructive">
                        {lightningError}
                      </p>
                    )}
                    {lightningWarning && !lightningError && (
                      <p className="text-caption text-yellow-600 dark:text-yellow-500">
                        {lightningWarning}
                      </p>
                    )}
                    {currentAddress && (
                      <p className="text-caption text-muted-foreground">
                        Current: <span className="font-medium">{currentAddress}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    onClick={async () => {
                      const trimmedInput = lightningInput.trim();
                      
                      // Clear previous warnings
                      setLightningWarning(null);
                      
                      try {
                        // Allow empty input to remove Lightning Address (alternative to Remove button)
                        if (!trimmedInput) {
                          await removeAddress();
                          return;
                        }
                        
                        // Non-empty input: verify first, then save only if valid or CORS warning
                        setIsVerifyingLightning(true);
                        let shouldSave = false;
                        
                        try {
                          const verifyResult = await verifyLightningAddress(trimmedInput);
                          
                          if (verifyResult.error) {
                            // Hard error: invalid LNURL response - BLOCK SAVE
                            setLightningError(verifyResult.error);
                            toast({
                              title: 'Invalid Lightning Address',
                              description: verifyResult.error,
                              variant: 'destructive',
                            });
                            shouldSave = false;  // Do NOT save
                            return;  // Exit early
                          }
                          
                          if (verifyResult.warning) {
                            // Soft warning: CORS failure (expected) - ALLOW SAVE
                            setLightningWarning(verifyResult.warning);
                            shouldSave = true;  // Allow save (deferred verification)
                          }
                          
                          if (verifyResult.success) {
                            // Successfully verified - ALLOW SAVE
                            toast({
                              title: 'Verification Successful',
                              description: 'Lightning Address verified and ready for tips',
                            });
                            shouldSave = true;  // Allow save
                          }
                          
                        } finally {
                          setIsVerifyingLightning(false);
                        }
                        
                        // Only save if verification succeeded or CORS warning
                        if (shouldSave) {
                          await updateAddress(trimmedInput);
                        }
                        
                      } catch (error: any) {
                        toast({
                          title: 'Update Failed',
                          description: error?.message || 'Failed to save Lightning Address',
                          variant: 'destructive',
                        });
                      }
                    }}
                    disabled={
                      isUpdatingLightning || 
                      isVerifyingLightning ||
                      lightningInput.trim() === (currentAddress || '')        // Disable only if no change
                    }
                    className="flex-1 h-11"
                    data-testid="button-save-lightning"
                  >
                    {isVerifyingLightning ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Verifying...
                      </>
                    ) : isUpdatingLightning ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save Address'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await removeAddress();
                      setLightningInput('');
                    }}
                    disabled={isUpdatingLightning || !currentAddress}
                    className="h-11"
                    data-testid="button-remove-lightning"
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex items-start gap-2 text-caption text-muted-foreground">
                  <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Get a Lightning Address from <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="underline hover-elevate">Alby</a>, <a href="https://www.walletofsatoshi.com" target="_blank" rel="noopener noreferrer" className="underline hover-elevate">Wallet of Satoshi</a>, or other Lightning wallet providers.
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
                <p>Hive Messenger v2.1.0</p>
                <p>
                  Encrypted messaging with exceptions list and auto-decrypt
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
