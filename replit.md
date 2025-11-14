# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform with no centralized servers, backend, database, or sessions. All operations are client-side, using the Hive blockchain for immutable storage and IndexedDB for local caching. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, Lightning Network Bitcoin tips via v4v.app bridge, and a mobile-first responsive design.

## Recent Changes (v2.2.0)
- **Lightning Network Integration**: Added Bitcoin Lightning Network tipping functionality with multiple payment methods.
  - Users can send Bitcoin satoshis to recipients with Lightning Addresses via three payment options.
  - **V4V.app HBD Bridge**: Send tips using HBD balance through Hive Keychain with automatic BTC conversion (0.8% fee).
  - **Manual Lightning Payment**: Copy invoice or scan QR code for payment with any Lightning wallet.
  - **WebLN Support**: One-click payment for users with WebLN-enabled browser wallets (Alby, etc.).
- **Lightning Address Settings**: Users can add their Lightning Address to profile, stored on-chain as custom_json metadata.
  - LNURL verification during tip generation ensures address validity and reachability.
  - Settings page with real-time validation and save confirmation.
- **Encrypted Tip Notifications**: Recipients receive encrypted notifications when tips are sent.
  - Special rendering with Zap icon badge and highlighted background.
  - Displays sats amount and clickable blockchain transaction link.
  - Maintains end-to-end encryption via memo keys.
- **QR Code Generation**: Automatic QR code display for Lightning invoices for mobile wallet scanning.
- **Security**: Invoice validation (BOLT11 decode, amount verification, expiry check) before transfer.
- **No Backend Proxy**: 100% client-side Lightning integration maintains decentralization principles.

## Recent Changes (v2.1.0)
- **Duplicate Message Fix**: Removed optimistic message updates entirely. Messages now appear ONLY after blockchain confirmation (no instant preview).
  - Trade-off: Slight delay (2-5 seconds) before messages appear, but 100% reliable with no duplicates.
  - Fast polling (15 seconds) triggers after send to minimize perceived latency.
