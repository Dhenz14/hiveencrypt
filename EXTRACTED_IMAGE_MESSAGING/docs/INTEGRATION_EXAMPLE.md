# Integration Example: Adding Image Upload to Message Composer

This document shows **exactly** how to integrate image messaging into your existing Hive Messenger application.

## Complete MessageComposer with Image Upload

```typescript
import { useState, useRef } from 'react';
import { Send, Image as ImageIcon, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { 
  encryptImagePayload, 
  type ImagePayload 
} from '@/lib/customJsonEncryption';
import { broadcastImageMessage } from '@/lib/imageChunking';
import { processImageForBlockchain } from '@/lib/imageUtils';
import { 
  cacheCustomJsonMessage,
  getConversationKey,
  type CustomJsonMessage
} from '@/lib/messageCache';
import { 
  getAccountRC, 
  estimateCustomJsonRC,
  getRCWarningLevel 
} from '@/lib/rcEstimation';
import { queryClient } from '@/lib/queryClient';

interface MessageComposerProps {
  recipientUsername: string;
  onMessageSent?: () => void;
}

export function MessageComposer({ recipientUsername, onMessageSent }: MessageComposerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {  // 5MB limit
      toast({
        title: 'File Too Large',
        description: 'Image must be smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }

    setSelectedImage(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    console.log('[IMAGE] Selected:', file.name, 'Size:', file.size, 'bytes');
  };

  // Clear selected image
  const handleClearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Send image message
  const handleSendImage = async () => {
    if (!selectedImage || !user?.username) return;

    setIsSending(true);

    try {
      console.log('[SEND IMAGE] Starting image send process...');

      // Step 1: Check RC balance
      const rcInfo = await getAccountRC(user.username);
      const warningLevel = getRCWarningLevel(rcInfo.percentage);
      
      if (warningLevel === 'critical') {
        toast({
          title: 'Insufficient Resource Credits',
          description: `Your RC is at ${rcInfo.percentage.toFixed(1)}%. Please wait for regeneration.`,
          variant: 'destructive',
        });
        setIsSending(false);
        return;
      }

      // Step 2: Process image (WebP + gzip compression)
      console.log('[SEND IMAGE] Processing image for blockchain...');
      const processedImage = await processImageForBlockchain(
        selectedImage,
        300,  // Max width in pixels
        0.6   // Quality (0-1)
      );

      console.log('[SEND IMAGE] Image processed:', {
        originalSize: selectedImage.size,
        processedSize: processedImage.base64.length,
        savings: processedImage.compressionStats.totalSavings + '%'
      });

      // Step 3: Create payload
      const payload: ImagePayload = {
        imageData: processedImage.base64,
        message: content.trim() || undefined,
        filename: selectedImage.name,
        contentType: processedImage.contentType,
        from: user.username,
        to: recipientUsername,
        timestamp: Date.now()
      };

      // Step 4: Encrypt payload
      console.log('[SEND IMAGE] Encrypting payload...');
      const { encrypted, hash } = await encryptImagePayload(payload, user.username);

      console.log('[SEND IMAGE] Payload encrypted:', {
        size: encrypted.length,
        hash: hash.substring(0, 16) + '...'
      });

      // Step 5: Estimate RC cost
      const estimatedRC = estimateCustomJsonRC(encrypted.length);
      console.log('[SEND IMAGE] Estimated RC cost:', estimatedRC);

      if (estimatedRC > rcInfo.current) {
        toast({
          title: 'Insufficient RC',
          description: `This operation requires ${(estimatedRC / 1_000_000_000).toFixed(1)}B RC, but you only have ${(rcInfo.current / 1_000_000_000).toFixed(1)}B RC.`,
          variant: 'destructive',
        });
        setIsSending(false);
        return;
      }

      // Step 6: Broadcast to blockchain
      console.log('[SEND IMAGE] Broadcasting to blockchain...');
      const txId = await broadcastImageMessage(user.username, encrypted, hash);

      console.log('[SEND IMAGE] ✅ Broadcast successful! TxID:', txId);

      // Step 7: Cache locally for instant display
      const conversationKey = getConversationKey(user.username, recipientUsername);
      const customJsonMessage: CustomJsonMessage = {
        txId,
        conversationKey,
        from: user.username,
        to: recipientUsername,
        imageData: processedImage.base64Uncompressed, // Use uncompressed for display
        message: content.trim() || undefined,
        filename: selectedImage.name,
        contentType: processedImage.contentType,
        timestamp: new Date().toISOString(),
        encryptedPayload: encrypted,
        hash,
        isDecrypted: true,  // Already decrypted (we just encrypted it)
        confirmed: false,   // Not yet confirmed on blockchain
      };

      await cacheCustomJsonMessage(customJsonMessage, user.username);

      // Invalidate React Query cache to trigger refetch
      queryClient.invalidateQueries({ 
        queryKey: ['custom-json-messages', user.username, recipientUsername] 
      });

      toast({
        title: 'Image Sent!',
        description: 'Your image message has been sent',
      });

      // Clear form
      setContent('');
      handleClearImage();
      onMessageSent?.();

    } catch (error: any) {
      console.error('[SEND IMAGE] Failed:', error);
      toast({
        title: 'Send Failed',
        description: error?.message || 'Failed to send image',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-t p-4 space-y-3">
      {/* Image Preview */}
      {imagePreview && (
        <div className="relative inline-block">
          <img
            src={imagePreview}
            alt="Preview"
            className="max-w-xs max-h-40 rounded-lg border"
          />
          <Button
            size="icon"
            variant="destructive"
            className="absolute -top-2 -right-2"
            onClick={handleClearImage}
            disabled={isSending}
            data-testid="button-clear-image"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Message Input */}
      <Textarea
        placeholder={selectedImage ? "Add a caption (optional)..." : "Type a message..."}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={isSending}
        className="min-h-20"
        data-testid="input-message"
      />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Image Upload Button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
          disabled={isSending}
        />
        
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || !!selectedImage}
          data-testid="button-upload-image"
        >
          <ImageIcon className="w-4 h-4" />
        </Button>

        {/* Send Button */}
        <Button
          onClick={selectedImage ? handleSendImage : handleSendTextMessage}
          disabled={isSending || (!content.trim() && !selectedImage)}
          className="flex-1"
          data-testid="button-send"
        >
          {isSending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Send {selectedImage ? 'Image' : 'Message'}
            </>
          )}
        </Button>
      </div>

      {/* Helper Text */}
      {selectedImage && !isSending && (
        <p className="text-xs text-muted-foreground">
          Image will be compressed and encrypted before sending
        </p>
      )}
    </div>
  );
}

// Note: handleSendTextMessage() would be your existing text message send logic
```

