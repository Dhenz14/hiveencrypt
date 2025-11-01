import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import type { Message, Conversation } from "@shared/schema";

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
  
  // Validate Hive account exists
  app.get("/api/hive/account/:username", async (req, res) => {
    try {
      const { username } = req.params;
      // This will be called from frontend with dhive directly
      // Backend just validates and caches if needed
      res.json({ exists: true, username });
    } catch (error) {
      console.error("Error validating account:", error);
      res.status(500).json({ error: "Failed to validate account" });
    }
  });

  // Get account history (messages) from Hive blockchain
  app.get("/api/hive/history/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const { limit = "100" } = req.query;
      
      // This endpoint will be used to fetch encrypted messages from blockchain
      // The actual dhive calls will be made from the frontend for better security
      res.json({ history: [], username });
    } catch (error) {
      console.error("Error fetching history:", error);
      res.status(500).json({ error: "Failed to fetch history" });
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
