# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform without centralized servers or databases. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, and bidirectional Lightning Network Bitcoin tips via the v4v.app bridge.

## Recent Changes (December 8, 2025)

### Group Discovery Feature Integration
- **Feature**: Added "Make Public" and "Discover Groups" functionality to the main Messages UI
- **Implementation**:
  - Added `PublishGroupModal` to Messages.tsx for creators to publish their groups publicly
  - Added `isPublishGroupOpen` state and `handleMakePublic` handler
  - Updated `GroupChatHeader` to show "Make Public" option for group creators
  - Added "Discover Groups" button to ConversationsList with navigation to `/discover` page
  - Uses wouter's `setLocation` for client-side routing
- **Discovery System**: Uses Hive posts tagged "hive-messenger" + "group-discovery" to leverage existing Hivemind indexing. Posts contain group metadata, payment settings, and shareable join links.
- **Key Files**:
  - `client/src/lib/groupDiscovery.ts` - Discovery API using Hivemind
  - `client/src/pages/GroupDiscovery.tsx` - Browse/search public groups
  - `client/src/components/PublishGroupModal.tsx` - Publish group UI
  - `client/src/pages/JoinGroup.tsx` - Join flow for discovered groups

## Previous Changes (November 21, 2025)

### Intuitive Keychain Error Messages for All Settings
- **Issue**: When users cancelled Keychain popups while changing settings (message privacy, group privacy, tip preference), they received generic "Update Failed" messages with no guidance
- **Root Cause**: Only tip preference handler had helpful error messaging; message privacy and group privacy handlers showed raw error messages
- **Solution**: Created shared helper utilities and applied consistent UX patterns across all settings:
  - Added `isKeychainCancelled()` helper to detect cancelled Keychain transactions
  - Added `getKeychainErrorMessage()` helper to provide user-friendly error messages
  - Updated all three settings handlers (tip preference, message privacy, group privacy) to use helpers
  - Added info boxes above all privacy settings warning: "Changing this setting will trigger a Hive Keychain popup. Please approve the popup to save your preference."
  - Consistent error message: "You need to approve the Hive Keychain popup to save this setting. Please try again and click 'Approve' when Keychain prompts you."
- **Impact**: Users now get clear, helpful guidance when they cancel Keychain popups, explaining exactly what went wrong and how to fix it

### Lightning Address & Minimum HBD Persistence Fix
- **Issue**: Lightning Address and Minimum HBD settings not persisting after save - reopening Settings modal showed old values
- **Root Cause**: Blockchain propagation delay - React Query cache was invalidated and refetched immediately after broadcast, but blockchain hadn't propagated the `account_update2` operation yet, causing refetch to return stale data
- **Solution**: Added 2-second delay before cache invalidation in both hooks:
  - `useLightningAddress`: Delays `invalidateQueries` by 2 seconds after successful save
  - `useMinimumHBD`: Delays `invalidateQueries` by 2 seconds after successful save
  - User sees optimistic update immediately (instant feedback)
  - Blockchain gets time to propagate before refetch
  - Cache refetches correct data after delay
- **Impact**: Lightning Address and Minimum HBD now persist correctly across modal reopens and page refreshes

### Race Condition Fix: Synchronous Double-Click Protection
- **Issue**: First message send attempt failed with "User ignored this transaction" error, worked on second attempt
- **Root Cause**: React state updates are **asynchronous**, creating a timing window where rapid double-clicks could bypass the `isSending` flag before it updated
- **Solution**: Implemented **synchronous ref-based guard** (`isSendingRef.current`) alongside state:
  - Added `useRef<boolean>` for instant, synchronous blocking
  - Check `isSendingRef.current` at the **very beginning** of all three send handlers
  - Set ref immediately before any async validation (refs update synchronously, state does not)
  - Reset ref in all error paths and finally blocks
  - Applied to: `handleSubmit()`, `handleGroupSend()`, `handleImageSend()`
- **Technical Detail**: State (`setIsSending`) is kept for UI reactivity, ref is used for race-free blocking
- **Impact**: **Zero-tolerance** double-click protection - physically impossible for duplicate Keychain popups

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger features a 100% decentralized architecture, operating as a React PWA hosted statically. It leverages the Hive blockchain as the single source of truth and IndexedDB for client-side message caching. Authentication is exclusively via Hive Keychain, and the application interacts directly with public Hive blockchain RPC nodes. Messages are end-to-end encrypted client-side using Hive memo encryption. The PWA supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first approach with single-view mobile and split-view desktop layouts.
- **Theming**: Dark mode support.
- **Component Library**: Shadcn UI.
- **Touch-Friendly UI**: 44px+ touch targets and iOS safe-area padding.

