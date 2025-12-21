import { Client, PrivateKey, PublicKey, Memo } from '@hiveio/dhive';
import { KeychainSDK, KeychainKeyTypes } from 'keychain-sdk';
import { hiveClient as optimizedHiveClient } from './hiveClient';
import { logger } from '@/lib/logger';

// Initialize Hive client with public node (for direct access)
export const hiveClient = new Client([
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://rpc.ecency.com',
  'https://hive-api.arcange.eu',
]);

/**
 * Normalizes Hive blockchain timestamps to proper UTC format
 * Hive returns timestamps like "2025-02-27T23:27:00" or "2024-11-18T22:11:54+00:00"
 * JavaScript interprets timestamps without timezone as local time, so we append "Z" to mark them as UTC
 * 
 * @param timestamp - Raw timestamp from Hive blockchain
 * @returns ISO 8601 timestamp with UTC indicator
 */
export const normalizeHiveTimestamp = (timestamp: string | null | undefined): string => {
  if (!timestamp) return new Date().toISOString();
  
  // Check if timestamp already ends with a timezone indicator
  // Match: Z at end, or +/-HH:MM at end, or +/-HHMM at end, or +/-HH at end
  const hasTimezone = /[Z]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$|[+-]\d{2}$/.test(timestamp);
  
  if (hasTimezone) {
    return timestamp;
  }
  
  // No timezone found at end - append Z to mark as UTC
  return timestamp + 'Z';
};

// Hive Keychain integration
export interface KeychainResponse {
  success: boolean;
  result?: string | { id: string } | any; // Can be string, object with id, or other formats
  message?: string;
  error?: string;
  data?: any;
  publicKey?: any; // Keychain may return publicKey directly or in data
}

declare global {
  interface Window {
    hive_keychain?: any;
  }
}

export const isKeychainInstalled = (): boolean => {
  return typeof window !== 'undefined' && !!window.hive_keychain;
};

export const requestHandshake = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!isKeychainInstalled()) {
      resolve(false);
      return;
    }
    
    window.hive_keychain.requestHandshake(() => {
      resolve(true);
    });
  });
};

export const requestLogin = (username: string): Promise<KeychainResponse> => {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      reject({ success: false, error: 'Hive Keychain not installed' });
      return;
    }

    window.hive_keychain.requestSignBuffer(
      username,
      `Login to Hive Messenger at ${new Date().toISOString()}`,
      'Posting',
      (response: KeychainResponse) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response);
        }
      }
    );
  });
};

export const requestEncode = (
  username: string,
  recipient: string,
  message: string,
  keyType: 'Memo' | 'Posting' | 'Active' = 'Memo'
): Promise<KeychainResponse> => {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      reject({ success: false, error: 'Hive Keychain not installed' });
      return;
    }

    window.hive_keychain.requestEncodeMessage(
      username,
      recipient,
      message,
      keyType,
      (response: KeychainResponse) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response);
        }
      }
    );
  });
};

export const requestTransfer = async (
  from: string,
  to: string,
  amount: string,
  memo: string,
  currency: 'HIVE' | 'HBD' = 'HBD'
): Promise<KeychainResponse> => {
  // Use Keychain extension (works on desktop and Keychain Mobile browser)
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      reject({ success: false, error: 'Hive Keychain not installed' });
      return;
    }

    window.hive_keychain.requestTransfer(
      from,
      to,
      amount,
      memo,
      currency,
      (response: KeychainResponse) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response);
        }
      },
      true // Enable auto-encryption - Keychain will encrypt memos starting with #
    );
  });
};

/**
 * Extracts the transaction ID string from a Keychain transfer response.
 * Keychain may return the ID directly as a string or wrapped in an object.
 */
export const extractTransactionId = (result: any): string => {
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof result === 'object' && result.id) {
    return result.id;
  }
  // Fallback: convert to string
  return String(result);
};

export const getAccount = async (username: string) => {
  try {
    const accounts = await hiveClient.database.getAccounts([username]);
    if (accounts && accounts.length > 0) {
      return accounts[0];
    }
    return null;
  } catch (error) {
    logger.error('Error fetching account:', error);
    return null;
  }
};

