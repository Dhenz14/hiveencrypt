/**
 * Image chunking and broadcasting module for Hive custom_json operations
 * Handles splitting large payloads into 8KB-compliant chunks and batched broadcasting
 * 
 * @module imageChunking
 */

const CHUNK_SIZE = 7000; // Conservative limit for 8KB after JSON overhead

/**
 * Chunk metadata for multi-operation messages
 */
export interface ChunkMetadata {
  sessionId: string;
  totalChunks: number;
  hash: string;
}

/**
 * Individual chunk structure
 */
export interface Chunk {
  idx: number;
  data: string;
}

/**
 * Split encrypted payload into chunks for blockchain broadcast
 * 
 * @param encrypted - Encrypted payload string
 * @param hash - SHA-256 integrity hash
 * @returns Object with sessionId and chunks array
 * 
 * @example
 * const { sessionId, chunks } = chunkEncryptedPayload(encrypted, hash);
 * console.log(`Split into ${chunks.length} chunks (session: ${sessionId})`);
 */
export function chunkEncryptedPayload(
  encrypted: string,
  hash: string
): { sessionId: string; chunks: Chunk[] } {
  const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const chunks: Chunk[] = [];
  
  for (let i = 0; i < encrypted.length; i += CHUNK_SIZE) {
    chunks.push({
      idx: chunks.length,
      data: encrypted.substring(i, i + CHUNK_SIZE)
    });
  }
  
  console.log(`[CHUNK] Created ${chunks.length} chunks (session: ${sessionId}):`, {
    totalSize: encrypted.length,
    chunkSize: CHUNK_SIZE,
    chunks: chunks.length,
    lastChunkSize: chunks[chunks.length - 1]?.data.length || 0
  });
  
  return { sessionId, chunks };
}

/**
 * Broadcast image message to blockchain
 * Automatically selects single-operation or chunked approach based on size
 * 
 * @param username - Sender's username
 * @param recipientUsername - Recipient's username
 * @param encrypted - Encrypted payload
 * @param hash - SHA-256 integrity hash
 * @returns Promise<string> - Transaction ID
 * 
 * @throws Error if broadcast fails or RC insufficient
 */
export async function broadcastImageMessage(
  username: string,
  recipientUsername: string,
  encrypted: string,
  hash: string
): Promise<string> {
  // Estimate JSON size with metadata
  const estimatedJsonSize = JSON.stringify({
    v: 1,
    to: recipientUsername,
    e: encrypted,
    h: hash
  }).length;
  
  console.log('[BROADCAST] Deciding broadcast strategy:', {
    encryptedSize: encrypted.length,
    estimatedJsonSize,
    threshold: 7500,
    recipient: recipientUsername
  });
  
  if (estimatedJsonSize <= 7500) {
    // Single operation - simple path
    console.log('[BROADCAST] Using single operation (under threshold)');
    return await broadcastSingleOperation(username, recipientUsername, encrypted, hash);
  } else {
    // Multi-chunk - batched transaction
    console.log('[BROADCAST] Using chunked operations (over threshold)');
    return await broadcastChunkedOperation(username, recipientUsername, encrypted, hash);
  }
}

/**
 * Broadcast a single custom_json operation
 * 
 * @param username - Sender's username
 * @param recipientUsername - Recipient's username
 * @param encrypted - Encrypted payload
 * @param hash - SHA-256 integrity hash
 * @returns Promise<string> - Transaction ID
 */
async function broadcastSingleOperation(
  username: string,
  recipientUsername: string,
  encrypted: string,
  hash: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    const payload = JSON.stringify({
      v: 1,       // Version
      to: recipientUsername,  // Recipient (unencrypted for filtering)
      e: encrypted,
      h: hash     // Integrity hash
    });

    console.log('[BROADCAST] Single operation payload size:', payload.length, 'bytes');

    window.hive_keychain.requestCustomJson(
      username,
      'hive-messenger-img',
      'Posting',
      payload,
      'Send encrypted image',
      (response: any) => {
        if (response.success) {
          console.log('[BROADCAST] ✅ Single operation sent, txId:', response.result);
          resolve(response.result);
        } else {
          console.error('[BROADCAST] ❌ Single operation failed:', response.message);
          reject(new Error(response.message || 'Broadcast failed'));
        }
      }
    );
  });
}

