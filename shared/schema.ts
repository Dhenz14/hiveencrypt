import { z } from "zod";

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
  isAuthenticated: boolean;
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