// TIER 2 OPTIMIZATION: Added start parameter for incremental pagination
// TIER 3 OPTIMIZATION: Updated to use new OperationFilter type
export const getAccountHistory = async (
  username: string,
  limit: number = 100,
  filter: import('./hiveClient').OperationFilter = 'transfers',
  start: number = -1
) => {
  try {
    // Use filtered query for 10-100x performance improvement
    const history = await optimizedHiveClient.getAccountHistory(
      username,
      limit,
      filter,  // TIER 3: Use new filter parameter
      start  // TIER 2: Pass start for incremental sync
    );
    return history;
  } catch (error) {
    logger.error('Error fetching account history:', error);
    return [];
  }
};

// Filter transfers with encrypted memos
export const filterEncryptedMessages = (history: any[], currentUser: string) => {
  return history
    .filter(([, op]) => {
      const operation = op.op;
      if (operation[0] !== 'transfer') return false;
      
      const transfer = operation[1];
      const memo = transfer.memo;
      
      // Check if message is encrypted (starts with #) and involves current user
      return (
        memo &&
        memo.startsWith('#') &&
        (transfer.to === currentUser || transfer.from === currentUser)
      );
    })
    .map(([index, op]) => ({
      index,
      ...op.op[1],
      timestamp: normalizeHiveTimestamp(op.timestamp),
      block: op.block,
      trx_id: op.trx_id,
    }));
};

export const formatHiveAmount = (amount: string): string => {
  const parts = amount.split(' ');
  if (parts.length !== 2) return amount;
  
  const value = parseFloat(parts[0]);
  const currency = parts[1];
  
  return `${value.toFixed(3)} ${currency}`;
};

export const getHiveMemoKey = async (username: string): Promise<string | null> => {
  const account = await getAccount(username);
  return account?.memo_key || null;
};

// Helper: Check if a string looks like an encrypted Hive memo
// Encrypted memos: #<33-char-pubkey><base58-data> (long, no spaces, alphanumeric)
// Plaintext: Can start with # but will have spaces or be short
const isEncryptedMemo = (text: string): boolean => {
  if (!text.startsWith('#')) return false;
  
  // Encrypted memos are typically 100+ characters of base58 (alphanumeric only)
  // Remove the '#' and check if it's a long base58 string
  const content = text.slice(1);
  
  // If it contains spaces, it's plaintext (e.g., "#Yo yo yo")
  if (content.includes(' ')) return false;
  
  // If it's short (<50 chars), likely plaintext
  if (content.length < 50) return false;
  
  // Check if it's base58 (only alphanumeric, no special chars except sometimes .)
  const base58Regex = /^[A-Za-z0-9]+$/;
  return base58Regex.test(content);
};

// MOBILE UX FIX: Deduplication map to prevent popup spam in requestDecodeMemo
// Tracks in-progress decryption requests to avoid multiple Keychain popups for the same memo
const pendingDecodeMemos = new Map<string, Promise<string>>();

// SESSION CACHE: Remember cancelled/failed decryption attempts to prevent retry spam
// Key: txId or memo hash, Value: timestamp when it was cancelled
const cancelledMemos = new Map<string, number>();
const CANCELLED_MEMO_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes before allowing retry

/**
 * Check if a memo decryption was recently cancelled by user
 * Returns true if we should skip this decryption attempt
 */
export const wasDecryptionCancelled = (txId?: string, encryptedMemo?: string): boolean => {
  const key = txId || encryptedMemo;
  if (!key) return false;
  
  const cancelledAt = cancelledMemos.get(key);
  if (!cancelledAt) return false;
  
  // Check if cooldown has passed
  if (Date.now() - cancelledAt > CANCELLED_MEMO_COOLDOWN_MS) {
    cancelledMemos.delete(key);
    return false;
  }
  
  return true;
};

/**
 * Mark a memo as cancelled (user rejected decryption)
 */
export const markDecryptionCancelled = (txId?: string, encryptedMemo?: string): void => {
  const key = txId || encryptedMemo;
  if (key) {
    cancelledMemos.set(key, Date.now());
    logger.info('[DECRYPT CANCEL] Marked as cancelled (5 min cooldown):', key.substring(0, 20));
  }
};

/**
 * Clear cancelled memo cache (useful for manual retry)
 */
export const clearCancelledMemos = (): void => {
  cancelledMemos.clear();
  logger.info('[DECRYPT CANCEL] Cleared all cancelled memos');
};

