import { Client, PrivateKey, PublicKey, Memo } from '@hiveio/dhive';
import { KeychainSDK, KeychainKeyTypes } from 'keychain-sdk';
import { hiveClient as optimizedHiveClient } from './hiveClient';

// Initialize Hive client with public node (for direct access)
export const hiveClient = new Client([
  'https://api.hive.blog',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
]);

// Hive Keychain integration
export interface KeychainResponse {
  success: boolean;
  result?: any;
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

export const requestTransfer = (
  from: string,
  to: string,
  amount: string,
  memo: string,
  currency: 'HIVE' | 'HBD' = 'HBD'
): Promise<KeychainResponse> => {
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
      false // Don't re-encrypt - memo is already encrypted by requestEncode
    );
  });
};

export const getAccount = async (username: string) => {
  try {
    const accounts = await hiveClient.database.getAccounts([username]);
    if (accounts && accounts.length > 0) {
      return accounts[0];
    }
    return null;
  } catch (error) {
    console.error('Error fetching account:', error);
    return null;
  }
};

export const getAccountHistory = async (
  username: string,
  start: number = -1,
  limit: number = 100,
  filterTransfersOnly: boolean = true
) => {
  try {
    // Use filtered query for 10-100x performance improvement
    const history = await optimizedHiveClient.getAccountHistory(
      username,
      limit,
      filterTransfersOnly
    );
    return history;
  } catch (error) {
    console.error('Error fetching account history:', error);
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
      timestamp: op.timestamp,
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

export const requestDecodeMemo = async (
  username: string,
  encryptedMemo: string,
  senderUsername?: string,
  recursionDepth: number = 0
): Promise<string> => {
  // Prevent infinite recursion (max 2 decryption attempts for double-encrypted messages)
  if (recursionDepth > 1) {
    throw new Error('Maximum decryption depth reached - message may be corrupted');
  }

  // Handle unencrypted memos (doesn't look like encrypted format)
  if (!isEncryptedMemo(encryptedMemo)) {
    console.log('[requestDecodeMemo] Not encrypted (plaintext or short message)');
    return encryptedMemo;
  }

  if (!window.hive_keychain) {
    throw new Error('Hive Keychain extension not found. Please install it.');
  }

  console.log('[requestDecodeMemo] Starting decryption with Memo key (depth:', recursionDepth, ')');
  console.log('[requestDecodeMemo] Parameters:', {
    username,
    messagePreview: encryptedMemo.substring(0, 40) + '...',
    sender: senderUsername,
    depth: recursionDepth
  });

  // Decrypt using Memo key (Hive protocol standard for memo encryption)
  try {
    console.log('[requestDecodeMemo] Requesting Memo key decryption from Hive Keychain...');
    
    const result = await new Promise<string>((resolve, reject) => {
      window.hive_keychain.requestVerifyKey(
        username,
        encryptedMemo,
        'Memo',
        (response: any) => {
          console.log('[requestDecodeMemo] Keychain response:', {
            success: response.success,
            hasResult: !!response.result,
            resultPreview: response.result ? response.result.substring(0, 50) + '...' : null,
            resultLength: response.result?.length
          });

          if (response.success && response.result) {
            resolve(response.result);
          } else {
            const errorMsg = response.message || response.error || 'Decryption failed';
            if (errorMsg.toLowerCase().includes('cancel')) {
              reject(new Error('User cancelled decryption'));
            } else {
              reject(new Error(errorMsg));
            }
          }
        }
      );
    });
    
    console.log('[requestDecodeMemo] Decryption successful, result length:', result.length);
    
    // Check for double-encryption: if result LOOKS like encrypted data, decrypt again
    if (isEncryptedMemo(result) && recursionDepth < 1) {
      console.log('[requestDecodeMemo] ⚠️ Result still encrypted - attempting second decryption for double-encrypted message...');
      
      const secondDecryption = await requestDecodeMemo(username, result, senderUsername, recursionDepth + 1);
      console.log('[requestDecodeMemo] ✅ Second decryption successful! Message was double-encrypted.');
      return secondDecryption;
    }
    
    // If still encrypted at max depth, that's an error
    if (isEncryptedMemo(result) && recursionDepth >= 1) {
      throw new Error('Message may be triple-encrypted or corrupted');
    }
    
    console.log('[requestDecodeMemo] ✅ Decryption complete!');
    return result;
    
  } catch (error: any) {
    console.error('[requestDecodeMemo] Decryption failed:', error.message);
    throw error;
  }
};

export const getConversationMessages = async (
  currentUser: string,
  partnerUsername: string,
  limit: number = 200
): Promise<any[]> => {
  try {
    const history = await getAccountHistory(currentUser, -1, limit);
    
    const conversationMessages = history
      .filter(([, op]: [any, any]) => {
        const operation = op.op;
        if (operation[0] !== 'transfer') return false;
        
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
        timestamp: op.timestamp,
        block: op.block,
        trx_id: op.trx_id,
      }));

    return conversationMessages;
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    return [];
  }
};

export const discoverConversations = async (
  currentUser: string,
  limit: number = 200
): Promise<Array<{ username: string; lastTimestamp: string }>> => {
  try {
    const history = await getAccountHistory(currentUser, -1, limit);
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
    console.error('Error discovering conversations:', error);
    return [];
  }
};

export const decryptMemo = async (
  username: string,
  encryptedMemo: string,
  otherParty?: string
): Promise<string | null> => {
  console.log('[decryptMemo] ========== DECRYPT MEMO START ==========');
  console.log('[decryptMemo] Input params:', {
    username,
    otherParty,
    memoPreview: encryptedMemo.substring(0, 40) + '...',
    memoLength: encryptedMemo.length,
    isEncrypted: isEncryptedMemo(encryptedMemo),
    fullMemo: encryptedMemo
  });

  try {
    if (!isEncryptedMemo(encryptedMemo)) {
      console.log('[decryptMemo] Memo not encrypted (plaintext), returning as-is');
      return encryptedMemo;
    }

    console.log('[decryptMemo] Calling requestDecodeMemo (will use Hive Keychain)...');
    const decrypted = await requestDecodeMemo(username, encryptedMemo, otherParty);
    console.log('[decryptMemo] requestDecodeMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);
    
    if (decrypted) {
      console.log('[decryptMemo] Final result:', decrypted.substring(0, 50) + '...');
      return decrypted;
    }
    
    console.log('[decryptMemo] requestDecodeMemo returned null/empty');
    return null;
  } catch (error: any) {
    console.error('[decryptMemo] ❌ ERROR:', error?.message || error);
    console.error('[decryptMemo] Error for memo:', encryptedMemo.substring(0, 40) + '...', 'otherParty:', otherParty);
    
    // Re-throw error so MessageBubble can show proper error toast
    throw error;
  }
};
