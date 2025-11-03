import { Client } from '@hiveio/dhive';
import { KeychainSDK } from 'keychain-sdk';
import * as hivecrypt from 'hivecrypt';

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

export const requestDecodeMemo = async (
  username: string,
  encryptedMemo: string,
  senderUsername?: string
): Promise<string> => {
  console.log('[DECRYPT] Starting decryption...', { 
    username, 
    sender: senderUsername,
    memoPreview: encryptedMemo.substring(0, 20) + '...' 
  });
  
  if (!isKeychainInstalled()) {
    console.error('[DECRYPT] Keychain not installed');
    throw new Error('Hive Keychain not installed');
  }

  console.log('[DECRYPT] Using direct Keychain extension requestVerifyKey API...');
  console.log('[DECRYPT] Parameters:', { username, memoLength: encryptedMemo.length });

  return new Promise((resolve, reject) => {
    // Use direct extension API - requestVerifyKey decrypts memos
    window.hive_keychain.requestVerifyKey(
      username,
      encryptedMemo,
      'Memo', // Must be 'Memo' for memo decryption
      (response: KeychainResponse) => {
        console.log('[DECRYPT] Extension API response:', {
          success: response?.success,
          error: response?.error,
          message: response?.message,
          hasResult: !!response?.result,
          resultType: typeof response?.result,
          resultPreview: response?.result ? String(response.result).substring(0, 50) : null
        });

        if (response.success) {
          // The decrypted text might be in result or message
          const decrypted = String(response.result || response.message || '');
          console.log('[DECRYPT] Full decrypted value:', decrypted);
          
          // Check if still encrypted (shouldn't be!)
          if (decrypted.startsWith('#') && decrypted.length > 100) {
            console.error('[DECRYPT] ⚠️ STILL ENCRYPTED after Keychain call!');
            console.log('[DECRYPT] This means requestVerifyKey is not decrypting properly');
            console.log('[DECRYPT] Attempting hivecrypt fallback is not possible (no private key access)');
            reject(new Error('Keychain returned encrypted text instead of plaintext. Please ensure you have the correct memo key imported in Hive Keychain.'));
            return;
          }

          // Successfully decrypted - remove leading # if present
          const cleanText = decrypted.startsWith('#') ? decrypted.substring(1) : decrypted;
          console.log('[DECRYPT] ✅ Success! Decrypted text:', cleanText);
          resolve(cleanText);
        } else {
          console.error('[DECRYPT] ❌ Decryption failed:', response.error || response.message);
          reject(new Error(response.error || response.message || 'Decryption failed'));
        }
      }
    );
  });
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
  try {
    if (!encryptedMemo.startsWith('#')) {
      return encryptedMemo;
    }

    const decrypted = await requestDecodeMemo(username, encryptedMemo);
    
    if (decrypted) {
      let result = decrypted;
      
      if (result.startsWith('#')) {
        result = result.substring(1);
      }
      
      return result;
    }
    
    return null;
  } catch (error: any) {
    console.error('Error decrypting memo:', error?.message || error, 'for memo:', encryptedMemo.substring(0, 20) + '...', 'otherParty:', otherParty);
    return null;
  }
};
