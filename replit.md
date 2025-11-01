# Hive Messenger - Encrypted Blockchain Messaging

## Overview
Hive Messenger is an end-to-end encrypted messaging application built on the Hive blockchain. It leverages Hive's native memo encryption feature to enable secure, decentralized communication between users.

## Features
- **End-to-End Encryption**: Messages are encrypted using Hive's ECDH + AES-CBC encryption
- **Blockchain-Backed**: All messages are stored encrypted on the Hive blockchain
- **Keychain Integration**: Secure authentication via Hive Keychain browser extension
- **No Server Storage**: Your keys never leave your browser
- **Dark Mode**: Beautiful light and dark themes
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile

## Tech Stack
### Frontend
- React with TypeScript
- Wouter for routing
- TanStack Query for data management
- Tailwind CSS for styling
- Shadcn UI components
- Hive Keychain SDK for authentication

### Backend
- Express.js server
- In-memory storage (MemStorage)
- @hiveio/dhive for blockchain API calls

## Architecture
### Authentication Flow
1. User enters Hive username
2. Frontend requests Keychain signature via requestSignBuffer
3. Keychain signs a timestamped login message with user's posting key
4. Frontend sends signature + public key to backend for verification
5. Backend validates signature using @hiveio/dhive crypto
6. Backend generates secure session token (256-bit random hex)
7. Session token stored server-side with 7-day expiry
8. Frontend stores only session token in localStorage
9. All subsequent requests include session token in Authorization header
10. Backend validates token on each request to protected endpoints

### Messaging Flow
1. User composes message in UI
2. Message encrypted using recipient's public memo key
3. Encrypted memo attached to micro-transfer (0.001 HBD)
4. Transaction broadcast to Hive blockchain via Keychain
5. Messages retrieved by polling account history
6. Encrypted memos decrypted for display

### Data Models
- **Conversation**: Tracks chat sessions with contacts
- **Message**: Individual encrypted messages with metadata
- **Contact**: User profiles with public encryption keys
- **UserSession**: Authenticated user state

## Key Files
### Frontend
- `client/src/pages/Login.tsx` - Authentication page
- `client/src/pages/Messages.tsx` - Main messaging interface
- `client/src/lib/hive.ts` - Hive blockchain integration
- `client/src/lib/encryption.ts` - Encryption utilities
- `client/src/contexts/AuthContext.tsx` - Authentication state
- `client/src/contexts/ThemeContext.tsx` - Theme management

### Backend
- `server/routes.ts` - API endpoints with authentication
- `server/auth.ts` - Session management and signature verification
- `server/storage.ts` - In-memory data storage
- `shared/schema.ts` - Shared TypeScript types

### Components
- `ConversationsList.tsx` - Sidebar contact list
- `ChatHeader.tsx` - Conversation header
- `MessageBubble.tsx` - Message display
- `MessageComposer.tsx` - Message input
- `NewMessageModal.tsx` - Start new conversation
- `ProfileDrawer.tsx` - Contact profile view
- `SettingsModal.tsx` - App settings

## Development Setup
1. Install Hive Keychain browser extension from https://hivekeychain.com
2. Create a Hive account at https://signup.hive.io
3. Run `npm install` to install dependencies
4. Run `npm run dev` to start development server
5. Open http://localhost:5000

## Security Considerations
### Authentication Security
- **Server-Side Session Validation**: All sessions validated against backend on restore
- **Keychain Signature Verification**: Backend verifies cryptographic signatures from Hive Keychain
- **Secure Session Tokens**: 256-bit random tokens stored server-side with 7-day expiry
- **Protected Endpoints**: All user data endpoints require valid session token
- **No Client-Side Trust**: localStorage only stores session token, never user data
- **Anti-Spoofing**: Impossible to forge sessions by editing localStorage

### Encryption Security
- Private keys never stored in application
- All encryption/decryption handled by Hive Keychain
- Messages encrypted before blockchain submission
- Memo encryption uses ECDH key exchange + AES-CBC
- Public blockchain means metadata (sender/receiver) is visible

