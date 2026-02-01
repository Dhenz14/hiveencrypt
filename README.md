# Hive Messenger

**Decentralized End-to-End Encrypted Messaging on the Hive Blockchain**

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen?style=for-the-badge)](https://dhenz14.github.io/hiveencrypt/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Hive Blockchain](https://img.shields.io/badge/Built%20on-Hive-E31337?style=for-the-badge)](https://hive.io)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge)](https://dhenz14.github.io/hiveencrypt/)

---

## Overview

Hive Messenger is a **100% decentralized**, censorship-resistant messaging application built as a Progressive Web App (PWA). It leverages the Hive blockchain for message storage and delivery, ensuring that no central authority can read, censor, or delete your messages.

**Your keys, your messages, your privacy.**

### Why Hive Messenger?

| Traditional Messengers | Hive Messenger |
|------------------------|----------------|
| Messages stored on company servers | Messages stored on decentralized blockchain |
| Company can read your messages | End-to-end encrypted with YOUR keys |
| Can be censored or shut down | Censorship-resistant and unstoppable |
| Requires email/phone signup | Just need a Hive account |
| Company controls your data | You control everything |

---

## Live Demo

**Try it now:** [https://dhenz14.github.io/hiveencrypt/](https://dhenz14.github.io/hiveencrypt/)

**Requirements:**
- A [Hive blockchain account](https://signup.hive.io/)
- [Hive Keychain](https://hive-keychain.com/) browser extension or mobile app

---

## Features

### Core Messaging
- **End-to-End Encryption** - Messages encrypted client-side using Hive memo keys (ECDH + AES-256-CBC)
- **1:1 Private Messages** - Secure direct messaging between any two Hive accounts
- **Group Chats** - Decentralized group messaging with unlimited members
- **Offline Support** - Read cached messages without internet connection
- **Real-time Sync** - Adaptive polling for near-instant message delivery

### Group Chat Features
- **Create & Manage Groups** - Full group administration controls
- **Paid Groups** - Monetize your community with HBD entry fees
- **Auto-Approve System** - Automatic member approval for paid groups
- **Manual Approval** - Review and approve join requests manually
- **Public Discovery** - List groups for others to find and join
- **Tag-Based Search** - Find groups by topic, interest, or category
- **Group Preview Pages** - Shareable public previews of your groups
- **Broadcast Messages** - Send announcements to all members
- **Pinned Messages** - Highlight important information
- **Member Management** - Add, remove, and manage group members

### Creator Tools
- **Earnings Dashboard** - Track HBD revenue from paid groups
- **Creator Analytics** - View member growth and engagement
- **Promotion Tools** - Referral tracking and promotional features
- **Notification Center** - Stay updated on group activity
- **Automated Expiry** - Auto-remove expired members from paid groups

### Lightning Network Integration
- **Bitcoin Tips** - Send satoshis to any Lightning Address
- **Bidirectional Tipping** - Receive tips via V4V.app bridge
- **Real-time Exchange Rates** - Live BTC/USD pricing via CoinGecko
- **Encrypted Notifications** - Private tip notifications

### Privacy & Security
- **Hive Following Integration** - Control who can message you
- **Minimum HBD Requirements** - Economic anti-spam protection
- **No Data Collection** - Zero tracking, zero analytics, zero surveillance
- **Open Source** - Full transparency, audit the code yourself

### PWA Features
- **Installable** - Add to home screen on any device
- **Offline Capable** - Service worker caches for offline access
- **Cross-Platform** - Works on desktop, tablet, and mobile
- **Responsive Design** - Optimized for all screen sizes

---

## Architecture

Hive Messenger operates with **zero backend servers**. All logic runs client-side in your browser.

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   React UI   │  │  IndexedDB   │  │   Hive Keychain      │   │
│  │   (Shadcn)   │  │  (Cache)     │  │   (Auth + Signing)   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                     │               │
│         └─────────────────┼─────────────────────┘               │
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HIVE BLOCKCHAIN                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  RPC Nodes   │  │   Memo       │  │   Custom JSON        │   │
│  │  (6 nodes)   │  │   Transfers  │  │   Operations         │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Authentication**: Hive Keychain provides secure key management
2. **Message Sending**: Messages encrypted locally, sent as memo transfers
3. **Message Receiving**: Blockchain scanned for incoming transfers, decrypted locally
4. **Caching**: Decrypted messages cached in IndexedDB for offline access
5. **Groups**: Managed via `custom_json` operations with memo-pointer protocol

---

## Technology Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Tailwind CSS | Styling |
| Shadcn UI | Component library |
| TanStack Query | Data fetching & caching |
| Wouter | Routing |
| Framer Motion | Animations |

### Blockchain
| Technology | Purpose |
|------------|---------|
| @hiveio/dhive | Hive blockchain client |
| keychain-sdk | Hive Keychain integration |
| hivecrypt | Memo encryption/decryption |

### Storage & Caching
| Technology | Purpose |
|------------|---------|
| IndexedDB (idb) | Local message cache |
| LRU Cache | In-memory performance cache |
| Service Worker | Offline support |

### External Services
| Service | Purpose |
|---------|---------|
| Hive RPC Nodes | Blockchain access |
| V4V.app | Lightning Network bridge |
| CoinGecko API | BTC price data |
| Hivescan.info | Transaction explorer |

---

## Getting Started

### Prerequisites

1. **Hive Account** - [Create one here](https://signup.hive.io/)
2. **Hive Keychain** - Install the browser extension:
   - [Chrome/Brave](https://chrome.google.com/webstore/detail/hive-keychain/jcacnejopjdphbnjgfaaobbfafkihpep)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/hive-keychain/)
   - [Mobile Apps](https://hive-keychain.com/)

### Using Hive Messenger

1. Visit [https://dhenz14.github.io/hiveencrypt/](https://dhenz14.github.io/hiveencrypt/)
2. Click "Connect with Keychain"
3. Approve the connection in Hive Keychain
4. Start messaging!

### Local Development

```bash
# Clone the repository
git clone https://github.com/Dhenz14/hiveencrypt.git
cd hiveencrypt

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## How It Works

### Message Encryption

Hive Messenger uses Hive's native memo encryption, which implements:

1. **ECDH Key Exchange** - Derives shared secret from sender's private key and recipient's public key
2. **AES-256-CBC** - Encrypts message content with derived key
3. **Checksum Verification** - Ensures message integrity

```
Sender's Private Key + Recipient's Public Key = Shared Secret
                              ↓
              Message + Shared Secret = Encrypted Memo
                              ↓
                   Sent as HBD/HIVE Transfer
                              ↓
Recipient's Private Key + Sender's Public Key = Same Shared Secret
                              ↓
              Encrypted Memo + Shared Secret = Decrypted Message
```

**Only the sender and recipient can decrypt messages** - not even Hive Messenger can read them.

### 1:1 Messaging Flow

1. User composes message in the UI
2. Message encrypted using recipient's memo public key
3. Encrypted memo attached to minimum HBD transfer (0.001 HBD)
4. Transaction broadcast to Hive blockchain
5. Recipient's client scans for incoming transfers
6. Encrypted memo decrypted using recipient's memo private key
7. Decrypted message cached in IndexedDB

### Group Chat Protocol

Groups use a combination of:

1. **Custom JSON Operations** - Store group metadata, membership, settings
2. **Memo-Pointer Protocol** - Reference group messages efficiently
3. **Batch Operations** - Optimize multi-recipient messaging

---

## Security Model

### What We NEVER Do

- Store private keys anywhere
- Send private keys over the network
- Access your keys directly (Hive Keychain handles all signing)
- Log or track your messages
- Store any data on servers

### What Hive Keychain Does

- Securely stores your private keys locally
- Signs transactions without exposing keys
- Encrypts/decrypts memos securely
- Provides secure authentication

### Encryption Details

| Aspect | Implementation |
|--------|----------------|
| Key Exchange | ECDH (Elliptic Curve Diffie-Hellman) |
| Encryption | AES-256-CBC |
| Key Derivation | SHA-512 |
| Message Integrity | Checksum verification |

---

## Privacy Controls

### Minimum HBD Requirement

Set a minimum HBD amount that others must send to message you. This economic barrier helps prevent spam while allowing genuine contacts through.

- Configure in Settings
- Range: 0.001 HBD to any amount
- Senders see warning if below minimum
- Higher amounts = stronger spam protection

### Hive Following Integration

Control who can message you based on your Hive social graph:

- **Allow Anyone** - Open to all messages
- **Following Only** - Only people you follow can message
- **Mutual Following** - Both must follow each other

---

## RPC Node Configuration

Hive Messenger connects to multiple public RPC nodes for reliability:

| Node | Provider |
|------|----------|
| api.hive.blog | BlockTrades (Official) |
| api.deathwing.me | Deathwing |
| api.openhive.network | OpenHive |
| hive-api.arcange.eu | Arcange |
| rpc.ecency.com | Ecency |
| anyx.io | Anyx |

### Failover System

- Automatic node rotation on failures
- Health tracking and prioritization
- Hedged parallel requests for critical operations
- Exponential backoff on errors

---

## Performance Optimizations

| Optimization | Benefit |
|--------------|---------|
| Adaptive Polling | Faster after sending, slower when idle |
| IndexedDB Caching | Instant message loading |
| LRU Memo Cache | Reduced decryption overhead |
| Parallel Decryption | Faster bulk message processing |
| Batch RPC Calls | Reduced network requests |
| Query Cancellation | Clean resource management |
| Optimistic Updates | Instant UI feedback |

### Polling Strategy

| State | Interval | Purpose |
|-------|----------|---------|
| Burst (after send) | 3s for 15s | Show sent message instantly |
| Active tab | 4s | Real-time messaging feel |
| Idle | 10s | Balance speed vs resources |
| Background tab | 20s | Conserve resources |

---

## Contributing

We welcome contributions! Here's how to help:

### Ways to Contribute

1. **Report Bugs** - Open an issue with reproduction steps
2. **Suggest Features** - Share your ideas in issues
3. **Submit PRs** - Fix bugs or add features
4. **Improve Docs** - Help others understand the project
5. **Spread the Word** - Tell others about Hive Messenger

### Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/hiveencrypt.git
cd hiveencrypt

# Install dependencies
npm install

# Create a branch
git checkout -b feature/your-feature

# Make changes and test
npm run dev

# Submit PR
```

### Code Style

- TypeScript for type safety
- Functional React components with hooks
- Shadcn UI components
- Tailwind CSS for styling
- Clear, descriptive variable names
- Comments for complex logic

---

## FAQ

### Is this really decentralized?

Yes! There are no servers. The app is a static website that runs entirely in your browser. All data lives on the Hive blockchain.

### Can you read my messages?

No. Messages are encrypted client-side before ever leaving your browser. Only you and your recipient have the keys to decrypt.

### What if the website goes down?

The code is open source. Anyone can host it, or you can run it locally. Your messages remain safe on the blockchain.

### Does messaging cost money?

Minimal. Messages require tiny HBD transfers (0.001 HBD minimum). Group operations use free `custom_json` transactions (just Resource Credits).

### How is this different from Hive chat apps?

Most Hive chat apps use centralized servers for message delivery. Hive Messenger uses only the blockchain - no servers, no databases, no central points of failure.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Hive Blockchain](https://hive.io) - Decentralized infrastructure
- [Hive Keychain](https://hive-keychain.com) - Secure key management
- [BlockTrades](https://blocktrades.us) - RPC node infrastructure
- [V4V.app](https://v4v.app) - Lightning Network bridge
- [Shadcn UI](https://ui.shadcn.com) - Beautiful components
- All the node operators keeping Hive decentralized

---

## Support

- **Issues**: [GitHub Issues](https://github.com/Dhenz14/hiveencrypt/issues)
- **Hive**: [@dhenz14](https://peakd.com/@dhenz14)

---

<p align="center">
  <strong>Built with privacy in mind. Powered by Hive.</strong>
</p>
