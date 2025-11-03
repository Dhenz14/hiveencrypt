// Hive memo encryption utilities
// Uses @hiveio/dhive for real ECDH + AES-CBC encryption
// Integrates with Hive Keychain for secure key management

import { PrivateKey, Memo, PublicKey } from '@hiveio/dhive';

export interface EncryptionResult {
  encrypted: string;
  success: boolean;
  error?: string;
}

export interface DecryptionResult {
  decrypted: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Core Encryption Functions (Direct Key Usage - For Development/Testing Only)
// ============================================================================

/**
 * Encrypt a message using Hive memo encryption (ECDH + AES-256-CBC)
 * 
 * WARNING: This function requires a private key. In production, use
 * requestKeychainEncryption() instead to avoid exposing private keys.
 * 
 * @param message - Plain text message to encrypt
 * @param fromPrivateKey - Sender's private memo key (WIF format)
 * @param toPublicKey - Recipient's public memo key
 * @returns Encrypted memo string starting with #
 */
export const encryptMemo = async (
  message: string,
  fromPrivateKey: string,
  toPublicKey: string
): Promise<EncryptionResult> => {
  try {
    // Validate inputs
    if (!message || message.trim().length === 0) {
      return {
        encrypted: '',
        success: false,
        error: 'Message cannot be empty',
      };
    }

    if (!fromPrivateKey || !toPublicKey) {
      return {
        encrypted: '',
        success: false,
        error: 'Both private key and public key are required',
      };
    }

    // Parse keys
    let privateKey: PrivateKey;
    let publicKey: PublicKey;

    try {
      privateKey = PrivateKey.fromString(fromPrivateKey);
    } catch (err) {
      return {
        encrypted: '',
        success: false,
        error: 'Invalid private key format. Expected WIF format.',
      };
    }

    try {
      publicKey = PublicKey.fromString(toPublicKey);
    } catch (err) {
      return {
        encrypted: '',
        success: false,
        error: 'Invalid public key format.',
      };
    }

    // Encode the memo using dhive's Memo.encode
    // This uses ECDH to create a shared secret, then AES-256-CBC to encrypt
    const encrypted = Memo.encode(privateKey, publicKey, message);
    
    return {
      encrypted,
      success: true,
    };
  } catch (error) {
    return {
      encrypted: '',
      success: false,
      error: error instanceof Error ? error.message : 'Encryption failed',
    };
  }
};

/**
 * Decrypt a Hive encrypted memo
 * 
 * WARNING: This function requires a private key. In production, use
 * requestKeychainDecryption() instead to avoid exposing private keys.
 * 
 * @param encryptedMemo - Encrypted memo string (starts with #)
 * @param privateKey - Private memo key for decryption (WIF format)
 * @returns Decrypted plain text message
 */
export const decryptMemo = async (
  encryptedMemo: string,
  privateKey: string
): Promise<DecryptionResult> => {
  try {
    // Handle unencrypted memos
    if (!encryptedMemo.startsWith('#')) {
      return {
        decrypted: encryptedMemo,
        success: true,
      };
    }

    // Validate inputs
    if (!privateKey) {
      return {
        decrypted: '',
        success: false,
        error: 'Private key is required for decryption',
      };
    }

    // Parse private key
    let privKey: PrivateKey;
    try {
      privKey = PrivateKey.fromString(privateKey);
    } catch (err) {
      return {
        decrypted: '',
        success: false,
        error: 'Invalid private key format. Expected WIF format.',
      };
    }

    // Decode the memo using dhive's Memo.decode
    // This handles ECDH shared secret derivation and AES-256-CBC decryption
    const decrypted = Memo.decode(privKey, encryptedMemo);
    
    return {
      decrypted,
      success: true,
    };
  } catch (error) {
    // Handle specific decryption errors
    const errorMessage = error instanceof Error ? error.message : 'Decryption failed';
    
    if (errorMessage.includes('checksum')) {
      return {
        decrypted: '',
        success: false,
        error: 'Memo checksum validation failed. The memo may be corrupted or you may not have the correct key.',
      };
    }
    
    if (errorMessage.includes('Invalid')) {
      return {
        decrypted: '',
        success: false,
        error: 'Invalid encrypted memo format.',
      };
    }

    return {
      decrypted: '',
      success: false,
      error: errorMessage,
    };
  }
};

// ============================================================================
// Hive Keychain Integration (Production-Ready)
// ============================================================================

/**
 * Request memo decryption via Hive Keychain browser extension
 * This is the RECOMMENDED approach for production as it never exposes private keys
 * 
 * @param encryptedMemo - Encrypted memo to decrypt
 * @param username - Hive username (to identify which key to use)
 * @returns Promise resolving to decrypted message
 */
export const requestKeychainDecryption = async (
  encryptedMemo: string,
  username: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Check if Keychain is installed
    if (typeof window === 'undefined' || !window.hive_keychain) {
      reject(new Error('Hive Keychain extension is not installed. Please install it from https://hive-keychain.com'));
      return;
    }

    // Handle unencrypted memos
    if (!encryptedMemo.startsWith('#')) {
      resolve(encryptedMemo);
      return;
    }

    // Use requestVerifyKey - the actual working API that PeakD uses
    // Source: https://peakd.com/@steempeak/decrypt-memos-on-steempeak-com-using-keychain
    window.hive_keychain.requestVerifyKey(
      username,
      encryptedMemo,
      'Memo',
      (response: any) => {
        if (response.success) {
          // Keychain returns the decrypted message in response.result
          resolve(response.result);
        } else {
          reject(new Error(response.message || 'Keychain decryption failed. Please check that you have the correct account selected.'));
        }
      }
    );
  });
};

