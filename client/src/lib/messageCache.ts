import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { normalizeHiveTimestamp } from './hive';
import type { PaymentSettings, MemberPayment, JoinRequest, GroupConversationCache } from '@shared/schema';
import { logger } from './logger';

interface MessageCache {
  id: string;
  conversationKey: string;
  from: string;
  to: string;
  content: string;
  encryptedContent: string;
  timestamp: string;
  txId: string;
  confirmed: boolean;
  isDecrypted?: boolean; // Flag to indicate manual decryption
  amount?: string; // HBD transfer amount (e.g., "0.001 HBD")
  hidden?: boolean; // Flag for messages filtered by minimum HBD threshold
}

interface ConversationCache {
  conversationKey: string;
  partnerUsername: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  lastChecked: string;
}

// TIER 2 OPTIMIZATION: Memo cache for never decrypting the same message twice
interface DecryptedMemoCache {
  txId: string;
  decryptedMemo: string;
  cachedAt: string;
}

// CUSTOM JSON: Image message storage (separate from memo-based messages)
interface CustomJsonMessage {
  txId: string;                    // Primary key (transaction ID)
  sessionId?: string;              // For multi-chunk messages
  conversationKey: string;
  from: string;
  to: string;
  imageData?: string;              // base64 image (after decryption)
  message?: string;                // optional text message
  filename?: string;
  contentType?: string;
  timestamp: string;
  encryptedPayload: string;        // Full encrypted data
  hash?: string;                   // SHA-256 integrity hash
  chunks?: number;                 // Total chunks (if multi-chunk)
  isDecrypted: boolean;
  confirmed: boolean;
}

// ============================================================================
// GROUP CHAT: IndexedDB Cache Interfaces
// ============================================================================
// Note: PaymentSettings, MemberPayment, JoinRequest, and GroupConversationCache
// are now imported from @shared/schema to ensure type consistency

interface GroupMessageCache {
  id: string;                      // Primary key (txId or tempId)
  groupId: string;                 // References GroupConversationCache.groupId
  sender: string;                  // Username who sent message
  creator?: string;                // Group creator (for metadata discovery)
  content: string;                 // Decrypted content
  encryptedContent: string;        // Original encrypted memo
  timestamp: string;               // ISO timestamp
  recipients: string[];            // Target usernames
  txIds: string[];                 // Array of blockchain txIds
  confirmed: boolean;              // All sends confirmed
  status: 'sending' | 'partial' | 'sent' | 'confirmed' | 'failed';
  failedRecipients?: string[];     // Failed recipient usernames
}

interface GroupManifestPointer {
  groupId: string;             // Primary key
  manifest_trx_id: string;     // Transaction ID containing the custom_json
  manifest_block: number;      // Block number
  manifest_op_idx: number;     // Operation index
  cachedAt: string;            // ISO timestamp when cached
  sender: string;              // Who sent the invite memo
}

interface HiveMessengerDB extends DBSchema {
  messages: {
    key: string;
    value: MessageCache;
    indexes: {
      'by-conversation': string;
      'by-timestamp': string;
      'by-txId': string;
    };
  };
  conversations: {
    key: string;
    value: ConversationCache;
    indexes: {
      'by-timestamp': string;
    };
  };
  metadata: {
    key: string;
    value: {
      key: string;
      value: string;
    };
  };
  // TIER 2: Decrypted memo cache - never decrypt the same txId twice
  decryptedMemos: {
    key: string;
    value: DecryptedMemoCache;
  };
  // CUSTOM JSON: Image messages table
  customJsonMessages: {
    key: string;
    value: CustomJsonMessage;
    indexes: {
      'by-conversation': string;
      'by-timestamp': string;
      'by-sessionId': string;
    };
  };
  // GROUP CHAT: Group conversations table
  groupConversations: {
    key: string;
    value: GroupConversationCache;
    indexes: {
      'by-timestamp': string;
    };
  };
  // GROUP CHAT: Group messages table
  groupMessages: {
    key: string;
    value: GroupMessageCache;
    indexes: {
      'by-group': string;
      'by-timestamp': string;
    };
  };
  // GROUP MANIFEST POINTERS: Manifest pointer cache table
  groupManifestPointers: {
    key: string;
    value: GroupManifestPointer;
  };
}

let dbInstance: IDBPDatabase<HiveMessengerDB> | null = null;
let currentDbUsername: string | null = null;

