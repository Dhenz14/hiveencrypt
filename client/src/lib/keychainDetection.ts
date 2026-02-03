/**
 * Keychain Platform Detection
 * 
 * Detects which Keychain environment the app is running in:
 * 1. Desktop browser with Keychain extension
 * 2. Keychain Mobile in-app browser (has window.hive_keychain injected)
 * 3. Regular mobile browser (needs redirect to Keychain Mobile)
 * 
 * Platform detection is cached in sessionStorage to prevent re-detection
 * on component remounts, which could cause unexpected auth state changes.
 */

import { logger } from './logger';

export type KeychainPlatform = 
  | 'desktop-extension'      // Desktop browser with Keychain extension
  | 'keychain-mobile-browser' // Keychain Mobile in-app browser
  | 'mobile-redirect';        // Regular mobile browser (needs redirect)

const PLATFORM_CACHE_KEY = 'hive_messenger_platform_cache';
const PLATFORM_CACHE_VERSION = 1;

interface PlatformCache {
  platform: KeychainPlatform;
  version: number;
  timestamp: number;
  userAgent: string;
}

/**
 * Checks if the device is mobile based on user agent
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  
  logger.debug('[Platform Detection] User Agent:', userAgent);
  logger.debug('[Platform Detection] Is Mobile:', isMobile);
  
  return isMobile;
}

/**
 * Gets cached platform from sessionStorage
 * Returns null if cache is invalid, expired, or user agent changed
 */
function getCachedPlatform(): KeychainPlatform | null {
  try {
    const cached = sessionStorage.getItem(PLATFORM_CACHE_KEY);
    if (!cached) return null;
    
    const data: PlatformCache = JSON.parse(cached);
    
    // Validate cache version
    if (data.version !== PLATFORM_CACHE_VERSION) {
      logger.debug('[Platform Cache] Version mismatch, invalidating cache');
      return null;
    }
    
    // Validate user agent matches (in case browser context changed)
    if (data.userAgent !== navigator.userAgent) {
      logger.debug('[Platform Cache] User agent changed, invalidating cache');
      return null;
    }
    
    // For desktop-extension and keychain-mobile-browser, verify Keychain is still available
    // This handles edge cases where extension was disabled after initial detection
    if (data.platform === 'desktop-extension' || data.platform === 'keychain-mobile-browser') {
      if (!window.hive_keychain) {
        logger.debug('[Platform Cache] Keychain no longer available, invalidating cache');
        return null;
      }
    }
    
    logger.debug('[Platform Cache] Using cached platform:', data.platform);
    return data.platform;
  } catch (error) {
    logger.warn('[Platform Cache] Failed to read cache:', error);
    return null;
  }
}

/**
 * Saves platform detection result to sessionStorage
 */
function cachePlatform(platform: KeychainPlatform): void {
  try {
    const cache: PlatformCache = {
      platform,
      version: PLATFORM_CACHE_VERSION,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };
    sessionStorage.setItem(PLATFORM_CACHE_KEY, JSON.stringify(cache));
    logger.debug('[Platform Cache] Cached platform:', platform);
  } catch (error) {
    logger.warn('[Platform Cache] Failed to cache platform:', error);
  }
}

/**
 * Clears the platform cache (useful for logout or debugging)
 */
export function clearPlatformCache(): void {
  try {
    sessionStorage.removeItem(PLATFORM_CACHE_KEY);
    logger.debug('[Platform Cache] Cache cleared');
  } catch (error) {
    logger.warn('[Platform Cache] Failed to clear cache:', error);
  }
}

/**
 * Waits for Keychain API to be injected (with timeout)
 * Both desktop extension and Keychain Mobile browser inject window.hive_keychain
 */
async function waitForKeychainInjection(maxWaitMs: number = 500): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (window.hive_keychain) {
      logger.debug('[Keychain Detection] window.hive_keychain found after', Date.now() - startTime, 'ms');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  logger.debug('[Keychain Detection] window.hive_keychain not found after', maxWaitMs, 'ms');
  return false;
}

