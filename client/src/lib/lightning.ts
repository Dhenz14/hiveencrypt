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
import type { KeychainResponse } from './hive';
import { getAccount } from './hive';

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
  try {
    console.log('[V4V TRANSFER] Initiating transfer:', {
      username,
      amountHBD,
      invoiceAmountSats,
      invoiceLength: invoice.length,
    });
    
    // HIGH-3: PRE-FLIGHT HBD Balance Check
    const account = await getAccount(username);
    
    if (!account) {
      throw new Error('BALANCE_CHECK_FAILED: Unable to verify account balance. Please check your connection and try again.');
    }
    
    const hbdBalance = parseFloat(account.hbd_balance.split(' ')[0]);
    
    if (hbdBalance < amountHBD) {
      throw new Error(`INSUFFICIENT_BALANCE: You need ${amountHBD.toFixed(3)} HBD but only have ${hbdBalance.toFixed(3)} HBD available.`);
    }
    
    console.log('[V4V TRANSFER] Balance check passed:', hbdBalance, 'HBD available');
    
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
    return await new Promise<string>((resolve, reject) => {
      if (!window.hive_keychain) {
        reject(new Error('KEYCHAIN_MISSING: Hive Keychain not installed. Please install Hive Keychain browser extension to continue.'));
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
            
            // Normalize Keychain rejection messages
            const keychainMessage = response.message || '';
            if (keychainMessage.toLowerCase().includes('cancel')) {
              reject(new Error('KEYCHAIN_CANCELLED: Transfer cancelled. Please approve the transfer in Hive Keychain to continue.'));
            } else if (keychainMessage.toLowerCase().includes('denied')) {
              reject(new Error('KEYCHAIN_DENIED: Transfer denied. Please approve the transfer in Hive Keychain to continue.'));
            } else {
              reject(new Error(`KEYCHAIN_ERROR: ${keychainMessage || 'Transfer failed. Please try again.'}`));
            }
          }
        }
      );
    });
    
  } catch (error) {
    console.error('[V4V TRANSFER] Error:', error);
    
    // Comprehensive error normalization
    if (error instanceof Error) {
      const message = error.message;
      
      // Pass through our prefixed user-friendly messages
      if (message.startsWith('BALANCE_CHECK_FAILED:') || 
          message.startsWith('INSUFFICIENT_BALANCE:') ||
          message.startsWith('KEYCHAIN_MISSING:') ||
          message.startsWith('KEYCHAIN_CANCELLED:') ||
          message.startsWith('KEYCHAIN_DENIED:') ||
          message.startsWith('KEYCHAIN_ERROR:')) {
        // Strip prefix and throw clean message
        throw new Error(message.split(': ').slice(1).join(': '));
      }
      
      // Handle validation errors from validateInvoiceForTransfer
      if (message.includes('Invalid invoice') || 
          message.includes('expired') || 
          message.includes('BOLT11') ||
          message.includes('does not contain an amount') ||
          message.includes('does not specify an amount') ||
          message.includes('amount mismatch') ||
          message.includes('Invoice amount') ||
          message.includes('Invalid amount')) {
        throw new Error('Invalid Lightning invoice. Please regenerate the invoice and try again.');
      }
      
      // Handle V4V limit errors
      if (message.includes('limit') || message.includes('maximum')) {
        throw new Error('Amount exceeds V4V.app transfer limits. Please try a smaller amount.');
      }
      
      // Handle network errors
      if (message.toLowerCase().includes('fetch') || 
          message.toLowerCase().includes('network') || 
          message.toLowerCase().includes('timeout') ||
          message.toLowerCase().includes('connection')) {
        throw new Error('Network error. Please check your connection and try again.');
      }
      
      // Generic fallback for unknown errors
      throw new Error('Unable to complete transfer. Please try again or contact support if the problem persists.');
    }
    
    // Non-Error instances (defensive)
    throw new Error('Unexpected error during transfer. Please try again.');
  }
}

// ============================================================================
// Exchange Rate Functions
// ============================================================================

/**
 * Fallback BTC/HBD exchange rate
 * Conservative estimate (~$95k BTC) used when CoinGecko API fails
 */
const FALLBACK_BTC_HBD_RATE = 95000;

/**
 * Get BTC/HBD exchange rate
 * Fetches real-time Bitcoin price from CoinGecko API
 * Assumes HBD ≈ $1 USD
 * 
 * @returns Promise<number> - BTC price in HBD (never throws, returns fallback on error)
 */
