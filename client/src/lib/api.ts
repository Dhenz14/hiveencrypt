import { apiRequest } from '@/lib/queryClient';
import type { Conversation, Message, Contact } from '@shared/schema';

// Conversations API
export const conversationsApi = {
  getAll: async (username: string): Promise<Conversation[]> => {
    const response = await fetch(`/api/conversations/${username}`);
    if (!response.ok) throw new Error('Failed to fetch conversations');
    return response.json();
  },

  create: async (data: Omit<Conversation, 'id'>): Promise<Conversation> => {
    return apiRequest('POST', '/api/conversations', data);
  },

  update: async (id: string, updates: Partial<Conversation>): Promise<Conversation> => {
    return apiRequest('PATCH', `/api/conversations/${id}`, updates);
  },
};

// Messages API
export const messagesApi = {
  getByConversation: async (conversationId: string): Promise<Message[]> => {
    const response = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  },

  send: async (data: Omit<Message, 'id'>): Promise<Message> => {
    return apiRequest('POST', '/api/messages', data);
  },

  updateStatus: async (messageId: string, status: Message['status']): Promise<Message> => {
    return apiRequest('PATCH', `/api/messages/${messageId}/status`, { status });
  },
};

// Contacts API
export const contactsApi = {
  getAll: async (username: string): Promise<Contact[]> => {
    const response = await fetch(`/api/contacts/${username}`);
    if (!response.ok) throw new Error('Failed to fetch contacts');
    return response.json();
  },

  add: async (username: string, contact: Contact): Promise<Contact> => {
    return apiRequest('POST', `/api/contacts/${username}`, contact);
  },
};

// Hive Blockchain API
export const hiveApi = {
  validateAccount: async (username: string): Promise<{ exists: boolean; username: string }> => {
    const response = await fetch(`/api/hive/account/${username}`);
    if (!response.ok) throw new Error('Failed to validate account');
    return response.json();
  },

  getHistory: async (username: string, limit = 100): Promise<any[]> => {
    const response = await fetch(`/api/hive/history/${username}?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch history');
    const data = await response.json();
    return data.history;
  },

  simulateTransfer: async (
    from: string,
    to: string,
    amount: string,
    memo: string
  ): Promise<{ success: boolean; trx_id: string; block_num: number }> => {
    return apiRequest('POST', '/api/hive/transfer', { from, to, amount, memo });
  },
};
