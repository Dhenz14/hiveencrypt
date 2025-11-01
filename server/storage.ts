import type { Conversation, Message, Contact } from "@shared/schema";
import { db } from "./db";
import { users, conversations, messages, contacts } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // Conversations
  getConversations(username: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  createConversation(conversation: Omit<Conversation, 'id'> & { currentUser: string }): Promise<Conversation>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined>;
  
  // Messages
  getMessages(conversationId: string): Promise<Message[]>;
  getMessage(id: string): Promise<Message | undefined>;
  createMessage(message: Omit<Message, 'id'>): Promise<Message>;
  updateMessageStatus(id: string, status: Message['status']): Promise<Message | undefined>;
  
  // Contacts
  getContacts(username: string): Promise<Contact[]>;
  addContact(username: string, contact: Contact): Promise<Contact>;
}

export class DatabaseStorage implements IStorage {
  private async ensureUser(username: string, publicMemoKey: string | null = null): Promise<number> {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    
    if (existingUser.length > 0) {
      return existingUser[0].id;
    }
    
    try {
      const [newUser] = await db
        .insert(users)
        .values({ username, publicMemoKey: publicMemoKey || null })
        .returning();
      
      return newUser.id;
    } catch (error: any) {
      if (error.code === '23505') {
        const retryUser = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        
        if (retryUser.length > 0) {
          return retryUser[0].id;
        }
      }
      throw error;
    }
  }

  async updateUserMemoKey(username: string, publicMemoKey: string): Promise<void> {
    await db
      .update(users)
      .set({ publicMemoKey })
      .where(eq(users.username, username));
  }

  async getConversations(username: string): Promise<Conversation[]> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    
    if (user.length === 0) return [];
    
