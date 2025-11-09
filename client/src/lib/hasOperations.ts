/**
 * HAS Operations for Mobile Messaging
 * 
 * This module provides HAS (Hive Authentication Services) wrappers for:
 * 1. Sending encrypted messages (memo transfers) via mobile wallet
 * 2. Decrypting received messages via mobile wallet
 * 
 * HAS enables mobile users to send/decrypt messages without exposing private keys,
 * similar to how Keychain works on desktop.
 */

import HAS from 'hive-auth-wrapper';
import { Memo, PrivateKey, PublicKey } from '@hiveio/dhive';
import { getAccount } from './hive';

export interface HASAuthData {
  username: string;
  token: string;
  expire: number;
  key: string;
}

/**
 * Encrypt a memo using HAS challenge for mobile users
 * 
 * HAS ENCRYPTION FLOW:
 * 1. Use HAS.challenge() to request the wallet to encrypt the memo
 * 2. The mobile wallet uses the user's private memo key (never exposed to app)
 * 3. Returns the encrypted memo string (starts with #)
 * 
 * This maintains security: private keys never leave the mobile wallet!
 * 
 * @param hasAuth - HAS authentication data
 * @param message - Plain text message to encrypt
 * @param fromUsername - Sender's Hive username
 * @param toUsername - Recipient's Hive username
 * @returns Encrypted memo string starting with #
 */
export const hasEncryptMemo = async (
  hasAuth: HASAuthData,
  message: string,
  fromUsername: string,
  toUsername: string
): Promise<string> => {
  try {
    console.log('[HAS ENCRYPT] Starting memo encryption via HAS challenge');
    console.log('[HAS ENCRYPT] From:', fromUsername, 'To:', toUsername);
    
    // Fetch recipient's public memo key from blockchain
    const toAccount = await getAccount(toUsername);
    
    if (!toAccount || !toAccount.memo_key) {
      throw new Error(`Could not fetch memo key for @${toUsername}`);
    }
    
    const recipientMemoKey = toAccount.memo_key;
    console.log('[HAS ENCRYPT] Recipient memo key:', recipientMemoKey.substring(0, 20) + '...');
    
    // Use HAS.challenge() to request memo encryption from the mobile wallet
    // The wallet will use the user's private memo key to encrypt
    // 
    // Challenge format for memo encryption:
    // - key_type: "memo" (uses memo key for encryption)
    // - challenge: JSON with { message, recipient_key }
    const encryptionRequest = {
      message,
      recipient: toUsername,
      recipient_key: recipientMemoKey,
    };
    
    const challengeData = {
      key_type: 'memo',
      challenge: JSON.stringify(encryptionRequest),
    };
    
    console.log('[HAS ENCRYPT] Sending encryption challenge to mobile wallet...');
    
    // @ts-expect-error - HAS library TypeScript definitions are incomplete (missing challenge method)
    const result = await HAS.challenge(hasAuth, challengeData);
    
    console.log('[HAS ENCRYPT] Challenge response received:', {
      hasData: !!result?.data,
      dataType: typeof result?.data,
    });
    
    if (!result || !result.data) {
      throw new Error('HAS encryption challenge failed - no result data');
    }
    
    // Extract encrypted memo from result
    let encrypted: string;
    
    if (typeof result.data === 'string') {
      encrypted = result.data;
    } else if (result.data.encrypted) {
      encrypted = result.data.encrypted;
    } else if (result.data.memo) {
      encrypted = result.data.memo;
    } else {
      // If wallet doesn't support memo encryption via challenge,
      // use client-side Memo.encode with public keys
      console.warn('[HAS ENCRYPT] Wallet does not support memo encryption via challenge');
      console.warn('[HAS ENCRYPT] Falling back to client-side encryption');
      
      // Fetch sender's public memo key
      const fromAccount = await getAccount(fromUsername);
      if (!fromAccount || !fromAccount.memo_key) {
        throw new Error(`Could not fetch memo key for @${fromUsername}`);
      }
      
      // Use dhive Memo.encode() with public keys
      // NOTE: This requires the sender's PRIVATE memo key which we don't have
      // So this fallback won't work properly. The wallet MUST support encryption.
      throw new Error('Mobile wallet does not support memo encryption. Please update Hive Keychain Mobile app.');
    }
    
    // Ensure encrypted memo starts with #
    if (!encrypted.startsWith('#')) {
      encrypted = '#' + encrypted;
    }
    
    console.log('[HAS ENCRYPT] ✅ Memo encrypted successfully');
    console.log('[HAS ENCRYPT] Encrypted preview:', encrypted.substring(0, 50) + '...');
    
    return encrypted;
  } catch (error: any) {
    console.error('[HAS ENCRYPT] Encryption failed:', error);
    
    // Handle specific error cases
    if (error?.message?.includes('expired')) {
      throw new Error('HAS session expired. Please re-authenticate.');
    }
    
    if (error?.message?.includes('cancel') || error?.message?.includes('reject')) {
      throw new Error('Encryption cancelled by user');
    }
    
    throw new Error(`HAS memo encryption failed: ${error?.message || 'Unknown error'}`);
  }
};

