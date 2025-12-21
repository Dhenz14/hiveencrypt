import { Client, type ExtendedAccount } from '@hiveio/dhive';
import { logger } from './logger';

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

// Operation type constants for bitwise filtering
// Reference: https://developers.hive.io/apidefinitions/
const OPERATION_FILTERS = {
  TRANSFER: 4,           // Type 2: 2^2 = 4
  CUSTOM_JSON: 262144,   // Type 18: 2^18 = 262144
  TRANSFER_AND_CUSTOM_JSON: 262148  // Combined: 4 + 262144
} as const;

export type OperationFilter = 'all' | 'transfers' | 'custom_json' | 'transfers_and_custom_json';

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
      // This is normal during heavy concurrent requests (rate limiting)
      logger.debug('[RPC] All nodes marked unhealthy, resetting health stats (likely rate limiting)');
      this.nodeHealth.forEach(h => {
        h.successCount = 0;
        h.errorCount = 0;
        h.successRate = 1.0;
        h.isHealthy = true;
      });
      return this.apiNodes[0];
    }

    const bestNode = healthyNodes[0];
    logger.info('[RPC] Selected best node:', bestNode.url, {
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
          
          logger.info(`[RPC] Retry ${attempt + 1}/${config.maxRetries} with node:`, nextBestNode);
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

  getBestNodeUrl(): string {
    return this.selectBestNode();
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
    logger.info('[RPC] Node health stats reset');
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

  // TIER 2 OPTIMIZATION: Added start parameter for incremental pagination
  // TIER 3 OPTIMIZATION: Added operation type filtering for custom_json operations
  async getAccountHistory(
    username: string,
    limit: number = 100,
    filter: OperationFilter = 'transfers',
    start: number = -1  // -1 = latest, otherwise start from specific opId for incremental sync
  ): Promise<any[]> {
    if (!this.validateUsername(username)) {
      throw new Error('Invalid username format. Must be 3-16 characters, lowercase letters, numbers, dots, and hyphens. Cannot start/end with dot or hyphen.');
    }

    if (limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000');
    }

    try {
      const history = await this.retryWithBackoff(async () => {
        let operationFilterLow = 0;
        let operationFilterHigh = 0;

        switch (filter) {
          case 'transfers':
            // Transfer operation type 2: 2^2 = 4
            operationFilterLow = OPERATION_FILTERS.TRANSFER;
            break;
          case 'custom_json':
            // Custom_json operation type 18: 2^18 = 262144
            operationFilterLow = OPERATION_FILTERS.CUSTOM_JSON;
            break;
          case 'transfers_and_custom_json':
            // Combined: 4 + 262144 = 262148
            operationFilterLow = OPERATION_FILTERS.TRANSFER_AND_CUSTOM_JSON;
            break;
          case 'all':
            // No filtering - unfiltered queries work fine with start=-1
            return await this.client.database.getAccountHistory(username, start, limit);
          default:
            // This should never happen due to TypeScript typing, but handle it anyway
            logger.error('[RPC] Invalid operation filter:', filter, '- falling back to transfers only');
            operationFilterLow = OPERATION_FILTERS.TRANSFER;
            break;
        }

        // For filtered queries when start=-1, get latest operation index first
        let actualStart = start;
        if (start === -1) {
          // Get a small batch using unfiltered API to find the latest operation index
          const recentOps = await this.client.database.getAccountHistory(username, -1, Math.min(limit, 100));
          if (recentOps && recentOps.length > 0) {
            // Get the highest operation index from recent ops
            const latestOpIndex = Math.max(...recentOps.map(([idx]) => idx));
            actualStart = latestOpIndex;
          } else {
            // No operations found, return empty array
            return [];
          }
        }

        // Ensure start >= limit - 1 for filtered queries (API constraint)
        if (actualStart < limit - 1) {
          actualStart = limit - 1;
        }

        // Use filtered query with corrected start value
        return await this.client.call('condenser_api', 'get_account_history', [
          username,
          actualStart,
          limit,
          operationFilterLow,
          operationFilterHigh
        ]);
      });

      return history || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch account history: ${errorMessage}`);
    }
  }

  async getTransaction(transactionId: string): Promise<any> {
    // Validate transaction ID format (40-character hex string)
    if (!transactionId || typeof transactionId !== 'string') {
      throw new Error('Transaction ID must be a non-empty string');
    }

    if (transactionId.length !== 40) {
      throw new Error('Transaction ID must be exactly 40 characters (SHA-256 hash)');
    }

    if (!/^[0-9a-f]{40}$/i.test(transactionId)) {
      throw new Error('Transaction ID must be a valid hexadecimal string');
    }

    try {
      const transaction = await this.retryWithBackoff(async () => {
        return await this.client.database.call('condenser_api.get_transaction', [transactionId]);
      });

      return transaction;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch transaction: ${errorMessage}`);
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

  /**
   * Generic RPC call to Hive API
   * Useful for condenser_api calls like get_discussions_by_*
   */
  async call(api: string, method: string, params: any[]): Promise<any> {
    return this.retryWithBackoff(async () => {
      const startTime = Date.now();
      const nodeUrl = this.selectBestNode();
      
      try {
        const result = await this.client.call(api, method, params);
        this.recordLatency(nodeUrl, Date.now() - startTime);
        this.recordSuccess(nodeUrl);
        return result;
      } catch (error) {
        this.recordError(nodeUrl);
        throw error;
      }
    });
  }

  /**
   * BATCH OPTIMIZATION: Fetch account history for multiple users in parallel
   * Reduces total network latency by running requests concurrently
   */
  async getBatchAccountHistory(
    usernames: string[],
    limit: number = 100,
    filter: OperationFilter = 'transfers'
  ): Promise<Map<string, any[]>> {
    const results = new Map<string, any[]>();
    
    if (usernames.length === 0) return results;

    logger.info('[BATCH RPC] Fetching account history for', usernames.length, 'users');
    const startTime = performance.now();

    const promises = usernames.map(async (username) => {
      try {
        const history = await this.getAccountHistory(username, limit, filter);
        return { username, history, success: true };
      } catch (error) {
        logger.warn('[BATCH RPC] Failed to fetch history for:', username, error);
        return { username, history: [], success: false };
      }
    });

    const settled = await Promise.all(promises);
    
    for (const result of settled) {
      results.set(result.username, result.history);
    }

    const elapsed = Math.round(performance.now() - startTime);
    logger.info('[BATCH RPC] Batch complete in', elapsed, 'ms for', usernames.length, 'users');

    return results;
  }

  /**
   * BATCH OPTIMIZATION: Fetch multiple accounts in a single RPC call
   * Much more efficient than getAccount() for multiple users
   */
  async getAccounts(usernames: string[]): Promise<Map<string, ExtendedAccount | null>> {
    const results = new Map<string, ExtendedAccount | null>();
    
    if (usernames.length === 0) return results;

    const validUsernames = usernames.filter(u => this.validateUsername(u));
    
    if (validUsernames.length === 0) {
      usernames.forEach(u => results.set(u, null));
      return results;
    }

    logger.info('[BATCH RPC] Fetching', validUsernames.length, 'accounts in single call');
    const startTime = performance.now();

    try {
      const accounts = await this.retryWithBackoff(async () => {
        return await this.client.database.getAccounts(validUsernames);
      });

      const accountMap = new Map<string, ExtendedAccount>();
      for (const account of accounts) {
        accountMap.set(account.name, account as ExtendedAccount);
      }

      for (const username of usernames) {
        results.set(username, accountMap.get(username) || null);
      }

      const elapsed = Math.round(performance.now() - startTime);
      logger.info('[BATCH RPC] Batch accounts fetched in', elapsed, 'ms');

    } catch (error) {
      logger.error('[BATCH RPC] Failed to fetch batch accounts:', error);
      usernames.forEach(u => results.set(u, null));
    }

    return results;
  }

  /**
   * Get the current head block number for sync state tracking
   */
  async getHeadBlockNumber(): Promise<number> {
    try {
      const props = await this.retryWithBackoff(async () => {
        return await this.client.database.getDynamicGlobalProperties();
      });
      return props.head_block_number;
    } catch (error) {
      logger.error('[RPC] Failed to get head block:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const hiveClient = new HiveBlockchainClient([
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://rpc.ecency.com',
  'https://hive-api.arcange.eu',
]);

// Export the class for testing purposes
export { HiveBlockchainClient };
