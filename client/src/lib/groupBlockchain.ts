import { hiveClient as optimizedHiveClient } from './hiveClient';
import { normalizeHiveTimestamp } from './hive';
import { logger } from './logger';
import type { Group } from '@/../../shared/schema';
import { z } from 'zod';

// ============================================================================
// GROUP CHAT: Blockchain Custom JSON Operations
// ============================================================================

// Configuration for deep backfill scanning
export const MAX_DEEP_BACKFILL_OPS = 5000; // Maximum total operations to scan during deep backfill
export const BACKFILL_CHUNK_SIZE = 1000;   // Hive RPC hard limit per request

export const GROUP_CUSTOM_JSON_ID = 'hive_messenger_group';

// ============================================================================
// GROUP INVITE MEMO SCHEMA
// ============================================================================
// Schema for encrypted memos containing transaction pointers to group manifests
// This solves the scalability problem for groups older than 5000 operations

export const GroupInviteMemoSchema = z.object({
  type: z.literal('group_invite'),
  groupId: z.string(),
  manifest_trx_id: z.string().length(40), // SHA-256 transaction ID
  manifest_block: z.number().int().positive(),
  manifest_op_idx: z.number().int().nonnegative(),
  version: z.number().int().positive().optional(),
  action: z.enum(['create', 'update']).optional(),
});

export type GroupInviteMemo = z.infer<typeof GroupInviteMemoSchema>;

export interface GroupCustomJson {
  action: 'create' | 'update' | 'leave';
  groupId: string;
  name?: string;
  members?: string[];
  creator?: string;
  version?: number;
  timestamp: string;
}

// ============================================================================
// OPTIMIZATION UTILITIES: Rate Limiting, Retry Logic, Memo Caching
// ============================================================================

/**
 * Token Bucket Rate Limiter
 * Ensures we respect Hive Keychain's 3-5 req/s limit
 * Allows bursts when tokens available, smooths to target rate over time
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(requestsPerSecond: number = 4) {
    this.capacity = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Recalculate tokens after waiting to account for elapsed time during sleep
      const afterWait = Date.now();
      const waitElapsed = (afterWait - this.lastRefill) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + waitElapsed * this.refillRate);
      this.lastRefill = afterWait;
      
      this.tokens -= 1;
    } else {
      this.tokens -= 1;
    }
  }
}

/**
 * LRU Memo Cache
 * Eliminates duplicate memo decrypts by caching results
 * Promise-based caching prevents concurrent duplicate requests
 */
class MemoCache {
  private cache = new Map<string, Promise<string>>();
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  async getOrDecrypt(
    memoKey: string,
    decryptFn: () => Promise<string>
  ): Promise<string> {
    if (this.cache.has(memoKey)) {
      return this.cache.get(memoKey)!;
    }

    const decryptPromise = decryptFn();
    this.cache.set(memoKey, decryptPromise);

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    try {
      return await decryptPromise;
    } catch (error) {
      this.cache.delete(memoKey);
      throw error;
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Decrypt memo with bounded retry and exponential backoff
 * Handles transient errors (network, throttling) but not permanent errors
 */
async function decryptMemoWithRetry(
  decodeFn: (username: string, memo: string) => Promise<string>,
  username: string,
  memo: string,
  maxAttempts: number = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await decodeFn(username, memo);
    } catch (error: any) {
      lastError = error;

      const errorMsg = error.message?.toLowerCase() || '';
      const isPermanentError = 
        errorMsg.includes('not encrypted for') ||
        errorMsg.includes('invalid') ||
        errorMsg.includes('decode') ||
        errorMsg.includes('malformed');

      if (isPermanentError) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delay = 100 * Math.pow(2, attempt - 1);
        logger.debug(`[MEMO DECRYPT] Retry attempt ${attempt}/${maxAttempts} after ${delay}ms:`, errorMsg);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Memo decryption failed after retries');
}

/**
 * Generates a unique group ID using crypto.randomUUID()
 */
export function generateGroupId(): string {
  return crypto.randomUUID();
}

/**
 * Broadcasts a group creation custom_json operation to the blockchain
 * This is FREE (no HBD cost) and creates an immutable group record
 */
export async function broadcastGroupCreation(
  username: string,
  groupId: string,
  name: string,
  members: string[]
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting group creation:', { groupId, name, members });

  const customJson: GroupCustomJson = {
    action: 'create',
    groupId,
    name,
    members,
    creator: username,
    version: 1,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Create Group Chat',
      (response: any) => {
        (async () => {
          if (response.success) {
            const txId = response.result.id;
            logger.info('[GROUP BLOCKCHAIN] ✅ Group created on blockchain:', txId);
            
            // Send invite memos in background - don't block group creation
            // Use Promise.race with timeout to prevent hanging
            const sendInvitesWithTimeout = async () => {
              try {
                // Add 15-second timeout to prevent indefinite hanging
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Invite memo send timeout after 15s')), 15000)
                );
                
                const sendPromise = (async () => {
                  // Get full transaction details for manifest pointer
                  const transaction = await optimizedHiveClient.getTransaction(txId);
                  
                  if (transaction && transaction.block_num) {
                    // Find the operation index for our custom_json
                    let opIdx = 0;
                    if (transaction.operations) {
                      for (let i = 0; i < transaction.operations.length; i++) {
                        if (transaction.operations[i][0] === 'custom_json' && 
                            transaction.operations[i][1]?.id === GROUP_CUSTOM_JSON_ID) {
                          opIdx = i;
                          break;
                        }
                      }
                    }
                    
                    // Send invite memos to all members
                    const manifestPointer = {
                      trx_id: txId,
                      block: transaction.block_num,
                      op_idx: opIdx
                    };
                    
                    const inviteResults = await sendGroupInviteMemos(
                      groupId,
                      members,
                      manifestPointer,
                      username,
                      'create'
                    );
                    
                    logger.info('[GROUP BLOCKCHAIN] Invite memos sent:', inviteResults);
                  }
                })();
                
                await Promise.race([sendPromise, timeoutPromise]);
              } catch (inviteError) {
                // Log but don't fail the group creation
                logger.error('[GROUP BLOCKCHAIN] Failed to send invite memos:', inviteError);
              }
            };
            
            // Send invites in background without blocking
            sendInvitesWithTimeout();
            
            // Resolve immediately - group creation succeeded
            resolve(txId);
          } else {
            logger.error('[GROUP BLOCKCHAIN] ❌ Failed to create group:', response.error);
            reject(new Error(response.error || 'Failed to broadcast group creation'));
          }
        })().catch(error => {
          logger.error('[GROUP BLOCKCHAIN] Error in callback:', error);
          reject(error);
        });
      }
    );
  });
}

/**
 * Broadcasts a group update (membership change) custom_json operation
 */
