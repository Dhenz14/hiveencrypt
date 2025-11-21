# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform without centralized servers or databases. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, and bidirectional Lightning Network Bitcoin tips via the v4v.app bridge.

## Recent Changes (November 21, 2025)
### Race Condition Fix: Double-Click Protection
- **Issue**: First message send attempt failed with "User ignored this transaction" error, worked on second attempt
- **Root Cause**: `isSending` state was set too late (after validation checks), allowing double-clicks to trigger duplicate Keychain popups
- **Solution**: Added `isSending` guard check at the **very beginning** of all three send handlers before any async validation:
  - `handleSubmit()` - Direct messages
  - `handleGroupSend()` - Group messages  
  - `handleImageSend()` - Image messages
- **Impact**: Prevents duplicate Keychain popups and "User ignored" errors from double-clicks

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
- **Lightning Network Tips**: Send Bitcoin satoshis via the Lightning Network to users with Lightning Addresses, supporting bidirectional tipping and encrypted notifications.
- **Privacy Controls**: Hive Following-based privacy settings for messages and group invites, stored on the Hive blockchain.
- Real-time message synchronization and offline browsing of cached data.
- PWA installable on mobile and desktop.
- No private keys are ever transmitted or stored by the application.

### System Design Choices
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