/**
 * Lightning Network Integration Module
 * 
 * Centralized module for all Lightning Network operations:
 * - LNURL-pay invoice generation
 * - BOLT11 invoice validation and decoding
 * - V4V.app bridge integration (HBD → Lightning BTC)
 * - Exchange rate calculations
 * - Security validations
 * 
 * Lightning Network Integration (v2.2.0)
 */

import { requestInvoice } from 'lnurl-pay';
import * as bolt11 from 'light-bolt11-decoder';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * LNURL service parameters (from lnurl-pay)
 */
export interface LNURLServiceParams {
  min: number;    // Minimum millisatoshis
  max: number;    // Maximum millisatoshis
  metadata: string;
  callback: string;
  commentAllowed?: number;
}

/**
 * Lightning invoice result from LNURL-pay
 */
export interface LightningInvoice {
  invoice: string;              // BOLT11 invoice string
  params: LNURLServiceParams;   // LNURL service parameters
  minSendable: number;          // Minimum sats (from LNURL server)
  maxSendable: number;          // Maximum sats (from LNURL server)
}

/**
 * Decoded BOLT11 invoice details
 */
export interface DecodedInvoice {
  paymentRequest: string;       // Original invoice string
  amount: number | null;        // Amount in satoshis (null if not specified)
  timestamp: number;            // Invoice creation timestamp
  expiry: number;               // Expiry time in seconds
  description?: string;         // Payment description/memo
  paymentHash: string;          // Payment hash
}

/**
 * V4V.app transfer calculation
 */
export interface V4VTransfer {
  invoiceAmountSats: number;    // Lightning invoice amount in satoshis
  invoiceAmountBTC: number;     // Amount in BTC
  invoiceAmountHBD: number;     // Equivalent in HBD (before fee)
  v4vFee: number;               // V4V.app fee (0.8% of HBD amount)
  totalHBD: number;             // Total HBD to send (including fee)
  invoice: string;              // BOLT11 invoice to include in memo
}

// ============================================================================
// Constants
// ============================================================================

/**
 * V4V.app Hive account (verified)
 */
export const V4VAPP_ACCOUNT = 'v4vapp';

/**
 * V4V.app fee percentage (0.8%)
 */
export const V4VAPP_FEE_PERCENT = 0.008;

/**
 * V4V.app limits (satoshis)
 */
export const V4VAPP_LIMITS = {
  max4Hours: 100000,    // 100k sats per 4 hours
  max24Hours: 200000,   // 200k sats per 24 hours
  max72Hours: 300000,   // 300k sats per 72 hours
};

/**
 * Lightning invoice expiry time (15 minutes)
 */
export const INVOICE_EXPIRY_SECONDS = 15 * 60;

// ============================================================================
// LNURL-pay Functions
// ============================================================================

/**
 * Verification result for Lightning Address
 */
export interface LightningVerificationResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * Verify Lightning Address is reachable and valid (best-effort, non-blocking)
 * 
 * ARCHITECTURE NOTE: Deferred verification approach
 * - Phase 1 (Settings): Best-effort LNURL probe, never blocks saves (CORS may fail)
 * - Phase 2 (Tipping): Authoritative verification during invoice generation
 * 
 * This preserves 100% decentralization (no backend proxy) while providing useful feedback
 * 
 * @param lightningAddress - Lightning Address to verify
 * @returns Promise<LightningVerificationResult> - never throws, returns status
 */
