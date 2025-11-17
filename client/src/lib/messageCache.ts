import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { normalizeHiveTimestamp } from './hive';

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

interface GroupConversationCache {
  groupId: string;                 // Primary key (UUID v4)
  name: string;                    // Group name
  members: string[];               // Array of usernames
  creator: string;                 // Creator username
  createdAt: string;               // ISO timestamp
  version: number;                 // Membership version
  lastMessage: string;             // Last message preview
  lastTimestamp: string;           // Last message timestamp
  unreadCount: number;             // Unread message count
  lastChecked: string;             // Last time user viewed group
}

interface GroupMessageCache {
  id: string;                      // Primary key (txId or tempId)
  groupId: string;                 // References GroupConversationCache.groupId
  sender: string;                  // Username who sent message
  content: string;                 // Decrypted content
  encryptedContent: string;        // Original encrypted memo
  timestamp: string;               // ISO timestamp
  recipients: string[];            // Target usernames
  txIds: string[];                 // Array of blockchain txIds
  confirmed: boolean;              // All sends confirmed
  status: 'sending' | 'partial' | 'sent' | 'confirmed' | 'failed';
  failedRecipients?: string[];     // Failed recipient usernames
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
  const dbName = username ? `hive-messenger-${username}-v6` : 'hive-messenger-v6';
  
  dbInstance = await openDB<HiveMessengerDB>(dbName, 1, {
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
    console.log('[MIGRATION] UTC timestamp migration already completed');
    return { messages: 0, conversations: 0, customJsonMessages: 0 };
  }
  
  console.log('[MIGRATION] Starting UTC timestamp migration...');
  
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
    
    console.log('[MIGRATION] UTC timestamp migration complete:', {
      messages: messagesUpdated,
      conversations: conversationsUpdated,
      customJsonMessages: customJsonUpdated
    });
    
    return { messages: messagesUpdated, conversations: conversationsUpdated, customJsonMessages: customJsonUpdated };
  } catch (error) {
    console.error('[MIGRATION] UTC timestamp migration failed:', error);
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
      console.log('[CACHE FIX] Fixing corrupted message (content === encrypted):', msg.id.substring(0, 20));
      
      // Use universal encrypted placeholder (both sent and received can be decrypted)
      msg.content = '[🔒 Encrypted - Click to decrypt]';
      
      await db.put('messages', msg);
      fixed++;
    }
  }
  
  console.log(`[CACHE FIX] Fixed ${fixed} corrupted messages`);
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
  console.log('[confirmMessage] Starting confirmation:', { tempId, txId, hasEncrypted: !!encryptedContent, username });
  
  const db = await getDB(username);
  const message = await db.get('messages', tempId);
  
  if (!message) {
    console.warn('[confirmMessage] Message not found in cache:', tempId);
    return;
  }
  
  console.log('[confirmMessage] Found message in cache:', {
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
      console.log('[confirmMessage] Stored encrypted content, length:', encryptedContent.length);
    }
    
    console.log('[confirmMessage] Deleting temp message with id:', tempId);
    await db.delete('messages', tempId);
    
    console.log('[confirmMessage] Storing confirmed message with id:', txId);
    await db.put('messages', message);
    
    console.log('[confirmMessage] ✅ Successfully confirmed message:', {
      tempId,
      txId,
      contentPreview: message.content?.substring(0, 30),
      hasEncryptedContent: !!message.encryptedContent
    });
  } catch (error: any) {
    console.error('[confirmMessage] ❌ Error confirming message:', {
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
        console.log('[confirmMessage] Restored temp message after error');
      }
    } catch (restoreError) {
      console.error('[confirmMessage] Failed to restore temp message:', restoreError);
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
  console.log('[deleteConversation] Deleting conversation:', { currentUser, partnerUsername });
  
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  // Delete all messages for this conversation
  const messages = await getMessagesByConversation(currentUser, partnerUsername);
  console.log('[deleteConversation] Deleting', messages.length, 'messages');
  
  const tx = db.transaction('messages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.id)),
    tx.done,
  ]);
  
  // Delete conversation metadata
  await db.delete('conversations', conversationKey);
  
  console.log('[deleteConversation] ✅ Conversation deleted from local storage');
}

