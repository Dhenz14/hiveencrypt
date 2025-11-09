# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

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