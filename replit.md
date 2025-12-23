# Hive Messenger - Decentralized Encrypted Blockchain Messaging PWA

## Overview
Hive Messenger is a decentralized, end-to-end encrypted messaging Progressive Web App (PWA) built on the Hive blockchain. It provides a censorship-resistant communication platform without centralized servers or databases. The project aims to deliver a free, private, and reliable messaging solution that is globally accessible and resilient against central points of failure. Key capabilities include end-to-end encryption via Hive memo keys, Hive Keychain authentication, messages sent via memo transfers, and bidirectional Lightning Network Bitcoin tips via the v4v.app bridge.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes. I prefer detailed explanations.

## Deployment Requirements (MANDATORY)
- **CRITICAL: Agent MUST push to GitHub automatically after every code change - NEVER ask user to push manually**
- **Production URL**: https://dhenz14.github.io/hiveencrypt/
- **Deployment Method**: GitHub Pages (static hosting from `gh-pages` branch)
- **Build Command**: `npm run build` generates static files in `dist/` folder

### How Agent Pushes to GitHub
1. Run: `npx tsx scripts/push-to-github.ts "Your commit message"`
2. This script automatically:
   - Gets the GitHub access token from Replit's GitHub connection
   - Stages all changes with `git add -A`
   - Commits with the provided message
   - Force pushes to origin main

### If Git Lock Error Occurs
If you see "index.lock: File exists", run in Shell: `rm -f .git/index.lock`
Then retry the push command.

### Alternative Direct Push (if script fails)
```bash
TOKEN=$(npx tsx -e "
const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
const xReplitToken = process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : null;
fetch('https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github', {
  headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken }
}).then(r => r.json()).then(d => {
  const s = d.items?.[0]?.settings;
  console.log(s?.access_token || s?.oauth?.credentials?.access_token);
});
" 2>/dev/null) && git push https://x-access-token:${TOKEN}@github.com/Dhenz14/hiveencrypt.git main
```

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
- **Group Chat System**: Decentralized group messaging with operations stored on the Hive blockchain as `custom_json`. Includes group creation, membership management, memo-pointer protocol for discovery, paid groups, and a self-service join system with multiple approval paths. Security measures include creator-only approval for join requests and client-side payment verification.
- **Performance Optimizations**: Token Bucket Rate Limiter, LRU Memo Cache with TTL (2000 entries, 10min TTL), Decryption with Retry, Query Cancellation, Optimistic Updates, synchronous ref-based guards for race condition prevention, Block Streaming for real-time updates (<3s latency), Batch RPC Calls for parallel account history fetching, Bitwise Operation Filtering to reduce data transfer by ~40%, and Batched Keychain Operations for group invites (reduces prompts by ~50%).

### Feature Specifications
- **Text Messaging**: End-to-end encrypted messages via memo transfers.
- **Group Chats**: Decentralized group messaging with multiple participants, including creation, management, custom naming, batch messaging, and a memo-pointer protocol for scalable discovery.
- **Paid Groups**: Monetization feature allowing creators to charge for group access using HBD payments with automatic verification.
- **Self-Service Join System**: Hybrid auto-approve and manual approval workflows for group access.
- **Lightning Network Tips**: Send Bitcoin satoshis via the Lightning Network to users with Lightning Addresses, supporting bidirectional tipping and encrypted notifications.
- **Privacy Controls**: Hive Following-based privacy settings for messages and group invites, stored on the Hive blockchain.
- **Real-time Sync**: Message synchronization and offline browsing of cached data.
- **PWA**: Installable on mobile and desktop.
- **Security**: No private keys are ever transmitted or stored by the application.
- **Creator Tools (Priority 2 & 3)**:
  - **Earnings Dashboard**: View payment history and revenue metrics across all paid groups.
  - **Creator Analytics**: Member activity charts, growth metrics, and engagement statistics.
  - **Promotion Tools**: Shareable links, social sharing buttons, and referral tracking with discount codes.
  - **Group Preview Pages**: Public landing pages for groups with referral parameter handling.
  - **Group Settings Modal**: Manage payment settings (enable/disable, recurring intervals), auto-approval settings, welcome messages, and danger zone actions.
  - **Notification Center**: Centralized notification hub tracking payments, expiries, join requests, and member activity with localStorage persistence.
  - **Broadcast Messaging**: Send messages to all group members simultaneously.
  - **Pinned Messages Bar**: Pin important announcements that display at the top of group chats.
  - **Automated Expired Member Management**: Auto-detect expired subscriptions with alerts for creators to remove members.

