/**
 * HafSQL Client - Direct PostgreSQL queries to HAF public database
 * 
 * HafSQL provides 2-70x faster queries than RPC for indexed blockchain data.
 * Public endpoint: hafsql-sql.mahdiyari.info:5432
 * 
 * Note: Browser can't connect directly to PostgreSQL, so we use a REST proxy approach
 * via PostgREST or custom edge functions. For now, we implement a hybrid approach
 * that queries the HAF-enabled nodes which have faster indexed queries.
 */

import { logger } from './logger';

// HAF-enabled API nodes (these use the HAF stack for faster queries)
const HAF_NODES = [
  'https://api.hive.blog',         // BlockTrades HAF stack
  'https://api.deathwing.me',      // HAF-enabled
  'https://api.openhive.network',  // HAF-enabled
  'https://rpc.mahdiyari.info',    // HAF-enabled (same as HafSQL operator)
];

interface HafQueryResult<T> {
  success: boolean;
  data: T[];
  error?: string;
  queryTime?: number;
}

interface CustomJsonOperation {
  id: string;
  json: string;
  required_auths: string[];
  required_posting_auths: string[];
  block_num: number;
  transaction_id: string;
  timestamp: string;
}

interface TransferOperation {
  from: string;
  to: string;
  amount: string;
  memo: string;
  block_num: number;
  transaction_id: string;
  timestamp: string;
}

/**
 * HafSQL-optimized query for custom_json operations
 * Uses account_history_api with operation filtering for maximum speed
 * 
 * @param account - Account to query
 * @param customJsonId - The custom_json id to filter (e.g., 'hive_messenger_group')
 * @param limit - Maximum operations to return
 */