// TIER 2 OPTIMIZATION: Added txId parameter for memo caching
// MOBILE UX FIX: Added deduplication to prevent popup spam
export const requestDecodeMemo = async (
  username: string,
  encryptedMemo: string,
  senderUsername?: string,
  txId?: string,
  recursionDepth: number = 0
): Promise<string> => {
  // CHECK: Skip if user recently cancelled this decryption
  if (recursionDepth === 0 && wasDecryptionCancelled(txId, encryptedMemo)) {
    logger.info('[requestDecodeMemo] Skipping - user cancelled this memo recently');
    throw new Error('User cancelled decryption');
  }
  // Prevent infinite recursion (max 2 decryption attempts for double-encrypted messages)
  if (recursionDepth > 1) {
    throw new Error('Maximum decryption depth reached - message may be corrupted');
  }

  // Handle unencrypted memos (doesn't look like encrypted format)
  if (!isEncryptedMemo(encryptedMemo)) {
    logger.info('[requestDecodeMemo] Not encrypted (plaintext or short message)');
    return encryptedMemo;
  }

  // TIER 2: Check LRU memo cache first (fast in-memory lookup)
  if (txId && recursionDepth === 0) {
    try {
      const { getCachedDecryptedMemo } = await import('@/lib/memoCache');
      const cachedMemo = getCachedDecryptedMemo(encryptedMemo, txId);
      
      if (cachedMemo) {
        logger.info('[MEMO CACHE HIT] Using LRU cached decryption for txId:', txId.substring(0, 20));
        return cachedMemo;
      }
    } catch (cacheError) {
      logger.warn('[requestDecodeMemo] Failed to check LRU memo cache:', cacheError);
    }
  }

  // MOBILE UX FIX: Check if this decrypt is already in progress (only at depth 0 to avoid issues with double-encryption)
  if (recursionDepth === 0) {
    const cacheKey = txId || encryptedMemo;
    if (pendingDecodeMemos.has(cacheKey)) {
      logger.info('[requestDecodeMemo] Deduplication - reusing pending decrypt for:', cacheKey.substring(0, 20));
      return pendingDecodeMemos.get(cacheKey)!;
    }
  }

  logger.info('[requestDecodeMemo] Starting decryption with Memo key (depth:', recursionDepth, ')');
  logger.sensitive('[requestDecodeMemo] Parameters:', {
    username,
    messagePreview: encryptedMemo.substring(0, 40) + '...',
    sender: senderUsername,
    txId: txId?.substring(0, 20),
    depth: recursionDepth,
    hasKeychainAPI: !!window.hive_keychain,
    userAgent: navigator.userAgent,
    platform: navigator.platform
  });

  // MOBILE UX FIX: Create decrypt promise with deduplication tracking
  const cacheKey = txId || encryptedMemo;
  const decryptPromise = new Promise<string>(async (resolve, reject) => {
    try {
      let result: string;

      // Use Keychain for decryption (works on desktop AND Keychain Mobile browser!)
      if (window.hive_keychain) {
        logger.info('[requestDecodeMemo] Keychain detected, using requestVerifyKey for decryption');
        
        result = await new Promise<string>((resolveInner, rejectInner) => {
          window.hive_keychain.requestVerifyKey(
            username,
            encryptedMemo,
            'Memo',
            (response: any) => {
              logger.sensitive('[requestDecodeMemo] Keychain response:', {
                success: response.success,
                hasResult: !!response.result,
                resultPreview: response.result ? response.result.substring(0, 50) + '...' : null,
                resultLength: response.result?.length
              });

              if (response.success && response.result) {
                resolveInner(response.result);
              } else {
                const errorMsg = response.message || response.error || 'Decryption failed';
                if (errorMsg.toLowerCase().includes('cancel')) {
                  // Mark this memo as cancelled to prevent retry spam
                  markDecryptionCancelled(txId, encryptedMemo);
                  rejectInner(new Error('User cancelled decryption'));
                } else {
                  rejectInner(new Error(errorMsg));
                }
              }
            }
          );
        });
      } else {
        // Keychain not available
        throw new Error('Hive Keychain is not available. Please install Hive Keychain extension or use Keychain Mobile browser.');
      }
      
      logger.info('[requestDecodeMemo] Decryption successful, result length:', result.length);
      
      // Check for double-encryption: if result LOOKS like encrypted data, decrypt again
      if (isEncryptedMemo(result) && recursionDepth < 1) {
        logger.info('[requestDecodeMemo] ⚠️ Result still encrypted - attempting second decryption for double-encrypted message...');
        
        const secondDecryption = await requestDecodeMemo(username, result, senderUsername, txId, recursionDepth + 1);
        logger.info('[requestDecodeMemo] ✅ Second decryption successful! Message was double-encrypted.');
        resolve(secondDecryption);
        return;
      }
      
      // If still encrypted at max depth, that's an error
      if (isEncryptedMemo(result) && recursionDepth >= 1) {
        throw new Error('Message may be triple-encrypted or corrupted');
      }
      
      // TIER 2: Cache the decrypted memo in LRU cache
      if (txId && recursionDepth === 0) {
        try {
          const { cacheDecryptedMemo } = await import('@/lib/memoCache');
          cacheDecryptedMemo(encryptedMemo, txId, result);
          logger.info('[MEMO CACHE] LRU cached decrypted memo for txId:', txId.substring(0, 20));
        } catch (cacheError) {
          logger.warn('[requestDecodeMemo] Failed to LRU cache decrypted memo:', cacheError);
        }
      }
      
      logger.info('[requestDecodeMemo] ✅ Decryption complete!');
      resolve(result);
    } catch (error) {
      // MOBILE UX FIX: Clear from pending map on error
      if (recursionDepth === 0) {
        pendingDecodeMemos.delete(cacheKey);
      }
      reject(error);
    }
  });

  // MOBILE UX FIX: Store in pending map before returning (only at depth 0)
  if (recursionDepth === 0) {
    pendingDecodeMemos.set(cacheKey, decryptPromise);
  }

  return decryptPromise;
};