### System Design Choices
- **Decentralized Storage**: Hive blockchain.
- **Client-Side Logic**: No backend servers or databases.
- **Security**: Memo encryption and secure authentication; private keys never leave Keychain.
- **Performance Optimizations**: Multi-layer optimization strategy including IndexedDB caching, LRU in-memory memo cache, parallel decryption, adaptive polling, block streaming for real-time message detection, batch RPC calls, and bitwise operation filtering.
- **Zero Centralization**: All operations are client-side with direct Hive RPC node communication.

## External Dependencies

### Core Libraries
- **@hiveio/dhive**: JavaScript client for Hive blockchain API.
- **keychain-sdk**: For Hive Keychain integration.
- **idb**: IndexedDB wrapper for local caching.

### Blockchain Infrastructure
- **Hive Blockchain**: Primary decentralized storage.
- **Public RPC Nodes** (ordered by reliability from beacon.peakd.com):
  1. `https://api.hive.blog` - Official (100% score)
  2. `https://api.deathwing.me` - 100% score
  3. `https://api.openhive.network` - 100% score
  4. `https://techcoderx.com` - 100% score
  5. `https://hiveapi.actifit.io` - 100% score
  6. `https://rpc.mahdiyari.info` - 100% score
  7. `https://api.syncad.com` - 100% score
- **RPC Failover System**: All fetch calls use 5-second AbortController timeouts. If a node times out or returns an error, the system automatically tries the next node in the list. Node health is monitored at https://beacon.peakd.com/
- **Hedged Parallel Requests**: For speed-critical operations (group discovery, publish checks), the system fires requests to the top 3 nodes simultaneously with 2-second timeouts, using whichever responds first. Falls back to sequential requests to remaining nodes if all parallel requests fail.

### Authentication Services
- **Hive Keychain**: Universal authentication solution.

### Lightning Network Services
- **V4V.app**: Bidirectional bridge service for Bitcoin tips (HBD ↔ Lightning).
- **LNURL Protocol**: Decentralized Lightning Address infrastructure.
- **CoinGecko API**: Real-time Bitcoin price data for exchange rate calculations.

## Known Technical Behaviors (Intentional)

### Console Warnings (Expected)
- **Module externalization warnings** from `lnurl-pay.js`: Warnings about `util.debuglog`, `util.inspect`, and `stream.Transform` are expected. The `lnurl-pay` library uses Node.js built-in modules that don't exist in browsers. Vite externalizes these modules for browser compatibility. **These warnings do not affect functionality** - the Lightning tip feature works correctly despite them.

### Double-Encryption Handling
- **Intentional design**: Some older messages or messages from certain systems may be double-encrypted (encrypted memo wrapped in another encrypted memo). The decryption logic in `client/src/lib/hive.ts` automatically detects this and performs up to 2 decryption passes. This is handled gracefully with a recursion limit to prevent infinite loops.

### RPC Rate Limiting Recovery
- **Automatic recovery**: When all Hive RPC nodes are temporarily marked unhealthy (due to rate limiting), the system automatically resets health stats and retries. The log message `All nodes marked unhealthy, resetting health stats` indicates this recovery mechanism is working.

### Query Cancellation
- **React Query behavior**: The `[QUERY CANCELLED]` log messages indicate React Query is properly canceling stale queries when components unmount or when queries are invalidated. This is expected behavior and the system gracefully returns cached data.

## Blockchain Explorers
- **Hivescan.info**: Used for transaction verification links (built by the Hive Messenger team).

## Future Optimization Considerations (P2)

### HAF Query Service
HAF (Hive Application Framework) provides 2x-70x faster queries than direct RPC for indexed blockchain data. When scaling becomes necessary:
- **Public HAF Servers**: Multiple community-operated HAF nodes available for queries
- **Use Cases**: Group chat discovery, message history retrieval, transaction lookups
- **Architecture Consideration**: Current approach uses group creation posts as metadata anchors. HAF could accelerate discovery via SQL queries on indexed custom_json operations.
- **Trade-off**: Adds external dependency vs. current fully decentralized client-side approach

### Additional Optimizations Evaluated
- **@splinterlands/hive-interface**: Evaluated but current `hiveClient.ts` already implements equivalent browser-optimized multi-node failover with health scoring
- **Background Sync Worker**: Keychain decryption requires main thread access; current LRU caching and deduplication provide similar benefits