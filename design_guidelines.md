# Design Guidelines: Hive Encrypted Messaging Frontend

## Core Philosophy

**Hybrid Approach:** Signal-inspired security + Material Design system

**Principles:**
1. **Trust Through Transparency** - Visible encryption/blockchain status
2. **Efficiency First** - Minimize clicks to core actions
3. **Calm Interface** - Avoid visual noise
4. **Progressive Disclosure** - Hide advanced features intuitively

## Typography

**Fonts:**
- Primary: Inter (UI, messages)
- Monospace: JetBrains Mono (hashes, keys)

**Scale & Usage:**
- Display: 24px/32px, semibold (page titles)
- Headline: 20px/28px, semibold (headers, modals)
- Body Large: 16px/24px, regular (messages, primary content)
- Body: 14px/20px, regular (secondary text, timestamps)
- Caption: 12px/16px, medium (labels, status)
- Code: 13px/20px, regular (technical data)

**Weights:** Regular (400), Medium (500), Semibold (600)

## Layout & Spacing

**Tailwind Scale:** 2, 3, 4, 6, 8, 12, 16
- Micro (internals): 2, 3
- Standard (between elements): 4, 6
- Section (major blocks): 8, 12, 16

**Responsive Grid:**
- **Desktop (1024px+):** Left sidebar 280px | Main chat (flex-1) | Right sidebar 320px (collapsible)
- **Tablet (768-1023px):** Left sidebar 240px | Main chat (flex-1)
- **Mobile (<768px):** Single column, bottom tabs, slide-over contacts

**Constraints:**
- Max message width: 720px
- Min sidebar: 240px
- Mobile: full-bleed conversations

## Components

### Navigation

**Left Sidebar:**
- Header: logo, username, Hive balance
- Search bar (full-width, rounded-lg)
- Contact list: 40px avatar, name (truncate), preview (1 line, muted), timestamp, unread badge, lock icon
- Bottom: New Message button (primary), Settings icon

**Top Bar:**
- Avatar + name (headline)
- "E2E Encrypted" badge with lock
- Actions: search, menu, blockchain sync indicator

### Messages

**Bubbles:**
- **Outgoing:** Right-aligned, 16px radius (TL, TR, BL), 4px (BR), padding 12px 16px, max-width 480px
- **Incoming:** Left-aligned, 16px radius (TL, TR, BR), 4px (BL), padding 12px 16px, max-width 480px
- Typography: body large, subtle shadow
- Metadata: timestamp (caption), delivery status (spinner/single check/double check), lock icon

**Grouping:**
- Consecutive messages grouped
- Timestamp every 5min or sender change
- Avatar only on first in group

**System Messages:** Centered, caption, no bubble (e.g., "Encryption key exchanged")

### Input

**Message Composer (fixed bottom):**
- Multi-line textarea (auto-expand, max 5 lines)
- Placeholder: "Type a message..."
- Left: attach, emoji icons
- Right: send button (active on text)
- Bottom notice: "Messages are end-to-end encrypted"

### Modals & Drawers

**New Message Modal:**
- Max-width 480px, centered
- Searchable contact list with Hive autocomplete
- Public key validation
- Footer: Cancel, Start Chat buttons

**Profile Drawer (right):**
- 120px avatar
- Username, public key (truncated, copy button)
- Encryption details, transaction history (last 10)
- Actions: Block, Report, View on blockchain

**Settings Panel:** Account, Security, Notifications, Appearance, About sections

### Lists

**Contact Item (72px height):**
- Layout: [40px avatar] [Name + Preview + Timestamp] [Badge + Status]
- States: hover, active/selected, unread (bold + badge)

**Transaction Item (56px):**
- Icon (arrow), amount, timestamp, block number, status

### Indicators

**Encryption Badge:** Lock icon + "Encrypted" | Variants: Active, Unencrypted (warning), Key Exchange
**Blockchain Sync:** Dot + text | States: Syncing (pulse), Synced, Error
**Unread Badge:** Circular, numeric (1-99+), positioned on avatar
**RC Warning:** Banner below input with dismiss

### Forms

**Inputs:**
- Height 44px, rounded-lg, padding 12px 16px
- Label above (caption), helper text below
- Focus/error states with border changes

**Buttons:**
- Primary/Secondary: 44px desktop, 48px mobile, padding 12px 24px, radius 8px, medium weight
- Icon: 40px square, rounded-lg, 20px icon

### Empty States

**No Conversations:** Illustration, "No Messages Yet", "Start a conversation...", "New Message" CTA
**No Results:** Icon, "No conversations found", suggestions

## Interactions

**Send Flow:**
1. Type → Send activates
2. Click → Optimistic UI (sending status)
3. Encrypt + broadcast → "sent" (single check)
4. Poll confirmation → "confirmed" (double check)

**Polling:** 30s intervals, pulse on sync indicator, new messages slide-in (100ms) + sound

**Transitions:**
- Conversation switch: instant
- Modals: fade + scale (150ms ease-out)
- Sidebar: slide (200ms)

**Loading:** Skeleton screens, spinner for history scroll, inline for key exchange

## Accessibility

**Keyboard:**
- Tab order: Search → Contacts → Chat → Input → Send
- Arrows: navigate lists
- Escape: close modals/clear search
- Enter: send/select

**Screen Reader:**
- ARIA labels on icon buttons
- role="log" on messages with live announcements
- Skip links to input

**Contrast:** WCAG AA (4.5:1 normal, 3:1 large), 2px focus rings
**Touch:** 44px minimum targets, 8px spacing

## Responsive

- **Desktop (1280px+):** 3-column, right sidebar open, 480px bubbles
- **Tablet:** 2-column, collapsible sidebar, 70% bubbles
- **Mobile:** Single column, bottom nav, FAB new message, swipe gestures

## Security Indicators

**Hierarchy:**
1. Top bar encryption badge (always visible)
2. Message lock icon (first in group)
3. Profile drawer details (public key)

**Blockchain:**
- Copy transaction ID from context menu
- Link to block explorer
- Confirmation count display

**Warnings:**
- Unencrypted: modal before send
- Key mismatch: banner alert
- Low RC: inline with staking instructions

## Progressive Features

**Hidden by Default:** Group messaging (overflow menu), file sharing (attachment click), blockchain details (context menu), custom node (Settings → Advanced)

**Discovery:** First-time tooltips, onboarding checklist (integrate Keychain, verify encryption, send first message)

---

**Token count target:** <2000 | **Focus:** Actionable specs for developers building secure, accessible blockchain messaging