import { z } from "zod";
import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

// Database Tables

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  publicMemoKey: text("public_memo_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  contactUsername: text("contact_username").notNull(),
  lastMessageAt: timestamp("last_message_at"),
  unreadCount: integer("unread_count").notNull().default(0),
  isEncrypted: boolean("is_encrypted").notNull().default(true),
  publicKey: text("public_key"),
}, (table) => ({
  userIdIdx: index("conversations_user_id_idx").on(table.userId),
  userContactUnique: uniqueIndex("conversations_user_contact_unique").on(table.userId, table.contactUsername),
}));

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  senderId: integer("sender_id").notNull().references(() => users.id),
  recipientId: integer("recipient_id").references(() => users.id),
  recipientUsername: text("recipient_username"),
  content: text("content").notNull(),
  encryptedContent: text("encrypted_content"),
  decryptedContent: text("decrypted_content"),
  isEncrypted: boolean("is_encrypted").notNull(),
  status: text("status").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  blockchainTxId: text("blockchain_tx_id"),
}, (table) => ({
  conversationIdIdx: index("messages_conversation_id_idx").on(table.conversationId),
}));

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  contactUsername: text("contact_username").notNull(),
  publicMemoKey: text("public_memo_key").notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (table) => ({
  userContactUnique: uniqueIndex("contacts_user_contact_unique").on(table.userId, table.contactUsername),
}));

// Relations

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  messages: many(messages),
  contacts: many(contacts),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  user: one(users, {
    fields: [contacts.userId],
    references: [users.id],
  }),
}));

// Insert Schemas

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, timestamp: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, addedAt: true });

// Insert Types

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertContact = z.infer<typeof insertContactSchema>;

// Select Types

export type User = typeof users.$inferSelect;
export type ConversationDB = typeof conversations.$inferSelect;
export type MessageDB = typeof messages.$inferSelect;
export type ContactDB = typeof contacts.$inferSelect;

// Hive Blockchain Data Models

export interface HiveAccount {
  id: string;
  name: string;
  memo_key: string;
  balance?: string;
  hbd_balance?: string;
}

export interface HiveTransfer {
  from: string;
  to: string;
  amount: string;
  memo: string;
  timestamp: string;
  block_num?: number;
  trx_id?: string;
}

// Application Data Models

export interface Message {
  id: string;
  conversationId: string;
  sender: string;
  recipient: string;
  content: string;
  encryptedMemo: string;
  decryptedContent?: string;
  timestamp: string;
  status: 'sending' | 'sent' | 'confirmed' | 'failed';
  blockNum?: number;
  trxId?: string;
  isEncrypted: boolean;
}

export interface Conversation {
  id: string;
  contactUsername: string;
  contactAvatar?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
  isEncrypted: boolean;
  publicKey?: string;
}

export interface Contact {
  username: string;
  publicKey: string;
  avatar?: string;
  lastSeen?: string;
  isOnline?: boolean;
}

export interface UserSession {
  username: string;
  publicMemoKey: string;
  isAuthenticated: boolean;
  timestamp: string;
  balance?: string;
  hbdBalance?: string;
}

export interface EncryptionStatus {
  isKeyExchangeComplete: boolean;
  recipientPublicKey?: string;
  encryptionMethod: 'hive-memo' | 'none';
}

export interface BlockchainSyncStatus {
  status: 'syncing' | 'synced' | 'error';
  lastSyncTime?: string;
  blockHeight?: number;
}

// Zod Schemas for Validation

export const messageSchema = z.object({
  sender: z.string().min(1),
  recipient: z.string().min(1),
  content: z.string().min(1).max(2000), // Hive memo size limit ~2KB
  amount: z.string().default('0.001 HBD'),
});

export const contactSchema = z.object({
  username: z.string().min(3).max(16), // Hive username constraints
});

export const loginSchema = z.object({
  username: z.string().min(3).max(16),
});

// Type exports
export type MessageInput = z.infer<typeof messageSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// Storage Interface Types
export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// ============================================================================
// GROUP CHAT: Decentralized Multi-Recipient Messaging
// ============================================================================

export interface Group {
  groupId: string;                    // UUID v4 - unique group identifier
  name: string;                       // User-defined group name
  members: string[];                  // Array of Hive usernames
  creator: string;                    // Username of group creator
  createdAt: string;                  // ISO timestamp
  version: number;                    // Increments on membership changes
  lastMessage?: string;               // Preview of last group message
  lastMessageTime?: string;           // Timestamp of last message
}