/**
 * Broadcast multiple custom_json operations in ONE batched transaction
 * All chunks sent together - atomic operation
 * 
 * @param username - Sender's username
 * @param recipientUsername - Recipient's username
 * @param encrypted - Encrypted payload
 * @param hash - SHA-256 integrity hash
 * @returns Promise<string> - Transaction ID
 */
async function broadcastChunkedOperation(
  username: string,
  recipientUsername: string,
  encrypted: string,
  hash: string
): Promise<string> {
  const { sessionId, chunks } = chunkEncryptedPayload(encrypted, hash);
  
  // Build operations array (all chunks in ONE transaction)
  const operations = chunks.map((chunk) => [
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [username],
      id: 'hive-messenger-img',
      json: JSON.stringify({
        v: 1,
        to: recipientUsername,  // Recipient (unencrypted for filtering)
        sid: sessionId,
        idx: chunk.idx,
        tot: chunks.length,
        h: chunk.idx === 0 ? hash : undefined, // Only include hash in first chunk
        e: chunk.data
      })
    }
  ]);
  
  console.log('[BROADCAST] Prepared batched transaction:', {
    sessionId,
    operations: operations.length,
    totalSize: encrypted.length
  });
  
  // Broadcast all in ONE transaction via Keychain
  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestBroadcast(
      username,
      operations,
      'Posting',
      (response: any) => {
        if (response.success) {
          console.log(`[BROADCAST] ✅ ${chunks.length} chunks sent in ONE transaction`);
          console.log('[BROADCAST] Transaction ID:', response.result.id);
          resolve(response.result.id);
        } else {
          console.error('[BROADCAST] ❌ Batched broadcast failed:', response.message);
          reject(new Error(response.message || 'Batched broadcast failed'));
        }
      }
    );
  });
}

/**
 * Reassemble chunked messages from blockchain data
 * 
 * @param chunks - Array of chunk objects with sessionId, idx, data
 * @returns Map<sessionId, reassembled encrypted payload>
 */
export function reassembleChunks(
  chunks: Array<{ sid: string; idx: number; tot: number; e: string; h?: string }>
): Map<string, { encrypted: string; hash?: string }> {
  const sessions = new Map<string, Array<{ idx: number; chunk: string; hash?: string }>>();
  
  // Group by session ID
  for (const chunk of chunks) {
    if (!sessions.has(chunk.sid)) {
      sessions.set(chunk.sid, []);
    }
    sessions.get(chunk.sid)!.push({ 
      idx: chunk.idx, 
      chunk: chunk.e,
      hash: chunk.h
    });
  }
  
  // Reassemble each session
  const reassembled = new Map<string, { encrypted: string; hash?: string }>();
  
  // Use Array.from to avoid downlevelIteration requirement
  Array.from(sessions.entries()).forEach(([sessionId, sessionChunks]) => {
    // Sort by index with explicit types
    sessionChunks.sort((a: { idx: number; chunk: string; hash?: string }, 
                       b: { idx: number; chunk: string; hash?: string }) => a.idx - b.idx);
    
    // Concatenate chunks with explicit type
    const fullPayload = sessionChunks.map((c: { idx: number; chunk: string; hash?: string }) => c.chunk).join('');
    const hash = sessionChunks.find((c: { idx: number; chunk: string; hash?: string }) => c.hash)?.hash;
    
    reassembled.set(sessionId, {
      encrypted: fullPayload,
      hash
    });
    
    console.log(`[REASSEMBLE] Session ${sessionId}:`, {
      chunks: sessionChunks.length,
      totalSize: fullPayload.length,
      hasHash: !!hash
    });
  });
  
  return reassembled;
}