/**
 * Verifies Keychain is responsive by calling requestHandshake()
 * Extended timeout (5s) to account for slow Keychain responses
 */
async function verifyKeychainHandshake(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!window.hive_keychain) {
        resolve(false);
        return;
      }
      
      let resolved = false;
      
      window.hive_keychain.requestHandshake(() => {
        if (!resolved) {
          resolved = true;
          logger.debug('[Keychain Detection] Handshake successful');
          resolve(true);
        }
      });
      
      // Extended timeout (5 seconds) to handle slow Keychain responses
      // This prevents false-negative detection when Keychain is busy
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.warn('[Keychain Detection] Handshake timeout after 5s');
          resolve(false);
        }
      }, 5000);
    } catch (error) {
      logger.error('[Keychain Detection] Handshake error:', error);
      resolve(false);
    }
  });
}

/**
 * Detects which Keychain platform the app is running on
 * 
 * Uses session-persistent caching to prevent re-detection on component remounts.
 * This is critical for preventing the "auto-exit" bug where platform detection
 * could fail on remount and incorrectly trigger a redirect.
 * 
 * @param forceRedetect - If true, bypasses cache and re-detects platform
 * @returns Promise<KeychainPlatform>
 * 
 * Flow:
 * 1. Check sessionStorage cache first
 * 2. If no valid cache, wait 500ms for window.hive_keychain injection
 * 3. If found + handshake successful:
 *    - Mobile device → 'keychain-mobile-browser'
 *    - Desktop → 'desktop-extension'
 * 4. If not found:
 *    - Mobile device → 'mobile-redirect'
 *    - Desktop → throws error (needs extension)
 */
export async function detectKeychainPlatform(forceRedetect: boolean = false): Promise<KeychainPlatform> {
  logger.debug('[Platform Detection] Starting detection... (forceRedetect:', forceRedetect, ')');
  
  // Check cache first (unless forced redetect)
  if (!forceRedetect) {
    const cachedPlatform = getCachedPlatform();
    if (cachedPlatform) {
      logger.info('[Platform Detection] ✅ Using cached platform:', cachedPlatform);
      return cachedPlatform;
    }
  }
  
  const isMobile = isMobileDevice();
  
  // Wait for Keychain API injection
  const keychainAvailable = await waitForKeychainInjection(500);
  
  if (keychainAvailable) {
    // Verify with handshake
    const handshakeSuccess = await verifyKeychainHandshake();
    
    if (handshakeSuccess) {
      const platform = isMobile ? 'keychain-mobile-browser' : 'desktop-extension';
      logger.info('[Platform Detection] ✅ Detected:', platform);
      cachePlatform(platform);
      return platform;
    }
    
    // Keychain API present but handshake failed - could be temporary
    // On desktop, treat as having extension but DON'T cache the result
    // This allows next detection attempt to verify properly
    if (!isMobile) {
      logger.warn('[Platform Detection] Keychain present but handshake failed - not caching, user can retry');
      return 'desktop-extension';
    }
  }
  
  // No Keychain API available
  if (isMobile) {
    logger.warn('[Platform Detection] ⚠️ Detected: mobile-redirect (needs Keychain Mobile browser)');
    cachePlatform('mobile-redirect');
    return 'mobile-redirect';
  }
  
  logger.warn('[Platform Detection] ❌ Desktop without Keychain extension');
  throw new Error('Please install Hive Keychain extension from https://hive-keychain.com');
}

/**
 * Checks if Keychain is currently available (synchronous check)
 */
export function isKeychainAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.hive_keychain;
}

/**
 * Gets the current app URL for deep linking
 */
export function getCurrentAppUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin + window.location.pathname;
}

/**
 * Generates Keychain Mobile deep link to open this app in the in-app browser
 */
export function getKeychainMobileDeepLink(): string {
  const appUrl = getCurrentAppUrl();
  return `hive://browser?url=${encodeURIComponent(appUrl)}`;
}