export async function verifyLightningAddress(lightningAddress: string): Promise<LightningVerificationResult> {
  try {
    console.log('[LIGHTNING] Best-effort verification of Lightning Address:', lightningAddress);
    
    const testAmountSats = 1000;
    
    // Attempt LNURL verification (may fail due to CORS - that's expected)
    const result = await requestInvoice({
      lnUrlOrAddress: lightningAddress,
      tokens: testAmountSats as any,  // Test amount for verification
      comment: 'Hive Messenger address verification probe',
    });
    
    // Validate response structure
    if (!result || typeof result !== 'object') {
      return {
        success: false,
        error: 'Invalid Lightning Address - malformed LNURL response',
      };
    }
    
    // Check for invoice
    if (!result.invoice) {
      return {
        success: false,
        error: 'Invalid Lightning Address - LNURL server returned no invoice',
      };
    }
    
    // Validate invoice format
    if (typeof result.invoice !== 'string' || !result.invoice.toLowerCase().startsWith('lnbc')) {
      return {
        success: false,
        error: 'Invalid invoice format from LNURL server',
      };
    }
    
    // Validate LNURL params if present (optional in lnurl-pay response)
    if (result.params) {
      // Check callback exists
      if (!result.params.callback) {
        return {
          success: false,
          error: 'Invalid Lightning Address - missing callback URL',
        };
      }
      
      // Validate min/max limits if present
      if (result.params.min !== undefined && result.params.max !== undefined) {
        const min = Number(result.params.min);
        const max = Number(result.params.max);
        
        if (isNaN(min) || isNaN(max)) {
          return {
            success: false,
            error: 'Invalid Lightning Address - invalid payment limits',
          };
        }
        
        if (min > max) {
          return {
            success: false,
            error: 'Invalid Lightning Address - malformed payment limits',
          };
        }
        
        // Check test amount is within bounds (convert sats to millisats)
        const testAmountMsat = testAmountSats * 1000;
        if (testAmountMsat < min || testAmountMsat > max) {
          return {
            success: false,
            error: 'Invalid Lightning Address - test amount outside supported range',
          };
        }
      }
    }
    
    console.log('[LIGHTNING] Lightning Address verified successfully:', lightningAddress);
    return { success: true };
    
  } catch (error) {
    // Log full technical error for debugging
    console.warn('[LIGHTNING] Verification probe failed:', error);
    
    // Differentiate between CORS failures and genuine LNURL errors
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
    
    // CORS errors typically contain 'cors', 'network', or 'fetch' keywords
    const isCORSError = 
      errorMessage.includes('cors') || 
      errorMessage.includes('network') ||
      errorMessage.includes('fetch') ||
      errorMessage.includes('failed to fetch');
    
    if (isCORSError) {
      // Expected CORS failure - allow save with warning
      return {
        success: false,
        warning: 'Could not verify address (browser restriction). Will verify during tip.',
      };
    } else {
      // Genuine LNURL error - block save with user-friendly message
      // (Technical details logged above for debugging)
      return {
        success: false,
        error: 'Invalid Lightning Address. Please check and try again.',
      };
    }
  }
}

/**
 * Generate Lightning invoice from Lightning Address
 * Uses LNURL-pay protocol to request invoice
 * 
 * @param lightningAddress - Lightning Address (e.g., "user@getalby.com")
 * @param amountSats - Amount in satoshis
 * @param comment - Optional comment/message
 * @returns Promise<LightningInvoice>
 */
