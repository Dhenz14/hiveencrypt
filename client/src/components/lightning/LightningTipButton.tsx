import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { LightningTipDialog } from './LightningTipDialog';

interface LightningTipButtonProps {
  recipientUsername: string;
  recipientLightningAddress?: string;
  disabled?: boolean;
}

export function LightningTipButton({ 
  recipientUsername, 
  recipientLightningAddress,
  disabled 
}: LightningTipButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Don't show tip button if recipient has no Lightning Address
  if (!recipientLightningAddress) {
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
      />
    </>
  );
}
