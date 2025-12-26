# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform without centralized servers or databases. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, bidirectional Lightning Network Bitcoin tips, and decentralized group chats.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture
Hive Messenger operates as a 100% decentralized React PWA, leveraging the Hive blockchain as the single source of truth and IndexedDB for client-side message caching. Authentication is exclusively via Hive Keychain, with direct interaction with public Hive blockchain RPC nodes. Messages are end-to-end encrypted client-side using Hive memo encryption. The PWA supports offline functionality, installability, and cross-platform compatibility.

### UI/UX Decisions
- **Responsive Design**: Mobile-first with single-view mobile and split-view desktop layouts.
- **Theming**: Dark mode support.
- **Component Library**: Shadcn UI.
- **Touch-Friendly UI**: 44px+ touch targets and iOS safe-area padding.

### Technical Implementations
- **Client-Side Authentication**: Exclusively uses Hive Keychain.
- **Local Data Caching**: IndexedDB for decrypted messages and metadata.
- **Direct Blockchain Interaction**: Uses `@hiveio/dhive` for direct RPC node communication.
- **PWA Features**: Manifest and Service Worker for offline support.
- **Message Encryption**: Client-side ECDH + AES-256-CBC encryption.
- **Conversation Discovery**: Scans blockchain transactions for communication partners.
- **Economic Anti-Spam**: Configurable minimum HBD requirements for incoming messages.
- **Hive Following Integration**: Native integration with Hive's follow system for privacy controls.
- **Group Chat System**: Decentralized group messaging via `custom_json` operations, supporting creation, membership, memo-pointer protocol for discovery, paid groups, and self-service joining.
- **Performance Optimizations**: Token Bucket Rate Limiter, LRU Memo Cache with TTL, Decryption with Retry, Query Cancellation, Optimistic Updates, Block Streaming, Batch RPC Calls, Bitwise Operation Filtering, and Batched Keychain Operations.

### Feature Specifications
- **Text Messaging**: End-to-end encrypted via memo transfers.
- **Group Chats**: Decentralized group messaging with creation, management, custom naming, batch messaging, and a memo-pointer protocol.
- **Paid Groups**: Monetization feature allowing HBD payments for access with automatic verification.
- **Self-Service Join System**: Hybrid auto-approve and manual approval workflows for group access.
- **Lightning Network Tips**: Send Bitcoin satoshis via Lightning Network to Lightning Addresses, supporting bidirectional tipping and encrypted notifications.
- **Privacy Controls**: Hive Following-based privacy settings for messages and group invites.
- **Real-time Sync**: Message synchronization and offline browsing.
- **Security**: No private keys are ever transmitted or stored by the application.
- **Creator Tools**: Earnings Dashboard, Creator Analytics, Promotion Tools, Group Preview Pages, Group Settings Modal, Notification Center, Broadcast Messaging, Pinned Messages Bar, and Automated Expired Member Management.

### System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication; private keys never leave Keychain.
- **Performance Optimizations**: Multi-layer strategy including IndexedDB caching, LRU in-memory cache, parallel decryption, adaptive polling, block streaming, batch RPC calls, and bitwise operation filtering.
- **Zero Centralization**: All operations are client-side with direct Hive RPC node communication.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes**: A set of public Hive RPC nodes are used with a failover system for resilience.
- **RPC Failover System**: Automatically retries requests on different nodes if timeouts or errors occur.
- **Hedged Parallel Requests**: For critical operations, requests are sent to multiple top nodes simultaneously.

### Authentication Services
- **Hive Keychain**: Universal authentication solution for Hive.

### Lightning Network Services
- **V4V.app**: Bidirectional bridge service for Bitcoin tips (HBD ↔ Lightning).
- **LNURL Protocol**: Decentralized Lightning Address infrastructure.
- **CoinGecko API**: Real-time Bitcoin price data for exchange rate calculations.

### Blockchain Explorers
- **Hivescan.info**: Used for transaction verification links.