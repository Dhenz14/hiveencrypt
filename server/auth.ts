import crypto from 'crypto';
import { PublicKey, Signature } from '@hiveio/dhive';

// Session interface
export interface Session {
  username: string;
  publicMemoKey: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthChallenge {
  username: string;
  nonce: string;
  message: string;
  createdAt: Date;
  expiresAt: Date;
}

// In-memory session storage
const sessions = new Map<string, Session>();
const authChallenges = new Map<string, AuthChallenge>();

// Session configuration
const SESSION_EXPIRY_DAYS = 7;
const TOKEN_BYTES = 32; // 256 bits
const AUTH_CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function challengeKey(username: string, nonce: string): string {
  return `${normalizeUsername(username)}:${nonce}`;
}

/**
 * Generate a secure random session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

export function createAuthChallenge(username: string): AuthChallenge {
  const normalizedUsername = normalizeUsername(username);
  const nonce = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + AUTH_CHALLENGE_EXPIRY_MS);
  const message = `Hive Encrypt login:${normalizedUsername}:${nonce}`;
  const challenge = { username: normalizedUsername, nonce, message, createdAt, expiresAt };

  authChallenges.set(challengeKey(normalizedUsername, nonce), challenge);
  return challenge;
}

export function isAuthChallengeValid(username: string, message: string): boolean {
  const normalizedUsername = normalizeUsername(username);
  const prefix = `Hive Encrypt login:${normalizedUsername}:`;

  if (!message.startsWith(prefix)) {
    return false;
  }

  const nonce = message.slice(prefix.length);
  const challenge = authChallenges.get(challengeKey(normalizedUsername, nonce));

  if (!challenge) {
    return false;
  }

  if (new Date() > challenge.expiresAt) {
    authChallenges.delete(challengeKey(normalizedUsername, nonce));
    return false;
  }

  return challenge.message === message;
}

export function consumeAuthChallenge(username: string, message: string): boolean {
  if (!isAuthChallengeValid(username, message)) {
    return false;
  }

  const normalizedUsername = normalizeUsername(username);
  const prefix = `Hive Encrypt login:${normalizedUsername}:`;
  const nonce = message.slice(prefix.length);
  return authChallenges.delete(challengeKey(normalizedUsername, nonce));
}

/**
 * Verify a Keychain signature
 * @param username - Hive username
 * @param message - Message that was signed
 * @param signature - Signature from Keychain
 * @param publicKey - Public key (posting key) from Keychain response
 * @returns boolean indicating if signature is valid
 */
export function verifyKeychainSignature(
  username: string,
  message: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    // Parse the public key
    const pubKey = PublicKey.fromString(publicKey);
    
    // Parse the signature
    const sig = Signature.fromString(signature);
    
    // Verify the signature
    const messageHash = crypto.createHash('sha256').update(message).digest();
    
    return pubKey.verify(messageHash, sig);
  } catch (error) {
    console.error('Error verifying Keychain signature:', error);
    return false;
  }
}

/**
 * Create a new session
 */
export function createSession(username: string, publicMemoKey: string): string {
  const token = generateSessionToken();
  const createdAt = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  sessions.set(token, {
    username: normalizeUsername(username),
    publicMemoKey,
    createdAt,
    expiresAt,
  });

  return token;
}

/**
 * Get session by token
 */
export function getSession(token: string): Session | null {
  const session = sessions.get(token);
  
  if (!session) {
    return null;
  }

  // Check if session has expired
  if (new Date() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Invalidate a session
 */
export function invalidateSession(token: string): boolean {
  return sessions.delete(token);
}

/**
 * Clean up expired sessions (run periodically)
 */
export function cleanupExpiredSessions(): number {
  const now = new Date();
  let removedCount = 0;

  for (const [token, session] of Array.from(sessions.entries())) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      removedCount++;
    }
  }

  return removedCount;
}

export function cleanupExpiredAuthChallenges(): number {
  const now = new Date();
  let removedCount = 0;

  for (const [key, challenge] of Array.from(authChallenges.entries())) {
    if (now > challenge.expiresAt) {
      authChallenges.delete(key);
      removedCount++;
    }
  }

  return removedCount;
}

// Run cleanup every hour
setInterval(() => {
  const removed = cleanupExpiredSessions();
  const removedChallenges = cleanupExpiredAuthChallenges();
  if (removed > 0 || removedChallenges > 0) {
    console.log(`Cleaned up ${removed} expired session(s), ${removedChallenges} expired auth challenge(s)`);
  }
}, 60 * 60 * 1000);

/**
 * Express middleware to require authentication
 */
export function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No authentication token provided'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const session = getSession(token);

  if (!session) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or expired session token'
    });
  }

  // Attach session data to request
  req.session = session;
  req.sessionToken = token;

  next();
}

/**
 * Express middleware to optionally authenticate
 * Sets req.session if valid token is provided, but doesn't reject if missing
 */
export function optionalAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = getSession(token);
    
    if (session) {
      req.session = session;
      req.sessionToken = token;
    }
  }

  next();
}