// ============================================================================
// TIER 2: Decrypted Memo Caching - Never decrypt the same message twice
// ============================================================================

export async function getCachedDecryptedMemo(txId: string, username?: string): Promise<string | null> {
  const db = await getDB(username);
  const cached = await db.get('decryptedMemos', txId);
  
  if (cached) {
    console.log('[MEMO CACHE] HIT for txId:', txId.substring(0, 20), '- skipping decryption');
    return cached.decryptedMemo;
  }
  
  console.log('[MEMO CACHE] MISS for txId:', txId.substring(0, 20), '- will decrypt');
  return null;
}

export async function cacheDecryptedMemo(txId: string, decryptedMemo: string, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('decryptedMemos', {
    txId,
    decryptedMemo,
    cachedAt: new Date().toISOString(),
  });
  console.log('[MEMO CACHE] Cached decrypted memo for txId:', txId.substring(0, 20));
}

// ============================================================================
// TIER 2: Incremental Pagination - Track last synced operation ID
// ============================================================================

export async function getLastSyncedOpId(conversationKey: string, username?: string): Promise<number | null> {
  const metadataKey = `lastSyncedOpId:${conversationKey}`;
  const value = await getMetadata(metadataKey, username);
  
  if (value) {
    const opId = parseInt(value, 10);
    console.log('[INCREMENTAL] Last synced opId for', conversationKey, ':', opId);
    return opId;
  }
  
  console.log('[INCREMENTAL] No last synced opId for', conversationKey, '- first sync');
  return null;
}

export async function setLastSyncedOpId(conversationKey: string, opId: number, username?: string): Promise<void> {
  const metadataKey = `lastSyncedOpId:${conversationKey}`;
  await setMetadata(metadataKey, opId.toString(), username);
  console.log('[INCREMENTAL] Updated last synced opId for', conversationKey, ':', opId);
}

// ============================================================================
// CUSTOM JSON: Image Message Caching Functions
// ============================================================================

export async function cacheCustomJsonMessage(message: CustomJsonMessage, username?: string): Promise<void> {
  const db = await getDB(username);
  await db.put('customJsonMessages', message);
  console.log('[CUSTOM JSON] Cached message:', message.txId.substring(0, 20));
}

export async function cacheCustomJsonMessages(messages: CustomJsonMessage[], username?: string): Promise<void> {
  const db = await getDB(username);
  const tx = db.transaction('customJsonMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.put(msg)),
    tx.done,
  ]);
  console.log('[CUSTOM JSON] Batch cached', messages.length, 'image messages');
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
    console.log('[CUSTOM JSON] Updated message:', txId.substring(0, 20));
  }
}

