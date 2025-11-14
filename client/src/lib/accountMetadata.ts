/**
 * Hive Account Metadata Management
 * 
 * Handles reading and updating Hive account metadata for minimum HBD preferences
 * and Lightning Network integration.
 * All operations are decentralized - direct blockchain interaction via RPC nodes.
 * 
 * Phase 1 of Minimum HBD Filter Feature (v2.0.0)
 * Lightning Network Integration (v2.2.0)
 */

import { Client } from '@hiveio/dhive';
import { isKeychainInstalled } from './hive';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Tip receive preference options
 */
export type TipReceivePreference = 'lightning' | 'hbd';

/**
 * Hive Messenger specific metadata stored in account profile
 */
export interface HiveMessengerMetadata {
  min_hbd?: string;                          // Minimum HBD amount required (e.g., "0.001", "1.000") - optional
  lightning_address?: string;                // Lightning Network address (e.g., "user@getalby.com") - optional
  tip_receive_preference?: TipReceivePreference;  // How user wants to receive tips - optional
  version?: string;                          // Metadata version for future compatibility - optional
}

/**
 * Hive account metadata structure (posting_json_metadata field)
 */
export interface AccountMetadata {
  profile?: {
    name?: string;
    profile_image?: string;
    cover_image?: string;
    about?: string;
    location?: string;
    website?: string;
    hive_messenger?: HiveMessengerMetadata;  // Our custom field
    [key: string]: any;  // Allow other profile fields
  };
  [key: string]: any;  // Allow other metadata fields
}

/**
 * Hive account data from blockchain API
 */
export interface HiveAccount {
  name: string;
  posting_json_metadata: string;  // JSON string
  memo_key: string;
  created: string;
  [key: string]: any;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default minimum HBD amount (current standard for Hive Messenger)
 */
export const DEFAULT_MINIMUM_HBD = '0.001';

/**
 * Maximum allowed minimum HBD (1 million HBD cap as per requirements)
 */
export const MAX_MINIMUM_HBD = '1000000.000';

/**
 * Minimum allowed minimum HBD (0.001 HBD floor)
 */
export const MIN_MINIMUM_HBD = '0.001';

/**
 * Metadata cache TTL (5 minutes)
 */
const METADATA_CACHE_TTL = 5 * 60 * 1000;

/**
 * Current metadata version
 */
const METADATA_VERSION = '1.0';

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CachedMetadata {
  data: AccountMetadata;
  timestamp: number;
}

const metadataCache = new Map<string, CachedMetadata>();

/**
 * Clear cache entry for a specific account
 */
export function clearMetadataCache(username: string): void {
  metadataCache.delete(username.toLowerCase());
  console.log('[METADATA] Cleared cache for:', username);
}

/**
 * Clear all cached metadata
 */
export function clearAllMetadataCache(): void {
  metadataCache.clear();
  console.log('[METADATA] Cleared all cache');
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get account metadata from Hive blockchain
 * Uses in-memory cache to reduce RPC calls
 * 
 * @param username - Hive account username
 * @param forceRefresh - Skip cache and fetch fresh data
 * @returns Promise<AccountMetadata>
 */
export async function getAccountMetadata(
  username: string,
  forceRefresh = false
): Promise<AccountMetadata> {
  const normalizedUsername = username.toLowerCase();
  
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = metadataCache.get(normalizedUsername);
    if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
      console.log('[METADATA] Cache hit for:', username);
      return cached.data;
    }
  }
  
  try {
    console.log('[METADATA] Fetching from blockchain:', username);
    
    // Initialize Hive client (use public RPC node)
    const client = new Client([
      'https://api.hive.blog',
      'https://api.hivekings.com',
      'https://anyx.io',
      'https://api.openhive.network',
    ]);
    
    // Fetch account data from blockchain
    const accounts = await client.database.getAccounts([normalizedUsername]);
    
    if (!accounts || accounts.length === 0) {
      throw new Error(`Account not found: ${username}`);
    }
    
    const account = accounts[0] as HiveAccount;
    
    // Parse JSON metadata
    let metadata: AccountMetadata = {};
    
    if (account.posting_json_metadata) {
      try {
        metadata = JSON.parse(account.posting_json_metadata);
      } catch (parseError) {
        console.warn('[METADATA] Failed to parse posting_json_metadata:', parseError);
        // Return empty metadata object on parse failure
        metadata = {};
      }
    }
    
    // Cache the result
    metadataCache.set(normalizedUsername, {
      data: metadata,
      timestamp: Date.now(),
    });
    
    console.log('[METADATA] Fetched and cached:', username, metadata.profile?.hive_messenger);
    return metadata;
    
  } catch (error) {
    console.error('[METADATA] Failed to fetch account metadata:', error);
    
    // Return cached data if available (even if expired)
    const cached = metadataCache.get(normalizedUsername);
    if (cached) {
      console.warn('[METADATA] Using stale cache for:', username);
      return cached.data;
    }
    
    // Return empty metadata as fallback
    return {};
  }
}