async function getDB(username?: string): Promise<IDBPDatabase<HiveMessengerDB>> {
  // If username is provided and different from current, close and reopen for new user
  if (username && currentDbUsername !== username) {
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }
    currentDbUsername = username;
  }

  if (dbInstance) {
    return dbInstance;
  }

  // Scope database to username to prevent data mixing between accounts
  // v6: Add group chat support (groupConversations, groupMessages)
  // v7: Add groupManifestPointers object store for memo-pointer protocol
  const dbName = username ? `hive-messenger-${username}-v7` : 'hive-messenger-v7';
  
  dbInstance = await openDB<HiveMessengerDB>(dbName, 2, {
    upgrade(db: IDBPDatabase<HiveMessengerDB>) {
      if (!db.objectStoreNames.contains('messages')) {
        const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
        messageStore.createIndex('by-conversation', 'conversationKey');
        messageStore.createIndex('by-timestamp', 'timestamp');
        messageStore.createIndex('by-txId', 'txId');
      }

      if (!db.objectStoreNames.contains('conversations')) {
        const conversationStore = db.createObjectStore('conversations', {
          keyPath: 'conversationKey',
        });
        conversationStore.createIndex('by-timestamp', 'lastTimestamp');
      }

      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }

      // TIER 2: Add decryptedMemos cache table
      if (!db.objectStoreNames.contains('decryptedMemos')) {
        db.createObjectStore('decryptedMemos', { keyPath: 'txId' });
      }

      // CUSTOM JSON: Add customJsonMessages table for image messaging
      if (!db.objectStoreNames.contains('customJsonMessages')) {
        const customJsonStore = db.createObjectStore('customJsonMessages', { keyPath: 'txId' });
        customJsonStore.createIndex('by-conversation', 'conversationKey');
        customJsonStore.createIndex('by-timestamp', 'timestamp');
        customJsonStore.createIndex('by-sessionId', 'sessionId');
      }

      // GROUP CHAT: Add group conversations table
      if (!db.objectStoreNames.contains('groupConversations')) {
        const groupConvStore = db.createObjectStore('groupConversations', { keyPath: 'groupId' });
        groupConvStore.createIndex('by-timestamp', 'lastTimestamp');
      }

      // GROUP CHAT: Add group messages table
      if (!db.objectStoreNames.contains('groupMessages')) {
        const groupMsgStore = db.createObjectStore('groupMessages', { keyPath: 'id' });
        groupMsgStore.createIndex('by-group', 'groupId');
        groupMsgStore.createIndex('by-timestamp', 'timestamp');
      }

      // GROUP MANIFEST POINTERS: Add manifest pointer cache table
      if (!db.objectStoreNames.contains('groupManifestPointers')) {
        db.createObjectStore('groupManifestPointers', { keyPath: 'groupId' });
      }
    },
  });

  return dbInstance;
}

function getConversationKey(user1: string, user2: string): string {
  return [user1, user2].sort().join('-');
}

export async function cacheMessage(message: MessageCache, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('messages', message);
}

export async function cacheMessages(messages: MessageCache[], username?: string): Promise<void> {
  const db = await getDB(username);
  const tx = db.transaction('messages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.put(msg)),
    tx.done,
  ]);
}

