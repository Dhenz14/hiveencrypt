import { openDB, DBSchema, IDBPDatabase } from 'idb';

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
  // v5: Add customJsonMessages table for image messaging
  const dbName = username ? `hive-messenger-${username}-v5` : 'hive-messenger-v5';
  
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
  
  const message: MessageCache = {
    id: tempId,
    conversationKey,
    from,
    to,
    content,
    encryptedContent,
    timestamp: new Date().toISOString(),
    txId: '',
    confirmed: false,
  };

  await cacheMessage(message, from);

  const conversation = await getConversation(from, to);
  await updateConversation({
    conversationKey,
    partnerUsername: to,
    lastMessage: content,
    lastTimestamp: message.timestamp,
    unreadCount: conversation?.unreadCount || 0,
    lastChecked: new Date().toISOString(),
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

export type { MessageCache, ConversationCache, DecryptedMemoCache, CustomJsonMessage };
export { getConversationKey };