export async function getBTCtoHBDRate(): Promise<number> {
  try {
    console.log('[EXCHANGE RATE] Fetching BTC/USD rate from CoinGecko...');
    
    // CoinGecko public API (no auth required)
    // Free tier: 10-30 calls/minute
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );
    
    if (!response.ok) {
      console.warn('[EXCHANGE RATE] CoinGecko API error:', response.status);
      return FALLBACK_BTC_HBD_RATE;
    }
    
    const data = await response.json();
    const btcUSD = data?.bitcoin?.usd;
    
    if (!btcUSD || typeof btcUSD !== 'number') {
      console.warn('[EXCHANGE RATE] Invalid response from CoinGecko:', data);
      return FALLBACK_BTC_HBD_RATE;
    }
    
    // HBD ≈ $1 USD (Hive Backed Dollar is pegged to USD)
    // Therefore: BTC/HBD rate ≈ BTC/USD rate
    const rate = btcUSD / 1;
    
    console.log('[EXCHANGE RATE] BTC/HBD rate:', rate);
    
    return rate;
    
  } catch (error) {
    console.error('[EXCHANGE RATE] Failed to fetch BTC/HBD rate:', error);
    console.warn('[EXCHANGE RATE] Using fallback rate:', FALLBACK_BTC_HBD_RATE);
    return FALLBACK_BTC_HBD_RATE;
  }
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

// ============================================================================
// V4V.app Reverse Bridge (Lightning → HBD) (v2.3.0)
// ============================================================================

/**
 * V4V.app Reverse Bridge API constants
 */
export const V4VAPP_REVERSE_BRIDGE = {
  endpoint: 'https://api.v4v.app/v1/new_invoice_hive/qrcode',
  appName: 'hive_messenger',
  expirySeconds: 600,  // 10 minutes
  minSats: 133,        // Minimum invoice amount
  maxSats: 70000,      // Maximum invoice amount
  baseFee: 50,         // 50 sats base fee
  feePercent: 0.005,   // 0.5% fee
};

/**
 * Generate Lightning invoice via V4V.app Reverse Bridge (Lightning → HBD)
 * When paid, the Lightning sats are converted to HBD and sent to recipient's Hive wallet
 * 
 * This is the REVERSE of the normal V4V bridge:
 * - Normal bridge: User sends HBD → v4v.app pays Lightning invoice
 * - Reverse bridge: User pays Lightning invoice → v4v.app sends HBD to Hive account
 * 
 * @param recipientUsername - Hive username to receive HBD
 * @param hbdAmount - Amount of HBD to receive (e.g., 0.958)
 * @param senderUsername - Username of sender (for message)
 * @returns Promise<LightningInvoice> - Lightning invoice that when paid sends HBD
 */
