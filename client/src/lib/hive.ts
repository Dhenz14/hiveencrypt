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
    hive_keychain: any;
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

    window.hive_keychain.requestEncode(
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