### Technical Implementations
- **Client-Side Authentication**: Exclusively uses Hive Keychain.
- **Local Data Caching**: IndexedDB for decrypted messages and metadata.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` for direct communication with Hive RPC nodes.
- **PWA Features**: Manifest and Service Worker for offline support.
- **Message Encryption**: All messages are client-side encrypted before blockchain broadcast (ECDH + AES-256-CBC).
- **Conversation Discovery**: Scans blockchain transactions for communication partners.
- **Economic Anti-Spam**: Configurable minimum HBD requirements for incoming messages.
- **Hive Following Integration**: Native integration with Hive's follow system for privacy controls.

### Feature Specifications
- **Text Messaging**: End-to-end encrypted messages via memo transfers.
- **Group Chats**: Decentralized group messaging with multiple participants.
  - **Group Creation and Management**: Create and manage groups with blockchain-synced member updates.
  - **Custom Group Names**: Local nickname system for personalizing group names.
  - **Batch Messaging**: Send encrypted messages to all group members individually with progress tracking.
  - **Memo-Pointer Protocol**: Scalable solution for discovering groups older than 5000 operations, using transaction ID pointers for efficient lookup.
  - **Paid Groups**: Monetization feature allowing creators to charge for group access using HBD payments, with automatic verification and access control.
  - **Self-Service Join System**: Hybrid auto-approve and manual approval workflow for group access, supporting shareable links and blockchain-based join requests.

## Group Chat System - Technical Deep Dive

### Architecture Overview
The group chat system is 100% decentralized with no backend servers. All group operations are stored on the Hive blockchain as `custom_json` operations with the ID `hive_messenger_group`.

### Key Files
- `client/src/lib/groupBlockchain.ts` - Core blockchain operations
- `client/src/hooks/useGroupMessages.ts` - Group message fetching and caching
- `client/src/hooks/useJoinRequests.ts` - Join request query hooks
- `client/src/hooks/useAutoApproveJoinRequests.ts` - Background auto-approval hook
- `client/src/components/JoinGroupButton.tsx` - Join group UI with 4 approval paths
- `client/src/components/ManageMembersModal.tsx` - Member management for creators
- `client/src/components/PaymentGatewayModal.tsx` - HBD payment flow
- `client/src/lib/paymentVerification.ts` - Payment verification utilities
- `client/src/lib/joinRequestDiscovery.ts` - Blockchain scanning for join requests

### Blockchain Operations
1. **Group Creation** (`action: 'create'`): Creates immutable group record with members, creator, and optional payment settings
2. **Group Update** (`action: 'update'`): Membership changes with version tracking
3. **Leave Group** (`action: 'leave'`): User voluntarily leaves a group
4. **Join Request** (`action: 'join_request'`): User requests to join with status field
5. **Join Approve** (`action: 'join_approve'`): Creator approves a join request
6. **Join Reject** (`action: 'join_reject'`): Creator rejects a join request

### Self-Service Join System - 4 Approval Paths
**Important**: In all paths, only the creator's client can broadcast `join_approve`. Users broadcast `join_request` with a status field, but actual membership requires creator approval.

1. **Free Auto-Approve**: User broadcasts `join_request` with status `approved_free` → Creator's background process detects and broadcasts `join_approve`
2. **Paid Auto-Approve**: User broadcasts `join_request` with status `pending_payment_verification` + `memberPayment` → Creator's client verifies payment on blockchain, then broadcasts `join_approve`
3. **Manual Free**: User broadcasts `join_request` with status `pending` → Creator manually approves in ManageMembersModal
4. **Manual Paid**: User broadcasts `join_request` with status `pending` → Creator collects payment in modal, then approves

### Security Measures
- **Requesters can ONLY broadcast `join_request`, NEVER `join_approve`** - Critical security fix
- Payment verification is done by creator's client on the blockchain before approval
- All messages are end-to-end encrypted via Hive memo encryption
- Private keys never leave Hive Keychain

### Payment Verification
- **Batched scanning**: 500 operations per batch, max 10 batches (5000 ops total)
- **Memo matching**: Payment memo must contain groupId
- **Time window**: 24 hours default for payment validity
- **Automatic verification**: Creator's client verifies payment existence on blockchain

### Performance Optimizations
- **Token Bucket Rate Limiter**: 4 requests/second to respect Keychain limits
- **LRU Memo Cache**: 1000 entries to eliminate duplicate decrypt requests
- **Decryption with Retry**: Exponential backoff (100ms → 200ms → 400ms) for transient errors
- **Query Cancellation**: AbortSignal support to prevent stale state
- **Optimistic Updates**: Messages appear instantly, confirmed after blockchain broadcast

### Race Condition Prevention
- **Synchronous Ref Guards**: `isSendingRef.current` provides instant blocking
- **Async State for UI**: `isSending` state handles button disabled state
- **Both are reset**: In all error paths and finally blocks

### Group Message Format
Messages use the format: `[GROUP:${groupId}:${creator}]${content}`
- `groupId`: UUID for the group
- `creator`: Username of group creator (for metadata discovery)
- `content`: Actual message content

### Auto-Approval Background Process
- Runs in `useAutoApproveJoinRequests` hook **only when user is group creator** (`isCreator` guard)
- Polls every 30 seconds for requests with status `approved_free` or `pending_payment_verification`
- For paid requests, verifies payment on blockchain before approving
- Broadcasts `join_approve` from creator's account
- Uses `processedRequestIds` ref to prevent duplicate approvals
- **Throttling**: 1-second delay between approval broadcasts to prevent rate limiting

### Other Key Features
- **Lightning Network Tips**: Send Bitcoin satoshis via the Lightning Network to users with Lightning Addresses, supporting bidirectional tipping and encrypted notifications.
- **Privacy Controls**: Hive Following-based privacy settings for messages and group invites, stored on the Hive blockchain.
- **Real-time Sync**: Message synchronization and offline browsing of cached data.
- **PWA**: Installable on mobile and desktop.
- **Security**: No private keys are ever transmitted or stored by the application.

## System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication; private keys never leave Keychain.
- **Performance Optimizations**: Multi-layer optimization strategy including IndexedDB caching, parallel decryption, and adaptive polling.
- **Zero Centralization**: All operations are client-side with direct Hive RPC node communication.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes**: `https://api.hive.blog`, `https://anyx.io`, `https://api.openhive.network` with automatic health scoring and smart failover.

### Authentication Services
- **Hive Keychain**: Universal authentication solution.

### Lightning Network Services
- **V4V.app**: Bidirectional bridge service for Bitcoin tips (HBD ↔ Lightning).
- **LNURL Protocol**: Decentralized Lightning Address infrastructure.
- **CoinGecko API**: Real-time Bitcoin price data for exchange rate calculations.