export async function broadcastGroupUpdate(
  username: string,
  groupId: string,
  name: string,
  members: string[],
  version: number
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting group update:', { groupId, version });

  const customJson: GroupCustomJson = {
    action: 'update',
    groupId,
    name,
    members,
    version,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Update Group Chat',
      (response: any) => {
        (async () => {
          if (response.success) {
            const txId = response.result.id;
            logger.info('[GROUP BLOCKCHAIN] ✅ Group updated on blockchain:', txId);
            
            // Send invite memos in background - don't block group update
            // Use Promise.race with timeout to prevent hanging
            const sendInvitesWithTimeout = async () => {
              try {
                // Add 15-second timeout to prevent indefinite hanging
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Invite memo send timeout after 15s')), 15000)
                );
                
                const sendPromise = (async () => {
                  // Get full transaction details for manifest pointer
                  const transaction = await optimizedHiveClient.getTransaction(txId);
                  
                  if (transaction && transaction.block_num) {
                    // Find the operation index for our custom_json
                    let opIdx = 0;
                    if (transaction.operations) {
                      for (let i = 0; i < transaction.operations.length; i++) {
                        if (transaction.operations[i][0] === 'custom_json' && 
                            transaction.operations[i][1]?.id === GROUP_CUSTOM_JSON_ID) {
                          opIdx = i;
                          break;
                        }
                      }
                    }
                    
                    // Send invite memos to all members
                    const manifestPointer = {
                      trx_id: txId,
                      block: transaction.block_num,
                      op_idx: opIdx
                    };
                    
                    const inviteResults = await sendGroupInviteMemos(
                      groupId,
                      members,
                      manifestPointer,
                      username,
                      'update'
                    );
                    
                    logger.info('[GROUP BLOCKCHAIN] Invite memos sent:', inviteResults);
                  }
                })();
                
                await Promise.race([sendPromise, timeoutPromise]);
              } catch (inviteError) {
                // Log but don't fail the group update
                logger.error('[GROUP BLOCKCHAIN] Failed to send invite memos:', inviteError);
              }
            };
            
            // Send invites in background without blocking
            sendInvitesWithTimeout();
            
            // Resolve immediately - group update succeeded
            resolve(txId);
          } else {
            logger.error('[GROUP BLOCKCHAIN] ❌ Failed to update group:', response.error);
            reject(new Error(response.error || 'Failed to broadcast group update'));
          }
        })().catch(error => {
          logger.error('[GROUP BLOCKCHAIN] Error in callback:', error);
          reject(error);
        });
      }
    );
  });
}

/**
 * Broadcasts a "leave group" custom_json operation
 */
export async function broadcastLeaveGroup(
  username: string,
  groupId: string
): Promise<string> {
  logger.info('[GROUP BLOCKCHAIN] Broadcasting leave group:', groupId);

  const customJson: GroupCustomJson = {
    action: 'leave',
    groupId,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    if (!window.hive_keychain) {
      reject(new Error('Hive Keychain not installed'));
      return;
    }

    window.hive_keychain.requestCustomJson(
      username,
      GROUP_CUSTOM_JSON_ID,
      'Posting',
      JSON.stringify(customJson),
      'Leave Group Chat',
      (response: any) => {
        if (response.success) {
          logger.info('[GROUP BLOCKCHAIN] ✅ Left group on blockchain:', response.result.id);
          resolve(response.result.id);
        } else {
          logger.error('[GROUP BLOCKCHAIN] ❌ Failed to leave group:', response.error);
          reject(new Error(response.error || 'Failed to broadcast leave group'));
        }
      }
    );
  });
}

// In-memory caches for group metadata lookups to prevent repeated expensive RPC calls
// Sender-level cache: `${groupId}:${knownMember}` → group metadata
const metadataCache = new Map<string, { group: Group | null; timestamp: number }>();
// Group-level positive cache: `${groupId}` → group metadata (if found from any sender)
const groupPositiveCache = new Map<string, { group: Group; timestamp: number }>();
// Group-level negative cache: `${groupId}` → null (if all attempted senders failed)
const groupNegativeCache = new Map<string, { timestamp: number }>();
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Looks up group metadata by querying the blockchain for a specific groupId
 * Uses multi-tier discovery strategy:
 * 1. In-memory caches (instant)
 * 2. IndexedDB manifest pointer cache (instant)
 * 3. Transfer scan for invite memos (scalable)
 * 4. Legacy custom_json deep backfill (5k ops max)
 */
