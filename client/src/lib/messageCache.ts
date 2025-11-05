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
}

interface ConversationCache {
  conversationKey: string;
  partnerUsername: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  lastChecked: string;
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
  const dbName = username ? `hive-messenger-${username}-v3` : 'hive-messenger-v3';
  
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

export type { MessageCache, ConversationCache };
export { getConversationKey };