/**
 * Parse minimum HBD from account metadata
 * Returns DEFAULT_MINIMUM_HBD if not set or invalid
 * 
 * @param metadata - Account metadata object
 * @returns Minimum HBD as string (e.g., "0.001", "1.000")
 */
export function parseMinimumHBD(metadata: AccountMetadata | null | undefined): string {
  if (!metadata?.profile?.hive_messenger?.min_hbd) {
    return DEFAULT_MINIMUM_HBD;
  }
  
  const minHBD = metadata.profile.hive_messenger.min_hbd;
  
  // Validate format
  if (!isValidHBDAmount(minHBD)) {
    console.warn('[METADATA] Invalid min_hbd format:', minHBD, '- using default');
    return DEFAULT_MINIMUM_HBD;
  }
  
  return minHBD;
}

/**
 * Validate HBD amount format
 * Must be numeric string with exactly 3 decimal places
 * Must be between MIN_MINIMUM_HBD and MAX_MINIMUM_HBD
 * 
 * @param amount - HBD amount string (e.g., "0.001", "1.000")
 * @returns true if valid
 */
export function isValidHBDAmount(amount: string): boolean {
  // Check format: must be numeric with exactly 3 decimal places
  const hbdRegex = /^\d+\.\d{3}$/;
  if (!hbdRegex.test(amount)) {
    return false;
  }
  
  // Parse and validate range
  const numericAmount = parseFloat(amount);
  const minAmount = parseFloat(MIN_MINIMUM_HBD);
  const maxAmount = parseFloat(MAX_MINIMUM_HBD);
  
  if (isNaN(numericAmount) || numericAmount < minAmount || numericAmount > maxAmount) {
    return false;
  }
  
  return true;
}

/**
 * Format number to HBD amount string with 3 decimal places
 * 
 * @param amount - Numeric amount
 * @returns Formatted HBD string (e.g., "1.000")
 */
export function formatHBDAmount(amount: number): string {
  return amount.toFixed(3);
}

/**
 * Update user's minimum HBD preference on blockchain
 * Broadcasts account_update2 operation via Hive Keychain
 * 
 * @param username - User's Hive account
 * @param minHBD - New minimum HBD amount (e.g., "0.001", "1.000")
 * @returns Promise<boolean> - true if successful
 */
export async function updateMinimumHBD(
  username: string,
  minHBD: string
): Promise<boolean> {
  // Validate inputs
  if (!username) {
    throw new Error('Username is required');
  }
  
  if (!isValidHBDAmount(minHBD)) {
    throw new Error(`Invalid HBD amount: ${minHBD}. Must be between ${MIN_MINIMUM_HBD} and ${MAX_MINIMUM_HBD} with 3 decimal places.`);
  }
  
  // Check Keychain availability
  if (!isKeychainInstalled()) {
    throw new Error('Hive Keychain not installed');
  }
  
  try {
    console.log('[METADATA] Updating minimum HBD for:', username, 'to:', minHBD);
    
    // Fetch current metadata
    const currentMetadata = await getAccountMetadata(username, true);
    
    // Get existing hive_messenger data to preserve lightning_address and other fields
    const existingMessengerData = currentMetadata.profile?.hive_messenger || {};
    
    // Merge with new minimum HBD (preserve existing fields like lightning_address)
    const updatedMetadata: AccountMetadata = {
      ...currentMetadata,
      profile: {
        ...(currentMetadata.profile ?? {}),
        hive_messenger: {
          ...existingMessengerData,  // Preserve lightning_address, etc.
          min_hbd: minHBD,
          version: METADATA_VERSION,
        },
      },
    };
    
    // Broadcast via Keychain
    const success = await broadcastAccountUpdate(username, updatedMetadata);
    
    if (success) {
      // Clear cache to force refresh
      clearMetadataCache(username);
      console.log('[METADATA] Successfully updated minimum HBD');
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('[METADATA] Failed to update minimum HBD:', error);
    throw error;
  }
}

/**
 * Broadcast account_update2 operation via Keychain
 * Internal helper function
 * 
 * @param username - Hive account username
 * @param metadata - Updated metadata object
 * @returns Promise<boolean>
 */
async function broadcastAccountUpdate(
  username: string,
  metadata: AccountMetadata
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }
    
    // Serialize metadata to JSON string
    const metadataJson = JSON.stringify(metadata);
    
    // Broadcast account_update2 operation
    // Note: account_update2 is the recommended operation for updating metadata
    window.hive_keychain.requestBroadcast(
      username,
      [
        [
          'account_update2',
          {
            account: username,
            posting_json_metadata: metadataJson,
            json_metadata: '', // Keep existing json_metadata
          },
        ],
      ],
      'Posting',
      (response: any) => {
        if (response.success) {
          console.log('[METADATA] Keychain broadcast success:', response.result);
          resolve(true);
        } else {
          console.error('[METADATA] Keychain broadcast failed:', response.message);
          reject(new Error(response.message || 'Broadcast failed'));
        }
      }
    );
  });
}

