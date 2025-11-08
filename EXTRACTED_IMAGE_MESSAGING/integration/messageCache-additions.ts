/**
 * IndexedDB Schema Additions for Custom JSON Image Messaging
 * 
 * Add this to your messageCache.ts or database.ts file
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

/**
 * Custom JSON Message interface for IndexedDB storage
 */
export interface CustomJsonMessage {
  txId: string;                    // Primary key (transaction ID)
  sessionId?: string;              // For multi-chunk messages
  conversationKey: string;         // "<user1>_<user2>" (sorted alphabetically)
  from: string;                    // Sender username
  to: string;                      // Recipient username
  timestamp: string;               // ISO timestamp
  encryptedPayload: string;        // Encrypted image payload
  hash?: string;                   // SHA-256 integrity hash
  chunks?: number;                 // Number of chunks (if multi-chunk)
  isDecrypted: boolean;            // Whether message has been decrypted
  confirmed: boolean;              // Blockchain confirmation status
  
  // Decrypted fields (populated after decryption)
  imageData?: string;              // base64 image data
  message?: string;                // Optional text caption
  filename?: string;               // Original filename
  contentType?: string;            // MIME type (e.g., 'image/webp')
}

/**
 * Extended database schema with custom JSON support
 */
interface HiveMessengerDB extends DBSchema {
  // ... your existing tables (messages, conversations, etc.)
  
  // CUSTOM JSON: Image messages table
  customJsonMessages: {
    key: string;  // txId
    value: CustomJsonMessage;
    indexes: {
      'by-conversation': string;  // conversationKey
      'by-timestamp': string;     // timestamp
      'by-sessionId': string;     // sessionId
    };
  };
}

/**
 * Initialize database with custom JSON support
 * 
 * INTEGRATION: Add this to your existing database initialization
 */
export async function initializeDatabaseWithCustomJson(username?: string): Promise<IDBPDatabase<HiveMessengerDB>> {
  const dbName = username ? `hive-messenger-${username}-v5` : 'hive-messenger-v5';
  
  return await openDB<HiveMessengerDB>(dbName, 1, {
    upgrade(db: IDBPDatabase<HiveMessengerDB>) {
      // Your existing table creation code here...
      
      // CUSTOM JSON: Create customJsonMessages table
      if (!db.objectStoreNames.contains('customJsonMessages')) {
        const customJsonStore = db.createObjectStore('customJsonMessages', { keyPath: 'txId' });
        customJsonStore.createIndex('by-conversation', 'conversationKey');
        customJsonStore.createIndex('by-timestamp', 'timestamp');
        customJsonStore.createIndex('by-sessionId', 'sessionId');
        
        console.log('[DB] Created customJsonMessages table with indexes');
      }
    },
  });
}

/**
 * Helper function to generate conversation key (sorted usernames)
 */
export function getConversationKey(user1: string, user2: string): string {
  return [user1, user2].sort().join('_');
}

/**
 * CRUD Operations for Custom JSON Messages
 */

/**
 * Cache a single custom JSON message
 */
export async function cacheCustomJsonMessage(
  message: CustomJsonMessage,
  username?: string
): Promise<void> {
  const db = await initializeDatabaseWithCustomJson(username);
  await db.put('customJsonMessages', message);
  console.log('[CUSTOM JSON] Cached message:', message.txId.substring(0, 20));
}

/**
 * Batch cache multiple custom JSON messages (optimized)
 */
export async function cacheCustomJsonMessages(
  messages: CustomJsonMessage[],
  username?: string
): Promise<void> {
  const db = await initializeDatabaseWithCustomJson(username);
  const tx = db.transaction('customJsonMessages', 'readwrite');
  
  await Promise.all([
    ...messages.map((msg) => tx.store.put(msg)),
    tx.done,
  ]);
  
  console.log('[CUSTOM JSON] Batch cached', messages.length, 'image messages');
}

/**
 * Get all custom JSON messages for a conversation
 */
export async function getCustomJsonMessagesByConversation(
  currentUser: string,
  partnerUsername: string
): Promise<CustomJsonMessage[]> {
  const db = await initializeDatabaseWithCustomJson(currentUser);
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

/**
 * Get a specific custom JSON message by transaction ID
 */
export async function getCustomJsonMessageByTxId(
  txId: string,
  username?: string
): Promise<CustomJsonMessage | undefined> {
  const db = await initializeDatabaseWithCustomJson(username);
  return await db.get('customJsonMessages', txId);
}

/**
 * Update a custom JSON message (e.g., after decryption)
 */
export async function updateCustomJsonMessage(
  txId: string,
  updates: Partial<CustomJsonMessage>,
  username?: string
): Promise<void> {
  const db = await initializeDatabaseWithCustomJson(username);
  const message = await db.get('customJsonMessages', txId);
  
  if (message) {
    Object.assign(message, updates);
    await db.put('customJsonMessages', message);
    console.log('[CUSTOM JSON] Updated message:', txId.substring(0, 20));
  }
}

/**
 * Delete all custom JSON messages for a conversation
 */
export async function deleteCustomJsonConversation(
  currentUser: string,
  partnerUsername: string
): Promise<void> {
  console.log('[CUSTOM JSON] Deleting image conversation:', { currentUser, partnerUsername });
  
  const db = await initializeDatabaseWithCustomJson(currentUser);
  const messages = await getCustomJsonMessagesByConversation(currentUser, partnerUsername);
  
  console.log('[CUSTOM JSON] Deleting', messages.length, 'image messages');
  
  const tx = db.transaction('customJsonMessages', 'readwrite');
  await Promise.all([
    ...messages.map((msg) => tx.store.delete(msg.txId)),
    tx.done,
  ]);
  
  console.log('[CUSTOM JSON] ✅ Image conversation deleted from local storage');
}

/**
 * INTEGRATION INSTRUCTIONS:
 * 
 * 1. Add CustomJsonMessage interface to your types
 * 2. Add customJsonMessages table to your existing DBSchema
 * 3. Update your database initialization to create the new table
 * 4. Import and use these CRUD functions in your hooks/components
 * 
 * Example:
 * 
 * import { 
 *   cacheCustomJsonMessages,
 *   getCustomJsonMessagesByConversation,
 *   updateCustomJsonMessage 
 * } from '@/lib/messageCache';
 * 
 * // Cache messages after fetching from blockchain
 * await cacheCustomJsonMessages(newMessages, username);
 * 
 * // Load cached messages for instant display
 * const cached = await getCustomJsonMessagesByConversation(user, partner);
 * 
 * // Update after decryption
 * await updateCustomJsonMessage(txId, { 
 *   isDecrypted: true,
 *   imageData: base64Image,
 *   message: caption
 * }, username);
 */

export type { CustomJsonMessage };
