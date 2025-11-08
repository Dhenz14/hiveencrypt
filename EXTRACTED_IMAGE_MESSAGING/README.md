# Hive Messenger Image Messaging Module

## 🎯 Overview

This is the **complete custom_json image messaging system** extracted from Hive Messenger. It provides end-to-end encrypted image messaging on the Hive blockchain using `custom_json` operations.

**IMPORTANT**: This module is **separate** from the memo-based text messaging system. It uses a completely different blockchain operation type (`custom_json` vs `transfer` with memos).

## 📦 What's Included

### Core Libraries (`lib/`)
- **`imageChunking.ts`** - Splits large payloads into 8KB-compliant chunks for blockchain broadcast
- **`customJsonEncryption.ts`** - Handles encryption/decryption via Hive Keychain memo keys
- **`imageUtils.ts`** - WebP compression, gzip optimization, and image processing pipeline
- **`compression.ts`** - Gzip utilities for payload optimization
- **`rcEstimation.ts`** - Resource Credits (RC) estimation and warnings
- **`messageCache.ts`** - IndexedDB caching functions for custom_json messages

### Components (`components/`)
- **`ImageMessage.tsx`** - React component for displaying encrypted image messages with on-demand decryption

### Hooks (`hooks/`)
- **`useCustomJsonMessages.ts`** - React hook for fetching and caching custom_json messages

### Integration Code (`integration/`)
- **`hive-custom-json-functions.ts`** - Blockchain API functions for custom_json operations
- **`messageCache-additions.ts`** - IndexedDB schema and cache functions

## 🚀 How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    IMAGE MESSAGING PIPELINE                  │
└─────────────────────────────────────────────────────────────┘

1. IMAGE SELECTION
   User selects image file (any format, max 5MB)
   
2. PROCESSING PIPELINE
   ┌────────────┐    ┌────────────┐    ┌────────────┐
   │ WebP Conv  │───▶│ Gzip Comp  │───▶│ Base64 Enc │
   │ (70% saved)│    │ (30% saved)│    │ (JSON compat)
   └────────────┘    └────────────┘    └────────────┘
   
3. ENCRYPTION
   ┌──────────────────────────────────────────────────┐
   │ Payload = { imageData, message, filename, ... } │
   │ ───▶ JSON stringify with short keys (25% saved) │
   │ ───▶ SHA-256 hash for integrity verification     │
   │ ───▶ Hive Keychain memo encryption (ECDH+AES)  │
   └──────────────────────────────────────────────────┘
   
4. CHUNKING (if needed)
   If encrypted payload > 7.5KB:
   ┌────────┐  ┌────────┐  ┌────────┐
   │ Chunk 1│  │ Chunk 2│  │ Chunk 3│
   │ (7KB)  │  │ (7KB)  │  │ (7KB)  │
   └────────┘  └────────┘  └────────┘
   
5. BLOCKCHAIN BROADCAST
   Single operation OR batched transaction
   ┌─────────────────────────────────────────┐
   │ custom_json operations:                 │
   │ - id: "hive-messenger-img"             │
   │ - required_posting_auths: [username]   │
   │ - json: { v, e, h, sid?, idx?, tot? }  │
   └─────────────────────────────────────────┘
   
6. DECRYPTION (on-demand)
   ┌──────────────────────────────────────────────┐
   │ Fetch from blockchain ───▶ Reassemble chunks │
   │ Decrypt with Keychain ───▶ Verify SHA-256    │
   │ Parse JSON ───▶ Decompress ───▶ Display      │
   └──────────────────────────────────────────────┘
