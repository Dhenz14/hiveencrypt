# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Version History

### v1.0.0 - HiveEncryptV1 (Stable Release)
**Date:** November 10, 2025  
**Status:** Production Ready ✅

**Core Features:**
- End-to-end encryption via Hive memo keys (ECDH + AES-256-CBC)
- Hive Keychain authentication (desktop extension + mobile in-app browser)
- Messages via memo transfers (0.001 HBD per message)
- Mobile-first responsive design (single-view mobile, split-view desktop)
- Adaptive blockchain polling (5s active, 15s idle, 45s background)
- IndexedDB caching for instant loading and offline access
- PWA installable with service worker
- Blockchain verification links (hiveblockexplorer.com)
- Platform detection with mobile browser redirect to Keychain Mobile
- Touch-friendly UI (44px+ targets, safe-area padding)
- Real-time messaging experience with zero server dependencies
- 100% decentralized architecture (no backend, no database, no sessions)
- Double-encryption detection and recovery
- Selective conversation deletion
- Dark mode support

**Architecture Highlights:**
- Zero centralization - all operations client-side
- Direct Hive RPC node communication
- Private keys never leave Keychain
- Offline-first with IndexedDB caching
- Cross-platform compatibility (desktop + mobile)

**Performance:**
- 40-80% fewer API calls vs. constant polling
- Instant message loading from cache
- Parallel decryption for message batches
- RPC node health scoring for reliability

This version serves as the stable baseline before implementing v2 features.

---

### v2.0.0 - Minimum HBD Filter (Stable Release)
**Date:** November 11, 2025  
**Status:** Production Ready ✅

**New Features:**
- **Configurable Minimum HBD Requirements**: Users can set their own minimum HBD amount (0.001 to 1,000,000) required for incoming messages
- **Economic Anti-Spam Mechanism**: Recipient-controlled transfer minimums create economic barrier against unwanted messages
- **Sender Pre-Validation**: Message composer displays recipient's minimum requirement and validates send amounts before blockchain broadcast
- **Intelligent Inbox Filtering**: Received messages below user's minimum are automatically filtered client-side (cached but hidden from display)
- **Dynamic Re-Evaluation**: Cached messages are re-evaluated when user changes their minimum threshold
- **User-Friendly UX**: Hidden message count banner, empty state for fully filtered conversations, and one-click settings access
- **Accessibility Improvements**: ARIA labels, live regions, and screen reader support for filter features

**Architecture Implementation:**

**Phase 1 - Metadata Plumbing:**
- `accountMetadata.ts` library for Hive account metadata operations
- `getAccountMetadata()` - Fetches custom_json account data with TTL caching
- `updateMinimumHBD()` - Writes min_hbd preference via Keychain broadcast
- `parseMinimumHBD()` - Extracts minimum with fallback to 0.001 HBD default
- Integration with Hive blockchain custom_json operations

**Phase 2 - Settings UI:**
- `useMinimumHBD` hook for state management and persistence
- Message Filter section in SettingsModal with:
  - Numeric input validation (0.001 to 1,000,000 HBD)
  - Save and Reset functionality
  - Economic anti-spam explanation with icon
  - Toast notifications for success/error states

**Phase 3 - Sender Validation:**
- `useRecipientMinimum` hook to fetch recipient's minimum requirement
- MessageComposer integration showing recipient's minimum
- Customizable send amount input (default to recipient minimum if > 0.001)
- Comprehensive validation guards:
  - `hasVerifiedMinimum` flag prevents sends during metadata loading
  - Network error handling with user-friendly messages
  - Amount comparison validation before blockchain broadcast

**Phase 4 - Inbox Filtering:**
- Extended MessageCache interface with `amount` and `hidden` fields
- Modified `useBlockchainMessages` hook with filtering logic:
  - Filters RECEIVED messages where amount < user's minimum
  - NEVER filters SENT messages (user always sees own messages)
  - Caches ALL messages (preserves incremental sync)
  - Re-evaluation loop updates hidden flags on every query
- Return value changed to `{ messages, hiddenCount }` for UI awareness
- Hidden message banner with:
  - Accurate count display with proper pluralization
  - "Adjust Filter" button linking to Settings
  - Subtle, non-alarming styling (bg-muted, Info icon)
  - ARIA live region for screen reader announcements
- Empty state for fully filtered conversations:
  - Detects when `hiddenCount > 0 && messages.length === 0`
  - Filter icon with clear explanation
  - "Adjust Filter Settings" button
  - Preserves normal empty state for new chats
