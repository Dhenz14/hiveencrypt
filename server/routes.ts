import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import type { Message, Conversation } from "@shared/schema";
import { hiveClient } from "../client/src/lib/hiveClient";
import { 
  createSession, 
  getSession, 
  invalidateSession, 
  verifyKeychainSignature,
  requireAuth
} from "./auth";

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // Authentication Endpoints
  // ============================================================================

  // POST /api/auth/login - Authenticate with Keychain proof and create session
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, keychainProof } = req.body;

      // Validate request body
      if (!username || typeof username !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Username is required'
        });
      }

      if (!keychainProof || !keychainProof.signature || !keychainProof.message) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Keychain proof (signature, message) is required'
        });
      }

      // SECURITY FIX: Fetch authoritative account data from blockchain
      let blockchainAccount;
      try {
        blockchainAccount = await hiveClient.getAccount(username);
      } catch (error) {
        console.error('Error fetching account from blockchain:', error);
        return res.status(500).json({
          error: 'Blockchain error',
          message: 'Failed to verify account on blockchain: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
      }

      if (!blockchainAccount) {
        return res.status(404).json({
          error: 'Account not found',
          message: 'Hive account does not exist'
        });
      }

      // SECURITY FIX: Extract authoritative posting key from blockchain
      const blockchainPostingKey = blockchainAccount.posting?.key_auths?.[0]?.[0];
      if (!blockchainPostingKey) {
        return res.status(500).json({
          error: 'Invalid account',
          message: 'Account has no posting key'
        });
      }

      // SECURITY FIX: Extract authoritative memo key from blockchain
      const blockchainMemoKey = blockchainAccount.memo_key;
      if (!blockchainMemoKey) {
        return res.status(500).json({
          error: 'Invalid account',
          message: 'Account has no memo key'
        });
      }

      // SECURITY FIX: Verify signature against blockchain posting key (not client-supplied key)
      const isValidSignature = verifyKeychainSignature(
        username,
        keychainProof.message,
        keychainProof.signature,
        blockchainPostingKey  // Use blockchain key, not client-supplied
      );

      if (!isValidSignature) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid Keychain signature - signature does not match blockchain posting key'
        });
      }

      // SECURITY FIX: Create session with blockchain-verified memo key
      const sessionToken = createSession(username, blockchainMemoKey);

      // SECURITY FIX: Update user record with blockchain-verified memo key
      const dbStorage = storage as any;
      await dbStorage.ensureUser(username, blockchainMemoKey);

      res.json({
        success: true,
        sessionToken,
        username,
        publicMemoKey: blockchainMemoKey  // Return blockchain memo key
      });
    } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({
        error: 'Authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/auth/verify - Verify session token
  app.get("/api/auth/verify", (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        valid: false,
        error: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const session = getSession(token);

    if (!session) {
      return res.status(401).json({
        valid: false,
        error: 'Invalid or expired session token'
      });
    }

    res.json({
      valid: true,
      username: session.username,
      publicMemoKey: session.publicMemoKey
    });
  });

  // POST /api/auth/logout - Invalidate session
  app.post("/api/auth/logout", (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({
        success: false,
        error: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7);
    const invalidated = invalidateSession(token);

    res.json({
      success: invalidated,
      message: invalidated ? 'Session invalidated successfully' : 'Session not found'
    });
  });

  // ============================================================================
  // Conversation & Message Endpoints
  // ============================================================================

  // Get conversations for a user
  app.get("/api/conversations/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const conversations = await storage.getConversations(username);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Create a new conversation (Protected - requires authentication)
  app.post("/api/conversations", requireAuth, async (req: any, res) => {
    try {
      const { participantUsername } = req.body;
      const currentUsername = req.session.username;

      // Validate participantUsername
      if (!participantUsername || typeof participantUsername !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'participantUsername is required'
        });
      }

      const cleanParticipant = participantUsername.toLowerCase().trim();

      // Validate username format
      if (cleanParticipant.length < 3 || cleanParticipant.length > 16) {
        return res.status(400).json({
          error: 'Invalid username',
          message: 'Username must be between 3 and 16 characters'
        });
      }

      if (!/^[a-z0-9.-]+$/.test(cleanParticipant)) {
        return res.status(400).json({
          error: 'Invalid username',
          message: 'Username can only contain lowercase letters, numbers, dots, and hyphens'
        });
      }

      // Prevent creating conversation with self
      if (cleanParticipant === currentUsername.toLowerCase()) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Cannot create conversation with yourself'
        });
      }

      // Fetch participant account from Hive blockchain to validate existence
      let participantAccount;
      try {
        participantAccount = await hiveClient.getAccount(cleanParticipant);
      } catch (error) {
        console.error('Error fetching participant account:', error);
        return res.status(500).json({
          error: 'Blockchain error',
          message: 'Failed to verify participant account on blockchain'
        });
      }

      if (!participantAccount) {
        return res.status(404).json({
          error: 'User not found',
          message: `Hive account '${cleanParticipant}' does not exist`
        });
      }

      // Get participant's public memo key from blockchain
      const participantMemoKey = participantAccount.memo_key;
      if (!participantMemoKey) {
        return res.status(500).json({
          error: 'Invalid account',
          message: 'Participant account has no memo key'
        });
      }

      // Ensure participant user exists in database
      const dbStorage = storage as any;
      await dbStorage.ensureUser(cleanParticipant, participantMemoKey);

      // Create or get existing conversation
      const conversation = await storage.createConversation({
        currentUser: currentUsername,
        contactUsername: cleanParticipant,
        unreadCount: 0,
        isEncrypted: true,
        publicKey: participantMemoKey,
      });

      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({
        error: "Failed to create conversation",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get messages for a conversation (Protected - requires authentication)
  app.get("/api/conversations/:conversationId/messages", requireAuth, async (req: any, res) => {
    try {
      const { conversationId } = req.params;
      const username = req.session.username;

      // Validate conversation exists and user is participant
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation) {
        return res.status(404).json({ 
          error: "Conversation not found",
          message: "The requested conversation does not exist"
        });
      }

      // Get all conversations for the user to verify participation
      const userConversations = await storage.getConversations(username);
      const isParticipant = userConversations.some(c => c.id === conversationId);

      if (!isParticipant) {
        return res.status(403).json({ 
          error: "Forbidden",
          message: "You are not a participant in this conversation"
        });
      }

      const messages = await storage.getMessages(conversationId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ 
        error: "Failed to fetch messages",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Send a message (Protected - requires authentication)
  app.post("/api/messages", requireAuth, async (req: any, res) => {
    try {
      const { conversationId, recipientUsername, content, decryptedContent, txId } = req.body;
      const senderUsername = req.session.username;

      // Validate required fields
      if (!conversationId || typeof conversationId !== 'string') {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "conversationId is required"
        });
      }

      if (!recipientUsername || typeof recipientUsername !== 'string') {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "recipientUsername is required"
        });
      }

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "content is required and cannot be empty"
        });
      }

      // Validate conversation exists
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation) {
        return res.status(404).json({ 
          error: "Conversation not found",
          message: "The specified conversation does not exist"
        });
      }

      // Verify user is participant in conversation
      const userConversations = await storage.getConversations(senderUsername);
      const isParticipant = userConversations.some(c => c.id === conversationId);

      if (!isParticipant) {
        return res.status(403).json({ 
          error: "Forbidden",
          message: "You are not a participant in this conversation"
        });
      }

      // Verify recipient matches conversation contact
      if (conversation.contactUsername !== recipientUsername) {
        return res.status(400).json({ 
          error: "Invalid recipient",
          message: "Recipient must match the conversation contact"
        });
      }

      // Ensure recipient user exists in database (for foreign key)
      const dbStorage = storage as any;
      await dbStorage.ensureUser(recipientUsername);

      // Create message with encrypted content
      const messageData: Omit<Message, 'id'> = {
        conversationId,
        sender: senderUsername,
        recipient: recipientUsername,
        content: content, // Store encrypted content
        encryptedMemo: content, // Also store in encryptedMemo for compatibility
        decryptedContent: decryptedContent || null, // Store plaintext for sender
        timestamp: new Date().toISOString(),
        status: txId ? 'sent' : 'sending', // If txId provided, mark as sent
        isEncrypted: true,
        trxId: txId || undefined,
      };

      const message = await storage.createMessage(messageData);

      // Update conversation's last message time
      await storage.updateConversation(conversationId, {
        lastMessageTime: message.timestamp,
      });

      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ 
        error: "Failed to create message",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Update message status
  app.patch("/api/messages/:messageId/status", async (req, res) => {
    try {
      const { messageId } = req.params;
      const { status } = req.body;
      const message = await storage.updateMessageStatus(messageId, status);
      
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }
      
      res.json(message);
    } catch (error) {
      console.error("Error updating message status:", error);
      res.status(500).json({ error: "Failed to update message status" });
    }
  });

  // Update message decrypted content (Protected - requires authentication)
  app.patch("/api/messages/:messageId", requireAuth, async (req: any, res) => {
    try {
      const { messageId } = req.params;
      const { decryptedContent } = req.body;
      const currentUsername = req.session.username;

      if (!decryptedContent || typeof decryptedContent !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'decryptedContent is required and must be a string'
        });
      }

      const message = await storage.getMessage(messageId);
      
      if (!message) {
        return res.status(404).json({ 
          error: "Message not found",
          message: "The specified message does not exist"
        });
      }

      if (message.sender !== currentUsername && message.recipient !== currentUsername) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only update messages you sent or received'
        });
      }

      const updatedMessage = await storage.updateMessageDecryptedContent(messageId, decryptedContent);
      
      if (!updatedMessage) {
        return res.status(404).json({ error: "Message not found" });
      }
      
      res.json(updatedMessage);
    } catch (error) {
      console.error("Error updating message decrypted content:", error);
      res.status(500).json({ 
        error: "Failed to update message",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Poll blockchain for new incoming messages
  app.get("/api/messages/poll", requireAuth, async (req: any, res) => {
    try {
      const currentUsername = req.session.username;
      const lastChecked = req.query.lastChecked ? new Date(req.query.lastChecked as string) : null;

      let newMessagesCount = 0;

      try {
        const history = await hiveClient.getAccountHistory(currentUsername, 100, 'transfers');
        
        for (const entry of history) {
          const [, operation] = entry;
          
          if (operation[0] !== 'transfer') continue;
          
          const transfer = operation[1];
          
          if (transfer.to !== currentUsername) continue;
          
          if (!transfer.memo || !transfer.memo.startsWith('#')) continue;
          
          const operationTimestamp = new Date(operation.timestamp + 'Z');
          
          if (lastChecked && operationTimestamp <= lastChecked) {
            continue;
          }
          
          const txId = entry[0]?.toString() || `${transfer.from}-${Date.now()}`;
          
          const alreadyExists = await storage.messageExistsByTxId(txId);
          if (alreadyExists) continue;
          
          const senderUsername = transfer.from;
          const encryptedMemo = transfer.memo;
          
          const dbStorage = storage as any;
          const senderMemoKey = await hiveClient.getPublicMemoKey(senderUsername);
          await dbStorage.ensureUser(senderUsername, senderMemoKey);
          
          const conversation = await storage.findOrCreateConversation(
            currentUsername,
            senderUsername,
            senderMemoKey || undefined
          );
          
          const messageData: Omit<Message, 'id'> = {
            conversationId: conversation.id,
            sender: senderUsername,
            recipient: currentUsername,
            content: encryptedMemo,
            encryptedMemo: encryptedMemo,
            timestamp: operationTimestamp.toISOString(),
            status: 'confirmed',
            isEncrypted: true,
            trxId: txId,
          };
          
          await storage.createMessage(messageData);
          
          await storage.updateConversation(conversation.id, {
            lastMessageTime: operationTimestamp.toISOString(),
            unreadCount: (conversation.unreadCount || 0) + 1,
          });
          
          newMessagesCount++;
        }
        
        res.json({
          newMessages: newMessagesCount,
          lastChecked: new Date().toISOString(),
        });
      } catch (blockchainError) {
        console.error('Blockchain polling error:', blockchainError);
        res.status(500).json({
          error: 'Blockchain error',
          message: blockchainError instanceof Error ? blockchainError.message : 'Failed to poll blockchain',
          newMessages: 0,
          lastChecked: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Error polling messages:', error);
      res.status(500).json({
        error: 'Polling failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        newMessages: 0,
        lastChecked: new Date().toISOString(),
      });
    }
  });

  // User management endpoints
  
  // Create or update user with public memo key (Protected - requires authentication)
  app.post("/api/users", requireAuth, async (req: any, res) => {
    try {
      const { username, publicMemoKey } = req.body;
      
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "Username is required"
        });
      }
      
      if (!publicMemoKey || typeof publicMemoKey !== 'string') {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "Public memo key is required"
        });
      }
      
      // Ensure user can only update their own record
      if (req.session.username !== username) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You can only update your own user record"
        });
      }
      
      // Use the ensureUser method from storage
      // We need to make it accessible, so we'll use a type assertion
      const dbStorage = storage as any;
      await dbStorage.ensureUser(username, publicMemoKey);
      
      res.json({ 
        success: true,
        username,
        publicMemoKey
      });
    } catch (error) {
      console.error("Error creating/updating user:", error);
      res.status(500).json({ 
        error: "Failed to create or update user",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  // Hive-specific endpoints for blockchain integration
  
  // Get Hive account information
  app.get("/api/hive/account/:username", async (req, res) => {
    try {
      const { username } = req.params;
      
      const account = await hiveClient.getAccount(username);
      
      if (!account) {
        return res.status(404).json({ 
          error: "Account not found",
          message: `Hive account '${username}' does not exist`
        });
      }
      
      res.json(account);
    } catch (error) {
      console.error("Error fetching account:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Return 400 for validation errors, 500 for blockchain errors
      if (errorMessage.includes("Invalid username format")) {
        return res.status(400).json({ 
          error: "Invalid username",
          message: errorMessage
        });
      }
      
      res.status(500).json({ 
        error: "Failed to fetch account",
        message: errorMessage
      });
    }
  });

  // Get public memo key for account
  app.get("/api/hive/account/:username/memo-key", async (req, res) => {
    try {
      const { username } = req.params;
      
      const memoKey = await hiveClient.getPublicMemoKey(username);
      
      if (!memoKey) {
        return res.status(404).json({ 
          error: "Account not found",
          message: `Hive account '${username}' does not exist or has no memo key`
        });
      }
      
      res.json({ 
        username,
        memoKey
      });
    } catch (error) {
      console.error("Error fetching memo key:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage.includes("Invalid username format")) {
        return res.status(400).json({ 
          error: "Invalid username",
          message: errorMessage
        });
      }
      
      res.status(500).json({ 
        error: "Failed to fetch memo key",
        message: errorMessage
      });
    }
  });

  // Get account history with transfer operations
  app.get("/api/hive/account/:username/history", async (req, res) => {
    try {
      const { username } = req.params;
      const { limit = "100" } = req.query;
      
      const limitNum = parseInt(limit as string, 10);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        return res.status(400).json({ 
          error: "Invalid limit",
          message: "Limit must be a number between 1 and 1000"
        });
      }
      
      // Verify account exists first
      const accountExists = await hiveClient.verifyAccountExists(username);
      
      if (!accountExists) {
        return res.status(404).json({ 
          error: "Account not found",
          message: `Hive account '${username}' does not exist`
        });
      }
      
      // Fetch account history
      const history = await hiveClient.getAccountHistory(username, limitNum);
      
      // Filter for transfer operations only
      const transfers = hiveClient.filterTransferOperations(history);
      
      res.json({ 
        username,
        transfers,
        totalOperations: history.length,
        transferCount: transfers.length
      });
    } catch (error) {
      console.error("Error fetching history:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage.includes("Invalid username format")) {
        return res.status(400).json({ 
          error: "Invalid username",
          message: errorMessage
        });
      }
      
      res.status(500).json({ 
        error: "Failed to fetch history",
        message: errorMessage
      });
    }
  });

  // Simulate encrypted message transfer
  app.post("/api/hive/transfer", async (req, res) => {
    try {
      const { from, to, amount, memo } = req.body;
      
      // In production, Hive Keychain handles this directly from frontend
      // This endpoint is for testing/simulation only
      
      res.json({ 
        success: true, 
        trx_id: `test-${Date.now()}`,
        block_num: Math.floor(Math.random() * 1000000)
      });
    } catch (error) {
      console.error("Error processing transfer:", error);
      res.status(500).json({ error: "Failed to process transfer" });
    }
  });

  // Get contacts for a user
  app.get("/api/contacts/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const contacts = await storage.getContacts(username);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // Add a contact
  app.post("/api/contacts/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const contactData = req.body;
      const contact = await storage.addContact(username, contactData);
      res.json(contact);
    } catch (error) {
      console.error("Error adding contact:", error);
      res.status(500).json({ error: "Failed to add contact" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
