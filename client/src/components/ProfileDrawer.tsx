import { Copy, ExternalLink, Shield, Clock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@shared/schema';

interface ProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
}

export function ProfileDrawer({ open, onOpenChange, contact }: ProfileDrawerProps) {
  const { toast } = useToast();

  if (!contact) return null;

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied to clipboard',
      description: `${label} copied successfully`,
    });
  };

  const truncateKey = (key: string) => {
    if (!key) return '';
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-headline">Contact Info</SheetTitle>
          <SheetDescription className="text-body">
            View profile and encryption details
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6">
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <Avatar className="w-24 h-24">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-2xl">
                  {getInitials(contact.username)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-headline font-semibold">@{contact.username}</h3>
                {contact.isOnline !== undefined && (
                  <Badge variant={contact.isOnline ? 'default' : 'secondary'} className="mt-2">
                    {contact.isOnline ? 'Online' : 'Offline'}
                  </Badge>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-caption text-muted-foreground">
                  <Shield className="w-4 h-4" />
                  <span className="font-medium">Encryption</span>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-muted-foreground">Public Key</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      onClick={() => copyToClipboard(contact.publicKey, 'Public key')}
                      data-testid="button-copy-public-key"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                  <code className="text-code font-mono text-muted-foreground break-all">
                    {truncateKey(contact.publicKey)}
                  </code>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-caption text-muted-foreground">
                  <ExternalLink className="w-4 h-4" />
                  <span className="font-medium">Quick Actions</span>
                </div>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start h-11"
                    onClick={() => window.open(`https://peakd.com/@${contact.username}`, '_blank')}
                    data-testid="button-view-hive-profile"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View on Hive
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start h-11"
                    onClick={() => window.open(`https://hivehub.dev/@${contact.username}`, '_blank')}
                    data-testid="button-view-blockchain"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Transaction History
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3 pb-6">
              <h4 className="text-body font-medium">About Encryption</h4>
              <div className="space-y-2 text-caption text-muted-foreground">
                <p>
                  Messages are encrypted using Hive's built-in memo encryption with ECDH and AES-CBC.
                </p>
                <p>
                  Only you and @{contact.username} can read the messages. They're stored encrypted on the blockchain.
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
