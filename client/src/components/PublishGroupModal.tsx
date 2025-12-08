import { useState, useRef } from 'react';
import { Globe, Loader2, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';
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
  const { toast } = useToast();
  const isPublishingRef = useRef(false);

  // Check if group is already published
  const { data: publishStatus, isLoading: isCheckingStatus } = useQuery({
    queryKey: ['group-publish-status', creator, groupId],
    queryFn: () => isGroupPublished(creator, groupId),
    enabled: open,
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
      if (result.success) {
        toast({
          title: 'Group Published!',
          description: 'Your group is now discoverable by other users.',
        });
        queryClient.invalidateQueries({ queryKey: ['group-publish-status', creator, groupId] });
        queryClient.invalidateQueries({ queryKey: ['discoverable-groups'] });
        onOpenChange(false);
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

  const viewOnPeakD = () => {
    if (publishStatus?.permlink) {
      window.open(`https://peakd.com/@${creator}/${publishStatus.permlink}`, '_blank');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            Make Group Public
          </DialogTitle>
          <DialogDescription>
            Publish your group to the Hive blockchain so others can discover and join it.
          </DialogDescription>
        </DialogHeader>

        {isCheckingStatus ? (
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
              onClick={viewOnPeakD} 
              variant="outline" 
              className="w-full gap-2"
              data-testid="button-view-on-peakd"
            >
              <ExternalLink className="w-4 h-4" />
              View on PeakD
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
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            {publishStatus?.published ? 'Close' : 'Cancel'}
          </Button>
          
          {!publishStatus?.published && (
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
