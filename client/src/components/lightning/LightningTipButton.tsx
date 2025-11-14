import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { LightningTipDialog } from './LightningTipDialog';
import type { TipReceivePreference } from '@/lib/accountMetadata';

interface LightningTipButtonProps {
  recipientUsername: string;
  recipientLightningAddress?: string;
  recipientTipPreference: TipReceivePreference;
  disabled?: boolean;
}

export function LightningTipButton({ 
  recipientUsername, 
  recipientLightningAddress,
  recipientTipPreference,
  disabled 
}: LightningTipButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Show tip button when:
  // - Recipient prefers HBD (anyone can tip with Lightning, recipient gets HBD) OR
  // - Recipient prefers Lightning AND has a Lightning Address
  const shouldShowTipButton = 
    recipientTipPreference === 'hbd' || 
    (recipientTipPreference === 'lightning' && !!recipientLightningAddress);

  if (!shouldShowTipButton) {
    return null;
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setIsDialogOpen(true)}
        disabled={disabled}
        data-testid="button-lightning-tip"
        className="hover-elevate active-elevate-2"
      >
        <Zap className="h-4 w-4" />
      </Button>

      <LightningTipDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        recipientUsername={recipientUsername}
        recipientLightningAddress={recipientLightningAddress}
        recipientTipPreference={recipientTipPreference}
      />
    </>
  );
}
