import { hiveClient as optimizedHiveClient } from './hiveClient';
import { logger } from './logger';
import type { MemberPayment, PaymentSettings } from './groupBlockchain';

// ============================================================================
// PAYMENT VERIFICATION: HBD Payment Scanning & Validation
// ============================================================================

/**
 * Verify a payment transaction exists and matches expected criteria
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

    // Scan recent transfer history (last 100 operations)
    const history = await optimizedHiveClient.getAccountHistory(
      username,
      100,
      'transfers', // Only get transfer operations
      -1 // Start from latest
    );

    if (!history || history.length === 0) {
      return { verified: false, error: 'No transaction history found' };
    }

    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);

    // Search for matching payment
    for (const [, operation] of history.reverse()) {
      if (operation.op[0] === 'transfer') {
        const transfer = operation.op[1];
        const timestamp = new Date(operation.timestamp + 'Z').getTime();

        // Check if transfer is recent enough
        if (timestamp < cutoffTime) {
          continue;
        }

        // Verify all payment criteria
        const matches = 
          transfer.from === username &&
          transfer.to === recipient &&
          transfer.amount === `${expectedAmount} HBD` &&
          transfer.memo && transfer.memo.includes(memo);

        if (matches) {
          logger.info('[PAYMENT VERIFY] ✅ Payment verified:', {
            txId: operation.trx_id,
            timestamp: operation.timestamp,
          });

          return {
            verified: true,
            txId: operation.trx_id,
            timestamp: new Date(operation.timestamp + 'Z').toISOString(),
          };
        }
      }
    }

    logger.warn('[PAYMENT VERIFY] ❌ No matching payment found');
    return { verified: false, error: 'Payment not found in recent history' };
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
