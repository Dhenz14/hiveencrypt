# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform without centralized servers, backend, databases, or sessions. All operations are client-side, using the Hive blockchain for immutable storage and IndexedDB for local caching. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, and bidirectional Lightning Network Bitcoin tips via the v4v.app bridge.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger features a 100% decentralized architecture, operating as a React PWA hosted statically. It leverages the Hive blockchain as the single source of truth and IndexedDB for client-side message caching. Authentication is exclusively via Hive Keychain, and the application interacts directly with public Hive blockchain RPC nodes. Messages are end-to-end encrypted client-side using Hive memo encryption, ensuring private keys never leave the Keychain. The PWA supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first approach with single-view mobile and split-view desktop layouts.
- **Theming**: Dark mode support.
- **Component Library**: Shadcn UI.
- **Touch-Friendly UI**: 44px+ touch targets and iOS safe-area padding for notched devices.
- **Mobile Accessibility**: Viewport allows user zoom, 16px+ input font-size prevents auto-zoom.

### Technical Implementations
- **Client-Side Authentication**: Exclusively uses Hive Keychain (browser extension or mobile app).
- **Local Data Caching**: IndexedDB for decrypted messages and metadata, enabling instant loading and offline access.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` for direct communication with Hive RPC nodes.
- **PWA Features**: Manifest and Service Worker for offline support and asset caching.
- **Message Encryption**: All messages are client-side encrypted before blockchain broadcast (ECDH + AES-256-CBC).
- **Conversation Discovery**: Achieved by scanning blockchain transactions for communication partners.
- **Economic Anti-Spam**: Configurable minimum HBD requirements for incoming messages, stored as custom_json metadata on the blockchain.
- **Whitelist Management**: Local storage-based exceptions for bypassing minimum HBD filters.
- **Hidden Conversations**: Client-side conversation hiding to declutter the sidebar, stored in localStorage.
- **Resizable Sidebar**: Desktop-only feature using `react-resizable-panels` with state persistence.

### Feature Specifications
- **Text Messaging**: End-to-end encrypted messages via memo transfers (0.001 HBD per message).
- **Group Chats**: Decentralized group messaging with multiple participants.
  - **Group Creation**: Create named groups with 2+ members via custom_json operations (free, no HBD cost).
  - **Member Management**: Post-creation ability to add/remove members via ManageMembersModal with blockchain sync.
    - **Version Tracking**: Group updates increment version numbers to maintain state consistency.
    - **Creator Protection**: Group creators cannot be removed from their groups.
    - **Validation**: Prevents duplicate members and enforces minimum 2-member requirement.
    - **UI Features**: Two-column interface showing current members and add-member input with real-time validation.
  - **Custom Group Names**: Local nickname system for personalizing group names.
    - **Personal Labels**: Each user can rename any group to their preference (stored in localStorage).
    - **Instant Updates**: Custom names apply immediately without blockchain transactions.
    - **Persistent**: Names survive browser refreshes and are user-specific.
    - **Fallback Display**: Shows blockchain group name or auto-generated ID when no custom name is set.
  - **Message Previews**: Conversation list shows latest message from each group.
    - **Real-time Updates**: Previews refresh when new messages arrive or are sent.
    - **Cache-aware**: Loads previews from cached messages for instant display.
    - **Encrypted Content**: Shows decrypted preview text for authenticated users.
  - **Batch Messaging**: Send encrypted messages to all group members individually (N separate memo transfers).
  - **Progress Tracking**: Real-time UI showing "Sending to X members..." with progress bar during batch sends.
  - **Sender Attribution**: Group messages display sender usernames for proper conversation flow.
  - **Resource Credits Validation**: Checks RC before batch sends (blocks if <10%, warns if <30%).
  - **Error Handling**: Tracks failed recipients and shows partial success/failure status.
  - **Blockchain Sync**: Scans incoming memos for `group:` prefix to aggregate group messages.
  - **Privacy**: New members only see messages sent after they joined (true end-to-end encryption).
  - **Known Limitations**: Image attachments disabled for groups (post-MVP), 200-operation history window.
- **Lightning Network Tips**: Users can send Bitcoin satoshis via the Lightning Network to users with Lightning Addresses.
  - **Bidirectional Tipping**: Users choose to receive tips as Lightning sats or HBD in their Hive wallet.
  - **Payment Methods**: V4V.app HBD bridge, manual Lightning wallet (copy/QR), or WebLN browser wallet.
  - **Encrypted Notifications**: Recipients receive encrypted tip notifications showing the received currency.
  - **Lightning Address Profile**: Users can set their Lightning Address and tip receive preference in settings, stored on-chain.
- Real-time message synchronization with the blockchain.
- Offline message browsing of cached data.
- Selective local conversation deletion.
- PWA installable on mobile and desktop.
- No private keys are ever transmitted or stored by the application.
- Configurable minimum HBD filter for incoming messages and user-managed exceptions.
- Hide/unhide conversations from the sidebar.

### System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication; private keys never leave Keychain.
- **Performance Optimizations**: Multi-layer optimization strategy delivering <100ms conversation loads. See `PERFORMANCE_GUIDE.md` for complete technical documentation covering IndexedDB caching, parallel decryption, adaptive polling, RPC node health scoring, React Query cache strategy, incremental pagination, and batched writes.
- **Zero Centralization**: All operations are client-side with direct Hive RPC node communication.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.
- **lnurl-pay**: LNURL protocol implementation.
- **light-bolt11-decoder**: BOLT11 Lightning invoice decoding and validation.
- **qrcode**: QR code generation.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes**: 
  - Primary: `https://api.hive.blog` (default fallback)
  - Secondary: `https://api.hivekings.com`, `https://anyx.io`, `https://api.openhive.network`
  - **Node Health Monitoring**: Automatic health scoring with latency tracking and error rate monitoring
  - **Smart Failover**: Automatically switches to best-performing nodes when primary fails

### Authentication Services
- **Hive Keychain**: Universal authentication solution for desktop and mobile.

### Lightning Network Services
- **V4V.app**: Bidirectional bridge service for Bitcoin tips (HBD ↔ Lightning).
- **LNURL Protocol**: Decentralized Lightning Address infrastructure.
- **WebLN**: Browser wallet API for one-click Lightning payments (optional).
- **CoinGecko API**: Real-time Bitcoin price data for exchange rate calculations.