export async function getMessagesByConversation(
  currentUser: string,
  partnerUsername: string,
  limit?: number
): Promise<MessageCache[]> {
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  const messages = await db.getAllFromIndex(
    'messages',
    'by-conversation',
    conversationKey
  );

  const sorted = messages.sort((a: MessageCache, b: MessageCache) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (limit) {
    return sorted.slice(-limit);
  }

  return sorted;
}

export async function getMessageByTxId(txId: string, username?: string): Promise<MessageCache | undefined> {
  const db = await getDB(username);
  const messages = await db.getAllFromIndex('messages', 'by-txId', txId);
  return messages[0];
}

export async function updateConversation(conversation: ConversationCache, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('conversations', conversation);
}

export async function getConversations(username?: string): Promise<ConversationCache[]> {
  const db = await getDB(username);
  const conversations = await db.getAll('conversations');
  
  return conversations.sort((a: ConversationCache, b: ConversationCache) => 
    new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
}

export async function getConversation(
  currentUser: string,
  partnerUsername: string
): Promise<ConversationCache | undefined> {
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  return await db.get('conversations', conversationKey);
}

export async function setMetadata(key: string, value: string, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('metadata', { key, value });
}

export async function getMetadata(key: string, username?: string): Promise<string | undefined> {
  const db = await getDB(username);
  const result = await db.get('metadata', key);
  return result?.value;
}

export async function clearAllCache(username?: string): Promise<void> {
  const db = await getDB(username);
  await db.clear('messages');
  await db.clear('conversations');
  await db.clear('metadata');
}

/**
 * Migrates all cached timestamps to UTC-normalized format
 * Runs once per user, tracked by metadata flag
 * 
 * @param username - Current user
 * @returns Object with counts of migrated items
 */
export async function migrateTimestampsToUTC(username: string): Promise<{
  messages: number;
  conversations: number;
  customJsonMessages: number;
}> {
  const db = await getDB(username);
  
  // Check if migration already ran
  const migrationFlag = await db.get('metadata', 'utc-timestamp-migration-v1');
  if (migrationFlag) {
    logger.debug('[MIGRATION] UTC timestamp migration already completed');
    return { messages: 0, conversations: 0, customJsonMessages: 0 };
  }
  
  logger.debug('[MIGRATION] Starting UTC timestamp migration...');
  
  let messagesUpdated = 0;
  let conversationsUpdated = 0;
  let customJsonUpdated = 0;
  
  try {
    // Use single transaction for all stores
    const tx = db.transaction(['messages', 'conversations', 'customJsonMessages', 'metadata'], 'readwrite');
    
    // Migrate messages
    const messageStore = tx.objectStore('messages');
    const allMessages = await messageStore.getAll();
    for (const msg of allMessages) {
      const normalizedTimestamp = normalizeHiveTimestamp(msg.timestamp);
      if (normalizedTimestamp !== msg.timestamp) {
        msg.timestamp = normalizedTimestamp;
        await messageStore.put(msg);
        messagesUpdated++;
      }
    }
    
    // Migrate conversations
    const conversationStore = tx.objectStore('conversations');
    const allConversations = await conversationStore.getAll();
    for (const conv of allConversations) {
      const normalizedTimestamp = normalizeHiveTimestamp(conv.lastTimestamp);
      if (normalizedTimestamp !== conv.lastTimestamp) {
        conv.lastTimestamp = normalizedTimestamp;
        await conversationStore.put(conv);
        conversationsUpdated++;
      }
    }
    
    // Migrate custom JSON messages
    const customJsonStore = tx.objectStore('customJsonMessages');
    const allCustomJson = await customJsonStore.getAll();
    for (const msg of allCustomJson) {
      const normalizedTimestamp = normalizeHiveTimestamp(msg.timestamp);
      if (normalizedTimestamp !== msg.timestamp) {
        msg.timestamp = normalizedTimestamp;
        await customJsonStore.put(msg);
        customJsonUpdated++;
      }
    }
    
    // Mark migration as complete
    const metadataStore = tx.objectStore('metadata');
    await metadataStore.put({ 
      key: 'utc-timestamp-migration-v1', 
      value: new Date().toISOString() 
    });
    
    await tx.done;
    
    logger.debug('[MIGRATION] UTC timestamp migration complete:', {
      messages: messagesUpdated,
      conversations: conversationsUpdated,
      customJsonMessages: customJsonUpdated
    });
    
    return { messages: messagesUpdated, conversations: conversationsUpdated, customJsonMessages: customJsonUpdated };
  } catch (error) {
    logger.error('[MIGRATION] UTC timestamp migration failed:', error);
    throw error;
  }
}

export async function fixCorruptedMessages(currentUsername: string): Promise<number> {
  const db = await getDB(currentUsername);
  const allMessages = await db.getAll('messages');
  let fixed = 0;
  
  for (const msg of allMessages) {
    // ONLY fix if content exactly equals encryptedContent
    // This is the ONLY reliable test - if they're equal, it means
    // the encrypted memo was incorrectly stored in the content field
    const needsFixing = msg.content === msg.encryptedContent && msg.encryptedContent;
    
    if (needsFixing) {
      logger.debug('[CACHE FIX] Fixing corrupted message (content === encrypted):', msg.id.substring(0, 20));
      
      // Use universal encrypted placeholder (both sent and received can be decrypted)
      msg.content = '[🔒 Encrypted - Click to decrypt]';
      
      await db.put('messages', msg);
      fixed++;
    }
  }
  
  logger.debug(`[CACHE FIX] Fixed ${fixed} corrupted messages`);
  return fixed;
}

export async function addOptimisticMessage(
  from: string,
  to: string,
  content: string,
  encryptedContent: string,
  tempId: string
): Promise<void> {
  const conversationKey = getConversationKey(from, to);
  
  // CRITICAL: Use .toISOString() which always returns UTC format with 'Z' suffix
  // Example: "2024-11-13T12:34:56.789Z"
  // This ensures consistency with blockchain timestamps that are normalized via normalizeHiveTimestamp()
  const timestamp = new Date().toISOString();
  
  const message: MessageCache = {
    id: tempId,
    conversationKey,
    from,
    to,
    content,
    encryptedContent,
    timestamp, // Always UTC with 'Z' suffix
    txId: '',
    confirmed: false,
  };

  await cacheMessage(message, from);

  const conversation = await getConversation(from, to);
  await updateConversation({
    conversationKey,
    partnerUsername: to,
    lastMessage: content,
    lastTimestamp: timestamp, // Use same normalized timestamp
    unreadCount: conversation?.unreadCount || 0,
    lastChecked: new Date().toISOString(), // Also UTC with 'Z' suffix
  }, from);
}

export async function confirmMessage(tempId: string, txId: string, encryptedContent?: string, username?: string): Promise<void> {
  logger.debug('[confirmMessage] Starting confirmation:', { tempId, txId, hasEncrypted: !!encryptedContent, username });
  
  const db = await getDB(username);
  const message = await db.get('messages', tempId);
  
  if (!message) {
    logger.warn('[confirmMessage] Message not found in cache:', tempId);
    return;
  }
  
  logger.debug('[confirmMessage] Found message in cache:', {
    id: message.id,
    from: message.from,
    to: message.to,
    contentLength: message.content?.length || 0,
    encryptedContentLength: message.encryptedContent?.length || 0,
    confirmed: message.confirmed
  });
  
  try {
    // Update message with blockchain confirmation
    message.id = txId;
    message.txId = txId;
    message.confirmed = true;
    
    // Store encrypted content if provided (for sent messages to enable decryption)
    // IMPORTANT: Keep the original plaintext in the content field
    // This allows the user to see their sent message immediately
    if (encryptedContent) {
      message.encryptedContent = encryptedContent;
      logger.debug('[confirmMessage] Stored encrypted content, length:', encryptedContent.length);
    }
    
    logger.debug('[confirmMessage] Deleting temp message with id:', tempId);
    await db.delete('messages', tempId);
    
    logger.debug('[confirmMessage] Storing confirmed message with id:', txId);
    await db.put('messages', message);
    
    logger.debug('[confirmMessage] ✅ Successfully confirmed message:', {
      tempId,
      txId,
      contentPreview: message.content?.substring(0, 30),
      hasEncryptedContent: !!message.encryptedContent
    });
  } catch (error: any) {
    logger.error('[confirmMessage] ❌ Error confirming message:', {
      error: error?.message || error,
      stack: error?.stack,
      tempId,
      txId
    });
    
    // Try to restore the temp message if something went wrong
    try {
      const existingTemp = await db.get('messages', tempId);
      if (!existingTemp) {
        // Temp was deleted but confirmed wasn't stored, restore it
        message.id = tempId;
        message.txId = '';
        message.confirmed = false;
        await db.put('messages', message);
        logger.debug('[confirmMessage] Restored temp message after error');
      }
    } catch (restoreError) {
      logger.error('[confirmMessage] Failed to restore temp message:', restoreError);
    }
    
    throw error;
  }
}

export async function updateMessageContent(messageId: string, decryptedContent: string, username?: string): Promise<void> {
  const db = await getDB(username);
  const message = await db.get('messages', messageId);
  
  if (message) {
    message.content = decryptedContent;
    message.isDecrypted = true; // Mark as manually decrypted - don't touch it!
    await db.put('messages', message);
  }
}

export async function deleteConversation(
  currentUser: string,
  partnerUsername: string
): Promise<void> {
  logger.debug('[deleteConversation] Deleting conversation:', { currentUser, partnerUsername });
  
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  // Delete all messages for this conversation
  const messages = await getMessagesByConversation(currentUser, partnerUsername);
  logger.debug('[deleteConversation] Deleting', messages.length, 'messages');
  
  const tx = db.transaction('messages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.id)),
    tx.done,
  ]);
  
  // Delete conversation metadata
  await db.delete('conversations', conversationKey);
  
  logger.debug('[deleteConversation] ✅ Conversation deleted from local storage');
}

// ============================================================================
// TIER 2: Decrypted Memo Caching - Never decrypt the same message twice
// ============================================================================

export async function getCachedDecryptedMemo(txId: string, username?: string): Promise<string | null> {
  const db = await getDB(username);
  const cached = await db.get('decryptedMemos', txId);
  
  if (cached) {
    logger.debug('[MEMO CACHE] HIT for txId:', txId.substring(0, 20), '- skipping decryption');
    return cached.decryptedMemo;
  }
  
  logger.debug('[MEMO CACHE] MISS for txId:', txId.substring(0, 20), '- will decrypt');
  return null;
}

export async function cacheDecryptedMemo(txId: string, decryptedMemo: string, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('decryptedMemos', {
    txId,
    decryptedMemo,
    cachedAt: new Date().toISOString(),
  });
  logger.debug('[MEMO CACHE] Cached decrypted memo for txId:', txId.substring(0, 20));
}

// ============================================================================
// TIER 2: Incremental Pagination - Track last synced operation ID
// ============================================================================

export async function getLastSyncedOpId(conversationKey: string, username?: string): Promise<number | null> {
  const metadataKey = `lastSyncedOpId:${conversationKey}`;
  const value = await getMetadata(metadataKey, username);
  
  if (value) {
    const opId = parseInt(value, 10);
    logger.debug('[INCREMENTAL] Last synced opId for', conversationKey, ':', opId);
    return opId;
  }
  
  logger.debug('[INCREMENTAL] No last synced opId for', conversationKey, '- first sync');
  return null;
}

export async function setLastSyncedOpId(conversationKey: string, opId: number, username?: string): Promise<void> {
  const metadataKey = `lastSyncedOpId:${conversationKey}`;
  await setMetadata(metadataKey, opId.toString(), username);
  logger.debug('[INCREMENTAL] Updated last synced opId for', conversationKey, ':', opId);
}

// ============================================================================
// CUSTOM JSON: Image Message Caching Functions
// ============================================================================

export async function cacheCustomJsonMessage(message: CustomJsonMessage, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('customJsonMessages', message);
  logger.debug('[CUSTOM JSON] Cached message:', message.txId.substring(0, 20));
}

export async function cacheCustomJsonMessages(messages: CustomJsonMessage[], username?: string): Promise<void> {
  const db = await getDB(username);
  const tx = db.transaction('customJsonMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.put(msg)),
    tx.done,
  ]);
  logger.debug('[CUSTOM JSON] Batch cached', messages.length, 'image messages');
}