export async function generateLightningInvoice(
  lightningAddress: string,
  amountSats: number,
  comment?: string
): Promise<LightningInvoice> {
  try {
    console.log('[LIGHTNING] Generating invoice:', {
      address: lightningAddress,
      amount: amountSats,
      comment,
    });
    
    // Request invoice from LNURL server
    const result = await requestInvoice({
      lnUrlOrAddress: lightningAddress,
      tokens: amountSats as any,      // Amount in satoshis (lnurl-pay uses branded type)
      comment: comment || '',   // Optional message
    });
    
    if (!result || !result.invoice) {
      throw new Error('Failed to generate Lightning invoice');
    }
    
    console.log('[LIGHTNING] Invoice generated successfully');
    
    const params = result.params as any;
    
    return {
      invoice: result.invoice,
      params: params,
      minSendable: params.min / 1000, // Convert from millisats to sats
      maxSendable: params.max / 1000, // Convert from millisats to sats
    };
    
  } catch (error) {
    console.error('[LIGHTNING] Failed to generate invoice:', error);
    throw new Error(`Lightning invoice generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// BOLT11 Invoice Validation
// ============================================================================

/**
 * Decode and validate BOLT11 Lightning invoice
 * Ensures invoice is properly formatted and contains required fields
 * 
 * @param invoice - BOLT11 invoice string (starts with 'lnbc')
 * @returns DecodedInvoice
 */
export function decodeBOLT11Invoice(invoice: string): DecodedInvoice {
  try {
    // Validate invoice format
    if (!invoice || !invoice.toLowerCase().startsWith('lnbc')) {
      throw new Error('Invalid invoice format. Must start with "lnbc"');
    }
    
    // Decode invoice using light-bolt11-decoder
    const decoded = bolt11.decode(invoice) as any;
    
    // Extract sections
    const sections = decoded.sections || [];
    
    // Extract amount (in satoshis)
    let amount: number | null = null;
    const amountSection = sections.find((s: any) => s.name === 'amount');
    if (amountSection && 'value' in amountSection && amountSection.value) {
      // Convert from millisatoshis to satoshis
      amount = Math.floor(amountSection.value / 1000);
    }
    
    // Extract timestamp
    const timestampSection = sections.find((s: any) => s.name === 'timestamp');
    const timestamp = (timestampSection && 'value' in timestampSection) ? timestampSection.value : 0;
    
    // Extract expiry (default 3600 seconds if not specified)
    const expirySection = sections.find((s: any) => s.name === 'expiry');
    const expiry = (expirySection && 'value' in expirySection) ? expirySection.value : 3600;
    
    // Extract description
    const descriptionSection = sections.find((s: any) => s.name === 'description');
    const description = (descriptionSection && 'value' in descriptionSection) ? descriptionSection.value : undefined;
    
    // Extract payment hash
    const paymentHashSection = sections.find((s: any) => s.name === 'payment_hash');
    const paymentHash = (paymentHashSection && 'value' in paymentHashSection) ? paymentHashSection.value : '';
    
    return {
      paymentRequest: invoice,
      amount,
      timestamp,
      expiry,
      description,
      paymentHash,
    };
    
  } catch (error) {
    console.error('[LIGHTNING] Failed to decode invoice:', error);
    throw new Error(`Invalid BOLT11 invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Lowercase alias for convenience (both exports point to same function)
export const decodeBolt11Invoice = decodeBOLT11Invoice;

/**
 * Validate invoice amount matches expected amount
 * Security check to prevent amount manipulation
 * 
 * @param invoice - BOLT11 invoice string
 * @param expectedAmountSats - Expected amount in satoshis
 * @throws Error if amounts don't match
 */
export function validateInvoiceAmount(invoice: string, expectedAmountSats: number): void {
  const decoded = decodeBOLT11Invoice(invoice);
  
  if (decoded.amount === null) {
    throw new Error('Invoice does not specify an amount');
  }
  
  if (decoded.amount !== expectedAmountSats) {
    throw new Error(
      `Invoice amount mismatch! Expected ${expectedAmountSats} sats, got ${decoded.amount} sats`
    );
  }
}

/**
 * Check if invoice has expired
 * 
 * @param invoice - BOLT11 invoice string
 * @returns true if expired
 */
export function isInvoiceExpired(invoice: string): boolean {
  try {
    const decoded = decodeBOLT11Invoice(invoice);
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp
    const expiryTime = decoded.timestamp + decoded.expiry;
    
    return now > expiryTime;
  } catch {
    return true; // Treat invalid invoices as expired
  }
}

// ============================================================================
// V4V.app Bridge Functions
// ============================================================================

/**
 * Calculate V4V.app transfer details
 * Converts Lightning sats amount to HBD including V4V.app fee
 * 
 * @param invoiceAmountSats - Lightning invoice amount in satoshis
 * @param btcHbdRate - Current BTC/HBD exchange rate
 * @returns V4VTransfer calculation
 */
export function calculateV4VTransfer(
  invoice: string,
  invoiceAmountSats: number,
  btcHbdRate: number
): V4VTransfer {
  // Convert sats to BTC (1 BTC = 100,000,000 sats)
  const invoiceAmountBTC = invoiceAmountSats / 100_000_000;
  
  // Convert BTC to HBD
  const invoiceAmountHBD = invoiceAmountBTC * btcHbdRate;
  
  // Calculate V4V.app fee (0.8%)
  const v4vFee = invoiceAmountHBD * V4VAPP_FEE_PERCENT;
  
  // Total HBD to send (invoice amount + fee)
  const totalHBD = invoiceAmountHBD + v4vFee;
  
  return {
    invoiceAmountSats,
    invoiceAmountBTC,
    invoiceAmountHBD,
    v4vFee,
    totalHBD,
    invoice,
  };
}

/**
 * Validate V4V.app transfer is within limits
 * 
 * @param amountSats - Amount in satoshis
 * @throws Error if exceeds limits
 */
export function validateV4VLimits(amountSats: number): void {
  if (amountSats > V4VAPP_LIMITS.max4Hours) {
    throw new Error(
      `Amount exceeds V4V.app limit of ${V4VAPP_LIMITS.max4Hours.toLocaleString()} sats per 4 hours`
    );
  }
}

/**
 * Validate Lightning invoice before sending to v4v.app
 * Checks:
 * - Invoice is valid BOLT11 format
 * - Invoice matches expected amount
 * - Invoice is not expired
 * 
 * @param invoice - BOLT11 invoice string
 * @param expectedAmountSats - Expected satoshi amount
 * @throws Error if validation fails
 */
export function validateInvoiceForTransfer(
  invoice: string,
  expectedAmountSats: number
): void {
  // Decode invoice
  const decoded = decodeBOLT11Invoice(invoice);
  
  // Verify amount exists
  if (decoded.amount === null) {
    throw new Error('Invoice does not contain an amount');
  }
  
  // Verify amount matches
  if (decoded.amount !== expectedAmountSats) {
    throw new Error(
      `Invoice amount mismatch: expected ${expectedAmountSats} sats, got ${decoded.amount} sats`
    );
  }
  
  // Check expiry
  if (isInvoiceExpired(invoice)) {
    throw new Error('Invoice has expired. Please generate a new invoice.');
  }
}

/**
 * Send HBD transfer to v4v.app bridge for Lightning payment
 * Uses Hive Keychain to sign and broadcast the transfer
 * 
 * @param username - Current user's Hive username
 * @param invoice - BOLT11 Lightning invoice
 * @param amountHBD - Total HBD amount to send (includes v4v.app fee)
 * @param invoiceAmountSats - Invoice amount in satoshis (for validation)
 * @returns Transaction ID
 * @throws Error if transfer fails
 */
export async function sendV4VTransfer(
  username: string,
  invoice: string,
  amountHBD: number,
  invoiceAmountSats: number
): Promise<string> {
  console.log('[V4V TRANSFER] Initiating transfer:', {
    username,
    amountHBD,
    invoiceAmountSats,
    invoiceLength: invoice.length,
  });
  
  // Security validations
  validateInvoiceForTransfer(invoice, invoiceAmountSats);
  validateV4VLimits(invoiceAmountSats);
  
  // Format HBD amount (3 decimal places)
  const formattedAmount = amountHBD.toFixed(3);
  
  console.log('[V4V TRANSFER] Requesting Keychain transfer:', {
    to: V4VAPP_ACCOUNT,
    amount: formattedAmount,
    memo: invoice.substring(0, 50) + '...',
  });
  
  // Request transfer via Hive Keychain
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not found. Please install Hive Keychain.'));
      return;
    }
    
    window.hive_keychain.requestTransfer(
      username,
      V4VAPP_ACCOUNT,
      formattedAmount,
      invoice, // BOLT11 invoice in memo field
      'HBD',
      (response: KeychainResponse) => {
        console.log('[V4V TRANSFER] Keychain response:', response);
        
        if (response.success) {
          console.log('[V4V TRANSFER] Success! Transaction ID:', response.result?.id);
          resolve(response.result?.id || 'success');
        } else {
          console.error('[V4V TRANSFER] Failed:', response.message);
          reject(new Error(response.message || 'Transfer failed'));
        }
      }
    );
  });
}