export async function lookupGroupMetadata(groupId: string, knownMember: string): Promise<Group | null> {
  // Cache key used throughout the function
  const cacheKey = `${groupId}:${knownMember}`;
  
  try {
    // TIER 1: Check in-memory group-level positive cache
    const positiveCache = groupPositiveCache.get(groupId);
    if (positiveCache && (Date.now() - positiveCache.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] ✅ Using group-level positive cache for:', groupId);
      return positiveCache.group;
    }
    
    // TIER 2: Check in-memory group-level negative cache
    const negativeCache = groupNegativeCache.get(groupId);
    if (negativeCache && (Date.now() - negativeCache.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] ⚠️ Using group-level negative cache for:', groupId);
      return null;
    }
    
    // TIER 3: Check in-memory sender-level cache (only return if we have positive data)
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.group && (Date.now() - cached.timestamp) < METADATA_CACHE_TTL) {
      logger.info('[GROUP BLOCKCHAIN] Using sender-level cached metadata for:', { groupId, knownMember });
      return cached.group;
    }
    
    logger.info('[GROUP BLOCKCHAIN] Looking up group metadata:', { groupId, knownMember });
    
    // TIER 4: Check IndexedDB for cached manifest pointer
    const { getGroupManifestPointer } = await import('./messageCache');
    const pointer = await getGroupManifestPointer(groupId);
    
    if (pointer) {
      logger.info('[GROUP BLOCKCHAIN] ✅ Found cached manifest pointer for:', groupId);
      
      try {
        // Direct lookup via get_transaction - instant!
        const transaction = await optimizedHiveClient.getTransaction(pointer.manifest_trx_id);
        
        if (transaction && transaction.operations) {
          const operation = transaction.operations[pointer.manifest_op_idx];
          
          if (operation && operation[0] === 'custom_json' && operation[1].id === GROUP_CUSTOM_JSON_ID) {
            const jsonData: GroupCustomJson = JSON.parse(operation[1].json);
            
            if (jsonData.groupId === groupId && jsonData.action !== 'leave') {
              const groupData: Group = {
                groupId,
                name: jsonData.name || 'Unnamed Group',
                members: jsonData.members || [],
                creator: jsonData.creator || knownMember,
                createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                version: jsonData.version || 1,
              };
              
              // Cache in memory
              groupPositiveCache.set(groupId, {
                group: groupData,
                timestamp: Date.now()
              });
              
              logger.info('[GROUP BLOCKCHAIN] ✅ Resolved manifest via pointer (instant lookup):', groupData.name);
              return groupData;
            }
          }
        }
      } catch (pointerError) {
        logger.warn('[GROUP BLOCKCHAIN] Failed to resolve manifest pointer, will try transfer scan:', pointerError);
      }
    }
    
    // TIER 5: Scan transfer operations for group invite memos with STREAMING PROCESSING
    logger.info('[GROUP BLOCKCHAIN] Scanning transfer operations for group invite memos');
    
    // Initialize optimization utilities (shared across all chunks)
    const rateLimiter = new TokenBucket(4); // 4 req/s to stay within Keychain's 3-5 req/s limit
    const memoCache = new MemoCache(1000); // Cache up to 1000 decrypted memos
    
    // Helper function for processing transfer chunks
    const processTransferChunk = async (
      transfers: any[],
      targetGroupId: string,
      recipientUsername: string,
      decodeMemo: any,
      cachePointer: any,
      rateLimiter: TokenBucket,
      memoCache: MemoCache
    ): Promise<Group | null> => {
      for (const [seqNum, operation] of transfers) {
        // Wrap EACH transfer in individual try-catch
        try {
          if (!operation || !operation[1] || !operation[1].op) continue;
          const op = operation[1].op;
          
          if (op[0] !== 'transfer') continue;
          
          const transferData = op[1];
          const { memo, from } = transferData;
          
          if (!memo || !memo.startsWith('#')) continue; // Must be encrypted
          
          // Rate limit BEFORE decrypt (prevents Keychain throttling)
          await rateLimiter.consume();
          
          // Decrypt memo with retry + caching (eliminates duplicates, handles transient errors)
          const decryptedMemo = await memoCache.getOrDecrypt(
            memo, // Use encrypted memo as cache key
            () => decryptMemoWithRetry(decodeMemo, recipientUsername, memo, 3)
          );
          
          // Try to parse as JSON
          const jsonStr = decryptedMemo.startsWith('#') ? decryptedMemo.substring(1) : decryptedMemo;
          const memoData = JSON.parse(jsonStr);
          
          // Validate against GroupInviteMemoSchema
          const parseResult = GroupInviteMemoSchema.safeParse(memoData);
          
          if (!parseResult.success || parseResult.data.groupId !== targetGroupId) {
            continue; // Not a valid group invite for this group
          }
          
          const inviteMemo = parseResult.data;
          logger.info('[GROUP BLOCKCHAIN] ✅ Found group invite memo for:', targetGroupId, 'from:', from, 'seq:', seqNum);
          
          // Cache the pointer in IndexedDB for future instant lookups
          await cachePointer({
            groupId: inviteMemo.groupId,
            manifest_trx_id: inviteMemo.manifest_trx_id,
            manifest_block: inviteMemo.manifest_block,
            manifest_op_idx: inviteMemo.manifest_op_idx,
            cachedAt: new Date().toISOString(),
            sender: from
          });
          
          // Now fetch the manifest using the pointer
          const transaction = await optimizedHiveClient.getTransaction(inviteMemo.manifest_trx_id);
          
          if (transaction && transaction.operations) {
            const operation = transaction.operations[inviteMemo.manifest_op_idx];
            
            if (operation && operation[0] === 'custom_json' && operation[1].id === GROUP_CUSTOM_JSON_ID) {
              const jsonData: GroupCustomJson = JSON.parse(operation[1].json);
              
              if (jsonData.groupId === targetGroupId && jsonData.action !== 'leave') {
                const groupData: Group = {
                  groupId: targetGroupId,
                  name: jsonData.name || 'Unnamed Group',
                  members: jsonData.members || [],
                  creator: jsonData.creator || recipientUsername,
                  createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                  version: jsonData.version || 1,
                };
                
                logger.info('[GROUP BLOCKCHAIN] ✅ Resolved manifest from pointer:', groupData.name);
                return groupData; // IMMEDIATE RETURN
              }
            }
          }
        } catch (transferError: any) {
          // Log and CONTINUE to next transfer (don't abort the chunk)
          // This handles:
          // - Memo decryption failures (not for us)
          // - JSON parse errors (not a group invite)
          // - Keychain throttling (transient)
          // - Malformed payloads
          const from = operation?.[1]?.op?.[1]?.from || 'unknown';
          logger.debug('[GROUP BLOCKCHAIN] Skipping transfer from', from, 'seq', seqNum, ':', transferError.message || transferError);
          continue; // Continue to next transfer in chunk
        }
      }
      
      return null; // No invite memo found in this chunk
    }
    
    // Import utilities once before loop
    const { requestDecodeMemo } = await import('./hive');
    const { cacheGroupManifestPointer } = await import('./messageCache');
    
    // Initial fetch: 1000 transfer operations
    let transferHistory = await optimizedHiveClient.getAccountHistory(
      knownMember,
      1000,
      'transfers',
      -1
    );
    
    let oldestSeqNum = -1;
    let chunkIdx = 0;
    let totalScanned = 0;
    
    if (transferHistory.length > 0) {
      oldestSeqNum = Math.min(...transferHistory.map(([idx]) => idx));
      logger.info('[GROUP BLOCKCHAIN] Transfer scan - initial fetch:', transferHistory.length, 'ops, oldest seq:', oldestSeqNum);
    }
    
    // Process initial chunk immediately (streaming)
    const initialResult = await processTransferChunk(
      transferHistory,
      groupId,
      knownMember,
      requestDecodeMemo,
      cacheGroupManifestPointer,
      rateLimiter,
      memoCache
    );
    totalScanned += transferHistory.length;
    
    if (initialResult) {
      // Found and resolved - return immediately!
      groupPositiveCache.set(groupId, {
        group: initialResult,
        timestamp: Date.now()
      });
      logger.info('[GROUP BLOCKCHAIN] ✅ Resolved manifest via invite memo (initial chunk):', initialResult.name);
      return initialResult;
    }
    
    // Deep backfill with streaming processing
    const TRANSFER_CHUNK_SIZE = 1000;
    const MAX_CONSECUTIVE_FAILURES = 3; // Bail out after 3 consecutive RPC failures
    let consecutiveFailures = 0;
    
    if (oldestSeqNum > 0) {
      logger.info('[GROUP BLOCKCHAIN] Transfer scan - starting unlimited streaming backfill (will scan until pointer found or history exhausted)');
    
      while (oldestSeqNum > 0) {
        try {
          const nextStart = oldestSeqNum - 1;
    
          if (nextStart < 0) {
            logger.info('[GROUP BLOCKCHAIN] Transfer scan - reached beginning of history');
            break;
          }
          
          // Hive API constraint: for filtered queries, start must be >= limit - 1
          // If nextStart is too small, we've essentially reached the beginning of history
          if (nextStart < TRANSFER_CHUNK_SIZE - 1) {
            logger.info('[GROUP BLOCKCHAIN] Transfer scan - near beginning of history (seq:', nextStart, '< chunk size:', TRANSFER_CHUNK_SIZE, ')');
            logger.info('[GROUP BLOCKCHAIN] Transfer scan - scanned all available transfers');
            break;
          }
    
          const olderTransfers = await optimizedHiveClient.getAccountHistory(
            knownMember,
            TRANSFER_CHUNK_SIZE,
            'transfers',
            nextStart
          );
    
          if (olderTransfers.length === 0) {
            logger.info('[GROUP BLOCKCHAIN] Transfer scan - no more transfer operations');
            break;
          }
    
          const chunkOldest = Math.min(...olderTransfers.map(([idx]) => idx));
          if (!Number.isFinite(chunkOldest)) {
            logger.error('[GROUP BLOCKCHAIN] Transfer scan - invalid sequence number');
            break;
          }
    
          // Detect stuck pagination (RPC returning same data)
          if (chunkOldest === oldestSeqNum) {
            logger.error('[GROUP BLOCKCHAIN] Transfer scan - pagination stuck at seq', oldestSeqNum);
            break;
          }
    
          // SUCCESS: Update state BEFORE processing
          oldestSeqNum = chunkOldest;
          chunkIdx++;
          totalScanned += olderTransfers.length;
          consecutiveFailures = 0; // Reset failure counter on success
    
          logger.info('[GROUP BLOCKCHAIN] Transfer scan - chunk', chunkIdx, ':', olderTransfers.length, 'ops, total scanned:', totalScanned);
    
          // Process this chunk immediately (streaming)
          const chunkResult = await processTransferChunk(
            olderTransfers,
            groupId,
            knownMember,
            requestDecodeMemo,
            cacheGroupManifestPointer,
            rateLimiter,
            memoCache
          );
    
          if (chunkResult) {
            // Found and resolved - return immediately!
            groupPositiveCache.set(groupId, {
              group: chunkResult,
              timestamp: Date.now()
            });
            logger.info('[GROUP BLOCKCHAIN] ✅ Resolved manifest via invite memo (chunk', chunkIdx, ', total scanned:', totalScanned, '):', chunkResult.name);
            return chunkResult;
          }
        } catch (error: any) {
          consecutiveFailures++;
          
          // Enhanced error logging with context
          logger.error('[GROUP BLOCKCHAIN] Transfer scan - RPC error on chunk', chunkIdx, '(failure', consecutiveFailures, '/' + MAX_CONSECUTIVE_FAILURES + ')');
          logger.error('[GROUP BLOCKCHAIN] Error details:', {
            error: error.message || error,
            oldestSeqNum,
            totalScanned,
            knownMember,
            groupId
          });
          
          // Bail out after consecutive failures to prevent infinite loops
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.error('[GROUP BLOCKCHAIN] Transfer scan - BAILING OUT after', MAX_CONSECUTIVE_FAILURES, 'consecutive RPC failures');
            logger.error('[GROUP BLOCKCHAIN] Bailout context:', {
              groupId,
              knownMember,
              totalScanned,
              chunksProcessed: chunkIdx,
              lastOldestSeq: oldestSeqNum,
              finalError: error.message || error
            });
            break;
          }
          
          // Continue to retry (with same nextStart, since we didn't update oldestSeqNum)
          continue;
        }
      }
    }
    
    logger.info('[GROUP BLOCKCHAIN] Transfer scan - completed:', totalScanned, 'transfer operations scanned, chunks processed:', chunkIdx);
    
    // TIER 6: LEGACY FALLBACK - Scan custom_json operations (existing 5k deep backfill logic)
    logger.info('[GROUP BLOCKCHAIN] No manifest pointer found, falling back to custom_json scan (legacy)');
    
    // DEEP BACKFILL: Scan the known member's account history for custom_json operations about this group
    // Start with initial chunk of 1000 operations
    let history = await optimizedHiveClient.getAccountHistory(
      knownMember,
      BACKFILL_CHUNK_SIZE,      // 1000 operations per chunk
      'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
      -1         // start = -1 (latest)
    );

    let allOps = [...history];
    oldestSeqNum = -1; // Reuse variable from Tier 5

    if (history.length > 0) {
      oldestSeqNum = Math.min(...history.map(([idx]) => idx));
      logger.info('[GROUP BLOCKCHAIN] Metadata lookup - initial fetch:', history.length, 'ops, oldest seq:', oldestSeqNum);
    }

    // Continue backfilling until we find the group or hit the limit
    const totalOpsTarget = MAX_DEEP_BACKFILL_OPS; // 5000 operations max
    const chunksToFetch = Math.ceil((totalOpsTarget - allOps.length) / BACKFILL_CHUNK_SIZE);

    if (oldestSeqNum > 0 && chunksToFetch > 0 && allOps.length < totalOpsTarget) {
      logger.info('[GROUP BLOCKCHAIN] Metadata lookup - starting deep backfill for:', knownMember, 'target:', totalOpsTarget, 'ops');

      for (let chunkIdx = 0; chunkIdx < chunksToFetch; chunkIdx++) {
        const nextStart = oldestSeqNum - 1;

        if (nextStart < 0) {
          logger.info('[GROUP BLOCKCHAIN] Metadata lookup - reached beginning of history for:', knownMember);
          break;
        }
        
        // Hive API constraint: for filtered queries, start must be >= limit - 1
        // If nextStart is too small, we've essentially reached the beginning of history
        if (nextStart < BACKFILL_CHUNK_SIZE - 1) {
          logger.info('[GROUP BLOCKCHAIN] Metadata lookup - near beginning of history (seq:', nextStart, '< chunk size:', BACKFILL_CHUNK_SIZE, ')');
          logger.info('[GROUP BLOCKCHAIN] Metadata lookup - scanned all available custom_json operations');
          break;
        }

        const olderHistory = await optimizedHiveClient.getAccountHistory(
          knownMember,
          BACKFILL_CHUNK_SIZE,
          'custom_json',
          nextStart
        );

        if (olderHistory.length === 0) {
          logger.info('[GROUP BLOCKCHAIN] Metadata lookup - no more operations for:', knownMember);
          break;
        }

        const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
        if (!Number.isFinite(chunkOldest)) {
          logger.error('[GROUP BLOCKCHAIN] Metadata lookup - invalid sequence number for:', knownMember);
          break;
        }

        oldestSeqNum = chunkOldest;
        allOps = [...allOps, ...olderHistory];

        logger.info('[GROUP BLOCKCHAIN] Metadata lookup - chunk', chunkIdx + 1, ':', olderHistory.length, 'ops, total:', allOps.length);

        // Early exit: Check if we found the group in this chunk
        let foundInChunk = false;
        for (const [, operation] of olderHistory) {
          try {
            if (!operation || !operation[1] || !operation[1].op) continue;
            const op = operation[1].op;
            if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) continue;
            const jsonData: GroupCustomJson = JSON.parse(op[1].json);
            if (jsonData.groupId === groupId && jsonData.action !== 'leave') {
              foundInChunk = true;
              logger.info('[GROUP BLOCKCHAIN] Metadata lookup - found group in chunk', chunkIdx + 1, '- stopping backfill');
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (foundInChunk) {
          break; // Stop backfilling - we found the group!
        }

        if (allOps.length >= totalOpsTarget) {
          logger.info('[GROUP BLOCKCHAIN] Metadata lookup - reached target of', totalOpsTarget, 'ops for:', knownMember);
          break;
        }
      }
    }

    logger.info('[GROUP BLOCKCHAIN] Metadata lookup - completed scan of', allOps.length, 'operations for:', knownMember);

    let latestGroupData: Group | null = null;
    let latestVersion = 0;

    for (const [, operation] of allOps) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }
        
        const op = operation[1].op;
        
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData: GroupCustomJson = JSON.parse(op[1].json);
        
        // Only process operations for this specific groupId
        if (jsonData.groupId !== groupId) {
          continue;
        }

        // Skip leave actions
        if (jsonData.action === 'leave') {
          continue;
        }

        // Use the latest version
        const version = jsonData.version || 1;
        if (version > latestVersion) {
          latestVersion = version;
          latestGroupData = {
            groupId,
            name: jsonData.name || 'Unnamed Group',
            members: jsonData.members || [],
            creator: jsonData.creator || knownMember,
            createdAt: normalizeHiveTimestamp(jsonData.timestamp),
            version,
          };
        }
      } catch (parseError) {
        continue;
      }
    }

    // Cache the result at sender level
    metadataCache.set(cacheKey, {
      group: latestGroupData,
      timestamp: Date.now()
    });

    // Cache at group level (positive or negative)
    if (latestGroupData) {
      logger.info('[GROUP BLOCKCHAIN] ✅ Found group metadata:', latestGroupData.name);
      
      // Positive cache: Store for this groupId (shared across all senders)
      groupPositiveCache.set(groupId, {
        group: latestGroupData,
        timestamp: Date.now()
      });
      
      // Clear any negative cache entry
      groupNegativeCache.delete(groupId);
    } else {
      logger.warn('[GROUP BLOCKCHAIN] ⚠️ No metadata found for group:', groupId, 'from sender:', knownMember);
      // Don't set negative cache here - only when ALL senders fail (handled by caller)
    }

    return latestGroupData;
  } catch (error) {
    logger.error('[GROUP BLOCKCHAIN] ❌ Failed to lookup group metadata:', error);
    
    // Cache the failure at sender level to prevent repeated failed lookups for this sender
    metadataCache.set(cacheKey, {
      group: null,
      timestamp: Date.now()
    });
    
    // Don't set negative cache at group level - let caller decide after trying all senders
    return null;
  }
}