// TIER 2 OPTIMIZATION: Added support for incremental pagination
export const getConversationMessages = async (
  currentUser: string,
  partnerUsername: string,
  limit: number = 200,
  lastSyncedOpId?: number | null  // TIER 2: For incremental sync filtering
): Promise<any[]> => {
  try {
    // TIER 2 FIX: Always fetch latest operations (start = -1)
    // Then filter client-side for operations > lastSyncedOpId
    // Hive API's start parameter goes BACKWARDS, so we can't use it for incremental
    const history = await getAccountHistory(currentUser, limit, 'transfers', -1);
    
    const conversationMessages = history
      .filter(([index, op]: [any, any]) => {
        const operation = op.op;
        if (operation[0] !== 'transfer') return false;
        
        // TIER 2: Skip operations we've already processed
        if (lastSyncedOpId !== null && lastSyncedOpId !== undefined && index <= lastSyncedOpId) {
          return false;
        }
        
        const transfer = operation[1];
        const memo = transfer.memo;
        
        return (
          memo &&
          memo.startsWith('#') &&
          ((transfer.to === currentUser && transfer.from === partnerUsername) ||
           (transfer.from === currentUser && transfer.to === partnerUsername))
        );
      })
      .map(([index, op]: [any, any]) => ({
        index,
        from: op.op[1].from,
        to: op.op[1].to,
        memo: op.op[1].memo,
        amount: op.op[1].amount,
        timestamp: normalizeHiveTimestamp(op.timestamp),
        block: op.block,
        trx_id: op.trx_id,
      }));

    if (lastSyncedOpId !== null && conversationMessages.length > 0) {
      logger.info('[INCREMENTAL] Found', conversationMessages.length, 'new messages (filtered > opId:', lastSyncedOpId, ')');
    }

    return conversationMessages;
  } catch (error) {
    logger.error('Error fetching conversation messages:', error);
    return [];
  }
};

export const discoverConversations = async (
  currentUser: string,
  limit: number = 200
): Promise<Array<{ username: string; lastTimestamp: string }>> => {
  try {
    const history = await getAccountHistory(currentUser, limit, 'transfers', -1);
    const encryptedMessages = filterEncryptedMessages(history, currentUser);
    
    // Track last message timestamp for each partner
    const partnerData = new Map<string, string>();
    
    encryptedMessages.forEach((msg: any) => {
      const partner = msg.from === currentUser ? msg.to : msg.from;
      
      // Keep the most recent timestamp for each partner
      if (!partnerData.has(partner) || msg.timestamp > partnerData.get(partner)!) {
        partnerData.set(partner, msg.timestamp);
      }
    });

    return Array.from(partnerData.entries()).map(([username, lastTimestamp]) => ({
      username,
      lastTimestamp,
    }));
  } catch (error) {
    logger.error('Error discovering conversations:', error);
    return [];
  }
};