// ============================================================================
// Exchange Rate Functions
// ============================================================================

/**
 * Get BTC/HBD exchange rate
 * 
 * PLACEHOLDER - Will be implemented with actual API call
 * Currently returns mock rate for development
 * 
 * @returns Promise<number> - BTC price in HBD
 */
export async function getBTCtoHBDRate(): Promise<number> {
  // TODO: Implement actual exchange rate API
  // Options:
  // 1. CoinGecko API: bitcoin price in USD, HBD ≈ $1
  // 2. Hive internal market API
  // 3. Binance or other exchange API
  
  console.warn('[LIGHTNING] Using mock BTC/HBD rate - implement actual API');
  
  // Mock rate: ~$100,000 BTC / $1 HBD = 100,000
  return 100000;
}

/**
 * Convert satoshis to HBD (convenience function)
 * 
 * @param sats - Amount in satoshis
 * @param btcHbdRate - BTC/HBD exchange rate
 * @returns HBD amount
 */
export function satsToHBD(sats: number, btcHbdRate: number): number {
  const btc = sats / 100_000_000;
  return btc * btcHbdRate;
}

/**
 * Convert HBD to satoshis (convenience function)
 * 
 * @param hbd - Amount in HBD
 * @param btcHbdRate - BTC/HBD exchange rate
 * @returns Satoshis amount
 */
export function hbdToSats(hbd: number, btcHbdRate: number): number {
  const btc = hbd / btcHbdRate;
  return Math.floor(btc * 100_000_000);
}