## Displaying Image Messages

```typescript
import { ImageMessage } from '@/components/ImageMessage';
import { useCustomJsonMessages } from '@/hooks/useCustomJsonMessages';
import { useBlockchainMessages } from '@/hooks/useBlockchainMessages';  // Your existing hook

function ConversationView({ partnerUsername }: { partnerUsername: string }) {
  const { user } = useAuth();
  
  // Fetch text messages (existing)
  const { data: textMessages, isLoading: textLoading } = useBlockchainMessages({
    partnerUsername,
    enabled: true,
  });
  
  // Fetch image messages (new)
  const { data: imageMessages, isLoading: imageLoading } = useCustomJsonMessages({
    partnerUsername,
    enabled: true,
  });

  // Merge and sort by timestamp
  const allMessages = useMemo(() => {
    const merged = [
      ...(textMessages || []).map(msg => ({ ...msg, type: 'text' })),
      ...(imageMessages || []).map(msg => ({ ...msg, type: 'image' })),
    ];
    
    return merged.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [textMessages, imageMessages]);

  if (textLoading || imageLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {allMessages.map((msg) => (
        msg.type === 'image' ? (
          <ImageMessage
            key={msg.txId}
            message={msg}
            currentUsername={user.username}
          />
        ) : (
          <TextMessage
            key={msg.txId}
            message={msg}
            currentUsername={user.username}
          />
        )
      ))}
    </div>
  );
}
```

## Key Integration Points

### 1. Dependencies

Make sure you have:
```json
{
  "dependencies": {
    "@hiveio/dhive": "^1.2.x",
    "pako": "^2.1.x",
    "idb": "^8.0.x"
  }
}
```

### 2. IndexedDB Setup

Add the `customJsonMessages` table to your database (see `integration/messageCache-additions.ts`)

### 3. Hive Client

Add `getCustomJsonMessages()` to your hive client (see `integration/hive-custom-json-functions.ts`)

### 4. React Query Setup

Update your query client to handle custom_json queries:

```typescript
// In your queryClient.ts
queryClient.setDefaultOptions({
  queries: {
    staleTime: 30000,
    refetchOnWindowFocus: true,
  },
});
```

## Testing Your Integration

### 1. Test Image Selection

```typescript
// Should accept images
✅ JPEG, PNG, GIF, WebP
✅ Files < 5MB

// Should reject
❌ Non-image files
❌ Files > 5MB
```

### 2. Test Image Send

```typescript
// Should successfully send
✅ Small images (<300x300, <100KB)
✅ Medium images (300-800px, 100KB-1MB)
✅ Large images (>800px, 1-5MB)

// Should handle errors
❌ Insufficient RC
❌ Network failures
❌ Encryption failures
```

### 3. Test Image Display

```typescript
// Should display correctly
✅ Encrypted state (lock icon + decrypt button)
✅ Decrypted state (image + download button)
✅ Caption text below image
✅ Error state (retry button)
```

## Common Issues

### Issue: "Hive Keychain not installed"
**Solution**: Ensure Keychain browser extension is installed and enabled

### Issue: "Insufficient RC"
**Solution**: User needs to wait for RC regeneration or power up more HP

### Issue: "Failed to encrypt"
**Solution**: Verify memo key is accessible in Keychain

### Issue: "Image not displaying after decrypt"
**Solution**: Check console for decompression errors, verify hash matches

## Next Steps

1. ✅ Copy all files from `EXTRACTED_IMAGE_MESSAGING/`
2. ✅ Install dependencies
3. ✅ Update IndexedDB schema
4. ✅ Add custom_json blockchain functions
5. ✅ Integrate image upload into MessageComposer
6. ✅ Add ImageMessage component to conversation view
7. ✅ Test thoroughly with small images first
8. ✅ Deploy and monitor for errors

Need help? Check `TROUBLESHOOTING.md` for common issues and solutions.
