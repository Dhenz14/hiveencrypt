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

export const requestDecodeMemo = async (
  username: string,
  encryptedMemo: string,
  senderUsername?: string
): Promise<string> => {
  // Handle unencrypted memos
  if (!encryptedMemo.startsWith('#')) {
    return encryptedMemo;
  }

  try {
    const keychain = new KeychainSDK(window);
    
    console.log('[requestDecodeMemo] Using KeychainSDK.decode() for memo decryption');
    console.log('[requestDecodeMemo] Parameters:', {
      username,
      messagePreview: encryptedMemo.substring(0, 40) + '...',
      method: 'memo'
    });

    const response = await keychain.decode({ 
      username, 
      message: encryptedMemo, 
      method: KeychainKeyTypes.memo 
    });

    console.log('[requestDecodeMemo] KeychainSDK response:', {
      success: response.success,
      hasData: !!response.data,
      hasMessage: !!response.data?.message,
      messagePreview: response.data?.message ? response.data.message.substring(0, 50) + '...' : null
    });

    if (response.success && response.data?.message) {
      return response.data.message;
    } else {
      const errorMsg = response.message || response.error || 'Decryption failed';
      if (errorMsg.toLowerCase().includes('cancel')) {
        throw new Error('User cancelled decryption');
      } else {
        throw new Error(errorMsg);
      }
    }
  } catch (error: any) {
    console.error('[requestDecodeMemo] Error:', error);
    if (error.message) {
      throw error;
    }
    throw new Error('Hive Keychain extension not found. Please install it.');
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

    console.log('[decryptMemo] Calling requestDecodeMemo (uses KeychainSDK.decode())...');
    const decrypted = await requestDecodeMemo(username, encryptedMemo, otherParty);
    console.log('[decryptMemo] requestDecodeMemo returned:', decrypted ? decrypted.substring(0, 50) + '...' : null);
    
    if (decrypted) {
      // KeychainSDK.decode() returns clean plaintext, no need to strip anything
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
