import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import type { Message, Conversation } from "@shared/schema";
import { hiveClient } from "../client/src/lib/hiveClient";

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Create a new conversation
  app.post("/api/conversations", async (req, res) => {
    try {
      const conversationData = req.body;
      const conversation = await storage.createConversation(conversationData);
      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Get messages for a conversation
  app.get("/api/conversations/:conversationId/messages", async (req, res) => {
    try {
      const { conversationId } = req.params;
      const messages = await storage.getMessages(conversationId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send a message
  app.post("/api/messages", async (req, res) => {
    try {
      const messageData = req.body;
      const message = await storage.createMessage(messageData);
      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ error: "Failed to create message" });
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
