/**
 * Keychain Platform Detection
 * 
 * Detects which Keychain environment the app is running in:
 * 1. Desktop browser with Keychain extension
 * 2. Keychain Mobile in-app browser (has window.hive_keychain injected)
 * 3. Regular mobile browser (needs redirect to Keychain Mobile)
 */

export type KeychainPlatform = 
  | 'desktop-extension'      // Desktop browser with Keychain extension
  | 'keychain-mobile-browser' // Keychain Mobile in-app browser
  | 'mobile-redirect';        // Regular mobile browser (needs redirect)

/**
 * Checks if the device is mobile based on user agent
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  
  console.log('[Platform Detection] User Agent:', userAgent);
  console.log('[Platform Detection] Is Mobile:', isMobile);
  
  return isMobile;
}

/**
 * Waits for Keychain API to be injected (with timeout)
 * Both desktop extension and Keychain Mobile browser inject window.hive_keychain
 */
async function waitForKeychainInjection(maxWaitMs: number = 500): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (window.hive_keychain) {
      console.log('[Keychain Detection] window.hive_keychain found after', Date.now() - startTime, 'ms');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log('[Keychain Detection] window.hive_keychain not found after', maxWaitMs, 'ms');
  return false;
}

/**
 * Verifies Keychain is responsive by calling requestHandshake()
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
          console.log('[Keychain Detection] Handshake successful');
          resolve(true);
        }
      });
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[Keychain Detection] Handshake timeout');
          resolve(false);
        }
      }, 3000);
    } catch (error) {
      console.error('[Keychain Detection] Handshake error:', error);
      resolve(false);
    }
  });
}

/**
 * Detects which Keychain platform the app is running on
 * 
 * @returns Promise<KeychainPlatform>
 * 
 * Flow:
 * 1. Wait 500ms for window.hive_keychain injection
 * 2. If found + handshake successful:
 *    - Mobile device → 'keychain-mobile-browser'
 *    - Desktop → 'desktop-extension'
 * 3. If not found:
 *    - Mobile device → 'mobile-redirect'
 *    - Desktop → throws error (needs extension)
 */
export async function detectKeychainPlatform(): Promise<KeychainPlatform> {
  console.log('[Platform Detection] Starting detection...');
  
  const isMobile = isMobileDevice();
  
  // Wait for Keychain API injection
  const keychainAvailable = await waitForKeychainInjection(500);
  
  if (keychainAvailable) {
    // Verify with handshake
    const handshakeSuccess = await verifyKeychainHandshake();
    
    if (handshakeSuccess) {
      const platform = isMobile ? 'keychain-mobile-browser' : 'desktop-extension';
      console.log('[Platform Detection] ✅ Detected:', platform);
      return platform;
    }
  }
  
  // No Keychain API available
  if (isMobile) {
    console.log('[Platform Detection] ⚠️ Detected: mobile-redirect (needs Keychain Mobile browser)');
    return 'mobile-redirect';
  }
  
  console.log('[Platform Detection] ❌ Desktop without Keychain extension');
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