export async function getCustomJsonMessagesByConversation(
  currentUser: string,
  partnerUsername: string
): Promise<CustomJsonMessage[]> {
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  const messages = await db.getAllFromIndex(
    'customJsonMessages',
    'by-conversation',
    conversationKey
  );

  return messages.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function getCustomJsonMessageByTxId(
  txId: string,
  username?: string
): Promise<CustomJsonMessage | undefined> {
  const db = await getDB(username);
  return await db.get('customJsonMessages', txId);
}

export async function updateCustomJsonMessage(
  txId: string,
  updates: Partial<CustomJsonMessage>,
  username?: string
): Promise<void> {
  const db = await getDB(username);
  const message = await db.get('customJsonMessages', txId);
  
  if (message) {
    Object.assign(message, updates);
    await db.put('customJsonMessages', message);
    logger.debug('[CUSTOM JSON] Updated message:', txId.substring(0, 20));
  }
}

export async function deleteCustomJsonConversation(
  currentUser: string,
  partnerUsername: string
): Promise<void> {
  logger.debug('[CUSTOM JSON] Deleting image conversation:', { currentUser, partnerUsername });
  
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  // Delete all custom JSON messages for this conversation
  const messages = await getCustomJsonMessagesByConversation(currentUser, partnerUsername);
  logger.debug('[CUSTOM JSON] Deleting', messages.length, 'image messages');
  
  const tx = db.transaction('customJsonMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.txId)),
    tx.done,
  ]);
  
  logger.debug('[CUSTOM JSON] ✅ Image conversation deleted from local storage');
}