/**
 * Request memo encryption via Hive Keychain browser extension
 * This is the RECOMMENDED approach for production as it never exposes private keys
 * 
 * @param message - Plain text message to encrypt
 * @param username - Current user's Hive username
 * @param recipient - Recipient's Hive username
 * @returns Promise resolving to encrypted memo string
 */
export const requestKeychainEncryption = async (
  message: string,
  username: string,
  recipient: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Check if Keychain is installed
    if (typeof window === 'undefined' || !window.hive_keychain) {
      reject(new Error('Hive Keychain extension is not installed. Please install it from https://hive-keychain.com'));
      return;
    }

    // Validate inputs
    if (!message || message.trim().length === 0) {
      reject(new Error('Message cannot be empty'));
      return;
    }

    if (!username || !recipient) {
      reject(new Error('Both username and recipient are required'));
      return;
    }

    // Request encoding from Keychain
    window.hive_keychain.requestEncode(
      username,
      recipient,
      message,
      'Memo',
      (response: any) => {
        if (response.success) {
          // Keychain returns the encrypted memo
          resolve(response.result);
        } else {
          reject(new Error(response.message || 'Keychain encryption failed'));
        }
      }
    );
  });
};

/**
 * Check if Hive Keychain is available
 */
export const isKeychainAvailable = (): boolean => {
  return typeof window !== 'undefined' && !!window.hive_keychain;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a memo is encrypted
 * @param memo - Memo string to check
 * @returns true if memo starts with # (encrypted), false otherwise
 */
export const isEncrypted = (memo: string): boolean => {
  return memo.startsWith('#');
};

/**
 * Generate a random encryption key (for future group messaging feature)
 * @returns Hex-encoded random 32-byte key
 */
export const generateKey = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

// ============================================================================
// Development & Testing Utilities
// ============================================================================

/**
 * Test encryption/decryption roundtrip
 * 
 * WARNING: For development/testing only! Never use this with real private keys
 * in production. Always use Keychain integration for production.
 * 
 * @param message - Test message
 * @param senderPrivateKey - Sender's private memo key (WIF format)
 * @param receiverPublicKey - Receiver's public memo key
 * @param receiverPrivateKey - Receiver's private memo key (for decryption test)
 */
export const testEncryptionRoundtrip = async (
  message: string,
  senderPrivateKey: string,
  receiverPublicKey: string,
  receiverPrivateKey: string
): Promise<void> => {
  console.group('🔐 Hive Memo Encryption Test');
  
  // Warning about production usage
  console.warn(
    '⚠️  WARNING: This test function uses private keys directly.\n' +
    '   In production, ALWAYS use requestKeychainEncryption() and\n' +
    '   requestKeychainDecryption() to avoid exposing private keys!'
  );
  
  console.log('📝 Original message:', message);
  
  // Test encryption
  console.log('\n🔒 Testing encryption...');
  const encryptResult = await encryptMemo(message, senderPrivateKey, receiverPublicKey);
  
  if (!encryptResult.success) {
    console.error('❌ Encryption failed:', encryptResult.error);
    console.groupEnd();
    return;
  }
  
  console.log('✅ Encrypted:', encryptResult.encrypted);
  console.log('   Format check:', encryptResult.encrypted.startsWith('#') ? 'Valid (starts with #)' : 'Invalid');
  
  // Test decryption
  console.log('\n🔓 Testing decryption...');
  const decryptResult = await decryptMemo(encryptResult.encrypted, receiverPrivateKey);
  
  if (!decryptResult.success) {
    console.error('❌ Decryption failed:', decryptResult.error);
    console.groupEnd();
    return;
  }
  
  console.log('✅ Decrypted:', decryptResult.decrypted);
  
  // Verify roundtrip
  const success = decryptResult.decrypted === message;
  console.log('\n' + (success ? '✅' : '❌') + ' Roundtrip test:', success ? 'PASSED' : 'FAILED');
  
  if (!success) {
    console.error('Expected:', message);
    console.error('Got:', decryptResult.decrypted);
  }
  
  console.groupEnd();
};

/**
 * Log information about proper Keychain usage
 */
export const logKeychainUsageGuidance = (): void => {
  console.group('🔑 Hive Keychain Integration Guide');
  console.log(
    '✅ CORRECT (Production):\n' +
    '   const encrypted = await requestKeychainEncryption(msg, user, recipient);\n' +
    '   const decrypted = await requestKeychainDecryption(encrypted, user);\n\n' +
    '❌ INCORRECT (Exposes private keys):\n' +
    '   const encrypted = await encryptMemo(msg, privateKey, publicKey);\n' +
    '   const decrypted = await decryptMemo(encrypted, privateKey);\n\n' +
    '📚 Benefits of Keychain:\n' +
    '   • Private keys never leave the extension\n' +
    '   • User approves each encryption/decryption\n' +
    '   • Keys stored securely in browser extension\n' +
    '   • Works across all Hive dApps\n\n' +
    '🔗 Install Keychain: https://hive-keychain.com'
  );
  console.groupEnd();
};

// Declare global window interface for TypeScript
declare global {
  interface Window {
    hive_keychain?: any;
  }
}
