import { Client } from '@hiveio/dhive';

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

export const requestDecodeMemo = (
  username: string,
  encryptedMemo: string
): Promise<KeychainResponse> => {
  return new Promise((resolve, reject) => {
    if (!isKeychainInstalled()) {
      reject({ success: false, error: 'Hive Keychain not installed' });
      return;
    }

    window.hive_keychain.requestVerifyKey(
      username,
      encryptedMemo,
      'Memo',
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
  encryptedMemo: string
): Promise<string | null> => {
  try {
    if (!encryptedMemo.startsWith('#')) {
      return encryptedMemo;
    }

    const response = await requestDecodeMemo(username, encryptedMemo);
    
    if (response.success && response.result) {
      let decrypted = response.result;
      
      if (decrypted.startsWith('#')) {
        decrypted = decrypted.substring(1);
      }
      
      return decrypted;
    }
    
    return null;
  } catch (error) {
    console.error('Error decrypting memo:', error);
    return null;
  }
};
