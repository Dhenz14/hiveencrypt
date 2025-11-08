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
  const auth: HASAuthData = {
    username,
    token: undefined,
    expire: undefined,
    key: undefined,
  };

  try {
    console.log('[HAS] Starting authentication for:', username);
    
    const result = await HAS.authenticate(auth, getAppMeta(), (evt: any) => {
      console.log('[HAS] Auth event:', evt);
      
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
        
        onAuthPayload({
          deepLink,
          authReq: authReqData,
        });
      }
    });

    console.log('[HAS] Authentication successful:', {
      hasToken: !!result.token,
      expire: result.expire ? new Date(result.expire).toISOString() : null,
    });

    return result;
  } catch (error: any) {
    console.error('[HAS] Authentication failed:', error);
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