// ============================================================================
// GROUP CHAT: Cache Management Functions
// ============================================================================

export async function cacheGroupConversation(group: GroupConversationCache, username?: string): Promise<void> {
  const db = await getDB(username);
  
  // Cache versioning: Read existing version and increment
  const existing = await db.get('groupConversations', group.groupId);
  if (existing) {
    group.version = (existing.version || 1) + 1;
    logger.debug('[GROUP CACHE] Incrementing group conversation version:', group.groupId, 'to', group.version);
  } else {
    // First time caching this group, set version to 1
    if (!group.version) {
      group.version = 1;
    }
  }
  
  await db.put('groupConversations', group);
  logger.debug('[GROUP CACHE] Cached group conversation:', group.groupId, 'version:', group.version);
}

export async function getGroupConversations(username?: string): Promise<GroupConversationCache[]> {
  const db = await getDB(username);
  const groups = await db.getAll('groupConversations');
  
  return groups.sort((a, b) => 
    new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
}

export async function getGroupConversation(groupId: string, username?: string): Promise<GroupConversationCache | undefined> {
  const db = await getDB(username);
  return await db.get('groupConversations', groupId);
}

export async function cacheGroupMessage(message: GroupMessageCache, username?: string): Promise<void> {
  const db = await getDB(username);
  logger.debug('[GROUP CACHE] Attempting to cache group message:', {
    id: message.id,
    idType: typeof message.id,
    idLength: message.id?.length,
    groupId: message.groupId,
    sender: message.sender,
    recipientsCount: message.recipients?.length,
    messageKeys: Object.keys(message)
  });
  
  try {
    await db.put('groupMessages', message);
    logger.debug('[GROUP CACHE] ✅ Cached group message:', message.id);
  } catch (error) {
    logger.error('[GROUP CACHE] ❌ Failed to cache group message:', error);
    logger.error('[GROUP CACHE] Message object:', JSON.stringify(message, null, 2));
    throw error;
  }
}

export async function cacheGroupMessages(messages: GroupMessageCache[], username?: string): Promise<void> {
  const db = await getDB(username);
  const tx = db.transaction('groupMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.put(msg)),
    tx.done,
  ]);
  logger.debug('[GROUP CACHE] Batch cached', messages.length, 'group messages');
}

