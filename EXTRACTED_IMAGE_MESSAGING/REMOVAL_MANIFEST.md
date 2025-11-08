# Custom JSON Removal Manifest

## 📋 Overview

This document lists **all files and code sections** related to custom_json image messaging that should be **removed from the current Hive Messenger project** to keep it as a **pure memo-based text messaging system**.

Use this checklist when you're ready to remove the custom_json functionality from your main project.

---

## 🗑️ Files to Delete Completely

### Library Files (`client/src/lib/`)
- ✅ `imageChunking.ts` - Chunking and broadcasting logic
- ✅ `customJsonEncryption.ts` - Encryption/decryption for custom_json
- ✅ `imageUtils.ts` - Image processing, WebP compression, gzip
- ✅ `compression.ts` - Gzip compression utilities
- ✅ `rcEstimation.ts` - Resource Credits estimation

### Component Files (`client/src/components/`)
- ✅ `ImageMessage.tsx` - Image message display component

### Hook Files (`client/src/hooks/`)
- ✅ `useCustomJsonMessages.ts` - Custom JSON messages React hook

---

## ✂️ Code Sections to Remove

### 1. `client/src/lib/hive.ts`

**Remove this entire function:**
```typescript
export async function getCustomJsonMessages(
  username: string,
  partnerUsername: string,
  limit: number = 200
): Promise<CustomJsonOperation[]> {
  // ... entire function body ...
}
```

**Remove this interface:**
```typescript
export interface CustomJsonOperation {
  txId: string;
  sessionId?: string;
  from: string;
  to: string;
  timestamp: string;
  encryptedPayload: string;
  hash?: string;
  chunks?: number;
}
```

**Remove these imports (if only used for custom_json):**
```typescript
import { reassembleChunks } from './imageChunking';
```

---

### 2. `client/src/lib/messageCache.ts`

**Remove this interface:**
```typescript
interface CustomJsonMessage {
  txId: string;
  sessionId?: string;
  conversationKey: string;
  from: string;
  to: string;
  timestamp: string;
  encryptedPayload: string;
  hash?: string;
  chunks?: number;
  isDecrypted: boolean;
  confirmed: boolean;
  imageData?: string;
  message?: string;
  filename?: string;
  contentType?: string;
}
```

**Remove from DBSchema:**
```typescript
interface HiveMessengerDB extends DBSchema {
  // ... other tables ...
  
  // REMOVE THIS:
  customJsonMessages: {
    key: string;
    value: CustomJsonMessage;
    indexes: {
      'by-conversation': string;
      'by-timestamp': string;
      'by-sessionId': string;
    };
  };
}
```

**Remove from database initialization:**
```typescript
// In getDB() or initializeDatabase():

// REMOVE THIS BLOCK:
if (!db.objectStoreNames.contains('customJsonMessages')) {
  const customJsonStore = db.createObjectStore('customJsonMessages', { keyPath: 'txId' });
  customJsonStore.createIndex('by-conversation', 'conversationKey');
  customJsonStore.createIndex('by-timestamp', 'timestamp');
  customJsonStore.createIndex('by-sessionId', 'sessionId');
}
```

**Remove these functions:**
```typescript
export async function cacheCustomJsonMessage(...)
export async function cacheCustomJsonMessages(...)
export async function getCustomJsonMessagesByConversation(...)
export async function getCustomJsonMessageByTxId(...)
export async function updateCustomJsonMessage(...)
export async function deleteCustomJsonConversation(...)
```

**Remove from exports:**
```typescript
// REMOVE:
export type { CustomJsonMessage };
```

---

### 3. `client/src/components/MessageComposer.tsx`

**Remove image upload functionality:**

**Remove these imports:**
```typescript
import { Image as ImageIcon, X } from 'lucide-react';
import { encryptImagePayload, type ImagePayload } from '@/lib/customJsonEncryption';
import { broadcastImageMessage } from '@/lib/imageChunking';
import { processImageForBlockchain } from '@/lib/imageUtils';
import { cacheCustomJsonMessage, type CustomJsonMessage } from '@/lib/messageCache';
import { getAccountRC, estimateCustomJsonRC, getRCWarningLevel } from '@/lib/rcEstimation';
```

**Remove these state variables:**
```typescript
const [selectedImage, setSelectedImage] = useState<File | null>(null);
const [imagePreview, setImagePreview] = useState<string | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

**Remove these functions:**
```typescript
const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => { ... }
const handleClearImage = () => { ... }
const handleSendImage = async () => { ... }
```

**Remove from JSX:**
```typescript
// Remove image preview section
{imagePreview && (
  <div className="relative inline-block">
    <img ... />
    <Button ... onClick={handleClearImage} ... />
  </div>
)}