/**
 * Sets the negative cache for a groupId to prevent repeated failed lookups
 * Call this when all known senders have been tried and none had metadata
 */
export function setGroupNegativeCache(groupId: string): void {
  groupNegativeCache.set(groupId, {
    timestamp: Date.now()
  });
  logger.info('[GROUP BLOCKCHAIN] Set negative cache for group:', groupId);
}

/**
 * Sends encrypted invite memos to group members with manifest pointers
 * This enables direct manifest lookup via get_transaction() without scanning history
 * 
 * @param groupId - UUID of the group
 * @param members - Array of member usernames to send invites to
 * @param manifestPointer - Transaction details of the group manifest custom_json
 * @param currentUsername - Username sending the invites
 * @param action - 'create' or 'update' to indicate the type of invite
 * @returns Promise<{ successful: string[], failed: string[] }>
 */
export async function sendGroupInviteMemos(
  groupId: string,
  members: string[],
  manifestPointer: {
    trx_id: string;
    block: number;
    op_idx: number;
  },
  currentUsername: string,
  action: 'create' | 'update' = 'create'
): Promise<{ successful: string[], failed: string[] }> {
  logger.info('[GROUP INVITE] Sending invite memos to', members.length, 'members');
  
  const successful: string[] = [];
  const failed: string[] = [];
  
  // Import required utilities
  const { requestEncode } = await import('./hive');
  const { requestTransfer } = await import('./hive');
  
  for (const member of members) {
    try {
      // Skip sending to self
      if (member === currentUsername) {
        successful.push(member);
        continue;
      }
      
      // Create group invite memo payload
      const inviteMemo: GroupInviteMemo = {
        type: 'group_invite',
        groupId,
        manifest_trx_id: manifestPointer.trx_id,
        manifest_block: manifestPointer.block,
        manifest_op_idx: manifestPointer.op_idx,
        action,
      };
      
      const memoJson = JSON.stringify(inviteMemo);
      
      // Encrypt memo for recipient
      const encodeResponse = await requestEncode(
        currentUsername,
        member,
        `#${memoJson}` // Prefix with # for memo encryption
      );
      
      // Extract encrypted memo from Keychain response
      const encryptedMemo = encodeResponse.result as string;
      
      // Send 0.001 HBD transfer with encrypted memo
      await requestTransfer(
        currentUsername,
        member,
        '0.001',
        encryptedMemo,
        'HBD'
      );
      
      successful.push(member);
      logger.info('[GROUP INVITE] ✅ Sent invite to:', member);
      
    } catch (error) {
      logger.error('[GROUP INVITE] ❌ Failed to send invite to:', member, error);
      failed.push(member);
    }
  }
  
  logger.info('[GROUP INVITE] Complete:', {
    total: members.length,
    successful: successful.length,
    failed: failed.length
  });
  
  return { successful, failed };
}

