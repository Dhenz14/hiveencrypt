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
  const db = await getDB(username);
  const message = await db.get('messages', tempId);
  
  if (message) {
    await db.delete('messages', tempId);
    
    message.id = txId;
    message.txId = txId;
    message.confirmed = true;
    
    // Store encrypted content if provided (for future decryption on other devices)
    if (encryptedContent) {
      message.encryptedContent = encryptedContent;
    }
    
    await db.put('messages', message);
  }
}

export async function updateMessageContent(messageId: string, decryptedContent: string, username?: string): Promise<void> {
  const db = await getDB(username);
  const message = await db.get('messages', messageId);
  
  if (message) {
    message.content = decryptedContent;
    await db.put('messages', message);
  }
}

export type { MessageCache, ConversationCache };
export { getConversationKey };
