# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a fully decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. Its core purpose is to provide a censorship-resistant communication platform with zero centralized servers, no backend, no database, and no sessions. All operations are client-side, leveraging the Hive blockchain for immutable storage and IndexedDB for local caching, ensuring instant user experience. The project aims to offer a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger operates with a 100% decentralized architecture. The application is a React PWA hosted statically, utilizing the Hive blockchain as the sole source of truth and IndexedDB for client-side message caching. Authentication for desktop users is handled via the Hive Keychain browser extension, while mobile users use HAS (Hive Authentication Services) through QR codes or deep linking. Direct RPC calls are made to public Hive blockchain nodes, eliminating the need for any intermediary API servers. Messages are end-to-end encrypted client-side using Hive memo encryption (ECDH + AES-CBC) via the user's memo key, ensuring private keys never leave the authentication mechanisms. The PWA design supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first approach.
- **Theming**: Dark mode support included.
- **Component Library**: Utilizes Shadcn UI for consistent and modern UI elements.

### Technical Implementations
- **Client-Side Authentication**: Hive Keychain (desktop) and HAS (mobile) for secure, serverless login.
- **Local Data Caching**: IndexedDB stores decrypted messages and conversation metadata for instant loading and offline access.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` to communicate directly with public Hive RPC nodes.
- **PWA Features**: Manifest for installability, Service Worker for offline support and asset caching, protocol handler for mobile auth deep linking.
- **Message Encryption**: All messages are encrypted client-side before being broadcast to the blockchain, ensuring privacy.
- **Conversation Discovery**: Achieved by scanning blockchain transactions for unique communication partners.

### Feature Specifications
- End-to-end encrypted messaging.
- Real-time message synchronization with the blockchain.
- Offline message browsing of cached data.
- Selective local conversation deletion for privacy.
- Detection and recovery for double-encrypted messages.
- PWA installable on mobile and desktop.
- No private keys are ever transmitted or stored by the application.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain browser extension integration.
- **hive-auth-wrapper**: For HAS mobile authentication.
- **idb**: IndexedDB wrapper for local caching.
- **qrcode**: For QR code generation in mobile authentication.

### Blockchain Infrastructure
- **Hive Blockchain**: The primary decentralized storage for messages.
- **Public RPC Nodes**:
    - `https://api.hive.blog`
    - `https://api.hivekings.com`
    - `https://anyx.io`
    - `https://api.openhive.network`

### Authentication Services
- **Hive Keychain**: Browser extension for desktop authentication.
- **HAS (Hive Authentication Services)**: Mobile wallet authentication (e.g., Hive Keychain Mobile, HiveAuth Mobile App).