/**
 * Discovers all groups where the user is a member by scanning account history
 * Now also discovers groups from incoming group messages
 * Returns the most recent version of each group
 */
export async function discoverUserGroups(username: string): Promise<Group[]> {
  logger.info('[GROUP BLOCKCHAIN] Discovering groups for user:', username);

  try {
    const groupMap = new Map<string, Group>();
    const leftGroups = new Set<string>(); // Track groups user has left

    // STEP 1: Scan user's own custom_json operations for groups they created/updated
    logger.info('[GROUP BLOCKCHAIN] STEP 1: Scanning user\'s custom_json for group metadata');
    const customJsonHistory = await optimizedHiveClient.getAccountHistory(
      username,
      1000,      // limit (Hive's max per request)
      'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
      -1         // start = -1 (latest)
    );

    logger.info('[GROUP BLOCKCHAIN] Initial scan:', customJsonHistory.length, 'operations');

    // NEW: Paged backfill for older operations
    let allCustomJsonOps = [...customJsonHistory];

    // Track the oldest sequence number from the initial fetch
    let oldestSeqNum = -1;
    if (customJsonHistory.length > 0) {
      oldestSeqNum = Math.min(...customJsonHistory.map(([idx]) => idx));
      logger.info('[GROUP BLOCKCHAIN] Oldest sequence from initial scan:', oldestSeqNum);
    }

    // Calculate how many more chunks we need
    const totalOpsTarget = MAX_DEEP_BACKFILL_OPS;
    const alreadyFetched = customJsonHistory.length;
    const remainingOps = totalOpsTarget - alreadyFetched;
    const chunksToFetch = Math.ceil(remainingOps / BACKFILL_CHUNK_SIZE);

    if (oldestSeqNum > 0 && chunksToFetch > 0) {
      logger.info('[GROUP BLOCKCHAIN] Starting deep backfill, will scan up to', totalOpsTarget, 'total operations');
      
      for (let i = 0; i < chunksToFetch; i++) {
        // Use the oldestSeqNum as the starting point for the next chunk
        const nextStart = oldestSeqNum - 1;
        
        if (nextStart < 0) {
          logger.info('[GROUP BLOCKCHAIN] Reached beginning of account history, stopping backfill');
          break;
        }
        
        logger.info('[GROUP BLOCKCHAIN] Backfill chunk', i + 1, '/', chunksToFetch, 'starting at sequence:', nextStart);
        
        const olderHistory = await optimizedHiveClient.getAccountHistory(
          username,
          BACKFILL_CHUNK_SIZE,
          'custom_json',  // filter only custom_json operations (10-100x faster than unfiltered)
          nextStart  // Start from the operation BEFORE the oldest we've seen
        );
        
        if (olderHistory.length === 0) {
          logger.info('[GROUP BLOCKCHAIN] No more operations, stopping backfill');
          break;
        }
        
        // Update oldestSeqNum for the next iteration
        // Defensive: Validate Math.min result to catch edge cases
        const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
        if (!Number.isFinite(chunkOldest)) {
          logger.error('[GROUP BLOCKCHAIN] Invalid sequence number from chunk, stopping backfill');
          break;
        }
        oldestSeqNum = chunkOldest;
        
        allCustomJsonOps = [...allCustomJsonOps, ...olderHistory];
        logger.info('[GROUP BLOCKCHAIN] Total scanned:', allCustomJsonOps.length, 'operations, oldest sequence:', oldestSeqNum);
        
        // Stop if we've fetched enough
        if (allCustomJsonOps.length >= totalOpsTarget) {
          logger.info('[GROUP BLOCKCHAIN] Reached target of', totalOpsTarget, 'operations, stopping backfill');
          break;
        }
      }
    }

    logger.info('[GROUP BLOCKCHAIN] ✅ Completed scanning', allCustomJsonOps.length, 'custom_json operations');

    for (const [, operation] of allCustomJsonOps) {
      try {
        // Safely access operation data with null check
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }
        
        const op = operation[1].op;
        
        // Ensure it's a custom_json operation with our ID
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData: GroupCustomJson = JSON.parse(op[1].json);
        const { groupId, action } = jsonData;

        // Handle "leave" action
        if (action === 'leave') {
          leftGroups.add(groupId);
          groupMap.delete(groupId); // Remove from discovered groups
          continue;
        }

        // Only include groups where user is a member
        if (!jsonData.members?.includes(username)) {
          continue;
        }

        // If user has left this group, skip it
        if (leftGroups.has(groupId)) {
          continue;
        }

        // Check if we already have this group with a newer version
        const existing = groupMap.get(groupId);
        if (existing && existing.version >= (jsonData.version || 1)) {
          continue; // Skip older versions
        }

        // Create or update group entry
        const group: Group = {
          groupId,
          name: jsonData.name || 'Unnamed Group',
          members: jsonData.members || [],
          creator: jsonData.creator || username,
          createdAt: normalizeHiveTimestamp(jsonData.timestamp),
          version: jsonData.version || 1,
        };

        groupMap.set(groupId, group);
      } catch (parseError) {
        logger.warn('[GROUP BLOCKCHAIN] Failed to parse group operation:', parseError);
        continue;
      }
    }

    logger.info('[GROUP BLOCKCHAIN] Found', groupMap.size, 'groups from custom_json operations');

    // STEP 2: Tiered transfer scanning to find potential group senders
    // Start with quick scan, expand if needed
    const potentialGroupSenders = new Set<string>();
    
    // Stage 1: Quick scan of recent 500 transfers
    // CRITICAL FIX: Use unfiltered query to bypass RPC node caching issues
    logger.info('[GROUP BLOCKCHAIN] Stage 1: Scanning last 500 operations (unfiltered)...');
    let transferHistory = await optimizedHiveClient.getAccountHistory(
      username,
      500,
      'all',  // Use 'all' filter to bypass potential RPC caching (includes transfers + custom_json)
      -1
    );

    logger.info('[GROUP BLOCKCHAIN] Stage 1: Scanned', transferHistory.length, 'operations');

    // Diagnostic: Count all types of operations
    let totalTransfers = 0;
    let incomingTransfers = 0;
    let encryptedIncoming = 0;

    // Collect senders from Stage 1
    for (const [, operation] of transferHistory) {
      try {
        if (!operation || !operation[1] || !operation[1].op) continue;
        const op = operation[1].op;
        if (op[0] !== 'transfer') continue;
        
        totalTransfers++;
        const transfer = op[1];
        
        if (transfer.to === username) {
          incomingTransfers++;
          
          if (transfer.memo && transfer.memo.startsWith('#')) {
            encryptedIncoming++;
            potentialGroupSenders.add(transfer.from);
            logger.info('[GROUP BLOCKCHAIN] Found encrypted transfer from:', transfer.from, 'amount:', transfer.amount);
          }
        }
      } catch (parseError) {
        continue;
      }
    }

    logger.info('[GROUP BLOCKCHAIN] Stage 1: Total transfers:', totalTransfers, 'Incoming:', incomingTransfers, 'Encrypted:', encryptedIncoming);
    logger.info('[GROUP BLOCKCHAIN] Stage 1: Found', potentialGroupSenders.size, 'potential senders');

    // Stage 2: If no senders found, expand deeper
    if (potentialGroupSenders.size === 0) {
      try {
        logger.info('[GROUP BLOCKCHAIN] Stage 2: No senders in recent history, expanding to 1000 operations (unfiltered)...');
        
        transferHistory = await optimizedHiveClient.getAccountHistory(
          username,
          1000,  // Hive's max per request
          'all',  // Use 'all' filter to bypass potential RPC caching (includes transfers + custom_json)
          -1
        );

        logger.info('[GROUP BLOCKCHAIN] Stage 2: Scanned', transferHistory.length, 'operations');

        // Diagnostic: Count all types of operations
        let stage2TotalTransfers = 0;
        let stage2IncomingTransfers = 0;
        let stage2EncryptedIncoming = 0;

        for (const [, operation] of transferHistory) {
          try {
            if (!operation || !operation[1] || !operation[1].op) continue;
            const op = operation[1].op;
            if (op[0] !== 'transfer') continue;
            
            stage2TotalTransfers++;
            const transfer = op[1];
            
            if (transfer.to === username) {
              stage2IncomingTransfers++;
              
              if (transfer.memo && transfer.memo.startsWith('#')) {
                stage2EncryptedIncoming++;
                potentialGroupSenders.add(transfer.from);
                logger.info('[GROUP BLOCKCHAIN] Stage 2: Found encrypted transfer from:', transfer.from, 'amount:', transfer.amount);
              }
            }
          } catch (parseError) {
            continue;
          }
        }

        logger.info('[GROUP BLOCKCHAIN] Stage 2: Total transfers:', stage2TotalTransfers, 'Incoming:', stage2IncomingTransfers, 'Encrypted:', stage2EncryptedIncoming);
        logger.info('[GROUP BLOCKCHAIN] Stage 2: Found', potentialGroupSenders.size, 'total potential senders');
      } catch (stage2Error) {
        logger.error('[GROUP BLOCKCHAIN] Stage 2 failed:', stage2Error);
        logger.info('[GROUP BLOCKCHAIN] Continuing with', potentialGroupSenders.size, 'senders from Stage 1');
      }
    }

    logger.info('[GROUP BLOCKCHAIN] ✅ Discovery complete:', potentialGroupSenders.size, 'potential group senders to scan');

    // Track how many groups we had before sender scans
    const initialGroupCount = groupMap.size;

    // STEP 3: Check each sender's custom_json for group creations that include us
    // Use batched parallel scanning to avoid overwhelming RPC nodes
    const BATCH_SIZE = 10; // Process 10 senders at a time to avoid RPC overload
    const senders = Array.from(potentialGroupSenders);
    const allFoundGroups: Group[] = [];
    
    // Process senders in batches
    for (let i = 0; i < senders.length; i += BATCH_SIZE) {
      const batch = senders.slice(i, i + BATCH_SIZE);
      logger.info('[GROUP BLOCKCHAIN] Processing batch', Math.floor(i / BATCH_SIZE) + 1, '/', Math.ceil(senders.length / BATCH_SIZE), '(', batch.length, 'senders)');
      
      const batchScans = batch.map(async (sender) => {
        try {
          logger.info('[GROUP BLOCKCHAIN] Checking', sender, 'for group creations with deep backfill');
          
          // DEEP BACKFILL: Fetch initial chunk (up to 1000 operations)
          let senderHistory = await optimizedHiveClient.getAccountHistory(
            sender,
            BACKFILL_CHUNK_SIZE,  // 1000 operations per chunk
            'custom_json',
            -1  // start at latest
          );

          let allSenderOps = [...senderHistory];
          let oldestSeqNum = -1;

          if (senderHistory.length > 0) {
            oldestSeqNum = Math.min(...senderHistory.map(([idx]) => idx));
            logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- initial fetch:', senderHistory.length, 'ops, oldest seq:', oldestSeqNum);
          }

          // Continue backfilling until we hit the limit or run out of history
          const totalOpsTarget = MAX_DEEP_BACKFILL_OPS; // 5000 operations max
          const chunksToFetch = Math.ceil((totalOpsTarget - allSenderOps.length) / BACKFILL_CHUNK_SIZE);

          if (oldestSeqNum > 0 && chunksToFetch > 0 && allSenderOps.length < totalOpsTarget) {
            logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- starting deep backfill, target:', totalOpsTarget, 'ops');

            for (let chunkIdx = 0; chunkIdx < chunksToFetch; chunkIdx++) {
              const nextStart = oldestSeqNum - 1;

              if (nextStart < 0) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- reached beginning of history');
                break;
              }

              const olderHistory = await optimizedHiveClient.getAccountHistory(
                sender,
                BACKFILL_CHUNK_SIZE,
                'custom_json',
                nextStart
              );

              if (olderHistory.length === 0) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- no more operations');
                break;
              }

              const chunkOldest = Math.min(...olderHistory.map(([idx]) => idx));
              if (!Number.isFinite(chunkOldest)) {
                logger.error('[GROUP BLOCKCHAIN] Sender', sender, '- invalid sequence number, stopping');
                break;
              }

              oldestSeqNum = chunkOldest;
              allSenderOps = [...allSenderOps, ...olderHistory];

              logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- chunk', chunkIdx + 1, ':', olderHistory.length, 'ops, total:', allSenderOps.length);

              if (allSenderOps.length >= totalOpsTarget) {
                logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- reached target of', totalOpsTarget, 'ops');
                break;
              }
            }
          }

          logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- completed scan of', allSenderOps.length, 'operations');

          const foundGroups: Group[] = [];

          // Process all fetched operations
          for (const [, operation] of allSenderOps) {
            try {
              if (!operation || !operation[1] || !operation[1].op) {
                continue;
              }
              
              const op = operation[1].op;
              
              if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
                continue;
              }

              const jsonData: GroupCustomJson = JSON.parse(op[1].json);
              const { groupId, action } = jsonData;

              // Skip leave actions
              if (action === 'leave') {
                continue;
              }

              // Only include groups where current user is a member
              if (!jsonData.members?.includes(username)) {
                continue;
              }

              // Check if we already have this group with a newer version
              const existing = groupMap.get(groupId);
              if (existing && existing.version >= (jsonData.version || 1)) {
                continue;
              }

              // Create or update group entry
              const group: Group = {
                groupId,
                name: jsonData.name || 'Unnamed Group',
                members: jsonData.members || [],
                creator: jsonData.creator || sender,
                createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                version: jsonData.version || 1,
              };

              foundGroups.push(group);
              logger.info('[GROUP BLOCKCHAIN] Discovered group from', sender, ':', group.name, 'v' + group.version, 'with', group.members.length, 'members');

            } catch (parseError) {
              logger.warn('[GROUP BLOCKCHAIN] Failed to parse group operation from', sender, ':', parseError);
              continue;
            }
          }

          logger.info('[GROUP BLOCKCHAIN] Sender', sender, '- found', foundGroups.length, 'groups');
          return foundGroups;
        } catch (error) {
          logger.warn('[GROUP BLOCKCHAIN] Failed to scan', sender, 'history:', error);
          return [];
        }
      });

      // Wait for this batch to complete
      const batchResults = await Promise.all(batchScans);
      
      // Merge batch results
      for (const foundGroups of batchResults) {
        allFoundGroups.push(...foundGroups);
      }
    }

    // Now merge all discovered groups into groupMap (respecting leftGroups and versions)
    for (const group of allFoundGroups) {
      // Skip groups the user has left
      if (leftGroups.has(group.groupId)) {
        logger.info('[GROUP BLOCKCHAIN] Skipping left group:', group.name);
        continue;
      }
      
      // Check if we already have a newer version
      const existing = groupMap.get(group.groupId);
      if (existing && existing.version >= group.version) {
        logger.info('[GROUP BLOCKCHAIN] Skipping older version of', group.name, '(have v', existing.version, ', found v', group.version, ')');
        continue;
      }
      
      groupMap.set(group.groupId, group);
    }

    logger.info('[GROUP BLOCKCHAIN] Scanned', potentialGroupSenders.size, 'senders, found', groupMap.size - initialGroupCount, 'new groups');

    // STEP 4: Chain Discovery (BFS) - Recursively scan ALL group members
    // This discovers membership updates from members who haven't sent messages yet
    logger.info('[GROUP BLOCKCHAIN] STEP 4: Starting BFS chain discovery for group members');
    
    const CHAIN_BATCH_SIZE = 8; // Smaller batch size to reduce RPC load
    const CHAIN_OPS_LIMIT = 2000; // 1K initial + 1K backfill per member
    const MAX_CHAIN_ITERATIONS = 10; // Prevent infinite loops
    
    // BFS queue: Start with all current group members
    const memberQueue: string[] = [];
    const visitedMembers = new Set<string>([username]); // Skip current user
    
    // Initialize queue with ALL members from initially discovered groups
    // CRITICAL: Don't skip already scanned senders - they might have newer updates
    for (const group of Array.from(groupMap.values())) {
      for (const member of group.members) {
        if (!visitedMembers.has(member)) {
          memberQueue.push(member);
          visitedMembers.add(member);
        }
      }
    }
    
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Initial queue size:', memberQueue.length, 'members');
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Scanning members from', groupMap.size, 'initially discovered groups');
    
    // Diagnostic: Log if queue is empty
    if (memberQueue.length === 0) {
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Queue is empty! No members to scan.');
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: groupMap size:', groupMap.size);
      for (const group of Array.from(groupMap.values())) {
        logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Group', group.name, 'has members:', group.members);
      }
    }
    
    let chainIteration = 0;
    let totalScanned = 0;
    
    // BFS loop: Process queue until empty or max iterations reached
    while (memberQueue.length > 0 && chainIteration < MAX_CHAIN_ITERATIONS) {
      chainIteration++;
      const currentBatch = memberQueue.splice(0, CHAIN_BATCH_SIZE); // Take up to CHAIN_BATCH_SIZE members
      
      logger.info('[GROUP BLOCKCHAIN] Chain iteration', chainIteration, '- processing', currentBatch.length, 'members, queue remaining:', memberQueue.length);
      
      const batchScans = currentBatch.map(async (member) => {
        try {
          logger.info('[GROUP BLOCKCHAIN] Chain scanning:', member);
          
          // Fetch initial chunk (1000 ops)
          let memberHistory = await optimizedHiveClient.getAccountHistory(
            member,
            BACKFILL_CHUNK_SIZE,
            'custom_json',
            -1
          );
          
          let allMemberOps = [...memberHistory];
          let oldestSeqNum = -1;
          
          if (memberHistory.length > 0) {
            oldestSeqNum = Math.min(...memberHistory.map(([idx]) => idx));
          }
          
          // Single backfill chunk if needed (to reach 2K ops)
          if (oldestSeqNum > 0 && allMemberOps.length < CHAIN_OPS_LIMIT) {
            const nextStart = oldestSeqNum - 1;
            
            if (nextStart >= 0) {
              const olderHistory = await optimizedHiveClient.getAccountHistory(
                member,
                BACKFILL_CHUNK_SIZE,
                'custom_json',
                nextStart
              );
              
              if (olderHistory.length > 0) {
                allMemberOps = [...allMemberOps, ...olderHistory];
              }
            }
          }
          
          logger.info('[GROUP BLOCKCHAIN] Chain member', member, '- scanned', allMemberOps.length, 'ops');
          totalScanned++;
          
          const foundGroups: Group[] = [];
          const newMembersFound = new Set<string>();
          
          // Process all operations
          for (const [, operation] of allMemberOps) {
            try {
              if (!operation || !operation[1] || !operation[1].op) {
                continue;
              }
              
              const op = operation[1].op;
              
              if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
                continue;
              }
              
              const jsonData: GroupCustomJson = JSON.parse(op[1].json);
              const { groupId, action } = jsonData;
              
              // Skip leave actions
              if (action === 'leave') {
                continue;
              }
              
              // Only include groups where current user is a member
              if (!jsonData.members?.includes(username)) {
                continue;
              }
              
              // Check if this is a newer version than what we have
              const existing = groupMap.get(groupId);
              const newVersion = jsonData.version || 1;
              const existingVersion = existing?.version || 0;
              
              if (newVersion > existingVersion) {
                // Create group entry
                const group: Group = {
                  groupId,
                  name: jsonData.name || 'Unnamed Group',
                  members: jsonData.members || [],
                  creator: jsonData.creator || member,
                  createdAt: normalizeHiveTimestamp(jsonData.timestamp),
                  version: newVersion,
                };
                
                foundGroups.push(group);
                
                // Track new members to add to queue
                for (const m of group.members) {
                  if (!visitedMembers.has(m) && m !== username) {
                    newMembersFound.add(m);
                  }
                }
                
                logger.info('[GROUP BLOCKCHAIN] Chain found:', group.name, 'v' + group.version, 'with', group.members.length, 'members from', member);
              }
            } catch (parseError) {
              continue;
            }
          }
          
          return { foundGroups, newMembersFound: Array.from(newMembersFound) };
        } catch (error) {
          logger.warn('[GROUP BLOCKCHAIN] Chain scan failed for', member, ':', error);
          return { foundGroups: [], newMembersFound: [] };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchScans);
      
      // Merge results and enqueue newly discovered members
      for (const { foundGroups, newMembersFound } of batchResults) {
        // Update groupMap with newer versions
        for (const group of foundGroups) {
          // Skip groups the user has left
          if (leftGroups.has(group.groupId)) {
            continue;
          }
          
          const existing = groupMap.get(group.groupId);
          if (!existing || existing.version < group.version) {
            groupMap.set(group.groupId, group);
            logger.info('[GROUP BLOCKCHAIN] Chain: Updated', group.name, 'to v' + group.version);
          }
        }
        
        // Add new members to queue (BFS expansion)
        for (const newMember of newMembersFound) {
          if (!visitedMembers.has(newMember)) {
            memberQueue.push(newMember);
            visitedMembers.add(newMember);
            logger.info('[GROUP BLOCKCHAIN] Chain: Enqueued new member:', newMember);
          }
        }
      }
    }
    
    if (chainIteration >= MAX_CHAIN_ITERATIONS) {
      logger.warn('[GROUP BLOCKCHAIN] Chain discovery: Reached max iterations limit');
    }
    
    logger.info('[GROUP BLOCKCHAIN] Chain discovery: Completed in', chainIteration, 'iterations, scanned', totalScanned, 'members, visited', visitedMembers.size, 'total');

    const discoveredGroups = Array.from(groupMap.values());
    logger.info('[GROUP BLOCKCHAIN] ✅ Discovered', discoveredGroups.length, 'groups');

    return discoveredGroups;
  } catch (error) {
    logger.error('[GROUP BLOCKCHAIN] ❌ Failed to discover groups:', error);
    return [];
  }
}