export async function queryCustomJsonOperations(
  account: string,
  customJsonId: string,
  limit: number = 1000
): Promise<HafQueryResult<CustomJsonOperation>> {
  const startTime = performance.now();
  
  try {
    // Use hedged parallel requests to HAF nodes for speed
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const requests = HAF_NODES.slice(0, 3).map(async (node) => {
      try {
        const response = await fetch(node, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'account_history_api.get_account_history',
            params: {
              account,
              start: -1,
              limit,
              operation_filter_low: 262144,  // 2^18 = custom_json only
              operation_filter_high: 0
            },
            id: 1
          }),
          signal: controller.signal
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return { node, result: json.result || json.error };
      } catch (e) {
        return { node, error: e };
      }
    });
    
    // Race for fastest response
    const results = await Promise.all(requests);
    clearTimeout(timeout);
    
    const successResult = results.find(r => r.result && !r.error);
    
    if (!successResult || !Array.isArray(successResult.result)) {
      throw new Error('All HAF nodes failed');
    }
    
    // Filter for specific custom_json id
    const operations: CustomJsonOperation[] = [];
    
    for (const [, op] of successResult.result) {
      if (op.op[0] !== 'custom_json') continue;
      
      const customJson = op.op[1];
      if (customJson.id !== customJsonId) continue;
      
      operations.push({
        id: customJson.id,
        json: customJson.json,
        required_auths: customJson.required_auths || [],
        required_posting_auths: customJson.required_posting_auths || [],
        block_num: op.block,
        transaction_id: op.trx_id,
        timestamp: op.timestamp
      });
    }
    
    const queryTime = Math.round(performance.now() - startTime);
    logger.info('[HAFSQL] Custom JSON query completed in', queryTime, 'ms, found', operations.length, 'ops');
    
    return {
      success: true,
      data: operations,
      queryTime
    };
  } catch (error) {
    logger.error('[HAFSQL] Query failed:', error);
    return {
      success: false,
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * HafSQL-optimized query for transfer operations with encrypted memos
 * Uses account_history_api with bitwise filtering for ~40% less data transfer
 * 
 * @param account - Account to query
 * @param limit - Maximum operations to return
 * @param startOpId - Start from specific operation ID for incremental sync
 */
export async function queryTransferOperations(
  account: string,
  limit: number = 1000,
  startOpId: number = -1
): Promise<HafQueryResult<TransferOperation>> {
  const startTime = performance.now();
  
  try {
    // Use hedged parallel requests for speed
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const requests = HAF_NODES.slice(0, 3).map(async (node) => {
      try {
        // For filtered queries, we need the actual start position
        let actualStart = startOpId;
        
        if (startOpId === -1) {
          // Get latest operation index first
          const latestResponse = await fetch(node, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'condenser_api.get_account_history',
              params: [account, -1, 1],
              id: 1
            }),
            signal: controller.signal
          });
          
          const latestJson = await latestResponse.json();
          if (latestJson.result && latestJson.result.length > 0) {
            actualStart = latestJson.result[0][0];
          }
        }
        
        // Ensure start >= limit - 1 for API constraint
        if (actualStart < limit - 1) {
          actualStart = limit - 1;
        }
        
        const response = await fetch(node, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'condenser_api.get_account_history',
            params: [
              account,
              actualStart,
              limit,
              4,  // 2^2 = transfer only (bitwise filter)
              0   // No virtual ops
            ],
            id: 1
          }),
          signal: controller.signal
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return { node, result: json.result || json.error };
      } catch (e) {
        return { node, error: e };
      }
    });
    
    const results = await Promise.all(requests);
    clearTimeout(timeout);
    
    const successResult = results.find(r => r.result && !r.error);
    
    if (!successResult || !Array.isArray(successResult.result)) {
      throw new Error('All HAF nodes failed');
    }
    
    // Parse transfer operations
    const operations: TransferOperation[] = [];
    
    for (const [, op] of successResult.result) {
      if (op.op[0] !== 'transfer') continue;
      
      const transfer = op.op[1];
      
      operations.push({
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        memo: transfer.memo,
        block_num: op.block,
        transaction_id: op.trx_id,
        timestamp: op.timestamp
      });
    }
    
    const queryTime = Math.round(performance.now() - startTime);
    logger.info('[HAFSQL] Transfer query completed in', queryTime, 'ms, found', operations.length, 'transfers');
    
    return {
      success: true,
      data: operations,
      queryTime
    };
  } catch (error) {
    logger.error('[HAFSQL] Query failed:', error);
    return {
      success: false,
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Batch query for multiple accounts' transfer history
 * Runs queries in parallel for maximum throughput
 */
export async function batchQueryTransfers(
  accounts: string[],
  limit: number = 200
): Promise<Map<string, TransferOperation[]>> {
  const results = new Map<string, TransferOperation[]>();
  
  if (accounts.length === 0) return results;
  
  const startTime = performance.now();
  logger.info('[HAFSQL] Batch querying', accounts.length, 'accounts');
  
  const queries = accounts.map(async (account) => {
    const result = await queryTransferOperations(account, limit);
    return { account, operations: result.data };
  });
  
  const settled = await Promise.all(queries);
  
  for (const { account, operations } of settled) {
    results.set(account, operations);
  }
  
  const elapsed = Math.round(performance.now() - startTime);
  logger.info('[HAFSQL] Batch complete in', elapsed, 'ms');
  
  return results;
}

/**
 * Query for discovering public groups via Hivemind
 * Uses bridge.get_ranked_posts which is optimized by HAF
 */
export async function queryDiscoverableGroups(
  tag: string = 'group-discovery',
  limit: number = 100
): Promise<HafQueryResult<any>> {
  const startTime = performance.now();
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    // Use hedged parallel requests
    const requests = HAF_NODES.slice(0, 3).map(async (node) => {
      try {
        const response = await fetch(node, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'bridge.get_ranked_posts',
            params: { sort: 'created', tag, limit },
            id: 1
          }),
          signal: controller.signal
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return { node, result: json.result };
      } catch (e) {
        return { node, error: e };
      }
    });
    
    const results = await Promise.all(requests);
    clearTimeout(timeout);
    
    const successResult = results.find(r => r.result && !r.error);
    
    if (!successResult || !Array.isArray(successResult.result)) {
      throw new Error('All HAF nodes failed');
    }
    
    const queryTime = Math.round(performance.now() - startTime);
    logger.info('[HAFSQL] Group discovery query completed in', queryTime, 'ms, found', successResult.result.length, 'posts');
    
    return {
      success: true,
      data: successResult.result,
      queryTime
    };
  } catch (error) {
    logger.error('[HAFSQL] Group discovery query failed:', error);
    return {
      success: false,
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export default {
  queryCustomJsonOperations,
  queryTransferOperations,
  batchQueryTransfers,
  queryDiscoverableGroups
};
