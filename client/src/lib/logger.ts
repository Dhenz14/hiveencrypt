// Development-only logging utility
// Prevents sensitive data from being logged in production builds

// Support both Vite (import.meta.env.DEV) and Node.js (process.env.NODE_ENV) environments
const isDevelopment = (typeof import.meta !== 'undefined' ? import.meta.env?.DEV : undefined) ?? process.env.NODE_ENV !== 'production';

export const logger = {
  // Use for general info that's safe to log
  info: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  // Use for warnings
  warn: (...args: any[]) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },
  
  // Use for errors (always log these, even in production)
  error: (...args: any[]) => {
    console.error(...args);
  },
  
  // Use for sensitive data like decrypted messages, encryption details
  // This will NEVER log in production
  sensitive: (...args: any[]) => {
    if (isDevelopment) {
      console.log('[SENSITIVE]', ...args);
    }
  }
};
