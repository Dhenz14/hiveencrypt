# Architecture Documentation

## System Overview

The Image Messaging module is a **completely separate system** from the memo-based text messaging. It uses `custom_json` blockchain operations instead of `transfer` operations.

## Why Custom JSON?

### Memo System Limitations

The memo-based system (used for text messages) has constraints:
- ✅ **Pros**: Simple, built into transfer operations, low RC cost
- ❌ **Cons**: 2KB payload limit, can't handle images efficiently

### Custom JSON Advantages

For image messaging, custom_json provides:
- ✅ **8KB per operation** (4x larger than memos)
- ✅ **Batched operations** (multiple operations in ONE transaction)
- ✅ **Flexible payload structure** (JSON format)
- ✅ **Lower cost per byte** compared to repeated transfers

## Data Flow Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    CLIENT-SIDE ONLY                          │
│                  (No Backend Servers)                        │
└──────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  User Selects   │────▶│ Image Processing│────▶│   Encryption    │
│     Image       │     │   Pipeline      │     │  (Keychain)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                         │
                               ▼                         ▼
                        ┌──────────────┐         ┌──────────────┐
                        │ WebP (70%)   │         │ SHA-256 Hash │
                        │ Gzip (30%)   │         │   Integrity  │
                        │ Base64 (JSON)│         │  Verification│
                        └──────────────┘         └──────────────┘
                               │                         │
                               └─────────┬───────────────┘
                                         ▼
                              ┌───────────────────┐
                              │   Chunking Logic  │
                              │ (if payload > 7KB)│
                              └───────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              ┌─────────┐         ┌─────────┐         ┌─────────┐
              │ Chunk 1 │         │ Chunk 2 │         │ Chunk 3 │
              │  (7KB)  │         │  (7KB)  │         │  (7KB)  │
              └─────────┘         └─────────┘         └─────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
                           ┌──────────────────────────┐
                           │  Hive Keychain Broadcast │
                           │  (requestBroadcast API)  │
                           └──────────────────────────┘
                                         │
                                         ▼
                           ┌──────────────────────────┐
                           │   Hive Blockchain RPC    │
                           │ broadcast_transaction    │
                           └──────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              ┌──────────┐         ┌──────────┐         ┌──────────┐
              │ custom_  │         │ custom_  │         │ custom_  │
              │ json #1  │         │ json #2  │         │ json #3  │
              └──────────┘         └──────────┘         └──────────┘
                    │                    │                    │
                    └────────────────────┴────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  Single Transaction │
                              │    (Atomic Send)    │
                              └─────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   Block Inclusion   │
                              │    (~3 seconds)     │
                              └─────────────────────┘
```

## Component Architecture

### 1. Image Processing Layer

**File**: `lib/imageUtils.ts`

**Responsibilities**:
- Convert uploaded images to WebP format
- Resize to maximum dimensions (default: 300px)
- Apply quality compression (default: 0.6)
- Gzip compress WebP binary data
- Base64 encode for JSON compatibility

**Key Functions**:
```typescript
processImageForBlockchain(file, maxWidth, quality)
├─▶ compressImageToWebP() 
│   └─▶ HTML5 Canvas API
├─▶ blobToArrayBuffer()
├─▶ compressBinaryToBase64()
│   └─▶ pako.gzip()
└─▶ Returns: { base64, base64Uncompressed, stats }
```

### 2. Encryption Layer

**File**: `lib/customJsonEncryption.ts`

**Responsibilities**:
- Create optimized JSON payload with short keys
- Generate SHA-256 integrity hash
- Encrypt via Hive Keychain (memo key)
- Decrypt and verify integrity on receive

**Key Functions**:
```typescript
encryptImagePayload(payload, username)
├─▶ Optimize JSON keys (25-30% savings)
├─▶ generateSHA256() for integrity
├─▶ requestKeychainEncryption()
│   └─▶ window.hive_keychain.requestEncodeMessage()
└─▶ Returns: { encrypted, hash }