    const userConversations = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, user[0].id))
      .orderBy(desc(conversations.lastMessageAt));
    
    return userConversations.map(conv => ({
      id: conv.id.toString(),
      contactUsername: conv.contactUsername,
      lastMessageTime: conv.lastMessageAt?.toISOString(),
      unreadCount: conv.unreadCount,
      isEncrypted: conv.isEncrypted,
      publicKey: conv.publicKey || undefined,
    }));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, parseInt(id)))
      .limit(1);
    
    if (!conversation) return undefined;
    
    return {
      id: conversation.id.toString(),
      contactUsername: conversation.contactUsername,
      lastMessageTime: conversation.lastMessageAt?.toISOString(),
      unreadCount: conversation.unreadCount,
      isEncrypted: conversation.isEncrypted,
      publicKey: conversation.publicKey || undefined,
    };
  }

  async createConversation(conversation: Omit<Conversation, 'id'> & { currentUser: string }): Promise<Conversation> {
    const userId = await this.ensureUser(conversation.currentUser);
    
    try {
      const [newConversation] = await db
        .insert(conversations)
        .values({
          userId,
          contactUsername: conversation.contactUsername,
          lastMessageAt: conversation.lastMessageTime ? new Date(conversation.lastMessageTime) : null,
          unreadCount: conversation.unreadCount,
          isEncrypted: conversation.isEncrypted,
          publicKey: conversation.publicKey || null,
        })
        .returning();
      
      return {
        id: newConversation.id.toString(),
        contactUsername: newConversation.contactUsername,
        lastMessageTime: newConversation.lastMessageAt?.toISOString(),
        unreadCount: newConversation.unreadCount,
        isEncrypted: newConversation.isEncrypted,
        publicKey: newConversation.publicKey || undefined,
      };
    } catch (error: any) {
      if (error.code === '23505') {
        const [existing] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, userId),
              eq(conversations.contactUsername, conversation.contactUsername)
            )
          )
          .limit(1);
        
        if (existing) {
          return {
            id: existing.id.toString(),
            contactUsername: existing.contactUsername,
            lastMessageTime: existing.lastMessageAt?.toISOString(),
            unreadCount: existing.unreadCount,
            isEncrypted: existing.isEncrypted,
            publicKey: existing.publicKey || undefined,
          };
        }
      }
      throw error;
    }
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const updateData: any = {};
    
    if (updates.contactUsername !== undefined) updateData.contactUsername = updates.contactUsername;
    if (updates.lastMessageTime !== undefined) updateData.lastMessageAt = new Date(updates.lastMessageTime);
    if (updates.unreadCount !== undefined) updateData.unreadCount = updates.unreadCount;
    if (updates.isEncrypted !== undefined) updateData.isEncrypted = updates.isEncrypted;
    if (updates.publicKey !== undefined) updateData.publicKey = updates.publicKey;
    
    const [updated] = await db
      .update(conversations)
      .set(updateData)
      .where(eq(conversations.id, parseInt(id)))
      .returning();
    
    if (!updated) return undefined;
    
    return {
      id: updated.id.toString(),
      contactUsername: updated.contactUsername,
      lastMessageTime: updated.lastMessageAt?.toISOString(),
      unreadCount: updated.unreadCount,
      isEncrypted: updated.isEncrypted,
      publicKey: updated.publicKey || undefined,
    };
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, parseInt(conversationId)))
      .orderBy(messages.timestamp);
    
    const result: Message[] = [];
    
    for (const msg of msgs) {
      const [sender] = await db
        .select()
        .from(users)
        .where(eq(users.id, msg.senderId))
        .limit(1);
      
      let recipient = '';
      if (msg.recipientId) {
        const [recipientUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, msg.recipientId))
          .limit(1);
        recipient = recipientUser?.username || msg.recipientUsername || '';
      } else if (msg.recipientUsername) {
        recipient = msg.recipientUsername;
      }
      
      result.push({
        id: msg.id.toString(),
        conversationId: msg.conversationId.toString(),
        sender: sender?.username || '',
        recipient,
        content: msg.content,
        encryptedMemo: msg.encryptedContent || '',
        timestamp: msg.timestamp.toISOString(),
        status: msg.status as Message['status'],
        blockNum: undefined,
        trxId: msg.blockchainTxId || undefined,
        isEncrypted: msg.isEncrypted,
      });
    }
    
    return result;
  }

  async getMessage(id: string): Promise<Message | undefined> {
    const [msg] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, parseInt(id)))
      .limit(1);
    
    if (!msg) return undefined;
    
    const [sender] = await db
      .select()
      .from(users)
      .where(eq(users.id, msg.senderId))
      .limit(1);
    
    let recipient = '';
    if (msg.recipientId) {
      const [recipientUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, msg.recipientId))
        .limit(1);
      recipient = recipientUser?.username || msg.recipientUsername || '';
    } else if (msg.recipientUsername) {
      recipient = msg.recipientUsername;
    }
    
    return {
      id: msg.id.toString(),
      conversationId: msg.conversationId.toString(),
      sender: sender?.username || '',
      recipient,
      content: msg.content,
      encryptedMemo: msg.encryptedContent || '',
      timestamp: msg.timestamp.toISOString(),
      status: msg.status as Message['status'],
      blockNum: undefined,
      trxId: msg.blockchainTxId || undefined,
      isEncrypted: msg.isEncrypted,
    };
  }

  async createMessage(message: Omit<Message, 'id'>): Promise<Message> {
    const senderId = await this.ensureUser(message.sender);
    
    let recipientId: number | null = null;
    if (message.recipient) {
      const [recipientUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, message.recipient))
        .limit(1);
      recipientId = recipientUser?.id || null;
    }
    
    const [newMessage] = await db
      .insert(messages)
      .values({
        conversationId: parseInt(message.conversationId),
        senderId,
        recipientId,
        recipientUsername: message.recipient || null,
        content: message.content,
        encryptedContent: message.encryptedMemo || null,
        isEncrypted: message.isEncrypted,
        status: message.status,
        blockchainTxId: message.trxId || null,
      })
      .returning();
    
    return {
      id: newMessage.id.toString(),
      conversationId: newMessage.conversationId.toString(),
      sender: message.sender,
      recipient: message.recipient,
      content: newMessage.content,
      encryptedMemo: newMessage.encryptedContent || '',
      timestamp: newMessage.timestamp.toISOString(),
      status: newMessage.status as Message['status'],
      blockNum: message.blockNum,
      trxId: newMessage.blockchainTxId || undefined,
      isEncrypted: newMessage.isEncrypted,
    };
  }

  async updateMessageStatus(id: string, status: Message['status']): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set({ status })
      .where(eq(messages.id, parseInt(id)))
      .returning();
    
    if (!updated) return undefined;
    
    const [sender] = await db
      .select()
      .from(users)
      .where(eq(users.id, updated.senderId))
      .limit(1);
    
    let recipient = '';
    if (updated.recipientId) {
      const [recipientUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, updated.recipientId))
        .limit(1);
      recipient = recipientUser?.username || updated.recipientUsername || '';
    } else if (updated.recipientUsername) {
      recipient = updated.recipientUsername;
    }
    
    return {
      id: updated.id.toString(),
      conversationId: updated.conversationId.toString(),
      sender: sender?.username || '',
      recipient,
      content: updated.content,
      encryptedMemo: updated.encryptedContent || '',
      timestamp: updated.timestamp.toISOString(),
      status: updated.status as Message['status'],
      blockNum: undefined,
      trxId: updated.blockchainTxId || undefined,
      isEncrypted: updated.isEncrypted,
    };
  }

  async getContacts(username: string): Promise<Contact[]> {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    
    if (user.length === 0) return [];
    
    const userContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.userId, user[0].id));
    
    return userContacts.map(contact => ({
      username: contact.contactUsername,
      publicKey: contact.publicMemoKey,
    }));
  }

  async addContact(username: string, contact: Contact): Promise<Contact> {
    const userId = await this.ensureUser(username);
    
    const existing = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.contactUsername, contact.username)
        )
      )
      .limit(1);
    
    if (existing.length === 0) {
      await db
        .insert(contacts)
        .values({
          userId,
          contactUsername: contact.username,
          publicMemoKey: contact.publicKey,
        });
    }
    
    return contact;
  }
}

export const storage = new DatabaseStorage();