## Future Enhancements
- Group messaging with shared encryption keys
- File sharing via IPFS with hash in memo
- WebSocket integration for real-time updates
- Quantum-resistant encryption (Kyber-1024)
- Message search and filtering
- Custom Hive node selection
- Message notifications
- Read receipts
- Typing indicators

## Recent Changes
- 2025-11-01: **LOGIN UX FIX** - Improved authentication button robustness
  - **Button Always Clickable**: Removed pre-check disabled state based on Keychain detection
  - **Runtime Validation**: Keychain availability checked on button click, not page load
  - **Cross-Environment Support**: Works reliably in Replit preview, local dev, and production
  - **Better Error Messaging**: Clear toast notifications guide users to install Keychain
  - **User-Friendly**: Users can enter username even before Keychain detection completes

- 2025-11-01: **MESSAGE SENDING FLOW IMPLEMENTATION** - Complete Hive blockchain message sending with encryption
  - **Backend API Endpoints**:
    - POST /api/messages (protected with requireAuth): Accepts encrypted content and stores messages with txId
    - GET /api/conversations/:id/messages (protected with requireAuth): Returns messages for conversation
    - Full validation: user authentication, conversation existence, user participation
    - Automatic recipient user creation in database for foreign key references
  - **Frontend Message Encryption**:
    - MessageComposer.tsx updated with Hive Keychain integration
    - Step 1: Encrypt message using requestEncode with recipient's memo key
    - Step 2: Broadcast 0.001 HBD transfer with encrypted memo via requestTransfer
    - Step 3: Store message in database via API with blockchain txId
  - **Error Handling**: Comprehensive toast notifications for all error cases:
    - Keychain not available, user rejection, RC exhaustion, insufficient balance
    - Network errors, invalid recipients, encryption failures
  - **Message Display**:
    - Messages.tsx updated with TanStack Query for API data fetching
    - Loading states with skeletons
    - Empty state handling for no messages
    - Automatic refetch after new message sent
  - **Security**: Encrypted content stored in database, never decrypted server-side
  - **User Experience**: Real-time feedback, optimistic UI updates, proper loading states

- 2025-11-01: **CRITICAL SECURITY FIX** - Implemented proper authentication system
  - **Fixed Session Spoofing**: Session tokens now validated server-side on every restore
  - **Added Keychain Proof Validation**: Backend verifies cryptographic signatures from Hive Keychain
  - **Protected Endpoints**: POST /api/users now requires authentication
  - **Secure Session Management**: 256-bit random tokens with server-side storage and 7-day expiry
  - **New Authentication Endpoints**: POST /api/auth/login, GET /api/auth/verify, POST /api/auth/logout
  - **Created server/auth.ts**: Session management, token generation, signature verification
  - **Updated AuthContext**: Captures Keychain signatures, validates sessions with backend
  - **Eliminated localStorage Vulnerabilities**: Only session token stored, never user data

- 2025-01-11: Initial implementation with full MVP features
  - Complete frontend with Login, Messages, Settings
  - Hive Keychain integration for authentication
  - Dark mode support
  - Responsive design for mobile/tablet/desktop
  - Backend API routes for conversations and messages
  - In-memory storage implementation

## Project Structure
```
├── client/
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── contexts/       # React contexts (Auth, Theme)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── lib/            # Utilities (Hive API, encryption)
│   │   ├── pages/          # Route pages
│   │   └── App.tsx         # Root component
│   └── index.html
├── server/
│   ├── routes.ts          # API endpoints
│   ├── storage.ts         # Data storage interface
│   └── index.ts           # Server entry point
├── shared/
│   └── schema.ts          # Shared TypeScript types
└── design_guidelines.md   # UI/UX design specifications
```

## Notes
- This is a demonstration application showing Hive blockchain messaging capabilities
- For production use, implement proper error handling and edge case coverage
- Consider hybrid off-chain/on-chain approach for high-volume messaging
- Resource Credits (RC) on Hive limit transaction frequency
- 3-second block time + polling creates ~30s message latency