export const decryptMemo = async (
  username: string,
  encryptedMemo: string,
  otherParty?: string,
  txId?: string  // TIER 2: Pass txId for memo caching
): Promise<string | null> => {
  logger.info('[decryptMemo] ========== DECRYPT MEMO START ==========');
  logger.sensitive('[decryptMemo] Input params:', {
    username,
    otherParty,
    memoPreview: encryptedMemo.substring(0, 40) + '...',
    memoLength: encryptedMemo.length,
    isEncrypted: isEncryptedMemo(encryptedMemo),
    txId: txId?.substring(0, 20),
    fullMemo: encryptedMemo
  });

  try {
    if (!isEncryptedMemo(encryptedMemo)) {
      logger.info('[decryptMemo] Memo not encrypted (plaintext), returning as-is');
      return encryptedMemo;
    }

    logger.info('[decryptMemo] Calling requestDecodeMemo (will use Hive Keychain)...');
    const decrypted = await requestDecodeMemo(username, encryptedMemo, otherParty, txId, 0);
    logger.sensitive('[decryptMemo] requestDecodeMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);
    
    if (decrypted) {
      logger.sensitive('[decryptMemo] Final result:', decrypted.substring(0, 50) + '...');
      return decrypted;
    }
    
    logger.info('[decryptMemo] requestDecodeMemo returned null/empty');
    return null;
  } catch (error: any) {
    logger.error('[decryptMemo] ❌ ERROR:', error?.message || error);
    logger.error('[decryptMemo] Error for memo:', encryptedMemo.substring(0, 40) + '...', 'otherParty:', otherParty);
    
    // Re-throw error so MessageBubble can show proper error toast
    throw error;
  }
};

// ============================================================================
// TIER 2: Parallel Decryption with Concurrency Limits
// ============================================================================

interface DecryptionTask {
  encryptedMemo: string;
  txId: string;
  index: number;
}

/**
 * TIER 2 OPTIMIZATION: Decrypt multiple memos in parallel with concurrency limit
 * 
 * Instead of processing memos sequentially (await each one), this batches them
 * and processes 3-5 concurrently for 3-5x faster bulk decryption.
 * 
 * @param username - Current user's username
 * @param tasks - Array of decryption tasks with encrypted memo and txId
 * @param concurrency - Max concurrent decryptions (default: 5)
 * @returns Array of decrypted memos in same order as input
 */
export const decryptMemosInParallel = async (
  username: string,
  tasks: DecryptionTask[],
  concurrency: number = 5
): Promise<Array<{ index: number; decrypted: string | null; error?: string }>> => {
  logger.info('[PARALLEL] Starting parallel decryption:', tasks.length, 'tasks, concurrency:', concurrency);
  
  const results: Array<{ index: number; decrypted: string | null; error?: string }> = [];
  const executing: Promise<void>[] = [];
  
  for (const task of tasks) {
    const promise = (async () => {
      try {
        const decrypted = await requestDecodeMemo(username, task.encryptedMemo, undefined, task.txId, 0);
        results.push({ index: task.index, decrypted });
      } catch (error: any) {
        logger.warn('[PARALLEL] Decryption failed for task', task.index, ':', error.message);
        results.push({ index: task.index, decrypted: null, error: error.message });
      }
    })();
    
    executing.push(promise);
    
    // When we reach concurrency limit, wait for one to finish
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      executing.splice(0, executing.findIndex(p => 
        results.length > tasks.indexOf(task) - concurrency + 1
      ));
    }
  }
  
  // Wait for remaining promises
  await Promise.all(executing);
  
  logger.info('[PARALLEL] Completed parallel decryption:', results.length, 'results');
  
  // Sort by index to maintain order
  return results.sort((a, b) => a.index - b.index);
};

// ============================================================================
// CUSTOM JSON: Image Message Fetching & Reassembly
// ============================================================================

export interface CustomJsonOperation {
  txId: string;
  timestamp: string;
  from: string;
  to: string;
  encryptedPayload: string;
  hash?: string;
  sessionId?: string;
  chunks?: number;
}

/**
 * Fetch custom_json operations for image messaging
 * 
 * @param username - User's Hive username
 * @param partnerUsername - Conversation partner's username
 * @param limit - Maximum operations to fetch (default: 200)
 * @returns Array of custom_json image messages
 */