/**
 * Checks if a message memo contains a group prefix
 * New format: "group:{groupId}:{creator}:{encryptedContent}"
 * Legacy format: "group:{groupId}:{encryptedContent}" (backwards compatible)
 * Returns null if malformed (instead of throwing) to prevent crashes
 */
export function parseGroupMessageMemo(memo: string): { 
  isGroupMessage: boolean; 
  groupId?: string; 
  creator?: string;
  content?: string;
} | null {
  try {
    // CRITICAL FIX: Strip leading # if present (Keychain bug workaround)
    // Sometimes Keychain returns decrypted content with # prefix still attached
    let cleanMemo = memo;
    if (cleanMemo.startsWith('#')) {
      cleanMemo = cleanMemo.substring(1);
      logger.warn('[GROUP BLOCKCHAIN] Stripped # prefix from decrypted memo (Keychain bug)');
    }
    
    const groupPrefix = 'group:';
    
    if (!cleanMemo.startsWith(groupPrefix)) {
      return { isGroupMessage: false };
    }

    // Parse format: group:{groupId}:{creator}:{content} or group:{groupId}:{content}
    const parts = cleanMemo.split(':');
    
    if (parts.length < 3) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (too few parts):', memo.substring(0, 50));
      return null;
    }

    const groupId = parts[1];
    let creator: string | undefined;
    let content: string;
    
    // Check if this is new format (4+ parts) with creator or legacy format (3 parts)
    if (parts.length >= 4) {
      // New format: group:{groupId}:{creator}:{content}
      creator = parts[2];
      content = parts.slice(3).join(':'); // Rejoin in case content contains ":"
      logger.info('[GROUP BLOCKCHAIN] Parsed new format group message with creator:', creator);
    } else {
      // Legacy format: group:{groupId}:{content}
      creator = undefined;
      content = parts.slice(2).join(':');
      logger.info('[GROUP BLOCKCHAIN] Parsed legacy format group message (no creator)');
    }

    // Basic validation
    if (!groupId || !content) {
      logger.warn('[GROUP BLOCKCHAIN] Malformed group message memo (missing groupId or content)');
      return null;
    }

    return {
      isGroupMessage: true,
      groupId,
      creator,
      content,
    };
  } catch (error) {
    logger.warn('[GROUP BLOCKCHAIN] Failed to parse group message memo:', error);
    return null;
  }
}

/**
 * Formats a message for group sending
 * New format includes the group creator to enable metadata discovery
 * Returns the prefixed memo that will be encrypted
 */
export function formatGroupMessageMemo(groupId: string, creator: string, message: string): string {
  return `group:${groupId}:${creator}:${message}`;
}
