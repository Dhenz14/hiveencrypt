import { Client, PrivateKey, PublicKey, Memo } from '@hiveio/dhive';
import { KeychainSDK, KeychainKeyTypes } from 'keychain-sdk';

// Initialize Hive client with public node
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
      true // Enforce memo encryption
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
  limit: number = 100
) => {
  try {
    const history = await hiveClient.database.getAccountHistory(
      username,
      start,
      limit
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

// Store memo key temporarily in memory (NOT localStorage for security)
let memoKeyCache: string | null = null;

export const setMemoKey = (key: string) => {
  memoKeyCache = key;
};

export const getMemoKey = () => {
  return memoKeyCache;
};

export const clearMemoKey = () => {
  memoKeyCache = null;
};

export const requestDecodeMemo = async (
  username: string,
  encryptedMemo: string,
  senderUsername?: string
): Promise<string> => {
  console.log('[DECRYPT] Starting decryption...', { 
    username, 
    sender: senderUsername,
    memoPreview: encryptedMemo.substring(0, 40) + '...', 
    fullMemo: encryptedMemo
  });
  
  // STEP 1: Try Keychain first (the proper way - like Hive.blog)
  try {
    console.log('[DECRYPT] Attempting Keychain decryption via requestVerifyKey...');
    
    const keychain = new KeychainSDK(window);
    
    const result = await keychain.decode({
      username: username,
      message: encryptedMemo,
      method: KeychainKeyTypes.memo,
    });
    
    if (result.success && result.result) {
      console.log('[DECRYPT] ✅ Keychain decryption SUCCESS!');
      
      // The result is the decrypted string
      const decryptedText = String(result.result);
      console.log('[DECRYPT] Decrypted content:', decryptedText.substring(0, 50) + '...');
      
      // Remove leading # if present
      const decoded = decryptedText.startsWith('#') ? decryptedText.substring(1) : decryptedText;
      return decoded;
    } else {
      console.log('[DECRYPT] Keychain returned unsuccessful response:', result);
      throw new Error(result.error || 'Keychain decryption failed');
    }
  } catch (keychainError: any) {
    console.log('[DECRYPT] ⚠️ Keychain decryption failed:', keychainError.message || keychainError);
    console.log('[DECRYPT] Falling back to manual memo key entry...');
    
    // STEP 2: Fall back to manual memo key (if cached)
    const memoKey = getMemoKey();
    
    if (!memoKey) {
      console.log('[DECRYPT] No cached memo key - prompting user');
      throw new Error('MEMO_KEY_REQUIRED');
    }

    try {
      console.log('[DECRYPT] Using @hiveio/dhive Memo.decode with manual key...');
      
      // Use dhive's Memo.decode function (handles all the crypto internally)
      const decoded = Memo.decode(memoKey, encryptedMemo);
      
      console.log('[DECRYPT] ✅ Manual decryption success!');
      
      // Remove leading # if present in decoded text
      return decoded.startsWith('#') ? decoded.substring(1) : decoded;
    } catch (error: any) {
      console.error('[DECRYPT] ❌ Manual decryption error:', error.message || error);
      
      // Provide helpful error messages
      if (error.message?.includes('Invalid private key')) {
        throw new Error('Invalid memo key format. Please check your private memo key.');
      } else if (error.message?.includes('checksum')) {
        throw new Error('Memo decryption failed - corrupted or wrong key');
      }
      
      throw new Error(`Decryption failed: ${error.message || error}`);
    }
  }
};

export const getConversationMessages = async (
  currentUser: string,
  partnerUsername: string,
  limit: number = 1000
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
  limit: number = 1000
): Promise<string[]> => {
  try {
    const history = await getAccountHistory(currentUser, -1, limit);
    const encryptedMessages = filterEncryptedMessages(history, currentUser);
    
    const partners = new Set<string>();
    encryptedMessages.forEach((msg: any) => {
      if (msg.from === currentUser) {
        partners.add(msg.to);
      } else {
        partners.add(msg.from);
      }
    });

    return Array.from(partners);
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
    startsWithHash: encryptedMemo.startsWith('#'),
    fullMemo: encryptedMemo
  });

  try {
    if (!encryptedMemo.startsWith('#')) {
      console.log('[decryptMemo] Memo not encrypted, returning as-is');
      return encryptedMemo;
    }

    console.log('[decryptMemo] Calling requestDecodeMemo...');
    const decrypted = await requestDecodeMemo(username, encryptedMemo);
    console.log('[decryptMemo] requestDecodeMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);
    
    if (decrypted) {
      let result = decrypted;
      
      if (result.startsWith('#')) {
        result = result.substring(1);
      }
      
      console.log('[decryptMemo] Final result:', result.substring(0, 50) + '...');
      return result;
    }
    
    console.log('[decryptMemo] requestDecodeMemo returned null/empty');
    return null;
  } catch (error: any) {
    console.error('[decryptMemo] ❌ ERROR:', error?.message || error);
    console.error('[decryptMemo] Error for memo:', encryptedMemo.substring(0, 40) + '...', 'otherParty:', otherParty);
    return null;
  }
};