export async function deleteCustomJsonConversation(
  currentUser: string,
  partnerUsername: string
): Promise<void> {
  console.log('[CUSTOM JSON] Deleting image conversation:', { currentUser, partnerUsername });
  
  const db = await getDB(currentUser);
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  
  // Delete all custom JSON messages for this conversation
  const messages = await getCustomJsonMessagesByConversation(currentUser, partnerUsername);
  console.log('[CUSTOM JSON] Deleting', messages.length, 'image messages');
  
  const tx = db.transaction('customJsonMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.txId)),
    tx.done,
  ]);
  
  console.log('[CUSTOM JSON] ✅ Image conversation deleted from local storage');
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
    console.log('[GROUP CACHE] Incrementing group conversation version:', group.groupId, 'to', group.version);
  } else {
    // First time caching this group, set version to 1
    if (!group.version) {
      group.version = 1;
    }
  }
  
  await db.put('groupConversations', group);
  console.log('[GROUP CACHE] Cached group conversation:', group.groupId, 'version:', group.version);
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
  console.log('[GROUP CACHE] Attempting to cache group message:', {
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
    console.log('[GROUP CACHE] ✅ Cached group message:', message.id);
  } catch (error) {
    console.error('[GROUP CACHE] ❌ Failed to cache group message:', error);
    console.error('[GROUP CACHE] Message object:', JSON.stringify(message, null, 2));
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
  console.log('[GROUP CACHE] Batch cached', messages.length, 'group messages');
}

export async function getGroupMessages(groupId: string, username?: string): Promise<GroupMessageCache[]> {
  const db = await getDB(username);
  const messages = await db.getAllFromIndex('groupMessages', 'by-group', groupId);
  
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
  console.log('[GROUP CACHE] Confirming group message:', { tempId, txIds, failedRecipients });
  
  const db = await getDB(username);
  const message = await db.get('groupMessages', tempId);
  
  if (!message) {
    console.warn('[GROUP CACHE] Group message not found:', tempId);
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
  
  console.log('[GROUP CACHE] ✅ Group message confirmed:', finalTxId);
}

/**
 * Removes an optimistic group message from cache (used for rollback on complete failure)
 */
export async function removeOptimisticGroupMessage(tempId: string, username?: string): Promise<void> {
  console.log('[GROUP CACHE] Removing optimistic group message:', tempId);
  
  const db = await getDB(username);
  
  try {
    // Remove the message from cache
    await db.delete('groupMessages', tempId);
    console.log('[GROUP CACHE] ✅ Optimistic message removed:', tempId);
  } catch (error) {
    console.error('[GROUP CACHE] ❌ Failed to remove optimistic message:', error);
    throw error;
  }
}

export async function deleteGroupConversation(groupId: string, username?: string): Promise<void> {
  console.log('[GROUP CACHE] Deleting group conversation:', groupId);
  
  const db = await getDB(username);
  
  // Delete all messages for this group
  const messages = await getGroupMessages(groupId, username);
  console.log('[GROUP CACHE] Deleting', messages.length, 'group messages');
  
  const tx = db.transaction('groupMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.id)),
    tx.done,
  ]);
  
  // Delete group conversation
  await db.delete('groupConversations', groupId);
  
  console.log('[GROUP CACHE] ✅ Group conversation deleted');
}

/**
 * EDGE CASE FIX #2: Cleanup orphaned messages with proper reconciliation
 * If user closes browser during batch send, optimistic entries remain stuck
 * Proper reconciliation logic:
 * - Messages with txIds → Broadcasts reached blockchain, mark as 'confirmed'
 * - Messages without txIds → Truly orphaned, mark as 'failed'
 */
export async function cleanupOrphanedMessages(username: string): Promise<number> {
  console.log('[CLEANUP] Starting orphaned message cleanup for:', username);
  
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
          
          console.log('[CLEANUP] All recipients failed - marked as failed:', msg.id.substring(0, 20), 'failed:', failedCount, 'total:', totalRecipients);
        } else {
          const successfulCount = totalRecipients - failedCount;
          
          if (successfulCount === 0) {
            msg.status = 'failed';
            (msg as any).deliveryStatus = 'failed';
            msg.confirmed = false;
            
            console.log('[CLEANUP] All recipients failed - marked as failed:', msg.id.substring(0, 20), 'failed:', failedCount, 'total:', totalRecipients);
          } else if (successfulCount < totalRecipients) {
            msg.status = 'confirmed';
            (msg as any).deliveryStatus = 'partial';
            msg.confirmed = true;
            
            console.log('[CLEANUP] Partial delivery - marked as confirmed/partial:', msg.id.substring(0, 20), 'succeeded:', successfulCount, 'failed:', failedCount, 'total:', totalRecipients);
          } else {
            msg.status = 'confirmed';
            (msg as any).deliveryStatus = 'success';
            msg.confirmed = true;
            
            console.log('[CLEANUP] All recipients succeeded - marked as confirmed/success:', msg.id.substring(0, 20), 'total:', totalRecipients);
          }
        }
      } else {
        // No txIds - truly orphaned/failed
        msg.status = 'failed';
        (msg as any).deliveryStatus = 'failed';
        msg.confirmed = false;
        
        console.log('[CLEANUP] No txIds - marked orphaned message as failed:', msg.id.substring(0, 20));
      }
      
      await store.put(msg);
      cleanedCount++;
    }
  }
  
  await tx.done;
  
  console.log(`[CLEANUP] ✅ Cleaned up ${cleanedCount} orphaned messages`);
  return cleanedCount;
}

export type { 
  MessageCache, 
  ConversationCache, 
  DecryptedMemoCache, 
  CustomJsonMessage,
  GroupConversationCache,
  GroupMessageCache
};
export { getConversationKey };