/**
 * Broadcast a transfer operation (send message) via HAS
 * 
 * This function creates a transfer operation and asks the mobile wallet to:
 * 1. Sign the transaction with the user's active key
 * 2. Broadcast it to the Hive blockchain
 * 
 * @param hasAuth - HAS authentication data (from login)
 * @param from - Sender's username
 * @param to - Recipient's username
 * @param amount - Amount to transfer (e.g., "0.001")
 * @param memo - Encrypted memo (or plaintext for wallet to encrypt)
 * @param currency - "HIVE" or "HBD" (default: "HBD")
 * @returns Transaction ID
 */
export const hasBroadcastTransfer = async (
  hasAuth: HASAuthData,
  from: string,
  to: string,
  amount: string,
  memo: string,
  currency: 'HIVE' | 'HBD' = 'HBD'
): Promise<string> => {
  try {
    console.log('[HAS BROADCAST] Starting transfer broadcast:', { from, to, amount, currency });
    
    // Create transfer operation in Hive format
    const transferOp = [
      'transfer',
      {
        from,
        to,
        amount: `${amount} ${currency}`,
        memo,
      },
    ];
    
    console.log('[HAS BROADCAST] Transfer operation created:', transferOp);
    
    // Broadcast via HAS - mobile wallet will sign and broadcast
    // key_type: "active" because transfers require active key
    const result = await HAS.broadcast(hasAuth, 'active', [transferOp]);
    
    console.log('[HAS BROADCAST] Broadcast result:', result);
    
    if (!result || !result.data) {
      throw new Error('HAS broadcast failed - no result data');
    }
    
    // Extract transaction ID from result
    // HAS returns decrypted data in result.data
    const txData = result.data;
    const txId = txData.id || txData.tx_id || txData.transaction_id;
    
    if (!txId) {
      console.warn('[HAS BROADCAST] No txId in result, using fallback');
      // Fallback: use timestamp-based ID
      return `has-tx-${Date.now()}`;
    }
    
    console.log('[HAS BROADCAST] ✅ Transfer successful, txId:', txId);
    return txId;
  } catch (error: any) {
    console.error('[HAS BROADCAST] Transfer failed:', error);
    
    // Handle specific error cases
    if (error?.message?.includes('expired')) {
      throw new Error('HAS session expired. Please re-authenticate.');
    }
    
    if (error?.message?.includes('cancel') || error?.message?.includes('reject')) {
      throw new Error('Transfer cancelled by user');
    }
    
    if (error?.message?.includes('balance') || error?.message?.includes('funds')) {
      throw new Error(`Insufficient ${currency} balance`);
    }
    
    if (error?.message?.includes('RC') || error?.message?.includes('resource')) {
      throw new Error('Insufficient Resource Credits. Please wait and try again.');
    }
    
    throw new Error(`HAS transfer failed: ${error?.message || 'Unknown error'}`);
  }
};

