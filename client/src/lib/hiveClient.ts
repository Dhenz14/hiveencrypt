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

interface NodeHealth {
  url: string;
  latencies: number[];
  avgLatency: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  headBlock: number;
  lastChecked: Date;
  isHealthy: boolean;
}

class HiveBlockchainClient {
  private client: Client;
  private apiNodes: string[];
  private currentNodeIndex: number = 0;
  private nodeHealth: Map<string, NodeHealth> = new Map();
  private readonly HEALTH_CHECK_INTERVAL = 300000; // 5 minutes
  private readonly MAX_LATENCY_SAMPLES = 10;
  private readonly UNHEALTHY_ERROR_RATE = 0.2; // 20% error rate = unhealthy
  private readonly SLOW_NODE_THRESHOLD = 500; // 500ms avg latency = slow

  constructor(apiNodes: string[]) {
    this.apiNodes = apiNodes;
    this.client = new Client(apiNodes);
    
    // Initialize health tracking for all nodes
    this.apiNodes.forEach(url => {
      this.nodeHealth.set(url, {
        url,
        latencies: [],
        avgLatency: 0,
        successCount: 0,
        errorCount: 0,
        successRate: 1.0,
        headBlock: 0,
        lastChecked: new Date(0), // Force initial check
        isHealthy: true,
      });
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordLatency(nodeUrl: string, latencyMs: number): void {
    const health = this.nodeHealth.get(nodeUrl);
    if (!health) return;

    health.latencies.push(latencyMs);
    
    // Keep only last N samples for rolling average
    if (health.latencies.length > this.MAX_LATENCY_SAMPLES) {
      health.latencies.shift();
    }

    // Calculate average latency
    health.avgLatency = health.latencies.reduce((a, b) => a + b, 0) / health.latencies.length;
    health.lastChecked = new Date();
  }

  private recordSuccess(nodeUrl: string): void {
    const health = this.nodeHealth.get(nodeUrl);
    if (!health) return;

    health.successCount++;
    this.updateHealthStatus(nodeUrl);
  }

  private recordError(nodeUrl: string): void {
    const health = this.nodeHealth.get(nodeUrl);
    if (!health) return;

    health.errorCount++;
    this.updateHealthStatus(nodeUrl);
  }

  private updateHealthStatus(nodeUrl: string): void {
    const health = this.nodeHealth.get(nodeUrl);
    if (!health) return;

    const totalRequests = health.successCount + health.errorCount;
    if (totalRequests > 0) {
      health.successRate = health.successCount / totalRequests;
    }

    // Node is unhealthy if error rate > 20% OR avg latency > 500ms
    health.isHealthy = 
      health.successRate > (1 - this.UNHEALTHY_ERROR_RATE) &&
      (health.avgLatency === 0 || health.avgLatency < this.SLOW_NODE_THRESHOLD);
  }

  private selectBestNode(): string {
    const now = new Date().getTime();
    const healthyNodes = Array.from(this.nodeHealth.values())
      .filter(h => {
        // Include nodes that haven't been checked recently or are healthy
        const needsCheck = now - h.lastChecked.getTime() > this.HEALTH_CHECK_INTERVAL;
        return h.isHealthy || needsCheck;
      })
      .sort((a, b) => {
        // Prioritize by:
        // 1. Health status (healthy first)
        if (a.isHealthy !== b.isHealthy) {
          return a.isHealthy ? -1 : 1;
        }
        
        // 2. Success rate (higher first)
        if (Math.abs(a.successRate - b.successRate) > 0.1) {
          return b.successRate - a.successRate;
        }
        
        // 3. Average latency (lower first)
        if (a.avgLatency === 0) return 1; // No data = deprioritize
        if (b.avgLatency === 0) return -1;
        return a.avgLatency - b.avgLatency;
      });

    if (healthyNodes.length === 0) {
      // All nodes unhealthy - reset stats and try again
      console.warn('[RPC] All nodes unhealthy, resetting health stats');
      this.nodeHealth.forEach(h => {
        h.successCount = 0;
        h.errorCount = 0;
        h.successRate = 1.0;
        h.isHealthy = true;
      });
      return this.apiNodes[0];
    }

    const bestNode = healthyNodes[0];
    console.log('[RPC] Selected best node:', bestNode.url, {
      avgLatency: Math.round(bestNode.avgLatency),
      successRate: (bestNode.successRate * 100).toFixed(1) + '%',
    });

    return bestNode.url;
  }

  private switchToNode(nodeUrl: string): void {
    const index = this.apiNodes.indexOf(nodeUrl);
    if (index !== -1) {
      this.currentNodeIndex = index;
      this.client = new Client([nodeUrl]);
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.initialDelay;

    // Select best node before starting
    const bestNodeUrl = this.selectBestNode();
    this.switchToNode(bestNodeUrl);

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const currentNodeUrl = this.apiNodes[this.currentNodeIndex];
      const startTime = performance.now();

      try {
        const result = await operation();
        const latency = performance.now() - startTime;
        
        // Record successful request
        this.recordLatency(currentNodeUrl, latency);
        this.recordSuccess(currentNodeUrl);
        
        return result;
      } catch (error) {
        const latency = performance.now() - startTime;
        lastError = error as Error;
        
        // Record failed request
        this.recordLatency(currentNodeUrl, latency);
        this.recordError(currentNodeUrl);
        
        if (attempt < config.maxRetries) {
          await this.sleep(delay);
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
          
          // Select next best node (will skip unhealthy ones)
          const nextBestNode = this.selectBestNode();
          this.switchToNode(nextBestNode);
          
          console.log(`[RPC] Retry ${attempt + 1}/${config.maxRetries} with node:`, nextBestNode);
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  private rotateToNextNode(): void {
    // Deprecated: Now using selectBestNode() for intelligent selection
    // Kept for backwards compatibility
    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.apiNodes.length;
    this.client = new Client([this.apiNodes[this.currentNodeIndex]]);
  }

  getNodeHealthStats(): Map<string, NodeHealth> {
    return new Map(this.nodeHealth);
  }

  resetNodeHealth(): void {
    this.nodeHealth.forEach(h => {
      h.latencies = [];
      h.avgLatency = 0;
      h.successCount = 0;
      h.errorCount = 0;
      h.successRate = 1.0;
      h.isHealthy = true;
      h.lastChecked = new Date(0);
    });
    console.log('[RPC] Node health stats reset');
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
    limit: number = 100,
    filterTransfersOnly: boolean = true
  ): Promise<any[]> {
    if (!this.validateUsername(username)) {
      throw new Error('Invalid username format. Must be 3-16 characters, lowercase letters, numbers, dots, and hyphens. Cannot start/end with dot or hyphen.');
    }

    if (limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000');
    }

    try {
      const history = await this.retryWithBackoff(async () => {
        // PERFORMANCE OPTIMIZATION: Filter for transfer operations only (which contain memos)
        // This makes queries 10-100x faster by skipping all other operation types
        // Transfer operation is type 2, so the bit is 2^2 = 4 (operation_filter_low)
        // Reference: https://developers.hive.io/apidefinitions/#apidefinitions-broadcast-ops-transfer
        if (filterTransfersOnly) {
          return await this.client.call('condenser_api', 'get_account_history', [
            username,
            -1,
            limit,
            4,   // operation_filter_low: 2^2 = 4 for transfer operations
            0    // operation_filter_high: not used
          ]);
        } else {
          // Fallback to unfiltered query (slower, returns all operations)
          return await this.client.database.getAccountHistory(
            username,
            -1,
            limit
          );
        }
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
