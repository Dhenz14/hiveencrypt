import type { Conversation, Message, Contact } from "@shared/schema";

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

export class MemStorage implements IStorage {
  private conversations: Map<string, Conversation>;
  private messages: Map<string, Message>;
  private contacts: Map<string, Contact[]>;
  private userConversations: Map<string, Set<string>>;

  constructor() {
    this.conversations = new Map();
    this.messages = new Map();
    this.contacts = new Map();
    this.userConversations = new Map();
  }

  async getConversations(username: string): Promise<Conversation[]> {
    const userKey = username.toLowerCase();
    const userConvs = this.userConversations.get(userKey) || [];
    return userConvs
      .map(convId => this.conversations.get(convId))
      .filter((conv): conv is Conversation => conv !== undefined);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async createConversation(conversation: Omit<Conversation, 'id'> & { currentUser: string }): Promise<Conversation> {
    const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { currentUser, ...convData } = conversation;
    const newConversation: Conversation = { ...convData, id };
    this.conversations.set(id, newConversation);
    
    const userKey = currentUser.toLowerCase();
    if (!this.userConversations.has(userKey)) {
      this.userConversations.set(userKey, new Set());
    }
    this.userConversations.get(userKey)!.add(id);
    
    return newConversation;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(id);
    if (!conversation) return undefined;
    
    const updated = { ...conversation, ...updates };
    this.conversations.set(id, updated);
    return updated;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return Array.from(this.messages.values()).filter(
      msg => msg.conversationId === conversationId
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async getMessage(id: string): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async createMessage(message: Omit<Message, 'id'>): Promise<Message> {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMessage: Message = { ...message, id };
    this.messages.set(id, newMessage);
    return newMessage;
  }

  async updateMessageStatus(id: string, status: Message['status']): Promise<Message | undefined> {
    const message = this.messages.get(id);
    if (!message) return undefined;
    
    const updated = { ...message, status };
    this.messages.set(id, updated);
    return updated;
  }

  async getContacts(username: string): Promise<Contact[]> {
    return this.contacts.get(username) || [];
  }

  async addContact(username: string, contact: Contact): Promise<Contact> {
    const userContacts = this.contacts.get(username) || [];
    const exists = userContacts.find(c => c.username === contact.username);
    
    if (!exists) {
      userContacts.push(contact);
      this.contacts.set(username, userContacts);
    }
    
    return contact;
  }
}

export const storage = new MemStorage();