decryptImagePayload(encrypted, username, hash)
├─▶ requestKeychainDecryption()
│   └─▶ window.hive_keychain.requestDecode()
├─▶ Verify SHA-256 hash
├─▶ Parse and expand JSON
└─▶ Returns: ImagePayload
```

### 3. Chunking Layer

**File**: `lib/imageChunking.ts`

**Responsibilities**:
- Split large payloads into 7KB chunks
- Batch all chunks into ONE transaction
- Reassemble chunks from blockchain

**Key Functions**:
```typescript
broadcastImageMessage(username, encrypted, hash)
├─▶ Estimate payload size
├─▶ IF < 7.5KB: broadcastSingleOperation()
│   └─▶ window.hive_keychain.requestCustomJson()
└─▶ ELSE: broadcastChunkedOperation()
    ├─▶ chunkEncryptedPayload()
    └─▶ window.hive_keychain.requestBroadcast()
        └─▶ All chunks in ONE transaction

reassembleChunks(chunks)
├─▶ Group by sessionId
├─▶ Sort by index
└─▶ Concatenate chunk data
```

### 4. Blockchain Layer

**File**: `integration/hive-custom-json-functions.ts`

**Responsibilities**:
- Fetch custom_json operations from Hive blockchain
- Filter by conversation partners
- Handle both single and chunked messages

**Key Functions**:
```typescript
getCustomJsonMessages(username, partner, limit)
├─▶ Client.database.call('get_account_history')
│   └─▶ operation_filter_low: 262144 (custom_json only)
├─▶ Filter by 'hive-messenger-img' ID
├─▶ Separate single vs chunked operations
├─▶ reassembleChunks() for multi-chunk messages
└─▶ Returns: CustomJsonOperation[]
```

### 5. Caching Layer

**File**: `integration/messageCache-additions.ts`

**Responsibilities**:
- Store decrypted messages in IndexedDB
- Enable instant display on page load
- Support offline browsing

**IndexedDB Schema**:
```typescript
customJsonMessages {
  key: txId (Primary)
  indexes: {
    'by-conversation': conversationKey,
    'by-timestamp': timestamp,
    'by-sessionId': sessionId
  }
}
```

**Key Functions**:
```typescript
cacheCustomJsonMessages(messages, username)
├─▶ Open user-specific IndexedDB
├─▶ Batch write all messages
└─▶ Single transaction (atomic)

getCustomJsonMessagesByConversation(user, partner)
├─▶ Generate conversationKey (sorted usernames)
├─▶ Query by-conversation index
└─▶ Sort by timestamp
```

### 6. UI Components

**File**: `components/ImageMessage.tsx`

**Responsibilities**:
- Display encrypted/decrypted states
- Handle on-demand decryption
- Provide download functionality

**Component States**:
```typescript
┌─────────────────────────────────────────┐
│         ENCRYPTED STATE                 │
│  ┌───────────────────────────────────┐  │
│  │  🔒 Lock Icon                     │  │
│  │  "Encrypted Image"                │  │
│  │  [ Decrypt Button ]               │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                  │
                  │ User clicks "Decrypt"
                  ▼
┌─────────────────────────────────────────┐
│       DECRYPTING STATE                  │
│  ┌───────────────────────────────────┐  │
│  │  ⌛ Loading Spinner               │  │
│  │  "Decrypting..."                  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                  │
                  │ Decryption complete
                  ▼
┌─────────────────────────────────────────┐
│        DECRYPTED STATE                  │
│  ┌───────────────────────────────────┐  │
│  │  📷 [Image Display]               │  │
│  │  (hover: download button)         │  │
│  │  "Optional caption text"          │  │
│  │  filename.webp • #abc123          │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 7. React Hooks

**File**: `hooks/useCustomJsonMessages.ts`

**Responsibilities**:
- Fetch and cache custom_json messages
- Auto-refresh every 60 seconds
- Pre-populate with cached data

**Query Flow**:
```typescript
useCustomJsonMessages({ partnerUsername })
├─▶ Pre-populate cache on mount
│   └─▶ getCustomJsonMessagesByConversation()
├─▶ Query function
│   ├─▶ Load cached messages FIRST
│   ├─▶ Fetch from blockchain
│   ├─▶ Merge and deduplicate
│   └─▶ Batch cache new messages
└─▶ Auto-refetch: 60s active, paused when inactive
```

