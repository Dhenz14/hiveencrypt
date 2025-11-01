import { Client, type ExtendedAccount } from '@hiveio/dhive';

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

class HiveBlockchainClient {
  private client: Client;
  private apiNodes: string[];
  private currentNodeIndex: number = 0;

  constructor(apiNodes: string[]) {
    this.apiNodes = apiNodes;
    this.client = new Client(apiNodes);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.initialDelay;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < config.maxRetries) {
          await this.sleep(delay);
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
          
          // Try next node on network failure
          this.rotateToNextNode();
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  private rotateToNextNode(): void {
    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.apiNodes.length;
    this.client = new Client([this.apiNodes[this.currentNodeIndex]]);
  }

  private validateUsername(username: string): boolean {
    // Hive username validation following canonical blockchain rules:
    // - Total length: 3-16 characters
    // - Can contain dots to separate segments
    // - Each segment must be 3-16 characters and match: ^[a-z][a-z0-9-]{1,14}[a-z0-9]$
    //   (starts with letter, ends with letter/digit, allows consecutive hyphens in middle)
    
    if (username.length < 3 || username.length > 16) {
      return false;
    }
    
    // Basic character set validation
    if (!/^[a-z0-9.-]+$/.test(username)) {
      return false;
    }
    
    // No consecutive dots
    if (/\.\./.test(username)) {
      return false;
    }
    
    // Cannot start or end with dot
    if (/^\.|\.$/.test(username)) {
      return false;
    }
    
    // Split into segments by dots and validate each segment
    const segments = username.split('.');
    
    // Segment validation regex: 3-16 chars, starts with letter, ends with letter/digit
    // Middle can contain letters, numbers, hyphens (including consecutive hyphens)
    const segmentRegex = /^[a-z][a-z0-9-]{1,14}[a-z0-9]$/;
    
    for (const segment of segments) {
      // Each segment must match the canonical pattern
      if (!segmentRegex.test(segment)) {
        return false;
      }
    }
    
    return true;
  }

  async getAccount(username: string): Promise<ExtendedAccount | null> {
    if (!this.validateUsername(username)) {
      throw new Error('Invalid username format. Must be 3-16 characters, lowercase letters, numbers, dots, and hyphens. Cannot start/end with dot or hyphen.');
    }

    try {
      const accounts = await this.retryWithBackoff(async () => {
        return await this.client.database.getAccounts([username]);
      });

      if (!accounts || accounts.length === 0) {
        return null;
      }

      return accounts[0] as ExtendedAccount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch account: ${errorMessage}`);
    }
  }

  async getAccountHistory(
    username: string,
    limit: number = 100
  ): Promise<any[]> {
    if (!this.validateUsername(username)) {
      throw new Error('Invalid username format. Must be 3-16 characters, lowercase letters, numbers, dots, and hyphens. Cannot start/end with dot or hyphen.');
    }

    if (limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000');
    }

    try {
      const history = await this.retryWithBackoff(async () => {
        return await this.client.database.getAccountHistory(
          username,
          -1,
          limit
        );
      });

      return history || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch account history: ${errorMessage}`);
    }
  }

  async getPublicMemoKey(username: string): Promise<string | null> {
    try {
      const account = await this.getAccount(username);
      
      if (!account) {
        return null;
      }

      return account.memo_key || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch memo key: ${errorMessage}`);
    }
  }

  async verifyAccountExists(username: string): Promise<boolean> {
    try {
      const account = await this.getAccount(username);
      return account !== null;
    } catch (error) {
      // If validation error, account doesn't exist
      if (error instanceof Error && error.message.includes('Invalid username format')) {
        return false;
      }
      throw error;
    }
  }

  filterTransferOperations(history: any[]): any[] {
    return history
      .filter(([, operation]) => {
        return operation && operation.op && operation.op[0] === 'transfer';
      })
      .map(([index, operation]) => {
        const transfer = operation.op[1];
        return {
          index,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
          memo: transfer.memo,
          timestamp: operation.timestamp,
          block: operation.block,
          trx_id: operation.trx_id,
        };
      });
  }

  filterEncryptedTransfers(history: any[], currentUser: string): any[] {
    const transfers = this.filterTransferOperations(history);
    
    return transfers.filter((transfer) => {
      const memo = transfer.memo;
      
      // Check if message is encrypted (starts with #) and involves current user
      return (
        memo &&
        memo.startsWith('#') &&
        (transfer.to === currentUser || transfer.from === currentUser)
      );
    });
  }
}

// Export singleton instance
export const hiveClient = new HiveBlockchainClient([
  'https://api.hive.blog',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
]);

// Export the class for testing purposes
export { HiveBlockchainClient };
