# Paid Groups Feature - Technical Guide

## Overview

Hive Messenger's paid groups feature allows group creators to monetize their communities by requiring members to pay a one-time or recurring fee in HBD (Hive Backed Dollar) to join and maintain access. This feature leverages the Hive blockchain's native payment infrastructure to provide a zero-fee, decentralized payment solution without requiring traditional payment gateways.

## Key Features

- **Zero Transaction Fees**: Uses native Hive blockchain transfers (no Stripe, PayPal, or third-party fees)
- **Fast Settlement**: 3-second blockchain confirmation times
- **One-Time Payments**: Single upfront payment for lifetime group access
- **Recurring Payments**: Automatic billing cycles (daily, weekly, monthly)
- **Automatic Verification**: On-chain payment validation without manual approval
- **Privacy-Preserving**: Payments tied to usernames, not real identities
- **Decentralized**: No centralized payment processor or backend server

## Architecture

### Data Schema

#### PaymentSettings Interface
```typescript
interface PaymentSettings {
  enabled: boolean;          // Whether payment is required
  amount: string;            // HBD amount (e.g., "5.000")
  type: 'one_time' | 'recurring';
  recurringInterval?: number; // Days between payments (7, 30, etc.)
  description?: string;      // Optional payment description
}
```

#### MemberPayment Interface
```typescript
interface MemberPayment {
  username: string;          // Member who paid (normalized lowercase)
  txId: string;              // Blockchain transaction ID
  amount: string;            // Amount paid in HBD
  paidAt: string;            // ISO timestamp of payment
  status: 'active' | 'expired';
  nextDueDate?: string;      // ISO timestamp for recurring payments
}
```

### Storage

Payment data is stored in three places:

1. **Blockchain** (Source of Truth):
   - Group metadata with payment settings in `custom_json` operations
   - Payment transactions as HBD transfers with special memos

2. **IndexedDB** (Local Cache):
   - `GroupConversationCache` stores `paymentSettings` and `memberPayments[]`
   - Enables instant access and offline functionality

3. **React Query Cache** (Runtime Memory):
   - In-memory cache for active group data
   - Automatically invalidates and refreshes from IndexedDB

## User Flows

### Creating a Paid Group

1. **Group Creator** opens GroupCreationModal
2. Enables "Require Payment" toggle
3. Configures payment settings:
   - Amount (minimum 0.001 HBD)
   - Type (one-time or recurring)
   - Recurring interval (if applicable)
   - Optional description
4. Clicks "Create Group" → broadcasts `custom_json` with payment metadata
5. Group created with payment requirements stored on blockchain

### Joining a Paid Group

1. **New Member** receives group invite (added by creator)
2. Opens group chat → PaymentGatewayModal appears
3. Views payment details:
   - Group name and creator
   - Payment amount and type
   - Recurring billing cycle (if applicable)
4. Clicks "Pay Now" → Hive Keychain popup
5. Approves HBD transfer with payment memo
6. System verifies payment on blockchain (3-5 seconds)
7. Payment record cached locally and member gains access

### Recurring Payment Renewal

1. **System checks payment status** when loading group conversations
2. `updateExpiredPayments()` marks expired payments based on `nextDueDate`
3. Members with expired payments see "Payment Due" badge
4. Member clicks to renew → PaymentGatewayModal
5. Completes payment → `processPaymentRenewal()` extends access
6. New `nextDueDate` calculated based on recurring interval

### Group Creator Management

1. **Creator** opens ManageMembersModal
2. Views payment statistics:
   - Total paid members
   - Active vs. expired payments
   - Upcoming renewals (next 7 days)
   - Total revenue
3. Sees payment status badge next to each member
4. Can manually verify payments on blockchain if needed

## Technical Implementation

### Payment Verification Flow

```typescript
// 1. Generate payment memo
const memo = generatePaymentMemo(groupId, username);
// Output: "group_payment:abc123|member:johndoe"

// 2. Request HBD transfer via Keychain
window.hive_keychain.requestTransfer(
  from: username,
  to: creatorUsername,
  amount: "5.000",
  memo: memo,
  currency: "HBD"
);

// 3. Wait for blockchain confirmation (3 seconds)
await sleep(3000);

// 4. Verify payment on blockchain
const result = await verifyPayment(
  username,
  creatorUsername,
  "5.000",
  groupId,
  maxAgeHours: 1
);

// 5. Create payment record
if (result.verified) {
  const payment = createMemberPaymentRecord(
    username,
    result.txId,
    "5.000 HBD",
    paymentSettings
  );
  
  // 6. Cache payment record
  await cacheGroupConversation({
    ...groupCache,
    memberPayments: [...memberPayments, payment]
  });
}
```

