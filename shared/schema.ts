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
