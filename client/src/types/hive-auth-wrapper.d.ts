/**
 * Type declarations for hive-auth-wrapper
 */

declare module 'hive-auth-wrapper' {
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

  export interface HASEvent {
    cmd: string;
    account: string;
    uuid: string;
    key: string;
    host: string;
    [key: string]: any;
  }

  export interface HASResult {
    success: boolean;
    result?: any;
    message?: string;
    error?: string;
    token?: string;
    expire?: number;
    key?: string;
  }

  const HAS: {
    authenticate: (
      auth: HASAuthData,
      appMeta: HASAppMeta,
      onWaiting?: (evt: HASEvent) => void
    ) => Promise<HASAuthData>;

    broadcast: (
      auth: HASAuthData,
      keyType: 'posting' | 'active' | 'memo',
      operations: any[],
      onWaiting?: (evt: HASEvent) => void
    ) => Promise<any>;

    signChallenge: (
      auth: HASAuthData,
      challenge: string,
      keyType: 'posting' | 'active' | 'memo'
    ) => Promise<any>;
  };

  export default HAS;
}