// Remove file input
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  onChange={handleImageSelect}
  className="hidden"
/>

// Remove image upload button
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

// Simplify send button (remove image logic)
<Button
  onClick={selectedImage ? handleSendImage : handleSendTextMessage}  // CHANGE TO: onClick={handleSendTextMessage}
  disabled={isSending || (!content.trim() && !selectedImage)}  // CHANGE TO: disabled={isSending || !content.trim()}
>
  Send {selectedImage ? 'Image' : 'Message'}  // CHANGE TO: Send Message
</Button>
```

---

### 4. `client/src/pages/Messages.tsx` (or wherever you display messages)

**Remove image message display:**

**Remove these imports:**
```typescript
import { ImageMessage } from '@/components/ImageMessage';
import { useCustomJsonMessages } from '@/hooks/useCustomJsonMessages';
```

**Remove image messages query:**
```typescript
const { data: imageMessages, isLoading: imageLoading } = useCustomJsonMessages({
  partnerUsername,
  enabled: true,
});
```

**Remove message merging logic:**
```typescript
const allMessages = useMemo(() => {
  const merged = [
    ...(textMessages || []).map(msg => ({ ...msg, type: 'text' })),
    ...(imageMessages || []).map(msg => ({ ...msg, type: 'image' })),  // REMOVE THIS
  ];
  
  return merged.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}, [textMessages, imageMessages]);  // CHANGE TO: [textMessages]
```

**Simplify message rendering:**
```typescript
{allMessages.map((msg) => (
  msg.type === 'image' ? (
    <ImageMessage ... />  // REMOVE THIS
  ) : (
    <TextMessage ... />
  )
))}

// CHANGE TO:
{textMessages.map((msg) => (
  <TextMessage key={msg.txId} message={msg} currentUsername={user.username} />
))}
```

---

## 📦 Dependencies to Remove

### From `package.json`:

**Can be removed (if not used elsewhere):**
```json
{
  "dependencies": {
    "pako": "^2.1.x"  // ONLY if not used elsewhere
  },
  "devDependencies": {
    "@types/pako": "^2.0.x"  // ONLY if not used elsewhere
  }
}
```

**Keep these (still needed for memo messaging):**
```json
{
  "dependencies": {
    "@hiveio/dhive": "^1.2.x",  // KEEP - needed for blockchain
    "idb": "^8.0.x"  // KEEP - needed for message caching
  }
}
```

---

## 🧪 Testing After Removal

### 1. Build Verification
```bash
npm run build
# Should complete without errors
```

### 2. Functionality Tests
- ✅ Can send text messages via memo
- ✅ Can receive text messages
- ✅ Messages cached in IndexedDB
- ✅ Conversations list works
- ✅ No image upload button visible
- ✅ No "custom_json" operations fetched

### 3. Console Verification
- ❌ No errors about missing modules
- ❌ No references to "custom_json" in logs
- ❌ No "image" related errors

---

## 📝 Database Migration (Optional)

If users already have custom_json messages in IndexedDB:

### Option 1: Clean Migration
```typescript
// Remove customJsonMessages table from all users
const databases = await indexedDB.databases();
for (const db of databases) {
  if (db.name?.includes('hive-messenger')) {
    const connection = await indexedDB.open(db.name);
    if (connection.objectStoreNames.contains('customJsonMessages')) {
      connection.deleteObjectStore('customJsonMessages');
    }
  }
}
```

### Option 2: Leave Intact
- Old data remains in IndexedDB but is never accessed
- No functional impact
- Will be cleaned up if user clears browser data

---

## ✅ Completion Checklist

Before considering removal complete:

- [ ] All files from "Files to Delete" section removed
- [ ] All code sections from hive.ts removed
- [ ] All code sections from messageCache.ts removed  
- [ ] All image upload UI removed from MessageComposer
- [ ] All image display UI removed from Messages page
- [ ] Dependencies cleaned up (if safe)
- [ ] Build succeeds without errors
- [ ] Text messaging works correctly
- [ ] No console errors
- [ ] No broken imports or references

---

## 🎯 Final State

After following this manifest, your Hive Messenger will be:

✅ **Memo-only text messaging** (transfer operations)  
✅ **No image messaging** (no custom_json operations)  
✅ **No image processing** (no WebP/gzip utilities)  
✅ **No RC estimation** (not needed for simple memos)  
✅ **Cleaner codebase** (~2000 lines removed)  
✅ **Faster builds** (fewer dependencies)  

---

**Important**: Keep this `EXTRACTED_IMAGE_MESSAGING/` folder safe before deletion! You can use it for a new project later.