```

### Key Features

✅ **End-to-end encryption** using Hive memo keys (ECDH + AES-256-CBC)  
✅ **WebP + Gzip compression** (85-90% total size reduction)  
✅ **Automatic chunking** for payloads > 7.5KB  
✅ **Batched transactions** (all chunks in ONE blockchain operation)  
✅ **Integrity verification** via SHA-256 hashing  
✅ **IndexedDB caching** for offline access and instant display  
✅ **On-demand decryption** to save RC and improve performance  
✅ **RC estimation** to prevent failed transactions  

## 📋 Dependencies

Add these to your `package.json`:

```json
{
  "dependencies": {
    "@hiveio/dhive": "^1.2.x",
    "pako": "^2.1.x",
    "idb": "^8.0.x"
  },
  "devDependencies": {
    "@types/pako": "^2.0.x"
  }
}
```

**Note**: This module requires **Hive Keychain** browser extension for desktop authentication.

## 🔧 Integration Steps

### Step 1: Copy Files

```bash
# Copy library files
cp EXTRACTED_IMAGE_MESSAGING/lib/* YOUR_PROJECT/client/src/lib/

# Copy components
cp EXTRACTED_IMAGE_MESSAGING/components/* YOUR_PROJECT/client/src/components/

# Copy hooks
cp EXTRACTED_IMAGE_MESSAGING/hooks/* YOUR_PROJECT/client/src/hooks/
```

### Step 2: Update Your Hive Client

Add the `getCustomJsonMessages()` function from `integration/hive-custom-json-functions.ts` to your Hive client file.

### Step 3: Update IndexedDB Schema

Add the `customJsonMessages` table to your IndexedDB schema using code from `integration/messageCache-additions.ts`.

**Database Schema:**

```typescript
interface CustomJsonMessage {
  txId: string;                    // Primary key (transaction ID)
  sessionId?: string;              // For multi-chunk messages
  conversationKey: string;         // "<user1>_<user2>" (sorted)
  from: string;                    // Sender username
  to: string;                      // Recipient username
  timestamp: string;               // ISO timestamp
  encryptedPayload: string;        // Encrypted image payload
  hash?: string;                   // SHA-256 integrity hash
  chunks?: number;                 // Number of chunks (if multi-chunk)
  isDecrypted: boolean;            // Decryption status
  confirmed: boolean;              // Blockchain confirmation
  
  // Decrypted fields (after user clicks "Decrypt")
  imageData?: string;              // base64 image data
  message?: string;                // Optional text caption
  filename?: string;               // Original filename
  contentType?: string;            // MIME type (e.g., 'image/webp')
}
```

### Step 4: Add to Your Message Composer

See `docs/INTEGRATION_EXAMPLE.md` for a complete example of how to integrate image upload into your message composer component.

### Step 5: Display Image Messages

```tsx
import { ImageMessage } from '@/components/ImageMessage';
import { useCustomJsonMessages } from '@/hooks/useCustomJsonMessages';

function ConversationView({ partnerUsername }: { partnerUsername: string }) {
  const { data: imageMessages, isLoading } = useCustomJsonMessages({
    partnerUsername,
    enabled: true,
  });

  return (
    <div>
      {imageMessages?.map((msg) => (
        <ImageMessage
          key={msg.txId}
          message={msg}
          currentUsername={user.username}
        />
      ))}
    </div>
  );
}
```

## 🎨 UI Components

### ImageMessage Component

Displays encrypted images with:
- 🔒 **Encrypted state**: Shows lock icon and "Decrypt" button
- 🖼️ **Decrypted state**: Displays image with download button on hover
- 📝 **Optional caption**: Text message below image
- ⚠️ **Error handling**: Retry button for failed decryption
- 📊 **Metadata**: Filename and hash display

## 🔐 Security

### Encryption Details

- **Algorithm**: ECDH (key agreement) + AES-256-CBC (encryption)
- **Keys**: Uses Hive memo key (derived from private posting key)
- **Integrity**: SHA-256 hash verification
- **Privacy**: End-to-end encrypted, only sender and recipient can decrypt
- **Storage**: Private keys never leave Keychain extension

### RC (Resource Credits) Management

Each `custom_json` operation costs approximately:
- **Base cost**: ~200M RC per operation
- **Size cost**: ~50M RC per KB of data

The module includes:
- RC estimation before broadcast
- Warning dialogs for insufficient RC
- Automatic chunking to optimize RC usage

## 📊 Performance Optimizations

### Compression Pipeline

1. **WebP conversion**: 70-75% size reduction (lossy compression)
2. **Gzip compression**: Additional 20-30% on WebP binary
3. **Short JSON keys**: 25-30% metadata reduction
4. **Total savings**: 85-90% from original image

### Caching Strategy

- **IndexedDB**: Messages cached locally for instant display
- **Lazy decryption**: Only decrypt when user clicks "Decrypt" button
- **React Query**: Automatic background sync and cache management
- **Optimistic updates**: Local cache updated immediately on send

## 🧪 Testing Considerations

### Test Scenarios

1. **Single-chunk images** (<7.5KB encrypted)
2. **Multi-chunk images** (>7.5KB encrypted)
3. **Failed decryption** (wrong recipient, corrupted data)
4. **Insufficient RC** (low Resource Credits)
5. **Network failures** (retry mechanisms)
6. **Cache persistence** (offline access)

### Mock Data Generation

See `docs/TESTING_GUIDE.md` for test helpers and mock data generation.

## 🚨 Known Limitations

1. **Desktop only (currently)**: Requires Hive Keychain browser extension
   - Mobile support requires HAS (Hive Authentication Services) integration
   - See `docs/MOBILE_INTEGRATION.md` for guidance

2. **RC costs**: Image messages cost more than text messages
   - ~200M RC base + ~50M RC per KB
   - Users with low HP may need to wait for RC regeneration

3. **Size constraints**: Each chunk limited to ~7KB
   - Large images automatically chunked
   - All chunks broadcast in ONE transaction (atomic)

4. **Browser compatibility**: Requires modern browser
   - WebP support
   - crypto.subtle API
   - Canvas API

## 📚 API Reference

### Core Functions

```typescript
// Encryption
encryptImagePayload(payload: ImagePayload, username: string): Promise<{ encrypted: string; hash: string }>

// Decryption
decryptImagePayload(encrypted: string, username: string, hash?: string): Promise<ImagePayload>

// Broadcasting
broadcastImageMessage(username: string, encrypted: string, hash: string): Promise<string>

// Chunking
chunkEncryptedPayload(encrypted: string, hash: string): { sessionId: string; chunks: Chunk[] }
reassembleChunks(chunks: any[]): Map<string, { encrypted: string; hash?: string }>

// Image Processing
processImageForBlockchain(file: File, maxWidth?: number, quality?: number): Promise<ProcessedImage>
compressImageToWebP(file: File, maxWidth?: number, quality?: number): Promise<Blob>

// RC Estimation
getAccountRC(username: string): Promise<RCInfo>
estimateCustomJsonRC(payloadSize: number, chunkCount?: number): number
checkSufficientRC(username: string, estimatedCost: number): Promise<SufficientRCCheck>
```

### React Hooks

```typescript
// Fetch custom_json messages
useCustomJsonMessages({ partnerUsername, enabled }): UseQueryResult<CustomJsonMessage[]>
```

## 🔄 Migration Path

If you're integrating this into an existing Hive Messenger project:

1. **Keep memo system intact** - Don't modify any `transfer` operation code
2. **Add custom_json system separately** - This is a completely independent feature
3. **Update UI** - Add image upload button and display logic
4. **Test thoroughly** - Verify both systems work independently

## 📝 Additional Documentation

- [`docs/INTEGRATION_EXAMPLE.md`](docs/INTEGRATION_EXAMPLE.md) - Complete integration code examples
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - Detailed architecture documentation
- [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md) - Testing strategies and helpers
- [`docs/MOBILE_INTEGRATION.md`](docs/MOBILE_INTEGRATION.md) - HAS mobile auth integration guide
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) - Common issues and solutions

## 🤝 Support

For questions about this module:
1. Check documentation in `docs/` folder
2. Review the original Hive Messenger implementation
3. Test with small images first before production use

## ⚖️ License

This code is extracted from Hive Messenger and follows the same license terms as the parent project.

---

**Ready to integrate?** Start with `docs/INTEGRATION_EXAMPLE.md` for step-by-step guidance!