export async function getCustomJsonMessages(
  username: string,
  partnerUsername: string,
  limit: number = 200
): Promise<CustomJsonOperation[]> {
  try {
    logger.info('[CUSTOM JSON] Fetching messages for conversation:', { username, partnerUsername, limit });
    
    // Use direct client for database.call (optimizedHiveClient doesn't expose this)
    // Fetch account history with operation filter
    // custom_json is operation type 18, so bit 18 = 2^18 = 262144
    const history = await hiveClient.database.call('get_account_history', [
      username,
      -1,
      limit,
      262144  // Filter for custom_json operations only (2^18)
    ]);
    
    if (!history || !Array.isArray(history)) {
      logger.warn('[CUSTOM JSON] No history returned');
      return [];
    }
    
    logger.info('[CUSTOM JSON] Retrieved', history.length, 'operations from blockchain');
    
    // Track chunks by session ID for reassembly
    const sessionChunks = new Map<string, Array<{
      idx: number;
      data: string;
      hash?: string;
      timestamp: string;
      from: string;
      to: string;
      txId: string;
    }>>();
    
    // Track single-operation messages
    const singleMessages: CustomJsonOperation[] = [];
    
    for (const [index, op] of history) {
      const [opType, opData] = op.op;
      
      if (opType !== 'custom_json') continue;
      if (opData.id !== 'hive-messenger-img') continue;
      
      let jsonData: any;
      try {
        jsonData = typeof opData.json === 'string' ? JSON.parse(opData.json) : opData.json;
      } catch (parseError) {
        logger.warn('[CUSTOM JSON] Failed to parse JSON:', parseError);
        continue;
      }
      
      // Determine sender/receiver from required_posting_auths
      const sender = opData.required_posting_auths?.[0];
      if (!sender) continue;
      
      // Check if this involves our conversation (either direction)
      const isRelevant = (sender === username || sender === partnerUsername);
      if (!isRelevant) continue;
      
      // Determine the "from" and "to" for this operation
      const from = sender;
      // For custom_json, we need to extract recipient from encrypted payload later
      // For now, assume partner is the "to" if sender is us, and vice versa
      const to = sender === username ? partnerUsername : username;
      
      if (jsonData.sid) {
        // Multi-chunk message
        if (!sessionChunks.has(jsonData.sid)) {
          sessionChunks.set(jsonData.sid, []);
        }
        
        sessionChunks.get(jsonData.sid)!.push({
          idx: jsonData.idx,
          data: jsonData.e,
          hash: jsonData.h,
          timestamp: normalizeHiveTimestamp(op.timestamp),
          from,
          to,
          txId: op.trx_id
        });
      } else {
        // Single operation message
        singleMessages.push({
          txId: op.trx_id,
          timestamp: normalizeHiveTimestamp(op.timestamp),
          from,
          to,
          encryptedPayload: jsonData.e,
          hash: jsonData.h
        });
      }
    }
    
    // Reassemble multi-chunk messages
    const reassembledMessages: CustomJsonOperation[] = [];
    
    // Use Array.from to avoid downlevelIteration requirement
    Array.from(sessionChunks.entries()).forEach(([sessionId, chunks]) => {
      type ChunkType = { idx: number; data: string; hash?: string; timestamp: string; from: string; to: string; txId: string };
      
      // Sort by index with explicit types
      chunks.sort((a: ChunkType, b: ChunkType) => a.idx - b.idx);
      
      // Check if we have all chunks with explicit types
      const expectedChunks = chunks.length;
      const hasAllChunks = chunks.every((c: ChunkType, i: number) => c.idx === i);
      
      if (!hasAllChunks) {
        logger.warn('[CUSTOM JSON] Incomplete chunks for session:', sessionId, 
          'expected:', expectedChunks, 'have indices:', chunks.map((c: ChunkType) => c.idx));
        return; // Skip this session
      }
      
      // Concatenate chunks with explicit types
      const fullPayload = chunks.map((c: ChunkType) => c.data).join('');
      const hash = chunks.find((c: ChunkType) => c.hash)?.hash;
      
      reassembledMessages.push({
        txId: chunks[0].txId, // Use first chunk's txId
        timestamp: chunks[0].timestamp,
        from: chunks[0].from,
        to: chunks[0].to,
        encryptedPayload: fullPayload,
        hash,
        sessionId,
        chunks: chunks.length
      });
      
      logger.info('[CUSTOM JSON] Reassembled session:', sessionId, 
        'chunks:', chunks.length, 
        'size:', fullPayload.length);
    });
    
    const allMessages = [...singleMessages, ...reassembledMessages];
    logger.info('[CUSTOM JSON] Retrieved', allMessages.length, 'total messages',
      '(', singleMessages.length, 'single,', reassembledMessages.length, 'reassembled)');
    
    return allMessages;
  } catch (error) {
    logger.error('[CUSTOM JSON] Failed to fetch messages:', error);
    return [];
  }
}