### Payment Status Checking

```typescript
// Check if member has access
const status = checkPaymentStatus(
  memberPayments,
  username,
  paymentSettings
);

// Returns:
{
  hasAccess: boolean,
  status: 'paid' | 'expired' | 'unpaid',
  nextDueDate?: string,
  daysUntilDue?: number
}
```

### Payment Statistics

```typescript
// Calculate group payment stats
const stats = getPaymentStats(memberPayments, paymentSettings);

// Returns:
{
  totalPaid: 15,              // Total members who paid
  totalActive: 12,            // Members with active payments
  totalExpired: 3,            // Members with expired payments
  upcomingRenewals: 5,        // Renewals due in next 7 days
  revenue: "75.000 HBD"       // Total revenue collected
}
```

## UI Components

### PaymentGatewayModal
- **Purpose**: Handle payment initiation and verification
- **Features**:
  - Displays payment amount and group info
  - Hive Keychain integration
  - Real-time verification progress (10% → 40% → 80% → 100%)
  - Success/failure feedback
- **Location**: `client/src/components/PaymentGatewayModal.tsx`

### PaymentStatusBadge
- **Purpose**: Visual payment status indicator
- **Variants**:
  - ✓ Paid (green) - Active payment
  - ! Payment Due (red) - Expired recurring payment
  - $ Payment Required (yellow) - No payment on file
- **Location**: `client/src/components/PaymentStatusBadge.tsx`

### GroupCreationModal (Enhanced)
- **Purpose**: Group creation with payment configuration
- **Payment Section**:
  - Toggle to enable payments
  - Amount input (HBD)
  - Payment type selector (one-time/recurring)
  - Recurring interval input
  - Description textarea
- **Location**: `client/src/components/GroupCreationModal.tsx`

### GroupChatHeader (Enhanced)
- **Purpose**: Display group info with payment status
- **Additions**:
  - Payment status badge for current user
  - Payment amount indicator
- **Location**: `client/src/components/GroupChatHeader.tsx`

### ManageMembersModal (Enhanced)
- **Purpose**: Member management with payment tracking
- **Additions**:
  - Payment statistics in header
  - Payment status badge per member
  - Payment type indicator
- **Location**: `client/src/components/ManageMembersModal.tsx`

## Payment Verification Module

### Core Functions

**`verifyPayment()`**
- Scans blockchain for matching HBD transfer
- Validates amount, recipient, and memo
- Returns transaction ID and timestamp

**`checkPaymentStatus()`**
- Determines if member has valid access
- Handles one-time and recurring logic
- Calculates days until next payment

**`createMemberPaymentRecord()`**
- Creates standardized payment record
- Calculates next due date for recurring
- Normalizes username to lowercase

**`updateExpiredPayments()`**
- Marks expired recurring payments
- Runs when loading group conversations
- Updates payment status to 'expired'

**`processPaymentRenewal()`**
- Handles recurring payment renewal
- Updates transaction ID and dates
- Reactivates expired payments

**`getMembersToBlock()`**
- Identifies members who lost access
- Used for access control enforcement
- Returns array of expired usernames

**`getPaymentStats()`**
- Calculates group-wide statistics
- Total revenue, active/expired counts
- Upcoming renewals (7-day window)

### Location
`client/src/lib/paymentVerification.ts`

## Blockchain Integration

### Payment Memo Format
```
group_payment:{groupId}|member:{username}
```

Example:
```
group_payment:1732012345-abc123def456|member:johndoe
```

### Group Metadata Custom JSON
```json
{
  "type": "hive_messenger_group_create",
  "groupId": "1732012345-abc123def456",
  "groupName": "Premium Trading Signals",
  "members": ["alice", "bob", "charlie"],
  "creator": "alice",
  "version": 1,
  "paymentSettings": {
    "enabled": true,
    "amount": "10.000",
    "type": "recurring",
    "recurringInterval": 30,
    "description": "Monthly access to trading signals and analysis"
  }
}
```

### Payment Transaction
```json
{
  "from": "bob",
  "to": "alice",
  "amount": "10.000 HBD",
  "memo": "group_payment:1732012345-abc123def456|member:bob"
}
```

## Security Considerations

