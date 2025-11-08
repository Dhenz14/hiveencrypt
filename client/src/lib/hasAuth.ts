/**
 * HAS (Hive Authentication Services) Integration for Mobile PWA
 * Provides mobile-friendly authentication via QR codes and deep linking
 */

import HAS from 'hive-auth-wrapper';

export interface HASAuthData {
  username: string;
  token?: string;
  expire?: number;
  key?: string;
}

export interface HASAppMeta {
  name: string;
  description: string;
  icon: string;
}

// App metadata for HAS authentication
// Using a getter function to avoid accessing window at module scope (breaks SSR/build)
export const getAppMeta = (): HASAppMeta => ({
  name: 'Hive Messenger',
  description: 'Decentralized encrypted messaging on Hive blockchain',
  icon: typeof window !== 'undefined' ? `${window.location.origin}/favicon.png` : '/favicon.png',
});

// Check if user is on mobile device
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || (window.innerWidth <= 768);
};

export interface HASAuthPayload {
  qrCode?: string;  // QR code data URL
  deepLink?: string;  // Deep link URL for mobile app
  authReq?: any;  // Raw auth request data
}

/**
 * Authenticate user via HAS (for mobile users)
 * Shows QR code or deep link for mobile wallet apps
 */
export const authenticateWithHAS = async (
  username: string,
  onAuthPayload?: (payload: HASAuthPayload) => void
): Promise<HASAuthData> => {
  // Initial auth object - only username, no other fields
  // HAS library will MUTATE this object (adds token, expire, and key after successful auth)
  const auth: any = {
    username,
  };

  try {
    console.log('[HAS] Starting authentication for:', username);
    console.log('[HAS] Auth object:', JSON.stringify(auth));
    console.log('[HAS] App meta:', JSON.stringify(getAppMeta()));
    
    // CRITICAL: Must pass null (not undefined) for challenge_data when using callback
    // The library doesn't type-check parameters - it assumes 3rd param is challenge_data
    // Passing null makes the assertion pass: !null = true, skips validation
    
    // Wrap callback to catch and log errors (don't let callback errors crash auth)
    const safeCallback = (evt: any) => {
      try {
        console.log('[HAS] Auth event received:', evt);
        
        // HAS library provides auth request data in the event
        // evt contains: { uuid, expire, key, host, ... }
        if (evt && onAuthPayload) {
          // Generate deep link URL for mobile apps
          const authReqData = {
            account: username,
            uuid: evt.uuid,
            key: evt.key,
            host: evt.host || 'wss://hive-auth.arcange.eu',
          };
          
          const deepLink = `has://auth_req/${btoa(JSON.stringify(authReqData))}`;
          
          console.log('[HAS] Calling onAuthPayload with deep link');
          onAuthPayload({
            deepLink,
            authReq: authReqData,
          });
        }
      } catch (callbackError) {
        console.error('[HAS] Callback error (non-fatal):', callbackError);
        // Don't re-throw - callback errors shouldn't break authentication
      }
    };
    
    // @ts-expect-error - HAS library TypeScript definitions are incomplete (missing 4th callback parameter)
    await HAS.authenticate(auth, getAppMeta(), null, safeCallback);

    // CRITICAL BUG FIX: The library resolves with req_ack, but MUTATES the auth object
    // We need to return the MUTATED auth object, not the result
    // After successful auth, auth now has: { username, token, expire, key }
    console.log('[HAS] Authentication successful:', {
      username: auth.username,
      hasToken: !!auth.token,
      hasKey: !!auth.key,
      expire: auth.expire ? new Date(auth.expire).toISOString() : null,
    });

    // Return the mutated auth object with token, expire, and key populated
    return {
      username: auth.username,
      token: auth.token,
      expire: auth.expire,
      key: auth.key,
    };
  } catch (error: any) {
    console.error('[HAS] Authentication failed:', error);
    
    // Provide more specific error messages
    if (error?.message === 'expired') {
      throw new Error('Authentication timed out after 60 seconds. Please try again.');
    }
    
    throw new Error(error?.message || 'HAS authentication failed');
  }
};

/**
 * Broadcast a transfer operation via HAS
 */
export const broadcastTransferWithHAS = async (
  auth: HASAuthData,
  from: string,
  to: string,
  amount: string,
  memo: string,
  onWaiting?: (data: any) => void
): Promise<any> => {
  const op = [
    'transfer',
    {
      from,
      to,
      amount,
      memo,
    },
  ];

  try {
    console.log('[HAS] Broadcasting transfer...');
    
    const result = await HAS.broadcast(
      auth,
      'active', // Key type for transfers
      [op],
      (evt: any) => {
        console.log('[HAS] Waiting for signature:', evt);
        if (onWaiting) {
          onWaiting(evt);
        }
      }
    );

    console.log('[HAS] Transfer successful:', result);
    return result;
  } catch (error: any) {
    console.error('[HAS] Transfer failed:', error);
    throw new Error(error?.message || 'Transfer failed');
  }
};

/**
 * Encode a message via HAS (for encryption)
 */
export const encodeMessageWithHAS = async (
  auth: HASAuthData,
  receiver: string,
  message: string,
  onWaiting?: (data: any) => void
): Promise<string> => {
  try {
    console.log('[HAS] Encoding message for:', receiver);
    
    // HAS uses custom operations for encoding
    const result = await HAS.broadcast(
      auth,
      'posting',
      [
        [
          'custom_json',
          {
            required_auths: [],
            required_posting_auths: [auth.username],
            id: 'hive_messenger_encode',
            json: JSON.stringify({
              receiver,
              message,
            }),
          },
        ],
      ],
      (evt: any) => {
        if (onWaiting) {
          onWaiting(evt);
        }
      }
    );

    console.log('[HAS] Message encoded:', result);
    return result.result;
  } catch (error: any) {
    console.error('[HAS] Encoding failed:', error);
    throw new Error(error?.message || 'Message encoding failed');
  }
};

/**
 * Check if HAS token is still valid
 */
export const isHASTokenValid = (auth: HASAuthData): boolean => {
  if (!auth.token || !auth.expire) {
    return false;
  }
  
  return auth.expire > Date.now();
};

/**
 * Generate QR code data for HAS authentication
 */
export const generateHASQRData = (authPayload: any): string => {
  const encoded = btoa(JSON.stringify(authPayload));
  return `has://auth_req/${encoded}`;
};
