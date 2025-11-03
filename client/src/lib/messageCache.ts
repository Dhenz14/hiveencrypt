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

async function getDB(): Promise<IDBPDatabase<HiveMessengerDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  // Bump version to force cache clear for corrupted encrypted content
  dbInstance = await openDB<HiveMessengerDB>('hive-messenger-v3', 1, {
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

export async function cacheMessage(message: MessageCache): Promise<void> {
  const db = await getDB();
  await db.put('messages', message);
}

export async function cacheMessages(messages: MessageCache[]): Promise<void> {
  const db = await getDB();
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
  const db = await getDB();
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

export async function getMessageByTxId(txId: string): Promise<MessageCache | undefined> {
  const db = await getDB();
  const messages = await db.getAllFromIndex('messages', 'by-txId', txId);
  return messages[0];
}

export async function updateConversation(conversation: ConversationCache): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conversation);
}

export async function getConversations(): Promise<ConversationCache[]> {
  const db = await getDB();
  const conversations = await db.getAll('conversations');
  
  return conversations.sort((a: ConversationCache, b: ConversationCache) => 
    new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
}

export async function getConversation(
  currentUser: string,
  partnerUsername: string
): Promise<ConversationCache | undefined> {
  const db = await getDB();
  const conversationKey = getConversationKey(currentUser, partnerUsername);
  return await db.get('conversations', conversationKey);
}

export async function setMetadata(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.put('metadata', { key, value });
}

export async function getMetadata(key: string): Promise<string | undefined> {
  const db = await getDB();
  const result = await db.get('metadata', key);
  return result?.value;
}

export async function clearAllCache(): Promise<void> {
  const db = await getDB();
  await db.clear('messages');
  await db.clear('conversations');
  await db.clear('metadata');
}

export async function fixCorruptedMessages(currentUsername: string): Promise<number> {
  const db = await getDB();
  const allMessages = await db.getAll('messages');
  let fixed = 0;
  
  for (const msg of allMessages) {
    // ONLY fix if content exactly equals encryptedContent
    // This is the ONLY reliable test - if they're equal, it means
    // the encrypted memo was incorrectly stored in the content field
    const needsFixing = msg.content === msg.encryptedContent && msg.encryptedContent;
    
    if (needsFixing) {
      console.log('[CACHE FIX] Fixing corrupted message (content === encrypted):', msg.id.substring(0, 20));
      
      // Fix the content based on whether it's sent or received
      const isReceivedMessage = msg.from !== currentUsername;
      msg.content = isReceivedMessage 
        ? '[🔒 Encrypted - Click to decrypt]'
        : 'Your encrypted message';
      
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

  await cacheMessage(message);

  const conversation = await getConversation(from, to);
  await updateConversation({
    conversationKey,
    partnerUsername: to,
    lastMessage: content,
    lastTimestamp: message.timestamp,
    unreadCount: conversation?.unreadCount || 0,
    lastChecked: new Date().toISOString(),
  });
}

export async function confirmMessage(tempId: string, txId: string, encryptedContent?: string): Promise<void> {
  const db = await getDB();
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

export async function updateMessageContent(messageId: string, decryptedContent: string): Promise<void> {
  const db = await getDB();
  const message = await db.get('messages', messageId);
  
  if (message) {
    message.content = decryptedContent;
    await db.put('messages', message);
  }
}

export type { MessageCache, ConversationCache };
export { getConversationKey };