/**
 * Get minimum HBD for a specific user (convenience function)
 * Combines getAccountMetadata + parseMinimumHBD
 * 
 * @param username - Hive account username
 * @returns Promise<string> - Minimum HBD amount
 */
export async function getMinimumHBD(username: string): Promise<string> {
  try {
    const metadata = await getAccountMetadata(username);
    return parseMinimumHBD(metadata);
  } catch (error) {
    console.error('[METADATA] Failed to get minimum HBD:', error);
    return DEFAULT_MINIMUM_HBD;
  }
}

// ============================================================================
// Lightning Network Functions (v2.2.0)
// ============================================================================

/**
 * Validate Lightning Address format
 * Must follow email format: user@domain.com
 * Max length: 320 characters (email standard)
 * 
 * @param address - Lightning Address string
 * @returns true if valid format
 */
export function isValidLightningAddress(address: string): boolean {
  if (!address || address.length > 320) {
    return false;
  }
  
  // Lightning Address regex: user@domain.tld
  const lightningAddressRegex = /^[\w\.-]+@[\w\.-]+\.\w+$/;
  return lightningAddressRegex.test(address);
}

/**
 * Parse Lightning Address from account metadata
 * Returns null if not set or invalid
 * 
 * @param metadata - Account metadata object
 * @returns Lightning Address string or null
 */
export function parseLightningAddress(metadata: AccountMetadata | null | undefined): string | null {
  if (!metadata?.profile?.hive_messenger?.lightning_address) {
    return null;
  }
  
  const address = metadata.profile.hive_messenger.lightning_address;
  
  // Validate format
  if (!isValidLightningAddress(address)) {
    console.warn('[METADATA] Invalid lightning_address format:', address);
    return null;
  }
  
  return address;
}

/**
 * Update user's Lightning Address on blockchain
 * Broadcasts account_update2 operation via Hive Keychain
 * 
 * @param username - User's Hive account
 * @param lightningAddress - Lightning Address (e.g., "user@getalby.com") or empty string to remove
 * @returns Promise<boolean> - true if successful
 */