export async function generateV4VReverseInvoice(
  recipientUsername: string,
  hbdAmount: number,
  senderUsername: string
): Promise<LightningInvoice> {
  try {
    console.log('[V4V REVERSE BRIDGE] Generating invoice:', {
      recipient: recipientUsername,
      hbdAmount,
      sender: senderUsername,
    });
    
    // Validate inputs
    if (!recipientUsername || !senderUsername) {
      throw new Error('Recipient and sender usernames are required');
    }
    
    if (hbdAmount <= 0) {
      throw new Error('HBD amount must be positive');
    }
    
    // Format request body
    const requestBody = {
      app_name: V4VAPP_REVERSE_BRIDGE.appName,
      expiry: V4VAPP_REVERSE_BRIDGE.expirySeconds,
      hive_accname: recipientUsername,
      message: `Tip from @${senderUsername} via Hive Messenger`,
      hbd_amount: parseFloat(hbdAmount.toFixed(3)), // Ensure 3 decimal places
    };
    
    console.log('[V4V REVERSE BRIDGE] API request:', requestBody);
    
    // Call V4V.app reverse bridge API
    const response = await fetch(V4VAPP_REVERSE_BRIDGE.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[V4V REVERSE BRIDGE] API error:', response.status, errorText);
      throw new Error(`V4V.app API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response
    if (!data || !data.invoice) {
      throw new Error('Invalid response from V4V.app - no invoice returned');
    }
    
    const invoice = data.invoice;
    
    // Validate invoice format
    if (typeof invoice !== 'string' || !invoice.toLowerCase().startsWith('lnbc')) {
      throw new Error('Invalid invoice format from V4V.app');
    }
    
    // Decode invoice to extract details and validate amount
    const decoded = decodeBOLT11Invoice(invoice);
    
    if (!decoded.amount) {
      throw new Error('Invoice does not contain an amount');
    }
    
    console.log('[V4V REVERSE BRIDGE] Invoice generated successfully:', {
      invoiceLength: invoice.length,
      amountSats: decoded.amount,
      hbdAmount,
    });
    
    // Return Lightning invoice object
    // Note: V4V reverse bridge doesn't provide LNURL params, so we create a minimal structure
    return {
      invoice,
      params: {
        min: decoded.amount * 1000, // Convert sats to millisats
        max: decoded.amount * 1000,
        metadata: JSON.stringify([['text/plain', `Tip to @${recipientUsername} via Hive Messenger`]]),
        callback: V4VAPP_REVERSE_BRIDGE.endpoint,
      },
      minSendable: decoded.amount,
      maxSendable: decoded.amount,
    };
    
  } catch (error) {
    console.error('[V4V REVERSE BRIDGE] Failed to generate invoice:', error);
    throw new Error(
      `Failed to generate HBD tip invoice: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Calculate total sats required for V4V reverse bridge transfer
 * Includes V4V.app fee (50 sats + 0.5%)
 * 
 * @param hbdAmount - HBD amount to receive
 * @param btcHbdRate - Current BTC/HBD exchange rate
 * @returns Object with satoshis breakdown
 */
export function calculateV4VReverseFee(
  hbdAmount: number,
  btcHbdRate: number
): {
  hbdAmount: number;
  baseSats: number;
  baseFee: number;
  percentFee: number;
  totalSats: number;
} {
  // Convert HBD to base sats
  const baseSats = hbdToSats(hbdAmount, btcHbdRate);
  
  // Calculate fees
  const baseFee = V4VAPP_REVERSE_BRIDGE.baseFee;  // 50 sats
  const percentFee = Math.ceil(baseSats * V4VAPP_REVERSE_BRIDGE.feePercent);  // 0.5%
  
  // Total sats = base amount + fees
  const totalSats = baseSats + baseFee + percentFee;
  
  return {
    hbdAmount,
    baseSats,
    baseFee,
    percentFee,
    totalSats,
  };
}

// ============================================================================
// Tip Notifications (v2.3.0)
// ============================================================================

/**
 * Send tip notification message to recipient
 * Creates encrypted message on Hive blockchain notifying recipient of tip
 * 
 * @param senderUsername - Username of tip sender
 * @param recipientUsername - Username of tip recipient
 * @param txId - Hive transaction ID of the tip transfer
 * @param receivedCurrency - Currency type ('sats' | 'hbd')
 * @param amount - Amount as formatted string (e.g., "1,000" for sats, "0.958" for HBD)
 * @returns Promise<string> - Transaction ID of notification message
 */
export async function sendTipNotification(
  senderUsername: string,
  recipientUsername: string,
  txId: string,
  receivedCurrency: 'sats' | 'hbd',
  amount: string
): Promise<string> {
  // Format notification message based on currency type
  let notificationContent: string;
  
  if (receivedCurrency === 'sats') {
    notificationContent = `Lightning Tip Received: ${amount} sats\nhttps://hiveblocks.com/tx/${txId}`;
  } else {
    // HBD
    notificationContent = `Tip Received: ${amount} HBD\nhttps://hiveblocks.com/tx/${txId}`;
  }
  
  console.log('[TIP NOTIFICATION] Sending notification:', {
    from: senderUsername,
    to: recipientUsername,
    txId,
    receivedCurrency,
    amount,
  });
  
  // Import sendEncryptedMemo function (avoiding circular dependency)
  const { sendEncryptedMemo } = await import('./hive');
  
  try {
    // Send encrypted notification to recipient
    const notificationTxId = await sendEncryptedMemo(
      senderUsername,
      recipientUsername,
      notificationContent,
      '0.001' // Minimum HBD amount for notification
    );
    
    console.log('[TIP NOTIFICATION] Notification sent successfully:', notificationTxId);
    return notificationTxId;
    
  } catch (error) {
    console.error('[TIP NOTIFICATION] Failed to send notification:', error);
    throw new Error(
      `Failed to send tip notification: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