- **Service Worker Cache**: Bumped to v11 to force cache invalidation after precision fix.
- **Timezone Fixes**: All timestamps normalized to UTC with 'Z' suffix for consistency.
- **Migration System**: Implemented idempotent UTC timestamp migration for existing cached messages.
- **Exemption Indicator**: Added friendly UX indicator when users may be exempted from paying higher minimum HBD fees.
  - Green success badge with checkmark appears when sending at 0.001 HBD below recipient's higher minimum
  - Message: "{amount} HBD - You may be exempted from their {minimum} HBD minimum!"
  - Allows sending at default 0.001 HBD even if recipient requires more (assumes exemption stored in recipient's localStorage)
  - Uses precise integer thousandths validation to ensure ONLY exactly 0.001 HBD triggers exemption (no floating-point rounding issues)

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger features a 100% decentralized architecture. It's a React PWA hosted statically, leveraging the Hive blockchain as the single source of truth and IndexedDB for client-side message caching. Authentication uses Hive Keychain exclusively. The application makes direct RPC calls to public Hive blockchain nodes. Messages are end-to-end encrypted client-side using Hive memo encryption via the user's memo key, ensuring private keys never leave the Keychain. The PWA supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first approach, single-view mobile, split-view desktop.
- **Theming**: Dark mode support.
- **Component Library**: Utilizes Shadcn UI.
- **Touch-Friendly UI**: 44px+ targets (min-h-11/min-w-11), iOS safe-area padding for notched devices.
- **Mobile Accessibility**: Viewport allows user zoom, 16px+ input font-size prevents auto-zoom, all interactive elements meet 44px minimum.

### Technical Implementations
- **Client-Side Authentication**: Hive Keychain exclusively (browser extension for desktop, Keychain Mobile in-app browser for mobile).
- **Platform Detection**: Identifies and directs users to the appropriate Keychain environment.
- **Local Data Caching**: IndexedDB for decrypted messages and metadata, enabling instant loading and offline access.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` for direct communication with Hive RPC nodes.
- **PWA Features**: Manifest, Service Worker for offline support and asset caching.
- **Message Encryption**: All messages are client-side encrypted before blockchain broadcast (ECDH + AES-256-CBC).
- **Conversation Discovery**: Achieved by scanning blockchain transactions for communication partners.
- **Economic Anti-Spam**: Configurable minimum HBD requirements for incoming messages, stored as custom_json metadata on the blockchain.
- **Whitelist Management**: Local storage-based exceptions list for bypassing minimum HBD filters for trusted contacts.
- **Hidden Conversations**: Client-side conversation hiding to declutter sidebar without deleting message data, stored per-user in localStorage with centralized state management.
- **Resizable Sidebar**: Desktop-only (md+ breakpoint) using react-resizable-panels with one-time hydration pattern (static mountKey, default 22%, min 18%, max 40%, persists to localStorage key 'hive-messenger-sidebar-layout').
- **Mobile Optimization**: Viewport meta allows user zoom without auto-zoom (16px+ inputs), 24 interactive elements upgraded to 44px+ touch targets, iOS safe-area padding with min-h-[calc()] for notched devices (iPhone 14+, Dynamic Island).

### Feature Specifications
- **Text Messaging**: End-to-end encrypted messages via memo transfers (0.001 HBD per message).
- **Lightning Network Tips**: Send Bitcoin satoshis via Lightning Network to users with Lightning Addresses.
  - **V4V.app Bridge**: Convert HBD to BTC Lightning payments through v4v.app service (0.8% fee).
  - **LNURL Invoice Generation**: Generate Lightning invoices via recipient's LNURL endpoint.
  - **Multiple Payment Methods**: V4V.app HBD bridge, manual Lightning wallet (copy/QR), or WebLN browser wallet.
  - **Encrypted Notifications**: Recipients receive encrypted tip notifications with sats amount and transaction link.
  - **Lightning Address Profile**: Users can set their Lightning Address in settings, stored on-chain.
- Real-time message synchronization with the blockchain.
- Offline message browsing of cached data.
- Selective local conversation deletion.
- Detection and recovery for double-encrypted messages.
- PWA installable on mobile and desktop.
- No private keys are ever transmitted or stored by the application.
- Configurable minimum HBD filter for incoming messages.
- User-managed exceptions/whitelist for the HBD filter.
- Hide/unhide conversations from sidebar (message data remains in cache, accessible via "Hidden Chats" menu).

### System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication mechanisms; private keys never leave Keychain.
- **Performance Optimizations**: Adaptive blockchain polling, IndexedDB caching, parallel decryption, RPC node health scoring, and React Query cache optimization.
- **Zero Centralization**: All operations client-side, direct Hive RPC node communication.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.
- **lnurl-pay**: LNURL protocol implementation for Lightning Address invoice generation.
- **light-bolt11-decoder**: BOLT11 Lightning invoice decoding and validation.
- **qrcode**: QR code generation for Lightning invoices.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes**: `https://api.hive.blog`, `https://api.hivekings.com`, `https://anyx.io`, `https://api.openhive.network`.

### Authentication Services
- **Hive Keychain**: Universal authentication solution for both desktop (browser extension) and mobile (Keychain Mobile in-app browser).

### Lightning Network Services
- **V4V.app**: HBD-to-Lightning bridge service for Bitcoin tips (0.8% fee, 4-hour transfer limits).
- **LNURL Protocol**: Decentralized Lightning Address infrastructure for invoice generation.
- **WebLN**: Browser wallet API for one-click Lightning payments (optional, user-dependent).

### Platform Support
- **Desktop Browsers**: Full functionality with Keychain browser extension.
- **Keychain Mobile Browser**: Full functionality via in-app browser.
- **Regular Mobile Browsers** (Safari/Chrome): Redirects users to open the app in Keychain Mobile via deep linking (`hive://browser?url=...`).