## Security Architecture

### Encryption Scheme

```
┌────────────────────────────────────────────────────────┐
│          Hive Memo Encryption (ECDH + AES)             │
└────────────────────────────────────────────────────────┘

Sender Side:
1. Get recipient's PUBLIC memo key from blockchain
2. Use sender's PRIVATE memo key (via Keychain)
3. ECDH key agreement → shared secret
4. AES-256-CBC encryption with shared secret
5. Result: encrypted payload only sender/recipient can decrypt

Recipient Side:
1. Receive encrypted payload from blockchain
2. Use recipient's PRIVATE memo key (via Keychain)
3. ECDH key agreement → same shared secret
4. AES-256-CBC decryption
5. Verify SHA-256 hash for integrity
```

### Key Security Features

✅ **Private keys never leave Keychain**: All crypto operations via browser extension  
✅ **End-to-end encryption**: Only sender and recipient can decrypt  
✅ **Integrity verification**: SHA-256 hash prevents tampering  
✅ **On-demand decryption**: Saves RC, improves privacy  
✅ **No server storage**: Everything is blockchain + local IndexedDB  

## Performance Optimizations

### 1. Compression Pipeline

```
Original JPEG (500KB)
├─▶ WebP conversion: 350KB (70% saved)
├─▶ Resize to 300px: 150KB (additional 57% saved)
├─▶ Gzip binary: 105KB (additional 30% saved)
└─▶ Total savings: 79% (500KB → 105KB)
```

### 2. Caching Strategy

```
User opens conversation
├─▶ Load from IndexedDB (< 100ms)
│   └─▶ Display immediately
├─▶ Background blockchain sync
│   ├─▶ Fetch latest 200 operations
│   ├─▶ Filter by conversation
│   └─▶ Cache new messages
└─▶ Update UI with new messages
```

### 3. Batch Operations

Instead of N separate transactions:
```
❌ OLD: 5 chunks = 5 separate transactions
   - 5x transaction fees
   - 5x network round-trips
   - Race conditions possible

✅ NEW: 5 chunks = 1 batched transaction
   - 1x transaction fee
   - 1x network round-trip
   - Atomic (all-or-nothing)
```

## Resource Credits (RC) Management

### RC Cost Calculation

```typescript
Base cost: 200M RC per custom_json operation
Size cost: 50M RC per KB of data

Example:
- 1KB payload: 200M + 50M = 250M RC
- 7KB payload: 200M + 350M = 550M RC
- 3 chunks (21KB): 600M + 1050M = 1.65B RC
```

### RC Estimation Flow

```
Before sending image
├─▶ getAccountRC(username)
│   └─▶ Check current RC balance
├─▶ estimateCustomJsonRC(payloadSize, chunkCount)
│   └─▶ Calculate estimated cost
├─▶ Compare: current >= estimated?
│   ├─▶ YES: Proceed with broadcast
│   └─▶ NO: Show warning, abort
```

## Error Handling

### Encryption Errors

- **Keychain not installed**: Show installation link
- **User rejects**: Silent fail, show message
- **Invalid memo key**: Show error, suggest verification

### Broadcast Errors

- **Insufficient RC**: Show RC percentage, suggest waiting
- **Network failure**: Retry with exponential backoff
- **Invalid operation**: Log error, notify user

### Decryption Errors

- **Hash mismatch**: Data corrupted, show error
- **Wrong recipient**: Can't decrypt, show lock icon
- **Keychain unavailable**: Show installation prompt

## Scalability Considerations

### Current Limits

- **Max image size**: 5MB original (compressed to ~500KB final)
- **Max chunks**: ~70 chunks per image (theoretically)
- **Practical limit**: ~10 chunks (70KB encrypted payload)

### Optimization Opportunities

- **Parallel decryption**: Decrypt multiple messages simultaneously
- **Lazy loading**: Only fetch visible messages
- **Progressive loading**: Show thumbnails before full images
- **CDN caching**: Cache frequently viewed images (future)

---

**Next**: See `INTEGRATION_EXAMPLE.md` for practical implementation guide