export async function updateLightningAddress(
  username: string,
  lightningAddress: string
): Promise<boolean> {
  // Validate inputs
  if (!username) {
    throw new Error('Username is required');
  }
  
  // Allow empty string to remove Lightning Address
  if (lightningAddress && !isValidLightningAddress(lightningAddress)) {
    throw new Error(`Invalid Lightning Address format. Must be like: user@domain.com`);
  }
  
  // Check Keychain availability
  if (!isKeychainInstalled()) {
    throw new Error('Hive Keychain not installed');
  }
  
  try {
    console.log('[METADATA] Updating Lightning Address for:', username, 'to:', lightningAddress || '(removed)');
    
    // Fetch current metadata
    const currentMetadata = await getAccountMetadata(username, true);
    
    // Get existing hive_messenger data (preserve all fields, no defaults)
    const existingMessengerData = currentMetadata.profile?.hive_messenger || {};
    
    // Merge with new Lightning Address (preserve existing fields)
    const updatedMetadata: AccountMetadata = {
      ...currentMetadata,
      profile: {
        ...(currentMetadata.profile ?? {}),
        hive_messenger: {
          ...existingMessengerData,  // Preserve min_hbd, version, etc.
          lightning_address: lightningAddress || undefined, // Remove if empty
          version: METADATA_VERSION,  // Always set version when updating
        },
      },
    };
    
    // Broadcast via Keychain
    const success = await broadcastAccountUpdate(username, updatedMetadata);
    
    if (success) {
      // Clear cache to force refresh
      clearMetadataCache(username);
      console.log('[METADATA] Successfully updated Lightning Address');
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('[METADATA] Failed to update Lightning Address:', error);
    throw error;
  }
}

/**
 * Get Lightning Address for a specific user (convenience function)
 * Combines getAccountMetadata + parseLightningAddress
 * 
 * @param username - Hive account username
 * @returns Promise<string | null> - Lightning Address or null
 */
export async function getLightningAddress(username: string): Promise<string | null> {
  try {
    const metadata = await getAccountMetadata(username);
    return parseLightningAddress(metadata);
  } catch (error) {
    console.error('[METADATA] Failed to get Lightning Address:', error);
    return null;
  }
}

// ============================================================================
// Tip Receive Preference Functions (v2.3.0)
// ============================================================================

/**
 * Infer tip receive preference from metadata
 * Used for backward compatibility with legacy users who don't have explicit preference set
 * 
 * Logic:
 * 1. If tip_receive_preference is explicitly set, use it
 * 2. Else if lightning_address exists, infer 'lightning' (legacy user)
 * 3. Else default to 'hbd' (new users without Lightning Address)
 * 
 * @param metadata - Hive Messenger metadata object
 * @returns TipReceivePreference ('lightning' | 'hbd')
 */
export function inferTipReceivePreference(metadata: HiveMessengerMetadata | null | undefined): TipReceivePreference {
  // If explicit preference is set, use it
  if (metadata?.tip_receive_preference) {
    return metadata.tip_receive_preference;
  }
  
  // Legacy inference: if Lightning Address exists, assume user wants Lightning tips
  if (metadata?.lightning_address) {
    return 'lightning';
  }
  
  // Default: HBD (no Lightning Address needed)
  return 'hbd';
}

/**
 * Update user's tip receive preference on blockchain
 * Broadcasts account_update2 operation via Hive Keychain
 * 
 * VALIDATION: User can only set preference='lightning' if they have a valid lightning_address
 * 
 * @param username - User's Hive account
 * @param preference - Tip receive preference ('lightning' | 'hbd')
 * @returns Promise<boolean> - true if successful
 */
export async function updateTipReceivePreference(
  username: string,
  preference: TipReceivePreference
): Promise<boolean> {
  // Validate inputs
  if (!username) {
    throw new Error('Username is required');
  }
  
  if (preference !== 'lightning' && preference !== 'hbd') {
    throw new Error('Invalid preference. Must be "lightning" or "hbd"');
  }
  
  // Check Keychain availability
  if (!isKeychainInstalled()) {
    throw new Error('Hive Keychain not installed');
  }
  
  try {
    console.log('[METADATA] Updating tip receive preference for:', username, 'to:', preference);
    
    // Fetch current metadata
    const currentMetadata = await getAccountMetadata(username, true);
    
    // Get existing hive_messenger data
    const existingMessengerData = currentMetadata.profile?.hive_messenger || {};
    
    // VALIDATION: If setting preference='lightning', require lightning_address
    if (preference === 'lightning' && !existingMessengerData.lightning_address) {
      throw new Error('Cannot set preference to Lightning without a Lightning Address. Please add your Lightning Address first.');
    }
    
    // Merge with new preference (preserve all existing fields)
    const updatedMetadata: AccountMetadata = {
      ...currentMetadata,
      profile: {
        ...(currentMetadata.profile ?? {}),
        hive_messenger: {
          ...existingMessengerData,  // Preserve min_hbd, lightning_address, etc.
          tip_receive_preference: preference,
          version: METADATA_VERSION,
        },
      },
    };
    
    // Broadcast via Keychain
    const success = await broadcastAccountUpdate(username, updatedMetadata);
    
    if (success) {
      // Clear cache to force refresh
      clearMetadataCache(username);
      console.log('[METADATA] Successfully updated tip receive preference');
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('[METADATA] Failed to update tip receive preference:', error);
    throw error;
  }
}

/**
 * Get tip receive preference for a specific user (convenience function)
 * Combines getAccountMetadata + inferTipReceivePreference
 * 
 * @param username - Hive account username
 * @returns Promise<TipReceivePreference> - Tip receive preference
 */
export async function getTipReceivePreference(username: string): Promise<TipReceivePreference> {
  try {
    const metadata = await getAccountMetadata(username);
    return inferTipReceivePreference(metadata.profile?.hive_messenger);
  } catch (error) {
    console.error('[METADATA] Failed to get tip receive preference:', error);
    return 'hbd'; // Default fallback
  }
}