export interface GroupMessage {
  id: string;                         // Transaction ID or temp ID
  groupId: string;                    // References Group.groupId
  sender: string;                     // Username who sent the message
  content: string;                    // Decrypted message content
  encryptedContent: string;           // Original encrypted memo
  timestamp: string;                  // ISO timestamp
  recipients: string[];               // Usernames message was sent to
  txIds: string[];                    // Blockchain transaction IDs (one per recipient)
  confirmed: boolean;                 // All transactions confirmed
  status: 'sending' | 'partial' | 'sent' | 'confirmed' | 'failed';
  failedRecipients?: string[];        // Recipients whose transactions failed
  deliveryStatus?: 'full' | 'partial'; // Delivery status for partial failures
}

export interface GroupConversation extends Omit<Conversation, 'contactUsername'> {
  type: 'group';
  groupId: string;
  groupName: string;
  members: string[];
  memberCount: number;
  creator: string;
}

// Discriminated union for conversation types
export type AnyConversation = 
  | (Conversation & { type: 'direct' })
  | GroupConversation;

// Zod schema for group validation
export const createGroupSchema = z.object({
  name: z.string().min(1).max(50, 'Group name must be 50 characters or less'),
  members: z.array(z.string().min(3).max(16)).min(2, 'Groups must have at least 2 members'),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

// ============================================================================
// PAID GROUPS & JOIN REQUESTS: Payment Configuration & Request Management
// ============================================================================

/**
 * Payment configuration for a paid group
 * Defines pricing, payment type (one-time or recurring), and approval settings
 */
export interface PaymentSettings {
  /** Whether this group requires payment to join */
  enabled: boolean;
  /** HBD amount required to join (e.g., "5.000") */
  amount: string;
  /** Payment type - one-time or recurring subscription */
  type: 'one_time' | 'recurring';
  /** Days between recurring payments (only for recurring type) */
  recurringInterval?: number;
  /** Optional description explaining what the payment is for */
  description?: string;
  /** Auto-approve join requests (true) or require manual approval (false) */
  autoApprove?: boolean;
}

/**
 * Record of a member's payment for a paid group
 * Tracks payment status, transaction details, and renewal dates
 */
export interface MemberPayment {
  /** Username of the member who paid */
  username: string;
  /** Blockchain transaction ID of the payment */
  txId: string;
  /** Amount paid (e.g., "5.000 HBD") */
  amount: string;
  /** ISO timestamp when payment was made */
  paidAt: string;
  /** Next payment due date (for recurring payments) - ISO timestamp */
  nextDueDate?: string;
  /** Current payment status */
  status: 'active' | 'expired' | 'pending';
}

/**
 * Join request for a paid or manually-approved group
 * Tracks pending, approved, and rejected membership requests
 */
export interface JoinRequest {
  /** Unique request identifier - derived from txId or username+timestamp */
  requestId: string;
  /** Username requesting to join the group */
  username: string;
  /** ISO timestamp when request was submitted */
  requestedAt: string;
  /** Current status of the request */
  status: 'pending' | 'approved' | 'rejected';
  /** Optional message from the requester */
  message?: string;
  /** Transaction ID of the join request custom_json operation */
  txId?: string;
}

/**
 * Blockchain custom_json operation for group management
 * Used for creating groups, updating membership, and managing join requests
 */
export interface GroupCustomJson {
  /** Action type for this custom_json operation */
  action: 'create' | 'update' | 'leave' | 'join_request' | 'join_approve' | 'join_reject';
  /** Unique group identifier (UUID v4) */
  groupId: string;
  /** Group name (for create/update actions) */
  name?: string;
  /** Array of member usernames (for create/update actions) */
  members?: string[];
  /** Group creator username (for create action) */
  creator?: string;
  /** Group version - increments with membership changes */
  version?: number;
  /** ISO timestamp of this operation */
  timestamp: string;
  /** Payment configuration (for paid groups) */
  paymentSettings?: PaymentSettings;
  /** Payment records for group members */
  memberPayments?: MemberPayment[];
  /** Pending join requests (for manually-approved groups) */
  joinRequests?: JoinRequest[];
}

/**
 * IndexedDB cache entry for a group conversation
 * Stores group metadata, messages, and payment/join request state
 */
export interface GroupConversationCache {
  /** Unique group identifier (UUID v4) - primary key */
  groupId: string;
  /** User-defined group name */
  name: string;
  /** Array of member usernames */
  members: string[];
  /** Username of the group creator */
  creator: string;
  /** ISO timestamp when group was created */
  createdAt: string;
  /** Group version - increments with membership changes */
  version: number;
  /** Preview of the last message in the group */
  lastMessage: string;
  /** ISO timestamp of the last message */
  lastTimestamp: string;
  /** Number of unread messages in this group */
  unreadCount: number;
  /** ISO timestamp when user last viewed this group */
  lastChecked: string;
  /** Payment configuration (for paid groups) */
  paymentSettings?: PaymentSettings;
  /** Payment records for group members */
  memberPayments?: MemberPayment[];
  /** Pending join requests (for manually-approved groups) */
  joinRequests?: JoinRequest[];
}
