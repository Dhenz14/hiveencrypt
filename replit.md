# Hive Messenger - Encrypted Blockchain Messaging

## Overview
Hive Messenger is an end-to-end encrypted messaging application built on the Hive blockchain. It leverages Hive's native memo encryption feature to enable secure, decentralized communication between users. Its core purpose is to provide a censorship-resistant, privacy-focused messaging solution that utilizes the blockchain as a single source of truth, eliminating the need for centralized servers for message storage.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## System Architecture

### V2.0 Decentralized Architecture (Current Development Version)
This version eliminates centralized database dependencies by using the Hive blockchain as the single source of truth. Messages are queried directly from the blockchain and cached in the browser using IndexedDB for instant access.

**Key Components:**
- **IndexedDB Client-Side Cache**: Stores decrypted messages locally, enables instant display, provides conversation indexing, and includes automatic cache management.
- **Blockchain Querying**: Direct queries to the Hive blockchain via `@hiveio/dhive` to filter for encrypted transfers, discover conversations, and facilitate decryption via Hive Keychain.
- **Smart Polling Hooks**: `useBlockchainMessages` fetches messages for a conversation, and `useConversationDiscovery` scans the blockchain for conversation partners. It uses adaptive polling (15s active, 30s background) and automatic cache synchronization.

**Messaging Flow (V2.0):**
1.  **Send Message**: Optimistic update to IndexedDB, message encrypted via Hive Keychain, 0.001 HBD transfer broadcast with encrypted memo, and confirmation with blockchain transaction ID. Sent message plaintext is cached before encryption.
2.  **Receive Messages**: App polls account history for encrypted transfers. New received messages are stored as encrypted placeholders and require manual decryption via Hive Keychain. Decrypted content is cached in IndexedDB.
3.  **Historical Messages**: Both sent and received messages can be decrypted using the user's memo key via Hive Keychain. PeakD proves this works - users can decrypt their own sent messages. Messages display with a decrypt button, remaining encrypted until user interaction.
4.  **Conversation Discovery**: Scans recent transactions to identify unique conversation partners and build a conversation list from cached message metadata.

**Data Flow:**
The client-side browser, utilizing React UI, TanStack Query, IndexedDB, and Hive Keychain, makes direct API calls to the Hive Blockchain, which serves as the immutable, permanent, and decentralized storage for all encrypted messages.

**Benefits of V2.0:**
-   Zero server storage costs
-   True decentralization and censorship resistance
-   Offline access via IndexedDB
-   Client-side message decryption ensuring privacy
-   Instant UX with optimistic updates
-   User data ownership

### Frontend Technology Stack:
-   React with TypeScript
-   Wouter for routing
-   TanStack Query for data management
-   Tailwind CSS for styling
-   Shadcn UI components
-   Hive Keychain SDK for authentication

### Backend Technology Stack:
-   Express.js server
-   In-memory storage (MemStorage)
-   @hiveio/dhive for blockchain API calls

### Security Considerations:
-   **Authentication**: Server-side session validation, Keychain signature verification, secure session tokens (256-bit random hex with 7-day expiry), protected endpoints, and no client-side trust (localStorage only stores session token).
-   **Encryption**: Messages encrypted before blockchain submission using Hive memo encryption (ECDH key exchange + AES-CBC). Default encryption uses 'Memo' key type. Decryption handled via Hive Keychain's native browser extension API.
-   **Memo Decryption**: Uses `window.hive_keychain.requestVerifyKey(username, encryptedMemo, keyType, callback)` - the EXACT method PeakD uses for decrypting memos. Implements intelligent key type fallback: tries 'Memo' first (default), then 'Posting' if result is gibberish. This handles messages encrypted with different key types across Hive dApps. Uses readability heuristic (printable chars >80%, vowels, spaces) to detect successful decryption. The user's private key never leaves the Keychain extension. Users see a Keychain popup to confirm decryption for each message.
-   **Response Structure**: The requestVerifyKey callback receives `{ success: boolean, result: string, ... }` where `result` contains the decrypted plaintext.
-   **Known Keychain Warning**: When sending messages, Hive Keychain may display a "private key" security warning. **This is a FALSE POSITIVE** caused by pattern detection in the encrypted memo data. The application NEVER sends private keys - only encrypted message content. The warning appears because encrypted data can contain character patterns that resemble private keys. This is Keychain being cautious, which is good, but the warning can be safely dismissed.

## External Dependencies
-   **Hive Blockchain**: Core platform for message storage and decentralization.
-   **Hive Keychain**: Browser extension for secure authentication, encryption, and transaction signing.
-   **@hiveio/dhive**: JavaScript library for interacting with the Hive blockchain.
-   **Express.js**: Backend web application framework.
-   **React**: Frontend JavaScript library for building user interfaces.
-   **Wouter**: A minimalist React router.
-   **TanStack Query**: Data-fetching library for React.
-   **Tailwind CSS**: Utility-first CSS framework for styling.
-   **Shadcn UI**: UI component library.