export async function getGroupMessages(groupId: string, username?: string): Promise<GroupMessageCache[]> {
  const db = await getDB(username);
  const messages = await db.getAllFromIndex('groupMessages', 'by-group', groupId);
  
  return messages.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function getAllGroupMessages(username?: string): Promise<GroupMessageCache[]> {
  const db = await getDB(username);
  const messages = await db.getAll('groupMessages');
  
  return messages.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function addOptimisticGroupMessage(
  groupId: string,
  sender: string,
  recipients: string[],
  content: string,
  encryptedContent: string,
  tempId: string,
  username?: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  
  const message: GroupMessageCache = {
    id: tempId,
    groupId,
    sender,
    content,
    encryptedContent,
    timestamp,
    recipients,
    txIds: [],
    confirmed: false,
    status: 'sending',
  };

  await cacheGroupMessage(message, username);

  // Update group conversation's last message
  const group = await getGroupConversation(groupId, username);
  if (group) {
    group.lastMessage = content;
    group.lastTimestamp = timestamp;
    await cacheGroupConversation(group, username);
  }
}

export async function confirmGroupMessage(
  tempId: string,
  txIds: string[],
  failedRecipients: string[],
  username?: string
): Promise<void> {
  logger.debug('[GROUP CACHE] Confirming group message:', { tempId, txIds, failedRecipients });
  
  const db = await getDB(username);
  const message = await db.get('groupMessages', tempId);
  
  if (!message) {
    logger.warn('[GROUP CACHE] Group message not found:', tempId);
    return;
  }

  // Determine final transaction ID (use first successful tx)
  const finalTxId = txIds[0] || tempId;

  // Update message with confirmation
  message.id = finalTxId;
  message.txIds = txIds;
  message.confirmed = failedRecipients.length === 0;
  message.failedRecipients = failedRecipients.length > 0 ? failedRecipients : undefined;
  message.status = failedRecipients.length > 0 
    ? (txIds.length > 0 ? 'partial' : 'failed')
    : 'confirmed';
  
  // Add deliveryStatus for partial failures
  if (failedRecipients.length > 0 && txIds.length > 0) {
    (message as any).deliveryStatus = 'partial';
  } else if (failedRecipients.length === 0) {
    (message as any).deliveryStatus = 'full';
  }

  // Delete temp message
  await db.delete('groupMessages', tempId);
  
  // Store confirmed message
  await db.put('groupMessages', message);
  
  logger.debug('[GROUP CACHE] ✅ Group message confirmed:', finalTxId);
}

/**
 * Removes an optimistic group message from cache (used for rollback on complete failure)
 */
export async function removeOptimisticGroupMessage(tempId: string, username?: string): Promise<void> {
  logger.debug('[GROUP CACHE] Removing optimistic group message:', tempId);
  
  const db = await getDB(username);
  
  try {
    // Remove the message from cache
    await db.delete('groupMessages', tempId);
    logger.debug('[GROUP CACHE] ✅ Optimistic message removed:', tempId);
  } catch (error) {
    logger.error('[GROUP CACHE] ❌ Failed to remove optimistic message:', error);
    throw error;
  }
}

export async function deleteGroupConversation(groupId: string, username?: string): Promise<void> {
  logger.debug('[GROUP CACHE] Deleting group conversation:', groupId);
  
  const db = await getDB(username);
  
  // Delete all messages for this group
  const messages = await getGroupMessages(groupId, username);
  logger.debug('[GROUP CACHE] Deleting', messages.length, 'group messages');
  
  const tx = db.transaction('groupMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.id)),
    tx.done,
  ]);
  
  // Delete group conversation
  await db.delete('groupConversations', groupId);
  
  logger.debug('[GROUP CACHE] ✅ Group conversation deleted');
}

/**
 * EDGE CASE FIX #2: Cleanup orphaned messages with proper reconciliation
 * If user closes browser during batch send, optimistic entries remain stuck
 * Proper reconciliation logic:
 * - Messages with txIds → Broadcasts reached blockchain, mark as 'confirmed'
 * - Messages without txIds → Truly orphaned, mark as 'failed'
 */
export async function cleanupOrphanedMessages(username: string): Promise<number> {
  logger.debug('[CLEANUP] Starting orphaned message cleanup for:', username);
  
  const db = await getDB(username);
  const tx = db.transaction(['groupMessages'], 'readwrite');
  const store = tx.objectStore('groupMessages');
  
  // Find messages older than 5 minutes with status 'sending'
  const allMessages = await store.getAll();
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  
  let cleanedCount = 0;
  
  for (const msg of allMessages) {
    const messageAge = new Date(msg.timestamp).getTime();
    const isOrphaned = msg.status === 'sending' && messageAge < fiveMinutesAgo;
    
    if (isOrphaned) {
      if (msg.txIds && msg.txIds.length > 0) {
        // Calculate successful recipients
        const totalRecipients = msg.recipients.length;
        const failedCount = msg.failedRecipients?.length || 0;
        
        // Guard against inconsistent data where failed > total
        if (failedCount >= totalRecipients) {
          // All recipients failed (or data is inconsistent)
          msg.status = 'failed';
          (msg as any).deliveryStatus = 'failed';
          msg.confirmed = false;
          
          logger.debug('[CLEANUP] All recipients failed - marked as failed:', msg.id.substring(0, 20), 'failed:', failedCount, 'total:', totalRecipients);
        } else {
          const successfulCount = totalRecipients - failedCount;
          
          if (successfulCount === 0) {
            msg.status = 'failed';
            (msg as any).deliveryStatus = 'failed';
            msg.confirmed = false;
            
            logger.debug('[CLEANUP] All recipients failed - marked as failed:', msg.id.substring(0, 20), 'failed:', failedCount, 'total:', totalRecipients);
          } else if (successfulCount < totalRecipients) {
            msg.status = 'confirmed';
            (msg as any).deliveryStatus = 'partial';
            msg.confirmed = true;
            
            logger.debug('[CLEANUP] Partial delivery - marked as confirmed/partial:', msg.id.substring(0, 20), 'succeeded:', successfulCount, 'failed:', failedCount, 'total:', totalRecipients);
          } else {
            msg.status = 'confirmed';
            (msg as any).deliveryStatus = 'success';
            msg.confirmed = true;
            
            logger.debug('[CLEANUP] All recipients succeeded - marked as confirmed/success:', msg.id.substring(0, 20), 'total:', totalRecipients);
          }
        }
      } else {
        // No txIds - truly orphaned/failed
        msg.status = 'failed';
        (msg as any).deliveryStatus = 'failed';
        msg.confirmed = false;
        
        logger.debug('[CLEANUP] No txIds - marked orphaned message as failed:', msg.id.substring(0, 20));
      }
      
      await store.put(msg);
      cleanedCount++;
    }
  }
  
  await tx.done;
  
  logger.debug(`[CLEANUP] ✅ Cleaned up ${cleanedCount} orphaned messages`);
  return cleanedCount;
}

/**
 * MIGRATION: Find and move misplaced group messages from messages table to groupMessages table
 * This fixes the bug where group messages were initially cached as direct messages
 */
export async function migrateGroupMessages(username: string): Promise<number> {
  logger.debug('[MIGRATION] Starting group message migration for:', username);
  
  const db = await getDB(username);
  const { parseGroupMessageMemo } = await import('./groupBlockchain');
  const { lookupGroupMetadata } = await import('./groupBlockchain');
  
  // Get all messages from the messages table
  const allMessages = await db.getAll('messages');
  logger.debug('[MIGRATION] Scanning', allMessages.length, 'messages for misplaced group messages');
  
  let migratedCount = 0;
  const groupMessagesToAdd: GroupMessageCache[] = [];
  const messageIdsToDelete: string[] = [];
  const groupsToUpdate = new Map<string, { name: string; members: string[]; creator: string; lastMessage: string; lastTimestamp: string }>();
  
  for (const msg of allMessages) {
    // Check if content or encryptedContent starts with group: or #group:
    let isGroupMessage = false;
    let parsed: any = null;
    
    // Normalize and check content field (might have decrypted group message)
    if (msg.content) {
      const normalizedContent = msg.content.trim();
      if (normalizedContent.startsWith('group:') || normalizedContent.startsWith('#group:')) {
        logger.debug('[MIGRATION] Found potential group message in content:', msg.id.substring(0, 20), 'content preview:', normalizedContent.substring(0, 50));
        parsed = parseGroupMessageMemo(normalizedContent);
        isGroupMessage = parsed?.isGroupMessage ?? false;
      }
    }
    
    // Check encrypted content field if not found yet
    if (!isGroupMessage && msg.encryptedContent) {
      const normalizedEncrypted = msg.encryptedContent.trim();
      if (normalizedEncrypted.startsWith('group:') || normalizedEncrypted.startsWith('#group:')) {
        logger.debug('[MIGRATION] Found potential group message in encryptedContent:', msg.id.substring(0, 20), 'encrypted preview:', normalizedEncrypted.substring(0, 50));
        parsed = parseGroupMessageMemo(normalizedEncrypted);
        isGroupMessage = parsed?.isGroupMessage ?? false;
      }
    }
    
    if (isGroupMessage && parsed && parsed.groupId) {
      logger.debug('[MIGRATION] Migrating group message:', {
        txId: msg.id.substring(0, 20),
        groupId: parsed.groupId,
        creator: parsed.creator,
        from: msg.from
      });
      
      // Create group message entry
      const groupMessage: GroupMessageCache = {
        id: msg.txId,
        groupId: parsed.groupId,
        sender: msg.from,
        creator: parsed.creator,
        content: parsed.content || '',
        encryptedContent: msg.encryptedContent,
        timestamp: msg.timestamp,
        recipients: [msg.to],
        txIds: [msg.txId],
        confirmed: msg.confirmed ?? true,
        status: 'confirmed',
      };
      
      groupMessagesToAdd.push(groupMessage);
      messageIdsToDelete.push(msg.id);
      
      // Try to lookup group metadata
      try {
        const groupMetadata = await lookupGroupMetadata(parsed.groupId, msg.from);
        if (groupMetadata) {
          groupsToUpdate.set(parsed.groupId, {
            name: groupMetadata.name,
            members: groupMetadata.members,
            creator: groupMetadata.creator,
            lastMessage: parsed.content || '',
            lastTimestamp: msg.timestamp
          });
        }
      } catch (error) {
        logger.warn('[MIGRATION] Failed to lookup group metadata for:', parsed.groupId);
      }
      
      migratedCount++;
    }
  }
  
  // Write all changes in a transaction
  if (groupMessagesToAdd.length > 0) {
    logger.debug('[MIGRATION] Writing', groupMessagesToAdd.length, 'group messages to groupMessages table');
    
    // Add group messages
    await cacheGroupMessages(groupMessagesToAdd, username);
    
    // Delete old messages from messages table
    const tx = db.transaction('messages', 'readwrite');
    for (const msgId of messageIdsToDelete) {
      await tx.store.delete(msgId);
    }
    await tx.done;
    
    // Update group conversation caches
    const groupEntries = Array.from(groupsToUpdate.entries());
    for (const [groupId, groupData] of groupEntries) {
      const existingGroup = await db.get('groupConversations', groupId);
      const groupConv: GroupConversationCache = {
        groupId,
        name: groupData.name,
        members: groupData.members,
        creator: groupData.creator,
        createdAt: existingGroup?.createdAt || new Date().toISOString(),
        version: existingGroup?.version || 1,
        lastMessage: groupData.lastMessage,
        lastTimestamp: groupData.lastTimestamp,
        unreadCount: existingGroup?.unreadCount || 0,
        lastChecked: existingGroup?.lastChecked || new Date().toISOString(),
      };
      await db.put('groupConversations', groupConv);
    }
    
    logger.debug('[MIGRATION] ✅ Migrated', migratedCount, 'group messages');
  } else {
    logger.debug('[MIGRATION] No misplaced group messages found');
  }
  
  return migratedCount;
}

// ============================================================================
// GROUP MANIFEST POINTERS: CRUD Functions
// ============================================================================

export async function cacheGroupManifestPointer(pointer: GroupManifestPointer, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('groupManifestPointers', pointer);
}

export async function getGroupManifestPointer(groupId: string, username?: string): Promise<GroupManifestPointer | undefined> {
  const db = await getDB(username);
  return await db.get('groupManifestPointers', groupId);
}

// ============================================================================
// PENDING GROUPS: localStorage-based pending group tracking
// ============================================================================

export interface PendingGroup {
  groupId: string;
  groupName: string;
  creator: string;
  paymentAmount?: string;
  requestedAt: string;
}

const PENDING_GROUPS_KEY = (username: string) => `pending_groups_${username}`;

export function savePendingGroup(group: PendingGroup, username: string): void {
  try {
    const existing = getPendingGroups(username);
    const filtered = existing.filter(g => g.groupId !== group.groupId);
    filtered.push(group);
    localStorage.setItem(PENDING_GROUPS_KEY(username), JSON.stringify(filtered));
    // Dispatch custom event for same-tab reactivity
    window.dispatchEvent(new CustomEvent('pendingGroupsChanged'));
    logger.debug('[PENDING GROUPS] Saved pending group:', group.groupId);
  } catch (error) {
    logger.error('[PENDING GROUPS] Failed to save pending group:', error);
  }
}

export function getPendingGroups(username: string): PendingGroup[] {
  try {
    const stored = localStorage.getItem(PENDING_GROUPS_KEY(username));
    if (!stored) return [];
    return JSON.parse(stored) as PendingGroup[];
  } catch (error) {
    logger.error('[PENDING GROUPS] Failed to get pending groups:', error);
    return [];
  }
}

export function removePendingGroup(groupId: string, username: string): void {
  try {
    const existing = getPendingGroups(username);
    const filtered = existing.filter(g => g.groupId !== groupId);
    localStorage.setItem(PENDING_GROUPS_KEY(username), JSON.stringify(filtered));
    // Dispatch custom event for same-tab reactivity
    window.dispatchEvent(new CustomEvent('pendingGroupsChanged'));
    logger.debug('[PENDING GROUPS] Removed pending group:', groupId);
  } catch (error) {
    logger.error('[PENDING GROUPS] Failed to remove pending group:', error);
  }
}

export type { 
  MessageCache, 
  ConversationCache, 
  DecryptedMemoCache, 
  CustomJsonMessage,
  GroupConversationCache,
  GroupMessageCache,
  GroupManifestPointer
};
export { getConversationKey };