### Payment Verification
- **Blockchain Validation**: All payments verified on-chain (can't be faked)
- **Memo Matching**: Must include correct groupId and username
- **Amount Verification**: Exact amount match required
- **Time Window**: Payments must be recent (default: 24 hours)

### Access Control
- **Local Enforcement**: Payment status checked client-side
- **Grace Period**: 24-hour grace for expired recurring payments (future feature)
- **Creator Exemption**: Group creators automatically have access
- **No Refunds**: Payments are final (blockchain immutability)

### Privacy
- **Pseudonymous**: Tied to Hive usernames, not real identities
- **Public Ledger**: All payments visible on blockchain
- **No PII**: No email, phone, or credit card data collected

## Performance Optimizations

### Caching Strategy
1. **IndexedDB**: Persistent payment records
2. **React Query**: In-memory cache with stale-while-revalidate
3. **Background Refresh**: Periodic payment status updates

### Blockchain Queries
- **Filtered Queries**: Only fetch transfer operations (10-100x faster)
- **Batch Verification**: Verify multiple payments in parallel
- **Batched Scanning**: Scans up to 5000 operations in 500-operation batches for efficiency
- **Time-Based Cutoff**: Stops scanning when operations exceed maxAgeHours window (default: 24 hours)
- **Smart Pagination**: Handles active accounts with many transfers gracefully
- **Duplicate Detection**: Tracks unique operations to prevent infinite loops with duplicate records

## Error Handling

### Payment Failures
- **Keychain Cancelled**: User cancels payment → show cancellation message
- **Insufficient Funds**: Keychain validates before broadcast
- **Verification Timeout**: Retry verification up to 3 times
- **Network Errors**: Display error with retry option

### Edge Cases
- **Duplicate Payments**: Use transaction ID deduplication
- **Clock Skew**: Use blockchain timestamps (not local time)
- **Partial Success**: Track which members failed in batch scenarios

## Future Enhancements

### Planned Features
1. **Grace Period**: 24-hour buffer before blocking expired payments
2. **Payment Reminders**: Notifications 3 days before renewal
3. **Partial Refunds**: Creator-initiated refund mechanism
4. **Payment Tiers**: Different access levels based on amount
5. **Group Trials**: Free trial periods before payment required
6. **Bulk Discounts**: Reduced rates for long-term commitments

### Technical Debt
- Add payment history view in group settings
- Implement automatic payment renewal prompts
- Add payment analytics dashboard for creators
- Support for HIVE payments (in addition to HBD)

## Testing Checklist

### One-Time Payments
- [ ] Create paid group with one-time payment
- [ ] Join group as new member
- [ ] Verify payment on blockchain
- [ ] Confirm access granted immediately
- [ ] Check payment record in ManageMembersModal
- [ ] Test insufficient payment amount rejection

### Recurring Payments
- [ ] Create group with monthly recurring
- [ ] Join and pay initial fee
- [ ] Verify next due date calculated correctly
- [ ] Simulate expired payment (modify nextDueDate)
- [ ] Test payment renewal flow
- [ ] Verify access restored after renewal
- [ ] Check upcoming renewals display

### Error Scenarios
- [ ] Cancel Keychain payment → proper error message
- [ ] Invalid payment amount → rejection
- [ ] Wrong memo format → verification failure
- [ ] Network timeout during verification
- [ ] Expired payment blocking group access

### UI/UX
- [ ] Payment badges display correctly
- [ ] Payment stats accurate in ManageMembersModal
- [ ] Progress indicator during verification
- [ ] Mobile responsive payment modal
- [ ] Payment description displays properly

## Support & Troubleshooting

### Common Issues

**Q: Payment completed but verification failed**
A: Wait 5 seconds and manually refresh. Blockchain propagation can take 3-10 seconds.

**Q: Shows "Payment Required" but I already paid**
A: Check blockchain explorer with your transaction ID. Payment record may not be cached locally. Try clearing IndexedDB cache.

**Q: Recurring payment expired early**
A: Check your `nextDueDate` in browser console. System uses blockchain timestamps (UTC), not local time.

**Q: Can't join group - payment modal doesn't appear**
A: Ensure you have Hive Keychain installed and unlocked. Check browser console for errors.

### Debug Commands

```javascript
// Check payment records
const groups = await getGroupConversations(username);
console.log(groups.find(g => g.groupId === 'abc123').memberPayments);

// Verify payment manually
const result = await verifyPayment(
  'johndoe',
  'alice',
  '10.000',
  'abc123',
  24
);
console.log(result);

// Check payment status
const status = checkPaymentStatus(
  memberPayments,
  'johndoe',
  paymentSettings
);
console.log(status);
```

## Conclusion

The paid groups feature provides a fully decentralized, zero-fee monetization solution for Hive Messenger group creators. By leveraging Hive's native HBD transfers and blockchain verification, we achieve instant payments, automatic verification, and complete transparency without any centralized payment infrastructure.

---

**Last Updated**: November 19, 2025  
**Version**: 1.0.0  
**Author**: Hive Messenger Development Team
