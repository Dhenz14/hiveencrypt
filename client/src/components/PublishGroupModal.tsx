import { useState, useRef } from 'react';
import { Globe, Loader2, ExternalLink, CheckCircle, AlertCircle, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { publishGroupToDiscovery, isGroupPublished } from '@/lib/groupDiscovery';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import type { PaymentSettings } from '@shared/schema';

interface PublishGroupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  creator: string;
  memberCount: number;
  paymentSettings?: PaymentSettings;
}

export function PublishGroupModal({
  open,
  onOpenChange,
  groupId,
  groupName,
  creator,
  memberCount,
  paymentSettings,
}: PublishGroupModalProps) {
  const [description, setDescription] = useState('');
  const [justPublished, setJustPublished] = useState<{ permlink: string } | null>(null);
  const { toast } = useToast();
  const isPublishingRef = useRef(false);

  // Check if group is already published
  const { data: publishStatus, isLoading: isCheckingStatus } = useQuery({
    queryKey: ['group-publish-status', creator, groupId],
    queryFn: () => isGroupPublished(creator, groupId),
    enabled: open && !justPublished,
    staleTime: 30 * 1000,
  });

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (isPublishingRef.current) return { success: false, error: 'Already publishing' };
      isPublishingRef.current = true;
      
      try {
        return await publishGroupToDiscovery(
          creator,
          groupId,
          groupName,
          description,
          memberCount,
          paymentSettings
        );
      } finally {
        isPublishingRef.current = false;
      }
    },
    onSuccess: (result) => {
      if (result.success && result.permlink) {
        setJustPublished({ permlink: result.permlink });
        queryClient.invalidateQueries({ queryKey: ['group-publish-status', creator, groupId] });
        queryClient.invalidateQueries({ queryKey: ['discoverable-groups'] });
      } else {
        toast({
          title: 'Publish Failed',
          description: result.error || 'Could not publish group. Please try again.',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Publish Failed',
        description: error.message || 'Could not publish group. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handlePublish = () => {
    if (publishMutation.isPending || isPublishingRef.current) return;
    publishMutation.mutate();
  };

  const handleClose = () => {
    setJustPublished(null);
    setDescription('');
    onOpenChange(false);
  };

  const getEcencyUrl = (permlink: string) => {
    return `https://ecency.com/@${creator}/${permlink}`;
  };

  const viewOnEcency = (permlink: string) => {
    window.open(getEcencyUrl(permlink), '_blank');
  };

  // Determine which permlink to use for viewing
  const currentPermlink = justPublished?.permlink || publishStatus?.permlink;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {justPublished ? (
              <>
                <PartyPopper className="w-5 h-5 text-green-500" />
                Group Published!
              </>
            ) : (
              <>
                <Globe className="w-5 h-5 text-primary" />
                Make Group Public
              </>
            )}
          </DialogTitle>
          {!justPublished && (
            <DialogDescription>
              Publish your group to the Hive blockchain so others can discover and join it.
            </DialogDescription>
          )}
        </DialogHeader>

        {justPublished ? (
          <div className="space-y-4">
            <Alert className="border-green-500 bg-green-500/10">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-300">
                Your group has been published to the Hive blockchain! It's now discoverable by other users.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                View your post on Ecency to see how it looks and share it with others:
              </p>
              
              <Button 
                onClick={() => viewOnEcency(justPublished.permlink)} 
                className="w-full gap-2"
                data-testid="button-view-on-ecency"
              >
                <ExternalLink className="w-4 h-4" />
                View on Ecency
              </Button>

              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Post URL:</p>
                <p className="text-sm font-mono break-all text-primary">
                  {getEcencyUrl(justPublished.permlink)}
                </p>
              </div>
            </div>
          </div>
        ) : isCheckingStatus ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : publishStatus?.published ? (
          <div className="space-y-4">
            <Alert className="border-green-500">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription>
                This group has already been published and is discoverable by other users.
              </AlertDescription>
            </Alert>
            
            <Button 
              onClick={() => currentPermlink && viewOnEcency(currentPermlink)} 
              variant="outline" 
              className="w-full gap-2"
              data-testid="button-view-on-ecency"
            >
              <ExternalLink className="w-4 h-4" />
              View on Ecency
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Publishing will create a Hive post with your group details. This requires Posting key authorization via Keychain.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={groupName}
                disabled
                className="bg-muted"
                data-testid="input-group-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this group is about..."
                className="resize-none"
                rows={3}
                maxLength={500}
                data-testid="input-description"
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length}/500
              </p>
            </div>

            {paymentSettings?.enabled && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  Entry Fee: {paymentSettings.amount} HBD
                  {paymentSettings.type === 'recurring' && paymentSettings.recurringInterval && (
                    <span className="font-normal"> (every {paymentSettings.recurringInterval} days)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {paymentSettings.autoApprove 
                    ? 'Users will be auto-approved after payment'
                    : 'You will need to manually approve join requests'
                  }
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            data-testid="button-cancel"
          >
            {justPublished || publishStatus?.published ? 'Close' : 'Cancel'}
          </Button>
          
          {!justPublished && !publishStatus?.published && (
            <Button
              onClick={handlePublish}
              disabled={publishMutation.isPending || isCheckingStatus}
              className="gap-2"
              data-testid="button-publish"
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" />
                  Publish Group
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