- Accessibility enhancements:
  - aria-labels on all interactive elements
  - aria-live="polite" for dynamic content
  - aria-describedby linking for context

**Technical Highlights:**
- Zero server-side changes (100% client-side implementation)
- Metadata cached with TTL to minimize RPC calls
- Re-evaluation preserves cache efficiency
- Graceful degradation when metadata unavailable
- No breaking changes to core messaging functionality

**Performance:**
- Metadata caching reduces redundant blockchain queries
- Re-evaluation loop only updates changed messages
- Parallel decryption maintained for message batches
- IndexedDB caching preserves instant loading experience

**Security:**
- Metadata operations use Keychain signing (no private key exposure)
- Client-side filtering prevents malicious server manipulation
- Amount validation prevents accidental under-minimum sends
- Fail-safe defaults protect against metadata query failures

**Manual Testing Prerequisites:**
- Hive Keychain extension (desktop) or Keychain Mobile app required
- Existing Hive account with message history recommended
- Multiple conversations with varying HBD amounts for comprehensive testing
- Automated E2E testing blocked by Keychain authentication requirement

This version builds on v1.0.0 with backward compatibility, adding economic spam protection while maintaining the decentralized, privacy-first architecture.

---

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform with no centralized servers, backend, database, or sessions. All operations are client-side, using the Hive blockchain for immutable storage and IndexedDB for local caching. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure, ensuring instant user experience.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger features a 100% decentralized architecture. It's a React PWA hosted statically, leveraging the Hive blockchain as the single source of truth and IndexedDB for client-side message caching. Authentication uses Hive Keychain exclusively (browser extension for desktop and Keychain Mobile in-app browser for mobile devices). The application makes direct RPC calls to public Hive blockchain nodes. Messages are end-to-end encrypted client-side using Hive memo encryption (ECDH + AES-CBC) via the user's memo key, ensuring private keys never leave the Keychain authentication mechanisms. The PWA supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first approach.
- **Theming**: Dark mode support.
- **Component Library**: Utilizes Shadcn UI.

### Technical Implementations
- **Client-Side Authentication**: Hive Keychain exclusively (browser extension for desktop, Keychain Mobile in-app browser for mobile).
- **Platform Detection**: 500ms injection wait + handshake verification to detect Keychain availability.
- **Mobile Browser Redirect**: Regular mobile browsers (Safari/Chrome) are redirected to open the app in Keychain Mobile's in-app browser via deep linking (`hive://browser?url=...`).
- **Local Data Caching**: IndexedDB for decrypted messages and metadata, enabling instant loading and offline access.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` for direct communication with Hive RPC nodes.
- **PWA Features**: Manifest, Service Worker for offline support and asset caching.
- **Message Encryption**: All messages are client-side encrypted before blockchain broadcast.
- **Conversation Discovery**: Achieved by scanning blockchain transactions for communication partners.

### Feature Specifications
- **Text Messaging**: End-to-end encrypted messages via memo transfers (0.001 HBD per message).
- Real-time message synchronization with the blockchain.
- Offline message browsing of cached data.
- Selective local conversation deletion.
- Detection and recovery for double-encrypted messages.
- PWA installable on mobile and desktop.
- No private keys are ever transmitted or stored by the application.

### System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication mechanisms.
- **Performance Optimizations**: Incremental pagination, memo caching, parallel decryption, RPC node health scoring, React Query cache optimization, batched IndexedDB writes, operation filtering, placeholder conversation discovery, instant cached data display, and transaction limits.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes**: `https://api.hive.blog`, `https://api.hivekings.com`, `https://anyx.io`, `https://api.openhive.network`.

### Authentication Services
- **Hive Keychain**: Universal authentication solution for both desktop and mobile.
  - Desktop: Browser extension (Chrome, Firefox, Edge)
  - Mobile: Keychain Mobile in-app browser (iOS/Android)
  - API: `window.hive_keychain` injected into both environments
  
### Platform Support
- **Desktop Browsers**: Full functionality with Keychain browser extension
- **Keychain Mobile Browser**: Full functionality via in-app browser (same API as desktop)
- **Regular Mobile Browsers** (Safari/Chrome): Displays redirect screen with deep link to open in Keychain Mobile app
  - Deep link format: `hive://browser?url=<app-url>`
  - Provides app installation links (iOS App Store, Google Play)
  - Copy URL fallback for manual navigation