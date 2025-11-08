import { gzipCompress, gzipDecompress } from './compression';

/**
 * Custom JSON encryption module for Hive Messenger image messaging
 * Handles payload optimization, encryption, and integrity verification
 * 
 * @module customJsonEncryption
 */

/**
 * Image message payload structure (before encryption)
 */
export interface ImagePayload {
  imageData: string;      // base64 encoded image
  message?: string;       // optional text message
  filename: string;       // original filename
  contentType: string;    // MIME type (e.g., 'image/webp')
  from: string;          // sender username
  to: string;            // recipient username
  timestamp: number;     // Unix timestamp
}

/**
 * Optimized payload structure using short keys (saves 25-30%)
 */
interface OptimizedPayload {
  t: string;    // "to"
  f: string;    // "from"
  i: string;    // "img" (image data)
  m?: string;   // "msg" (message)
  n: string;    // "name" (filename)
  c: string;    // "contentType"
  ts: number;   // "timestamp"
}

/**
 * Generate SHA-256 hash for integrity verification
 * 
 * @param data - String data to hash
 * @returns Promise<string> - Hex-encoded hash
 */
export async function generateSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Request encryption from Hive Keychain
 * 
 * @param message - Message to encrypt (should start with #)
 * @param senderUsername - Sender's Hive username
 * @param recipientUsername - Recipient's Hive username
 * @returns Promise<string> - Encrypted message
 */
async function requestKeychainEncryption(
  message: string,
  senderUsername: string,
  recipientUsername: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    // Use requestEncodeMessage - the correct Keychain API
    window.hive_keychain.requestEncodeMessage(
      senderUsername,
      recipientUsername,
      message,
      'Memo',
      (response: any) => {
        if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.message || 'Encryption failed'));
        }
      }
    );
  });
}

/**
 * Request decryption from Hive Keychain
 * 
 * @param encryptedMessage - Encrypted message to decrypt
 * @param username - User's Hive username
 * @returns Promise<string> - Decrypted message
 */
async function requestKeychainDecryption(
  encryptedMessage: string,
  username: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestDecode(
      username,
      encryptedMessage,
      'Memo',
      (response: any) => {
        if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.message || 'Decryption failed'));
        }
      }
    );
  });
}

/**
 * Encrypt an image payload for blockchain storage
 * 
 * Process:
 * 1. Create optimized JSON with short keys (saves 25-30%)
 * 2. Generate SHA-256 hash for integrity
 * 3. Encrypt via Hive Keychain (memo key)
 * 
 * Note: Gzip compression is skipped for images because base64-encoded image data
 * doesn't compress well (~99% size). WebP images are already compressed.
 * 
 * @param payload - Image payload to encrypt
 * @param senderUsername - Sender's username
 * @returns Promise<{ encrypted: string; hash: string }>
 * 
 * @example
 * const { encrypted, hash } = await encryptImagePayload(payload, 'alice');
 * console.log(`Encrypted size: ${encrypted.length}, Hash: ${hash.substring(0, 8)}...`);
 */
export async function encryptImagePayload(
  payload: ImagePayload,
  senderUsername: string
): Promise<{ encrypted: string; hash: string }> {
  console.log('[ENCRYPT] Starting encryption process:', {
    from: payload.from,
    to: payload.to,
    imageSize: payload.imageData.length,
    hasMessage: !!payload.message
  });

  // Step 1: Create optimized JSON with short keys
  const optimized: OptimizedPayload = {
    t: payload.to,
    f: payload.from,
    i: payload.imageData,
    n: payload.filename,
    c: payload.contentType,
    ts: payload.timestamp
  };

  if (payload.message) {
    optimized.m = payload.message;
  }

  // Step 2: Stringify with no whitespace
  const jsonStr = JSON.stringify(optimized);
  console.log('[ENCRYPT] Optimized JSON size:', jsonStr.length, 'bytes');

  // Step 3: Generate SHA-256 hash for integrity (hash the JSON directly)
  // Note: Skipping gzip compression because base64 image data doesn't compress well
  // WebP images are already compressed, so gzip adds no benefit (~99% size)
  const hash = await generateSHA256(jsonStr);
  console.log('[ENCRYPT] Generated SHA-256 hash:', hash.substring(0, 16) + '...');

  // Step 4: Encrypt via Keychain (prefix with # for memo encryption)
  const messageToEncrypt = `#${jsonStr}`;
  const encrypted = await requestKeychainEncryption(
    messageToEncrypt,
    senderUsername,
    payload.to
  );

  console.log('[ENCRYPT] ✅ Encryption complete, final size:', encrypted.length, 'bytes');

  return { encrypted, hash };
}

/**
 * Decrypt an encrypted image payload
 * 
 * Process:
 * 1. Decrypt via Hive Keychain
 * 2. Verify integrity hash (if provided)
 * 3. Parse and expand JSON (no decompression - gzip skipped for images)
 * 
 * @param encryptedPayload - Encrypted payload from blockchain
 * @param username - User's username for decryption
 * @param expectedHash - Optional SHA-256 hash for verification
 * @returns Promise<ImagePayload>
 * 
 * @throws Error if integrity check fails
 */
export async function decryptImagePayload(
  encryptedPayload: string,
  username: string,
  expectedHash?: string
): Promise<ImagePayload> {
  console.log('[DECRYPT] Starting decryption process:', {
    username,
    payloadLength: encryptedPayload.length,
    hasHash: !!expectedHash
  });

  // Step 1: Decrypt via Keychain
  const decrypted = await requestKeychainDecryption(encryptedPayload, username);

  // Step 2: Remove # prefix if present
  const jsonStr = decrypted.startsWith('#') ? decrypted.substring(1) : decrypted;
  console.log('[DECRYPT] Decrypted JSON size:', jsonStr.length, 'bytes');

  // Step 3: Verify integrity if hash provided
  if (expectedHash) {
    const actualHash = await generateSHA256(jsonStr);
    if (actualHash !== expectedHash) {
      console.error('[DECRYPT] ❌ Integrity check failed:', {
        expected: expectedHash.substring(0, 16),
        actual: actualHash.substring(0, 16)
      });
      throw new Error('Integrity check failed - data may be corrupted');
    }
    console.log('[DECRYPT] ✅ Integrity verified');
  }

  // Step 4: Parse and expand (no decompression needed - gzip removed for images)
  const optimized: OptimizedPayload = JSON.parse(jsonStr);

  const payload: ImagePayload = {
    to: optimized.t,
    from: optimized.f,
    imageData: optimized.i,
    message: optimized.m,
    filename: optimized.n,
    contentType: optimized.c,
    timestamp: optimized.ts
  };

  console.log('[DECRYPT] ✅ Decryption complete:', {
    from: payload.from,
    to: payload.to,
    imageSize: payload.imageData.length,
    hasMessage: !!payload.message
  });

  return payload;
}
