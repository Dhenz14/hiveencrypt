import { Client } from '@hiveio/dhive';
import { logger } from './logger';

/**
 * Resource Credits (RC) estimation and warning system
 * Prevents failed transactions due to insufficient RC
 * 
 * @module rcEstimation
 */

/**
 * RC account information
 */
export interface RCInfo {
  current: number;
  max: number;
  percentage: number;
}

/**
 * Estimated RC costs for common operations
 * Note: These are approximations - actual costs vary by network load
 */
export const RC_COSTS = {
  CUSTOM_JSON_BASE: 200_000_000,      // ~200M RC per custom_json operation
  CUSTOM_JSON_PER_KB: 50_000_000,     // ~50M RC per KB of data
  TRANSFER: 100_000_000,              // ~100M RC per transfer
  VOTE: 100_000_000,                  // ~100M RC per vote
  COMMENT: 1_000_000_000,             // ~1B RC per comment
};

/**
 * Get account's current RC balance and percentage
 * 
 * @param username - Hive username
 * @returns Promise<RCInfo> - RC information
 */
export async function getAccountRC(username: string): Promise<RCInfo> {
  try {
    const client = new Client([
      'https://api.hive.blog',
      'https://api.hivekings.com',
      'https://anyx.io',
      'https://api.openhive.network'
    ]);

    // Use rc_api to get accurate Resource Credits information
    const rcAccounts = await client.call('rc_api', 'find_rc_accounts', {
      accounts: [username]
    });

    if (!rcAccounts || !rcAccounts.rc_accounts || rcAccounts.rc_accounts.length === 0) {
      throw new Error('RC account not found');
    }

    const rcAccount = rcAccounts.rc_accounts[0];
    const currentMana = parseInt(rcAccount.rc_manabar.current_mana);
    const maxMana = parseInt(rcAccount.max_rc);
    
    const percentage = (currentMana / maxMana) * 100;
    
    logger.info('[RC] Retrieved RC info:', {
      current: currentMana,
      max: maxMana,
      percentage: percentage.toFixed(2) + '%'
    });
    
    return {
      current: currentMana,
      max: maxMana,
      percentage: parseFloat(percentage.toFixed(2))
    };
  } catch (error) {
    console.error('[RC] Failed to fetch RC info:', error);
    throw new Error('Failed to get RC information');
  }
}

/**
 * Estimate RC cost for custom_json operation based on payload size
 * 
 * @param payloadSizeBytes - Size of JSON payload in bytes
 * @param chunkCount - Number of chunks (operations) needed
 * @returns Estimated RC cost
 */
export function estimateCustomJsonRC(payloadSizeBytes: number, chunkCount: number = 1): number {
  const baseCost = RC_COSTS.CUSTOM_JSON_BASE * chunkCount;
  const sizeCost = Math.ceil(payloadSizeBytes / 1024) * RC_COSTS.CUSTOM_JSON_PER_KB;
  return baseCost + sizeCost;
}

/**
 * Check if user has sufficient RC for an operation
 * 
 * @param username - Hive username
 * @param estimatedCost - Estimated RC cost
 * @returns Promise<{ sufficient: boolean; current: number; percentage: number }>
 */
export async function checkSufficientRC(
  username: string,
  estimatedCost: number
): Promise<{ sufficient: boolean; current: number; percentage: number }> {
  const rcInfo = await getAccountRC(username);
  
  return {
    sufficient: rcInfo.current >= estimatedCost,
    current: rcInfo.current,
    percentage: rcInfo.percentage
  };
}

/**
 * Get warning level based on RC percentage
 * 
 * @param percentage - RC percentage (0-100)
 * @returns 'critical' | 'low' | 'ok'
 */
export function getRCWarningLevel(percentage: number): 'critical' | 'low' | 'ok' {
  if (percentage < 5) return 'critical';
  if (percentage < 20) return 'low';
  return 'ok';
}

/**
 * Format RC value for display
 * 
 * @param rc - RC value
 * @returns Formatted string (e.g., "1.2B" or "500M")
 */
export function formatRC(rc: number): string {
  if (rc >= 1_000_000_000) {
    return (rc / 1_000_000_000).toFixed(1) + 'B';
  } else if (rc >= 1_000_000) {
    return (rc / 1_000_000).toFixed(1) + 'M';
  } else if (rc >= 1_000) {
    return (rc / 1_000).toFixed(1) + 'K';
  }
  return rc.toString();
}

/**
 * Calculate estimated operations remaining
 * 
 * @param currentRC - Current RC balance
 * @param operationType - Type of operation
 * @returns Number of operations user can perform
 */
export function calculateRemainingOperations(
  currentRC: number,
  operationType: keyof typeof RC_COSTS
): number {
  const cost = RC_COSTS[operationType];
  return Math.floor(currentRC / cost);
}
