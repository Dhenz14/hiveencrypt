import { hiveClient as optimizedHiveClient } from './hiveClient';
import { logger } from './logger';
import type { MemberPayment, PaymentSettings } from './groupBlockchain';

// ============================================================================
// PAYMENT VERIFICATION: HBD Payment Scanning & Validation
// ============================================================================

/**
 * Verify a payment transaction exists and matches expected criteria
 * Uses batched scanning to handle active accounts with many transfers
 * 
 * @param username - Payer's username
 * @param recipient - Payment recipient (group creator)
 * @param expectedAmount - Expected HBD amount (e.g., "5.000")
 * @param memo - Expected memo containing groupId
 * @param maxAgeHours - Maximum age of payment in hours (default: 24)
 * @returns Payment verification result with transaction details
 */
export async function verifyPayment(
  username: string,
  recipient: string,
  expectedAmount: string,
  memo: string,
  maxAgeHours: number = 24
): Promise<{ verified: boolean; txId?: string; timestamp?: string; error?: string }> {
  try {
    logger.info('[PAYMENT VERIFY] Checking payment:', { username, recipient, expectedAmount, memo });

    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    const batchSize = 100;
    const maxBatches = 50; // Maximum 5000 operations to scan
    let currentStart = -1;
    let batchCount = 0;
    let oldestTimestampSeen = Date.now();

    // Scan history in batches until we find payment or exceed time window
    while (batchCount < maxBatches) {
      batchCount++;
      
      const history = await optimizedHiveClient.getAccountHistory(
        username,
        batchSize,
        'transfers', // Only get transfer operations
        currentStart
      );

      if (!history || history.length === 0) {
        logger.info('[PAYMENT VERIFY] No more history to scan');
        break;
      }

      logger.info('[PAYMENT VERIFY] Scanning batch', batchCount, ':', history.length, 'operations');

      // Search for matching payment in this batch
      for (const [opIndex, operation] of history) {
        if (operation.op[0] === 'transfer') {
          const transfer = operation.op[1];
          const timestamp = new Date(operation.timestamp + 'Z').getTime();
          
          // Track oldest timestamp seen
          if (timestamp < oldestTimestampSeen) {
            oldestTimestampSeen = timestamp;
          }

          // Check if transfer is too old - stop scanning if we've exceeded time window
          if (timestamp < cutoffTime) {
            logger.info('[PAYMENT VERIFY] Reached operations older than', maxAgeHours, 'hours. Stopping scan.');
            return { verified: false, error: 'Payment not found within time window' };
          }

          // Verify all payment criteria
          const matches = 
            transfer.from === username &&
            transfer.to === recipient &&
            transfer.amount === `${expectedAmount} HBD` &&
            transfer.memo && transfer.memo.includes(memo);

          if (matches) {
            logger.info('[PAYMENT VERIFY] ✅ Payment verified in batch', batchCount, ':', {
              txId: operation.trx_id,
              timestamp: operation.timestamp,
              opIndex,
            });

            return {
              verified: true,
              txId: operation.trx_id,
              timestamp: new Date(operation.timestamp + 'Z').toISOString(),
            };
          }
        }
      }

      // Calculate next starting point for pagination
      // Get the oldest operation index from this batch
      const oldestOpIndex = Math.min(...history.map(([idx]) => idx));
      
      // If we've seen this index before or it's 0, we've reached the beginning
      if (oldestOpIndex === currentStart || oldestOpIndex <= 0) {
        logger.info('[PAYMENT VERIFY] Reached beginning of account history');
        break;
      }
      
      // Move to next batch (older operations)
      currentStart = oldestOpIndex - 1;
      
      logger.info('[PAYMENT VERIFY] Moving to next batch. New start:', currentStart);
    }

    if (batchCount >= maxBatches) {
      logger.warn('[PAYMENT VERIFY] Reached maximum batch limit (', maxBatches, ')');
    }

    logger.warn('[PAYMENT VERIFY] ❌ No matching payment found after scanning', batchCount, 'batches');
    return { verified: false, error: 'Payment not found in account history' };
  } catch (error) {
    logger.error('[PAYMENT VERIFY] Error verifying payment:', error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Check if a member has valid payment status for a group
 * 
 * @param memberPayments - Array of member payment records
 * @param username - Username to check
 * @param paymentSettings - Group payment configuration
 * @returns Payment status check result
 */
export function checkPaymentStatus(
  memberPayments: MemberPayment[] | undefined,
  username: string,
  paymentSettings: PaymentSettings | undefined
): {
  hasAccess: boolean;
  status: 'paid' | 'expired' | 'unpaid';
  nextDueDate?: string;
  daysUntilDue?: number;
} {
  // No payment required - everyone has access
  if (!paymentSettings?.enabled) {
    return { hasAccess: true, status: 'paid' };
  }

  // Find member's payment record
  const payment = memberPayments?.find(p => p.username.toLowerCase() === username.toLowerCase());

  if (!payment) {
    return { hasAccess: false, status: 'unpaid' };
  }

  // One-time payment - check if active
  if (paymentSettings.type === 'one_time') {
    return {
      hasAccess: payment.status === 'active',
      status: payment.status === 'active' ? 'paid' : 'expired',
    };
  }

  // Recurring payment - check if still valid
  if (paymentSettings.type === 'recurring' && payment.nextDueDate) {
    const now = new Date();
    const dueDate = new Date(payment.nextDueDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (now > dueDate) {
      return {
        hasAccess: false,
        status: 'expired',
        nextDueDate: payment.nextDueDate,
        daysUntilDue,
      };
    }

    return {
      hasAccess: true,
      status: 'paid',
      nextDueDate: payment.nextDueDate,
      daysUntilDue,
    };
  }

  return { hasAccess: false, status: 'unpaid' };
}

/**
 * Calculate next due date for recurring payment
 * 
 * @param lastPaymentDate - ISO timestamp of last payment
 * @param intervalDays - Number of days between payments
 * @returns Next due date as ISO string
 */
export function calculateNextDueDate(lastPaymentDate: string, intervalDays: number): string {
  const lastDate = new Date(lastPaymentDate);
  lastDate.setDate(lastDate.getDate() + intervalDays);
  return lastDate.toISOString();
}

/**
 * Generate payment memo for group payment
 * 
 * @param groupId - Group identifier
 * @param username - Payer's username
 * @returns Formatted payment memo
 */
export function generatePaymentMemo(groupId: string, username: string): string {
  return `group_payment:${groupId}|member:${username}`;
}

/**
 * Parse payment memo to extract group ID and username
 * 
 * @param memo - Payment memo string
 * @returns Parsed memo data or null if invalid
 */
export function parsePaymentMemo(memo: string): { groupId: string; username: string } | null {
  try {
    if (!memo.startsWith('group_payment:')) {
      return null;
    }

    const parts = memo.split('|');
    if (parts.length !== 2) {
      return null;
    }

    const groupId = parts[0].replace('group_payment:', '');
    const username = parts[1].replace('member:', '');

    if (!groupId || !username) {
      return null;
    }

    return { groupId, username };
  } catch {
    return null;
  }
}

/**
 * Create a member payment record after successful payment verification
 * 
 * @param username - Member who paid
 * @param txId - Payment transaction ID
 * @param amount - Amount paid
 * @param paymentSettings - Group payment configuration
 * @returns Member payment record
 */
export function createMemberPaymentRecord(
  username: string,
  txId: string,
  amount: string,
  paymentSettings: PaymentSettings
): MemberPayment {
  const paidAt = new Date().toISOString();
  
  const payment: MemberPayment = {
    username: username.toLowerCase(),
    txId,
    amount,
    paidAt,
    status: 'active',
  };

  // Calculate next due date for recurring payments
  if (paymentSettings.type === 'recurring' && paymentSettings.recurringInterval) {
    payment.nextDueDate = calculateNextDueDate(paidAt, paymentSettings.recurringInterval);
  }

  return payment;
}

/**
 * Update expired recurring payments in member payment list
 * Marks payments as expired if their due date has passed
 * 
 * @param memberPayments - Array of member payment records
 * @returns Updated array with expired statuses
 */
export function updateExpiredPayments(memberPayments: MemberPayment[]): MemberPayment[] {
  const now = new Date();

  return memberPayments.map(payment => {
    if (payment.nextDueDate && payment.status === 'active') {
      const dueDate = new Date(payment.nextDueDate);
      if (now > dueDate) {
        return { ...payment, status: 'expired' as const };
      }
    }
    return payment;
  });
}

/**
 * Process a payment renewal for recurring payments
 * Extends the member's access and updates next due date
 * 
 * @param memberPayment - Existing member payment record
 * @param newTxId - New payment transaction ID
 * @param paymentSettings - Group payment configuration
 * @returns Updated member payment record
 */
export function processPaymentRenewal(
  memberPayment: MemberPayment,
  newTxId: string,
  paymentSettings: PaymentSettings
): MemberPayment {
  if (paymentSettings.type !== 'recurring' || !paymentSettings.recurringInterval) {
    throw new Error('Payment renewal only applies to recurring payments');
  }

  const renewalDate = new Date().toISOString();
  const nextDueDate = calculateNextDueDate(renewalDate, paymentSettings.recurringInterval);

  return {
    ...memberPayment,
    txId: newTxId, // Update to latest payment transaction
    paidAt: renewalDate,
    status: 'active',
    nextDueDate,
  };
}

/**
 * Get members with expired payments that need to be blocked from group access
 * 
 * @param memberPayments - Array of member payment records
 * @param currentMembers - Current group member list
 * @returns Array of usernames that should lose access
 */
export function getMembersToBlock(
  memberPayments: MemberPayment[] | undefined,
  currentMembers: string[]
): string[] {
  if (!memberPayments || memberPayments.length === 0) {
    return [];
  }

  const expiredUsernames = memberPayments
    .filter(payment => payment.status === 'expired')
    .map(payment => payment.username.toLowerCase());

  // Only return members who are still in the group but have expired payments
  return currentMembers.filter(member => 
    expiredUsernames.includes(member.toLowerCase())
  );
}

/**
 * Calculate payment statistics for a paid group
 * 
 * @param memberPayments - Array of member payment records
 * @param paymentSettings - Group payment configuration
 * @returns Payment statistics summary
 */
export function getPaymentStats(
  memberPayments: MemberPayment[] | undefined,
  paymentSettings: PaymentSettings | undefined
): {
  totalPaid: number;
  totalActive: number;
  totalExpired: number;
  upcomingRenewals: number;
  revenue: string;
} {
  if (!memberPayments || !paymentSettings?.enabled) {
    return {
      totalPaid: 0,
      totalActive: 0,
      totalExpired: 0,
      upcomingRenewals: 0,
      revenue: '0.000 HBD',
    };
  }

  const updated = updateExpiredPayments(memberPayments);
  const totalActive = updated.filter(p => p.status === 'active').length;
  const totalExpired = updated.filter(p => p.status === 'expired').length;

  // Count renewals due in next 7 days
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingRenewals = updated.filter(p => {
    if (!p.nextDueDate || p.status !== 'active') return false;
    const dueDate = new Date(p.nextDueDate);
    return dueDate >= now && dueDate <= sevenDaysFromNow;
  }).length;

  // Calculate total revenue (multiply payment amount by number of payments)
  const amount = parseFloat(paymentSettings.amount);
  const revenue = (amount * memberPayments.length).toFixed(3);

  return {
    totalPaid: memberPayments.length,
    totalActive,
    totalExpired,
    upcomingRenewals,
    revenue: `${revenue} HBD`,
  };
}
