/**
 * Hive Blockchain Custom JSON Functions
 * 
 * Add these functions to your hive.ts or hiveClient.ts file
 * These handle fetching custom_json operations from the blockchain
 */

import { Client } from '@hiveio/dhive';
import { reassembleChunks } from '../lib/imageChunking';

/**
 * Custom JSON operation structure from blockchain
 */
export interface CustomJsonOperation {
  txId: string;
  sessionId?: string;
  from: string;
  to: string;
  timestamp: string;
  encryptedPayload: string;
  hash?: string;
  chunks?: number;
}

/**
 * Fetch custom_json operations for image messaging
 * 
 * @param username - User's Hive username
 * @param partnerUsername - Conversation partner's username
 * @param limit - Maximum operations to fetch (default: 200)
 * @returns Array of custom_json image messages
 * 
 * @example
 * const messages = await getCustomJsonMessages('alice', 'bob', 200);
 * console.log(`Found ${messages.length} image messages`);
 */
export async function getCustomJsonMessages(
  username: string,
  partnerUsername: string,
  limit: number = 200
): Promise<CustomJsonOperation[]> {
  try {
    console.log('[CUSTOM JSON] Fetching messages for conversation:', { username, partnerUsername, limit });
    
    // Create Hive client with reliable RPC nodes
    const client = new Client([
      'https://api.hive.blog',
      'https://api.hivekings.com',
      'https://anyx.io',
      'https://api.openhive.network'
    ]);
    
    // custom_json is operation type 18, so bit 18 = 2^18 = 262144
    const operationFilterLow = 262144;

    // Fetch account history with operation filter
    const history = await client.database.call('get_account_history', [
      username,
      -1, // Start from most recent
      limit,
      operationFilterLow, // Only custom_json operations
    ]);

    console.log('[CUSTOM JSON] Retrieved', history.length, 'custom_json operations from blockchain');

    // Parse operations and reassemble chunks
    const chunkedSessions = new Map<string, any[]>();
    const singleOperations: CustomJsonOperation[] = [];

    for (const [, op] of history) {
      if (op[0] !== 'custom_json') continue;

      const customJson = op[1];
      if (customJson.id !== 'hive-messenger-img') continue;

      let payload: any;
      try {
        payload = JSON.parse(customJson.json);
      } catch {
        console.warn('[CUSTOM JSON] Failed to parse JSON for operation');
        continue;
      }

      // Verify this is between the two users
      const from = customJson.required_posting_auths[0];
      if (
        (from !== username && from !== partnerUsername) ||
        (!payload.t || (payload.t !== username && payload.t !== partnerUsername))
      ) {
        continue;
      }

      // Check if this is a chunked operation
      if (payload.sid) {
        // Multi-chunk operation
        if (!chunkedSessions.has(payload.sid)) {
          chunkedSessions.set(payload.sid, []);
        }
        chunkedSessions.get(payload.sid)!.push(payload);
      } else {
        // Single operation
        singleOperations.push({
          txId: op[1].trx_id || `${op[1].block}-${op[1].trx_in_block}`,
          from,
          to: payload.t,
          timestamp: op[1].timestamp,
          encryptedPayload: payload.e,
          hash: payload.h,
          chunks: 1,
        });
      }
    }

    // Reassemble chunked messages
    const operations: CustomJsonOperation[] = [...singleOperations];

    for (const [sessionId, chunks] of chunkedSessions.entries()) {
      const reassembled = reassembleChunks(chunks);
      
      for (const [sid, { encrypted, hash }] of reassembled.entries()) {
        const firstChunk = chunks.find((c: any) => c.sid === sid);
        if (!firstChunk) continue;

        operations.push({
          txId: sessionId,
          sessionId: sid,
          from: username, // Assumes current user is sender for chunked messages
          to: partnerUsername,
          timestamp: new Date().toISOString(), // You may want to extract from operation
          encryptedPayload: encrypted,
          hash,
          chunks: chunks.length,
        });
      }
    }

    console.log('[CUSTOM JSON] Processed', operations.length, 'image messages (including reassembled chunks)');
    return operations;

  } catch (error) {
    console.error('[CUSTOM JSON] Failed to fetch messages:', error);
    throw error;
  }
}

/**
 * INTEGRATION INSTRUCTIONS:
 * 
 * 1. Copy this function to your hive.ts file
 * 2. Make sure you have @hiveio/dhive installed
 * 3. Import reassembleChunks from imageChunking.ts
 * 4. Use in your React hooks like this:
 * 
 * import { getCustomJsonMessages } from '@/lib/hive';
 * 
 * const messages = await getCustomJsonMessages(
 *   user.username,
 *   partnerUsername,
 *   200
 * );
 */