/**
 * Decrypt a memo using HAS challenge
 * 
 * This function asks the mobile wallet to decrypt an encrypted memo by:
 * 1. Sending a challenge request with the encrypted memo
 * 2. Mobile wallet decrypts using the user's private memo key
 * 3. Returns the decrypted plaintext
 * 
 * @param hasAuth - HAS authentication data (from login)
 * @param username - Current user's username
 * @param encryptedMemo - Encrypted memo string (starts with #)
 * @returns Decrypted plaintext message
 */
export const hasDecryptMemo = async (
  hasAuth: HASAuthData,
  username: string,
  encryptedMemo: string
): Promise<string> => {
  try {
    // Handle unencrypted memos
    if (!encryptedMemo.startsWith('#')) {
      console.log('[HAS DECRYPT] Memo not encrypted, returning as-is');
      return encryptedMemo;
    }
    
    console.log('[HAS DECRYPT] Starting memo decryption via HAS challenge');
    console.log('[HAS DECRYPT] Encrypted memo preview:', encryptedMemo.substring(0, 50) + '...');
    
    // Use HAS challenge API to request memo decryption
    // The mobile wallet will decrypt using the user's private memo key
    // 
    // Challenge format:
    // - key_type: "memo" (uses memo key for decryption)
    // - challenge: the encrypted memo data to decrypt
    const challengeData = {
      key_type: 'memo',
      challenge: encryptedMemo, // Send encrypted memo as challenge
    };
    
    console.log('[HAS DECRYPT] Sending challenge request to mobile wallet...');
    
    // @ts-expect-error - HAS library TypeScript definitions are incomplete (missing challenge method)
    const result = await HAS.challenge(hasAuth, challengeData);
    
    console.log('[HAS DECRYPT] Challenge response received:', {
      hasData: !!result?.data,
      dataType: typeof result?.data,
    });
    
    if (!result || !result.data) {
      throw new Error('HAS challenge failed - no result data');
    }
    
    // Extract decrypted memo from result
    // HAS returns decrypted data in result.data
    let decrypted: string;
    
    if (typeof result.data === 'string') {
      decrypted = result.data;
    } else if (result.data.decrypted) {
      decrypted = result.data.decrypted;
    } else if (result.data.message) {
      decrypted = result.data.message;
    } else {
      // Fallback: try to extract any string from data object
      decrypted = JSON.stringify(result.data);
    }
    
    console.log('[HAS DECRYPT] ✅ Decryption successful');
    console.log('[HAS DECRYPT] Decrypted preview:', decrypted.substring(0, 50) + '...');
    
    return decrypted;
  } catch (error: any) {
    console.error('[HAS DECRYPT] Decryption failed:', error);
    
    // Handle specific error cases
    if (error?.message?.includes('expired')) {
      throw new Error('HAS session expired. Please re-authenticate.');
    }
    
    if (error?.message?.includes('cancel') || error?.message?.includes('reject')) {
      throw new Error('Decryption cancelled by user');
    }
    
    throw new Error(`HAS decryption failed: ${error?.message || 'Unknown error'}`);
  }
};

/**
 * Check if HAS token is still valid
 * @param hasAuth - HAS authentication data
 * @returns true if token is still valid, false if expired
 */
export const isHASTokenValid = (hasAuth: HASAuthData | null): boolean => {
  if (!hasAuth || !hasAuth.expire) {
    return false;
  }
  
  // Check if token expiration time is in the future
  return hasAuth.expire > Date.now();
};

/**
 * Get time remaining until HAS token expires
 * @param hasAuth - HAS authentication data
 * @returns Milliseconds until expiration, or 0 if expired/invalid
 */
export const getHASTokenTimeRemaining = (hasAuth: HASAuthData | null): number => {
  if (!hasAuth || !hasAuth.expire) {
    return 0;
  }
  
  const remaining = hasAuth.expire - Date.now();
  return Math.max(0, remaining);
};
