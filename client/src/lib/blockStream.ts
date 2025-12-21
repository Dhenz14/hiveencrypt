import { Client, BlockchainMode } from '@hiveio/dhive';
import { hiveClient as sharedHiveClient } from './hiveClient';
import { logger } from './logger';

type BlockHandler = (block: any, blockNum: number) => void;
type OperationHandler = (op: any, blockNum: number, txId: string) => void;

interface StreamConfig {
  onBlock?: BlockHandler;
  onOperation?: OperationHandler;
  operationTypes?: string[];
  mode?: 'latest' | 'irreversible';
}

interface StreamState {
  isStreaming: boolean;
  lastBlockNum: number;
  startTime: Date | null;
  blocksProcessed: number;
  opsProcessed: number;
}

// Best Hive RPC nodes ordered by reliability (from beacon.peakd.com monitoring)
const API_NODES = [
  'https://api.hive.blog',         // Official - 100% score
  'https://api.deathwing.me',      // 100% score
  'https://api.openhive.network',  // 100% score
  'https://techcoderx.com',        // 100% score
  'https://hiveapi.actifit.io',    // 100% score
  'https://rpc.mahdiyari.info',    // 100% score
  'https://api.syncad.com',        // 100% score
  'https://anyx.io',               // 88% score - fallback only
];

function parseBlockNumber(blockId: string): number {
  if (!blockId || blockId.length < 8) return 0;
  const hexBytes = blockId.slice(0, 8);
  const b0 = parseInt(hexBytes.slice(0, 2), 16);
  const b1 = parseInt(hexBytes.slice(2, 4), 16);
  const b2 = parseInt(hexBytes.slice(4, 6), 16);
  const b3 = parseInt(hexBytes.slice(6, 8), 16);
  return (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
}

class BlockStreamManager {
  private client: Client;
  private currentNodeIndex: number = 0;
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private handlers: Map<string, StreamConfig> = new Map();
  private state: StreamState = {
    isStreaming: false,
    lastBlockNum: 0,
    startTime: null,
    blocksProcessed: 0,
    opsProcessed: 0,
  };
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY_BASE = 1000;

  constructor() {
    const bestNode = this.getBestNodeFromHiveClient();
    this.client = new Client([bestNode]);
    logger.info('[BLOCK STREAM] Initialized with node:', bestNode);
  }

  private getBestNodeFromHiveClient(): string {
    try {
      return sharedHiveClient.getBestNodeUrl();
    } catch (e) {
      logger.debug('[BLOCK STREAM] Could not get best node from hiveClient, using fallback');
      return API_NODES[this.currentNodeIndex % API_NODES.length];
    }
  }

  private rotateToNextNode(): void {
    this.currentNodeIndex = (this.currentNodeIndex + 1) % API_NODES.length;
    const nextNode = this.getBestNodeFromHiveClient();
    this.client = new Client([nextNode]);
    logger.info('[BLOCK STREAM] Rotated to node:', nextNode);
  }

  subscribe(id: string, config: StreamConfig): () => void {
    this.handlers.set(id, config);
    logger.info('[BLOCK STREAM] Subscribed handler:', id, 'operationTypes:', config.operationTypes);

    if (!this.isRunning && this.handlers.size > 0) {
      this.startStream();
    }

    return () => this.unsubscribe(id);
  }

  unsubscribe(id: string): void {
    this.handlers.delete(id);
    logger.info('[BLOCK STREAM] Unsubscribed handler:', id);

    if (this.handlers.size === 0) {
      this.stopStream();
    }
  }

  private async startStream(): Promise<void> {
    if (this.isRunning) return;

    const bestNode = this.getBestNodeFromHiveClient();
    this.client = new Client([bestNode]);
    logger.info('[BLOCK STREAM] Using best node for stream:', bestNode);

    this.isRunning = true;
    this.abortController = new AbortController();
    this.state.isStreaming = true;
    this.state.startTime = new Date();
    this.reconnectAttempts = 0;

    logger.info('[BLOCK STREAM] Starting block stream...');

    try {
      await this.runStream();
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        logger.info('[BLOCK STREAM] Stream aborted gracefully');
        return;
      }
      logger.error('[BLOCK STREAM] Stream error:', error);
      await this.handleReconnect();
    }
  }

  private async runStream(): Promise<void> {
    const mode: BlockchainMode = BlockchainMode.Latest;

    for await (const block of this.client.blockchain.getBlocks({ mode })) {
      if (!this.isRunning || this.abortController?.signal.aborted) break;

      const blockNum = parseBlockNumber(block.block_id);
      this.state.lastBlockNum = blockNum;
      this.state.blocksProcessed++;

      const handlerEntries = Array.from(this.handlers.entries());
      for (const [id, config] of handlerEntries) {
        if (config.onBlock) {
          try {
            config.onBlock(block, blockNum);
          } catch (error) {
            logger.error('[BLOCK STREAM] Handler error (onBlock):', id, error);
          }
        }

        if (config.onOperation && block.transactions) {
          for (const tx of block.transactions) {
            const txId = (tx as any).transaction_id || '';

            for (const op of (tx.operations as any[])) {
              const [opType, opData] = op as [string, any];

              if (!config.operationTypes || config.operationTypes.includes(opType)) {
                try {
                  config.onOperation({ type: opType, ...opData }, blockNum, txId);
                  this.state.opsProcessed++;
                } catch (error) {
                  logger.error('[BLOCK STREAM] Handler error (onOperation):', id, error);
                }
              }
            }
          }
        }
      }

      this.reconnectAttempts = 0;
    }
  }

  private async handleReconnect(): Promise<void> {
    if (!this.isRunning || this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error('[BLOCK STREAM] Max reconnect attempts reached, stopping stream');
      this.stopStream();
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY_BASE * Math.pow(2, this.reconnectAttempts - 1);

    this.rotateToNextNode();
    logger.info(`[BLOCK STREAM] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    if (this.isRunning) {
      try {
        await this.runStream();
      } catch (error) {
        logger.error('[BLOCK STREAM] Reconnect failed:', error);
        await this.handleReconnect();
      }
    }
  }

  private stopStream(): void {
    this.isRunning = false;
    this.state.isStreaming = false;
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    logger.info('[BLOCK STREAM] Stream stopped. Stats:', {
      blocksProcessed: this.state.blocksProcessed,
      opsProcessed: this.state.opsProcessed,
      runtime: this.state.startTime
        ? `${Math.round((Date.now() - this.state.startTime.getTime()) / 1000)}s`
        : 'N/A',
    });
  }

  forceStop(): void {
    this.handlers.clear();
    this.stopStream();
  }

  getState(): StreamState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const blockStreamManager = new BlockStreamManager();

export function subscribeToTransfers(
  username: string,
  onTransfer: (transfer: any, blockNum: number, txId: string) => void
): () => void {
  return blockStreamManager.subscribe(`transfers-${username}`, {
    operationTypes: ['transfer'],
    onOperation: (op, blockNum, txId) => {
      if (op.to === username || op.from === username) {
        logger.info('[BLOCK STREAM] Transfer detected for', username, ':', op.from, '->', op.to);
        onTransfer(op, blockNum, txId);
      }
    },
  });
}

export function subscribeToCustomJson(
  username: string,
  jsonIds: string[],
  onCustomJson: (data: any, blockNum: number, txId: string) => void
): () => void {
  return blockStreamManager.subscribe(`custom_json-${username}`, {
    operationTypes: ['custom_json'],
    onOperation: (op, blockNum, txId) => {
      if (jsonIds.includes(op.id)) {
        const requiredAuths = op.required_auths || [];
        const requiredPostingAuths = op.required_posting_auths || [];
        const allAuths = [...requiredAuths, ...requiredPostingAuths];

        if (allAuths.includes(username)) {
          try {
            const parsedJson = JSON.parse(op.json);
            logger.info('[BLOCK STREAM] Custom JSON detected:', op.id, 'for', username);
            onCustomJson({ ...op, parsedJson }, blockNum, txId);
          } catch (e) {
            logger.warn('[BLOCK STREAM] Failed to parse custom_json:', e);
          }
        }
      }
    },
  });
}

export function subscribeToGroupOperations(
  username: string,
  onGroupOp: (data: any, blockNum: number, txId: string) => void
): () => void {
  return blockStreamManager.subscribe(`group-ops-${username}`, {
    operationTypes: ['transfer', 'custom_json'],
    onOperation: (op, blockNum, txId) => {
      if (op.type === 'transfer') {
        if (op.to === username && op.memo?.startsWith('#')) {
          logger.info('[BLOCK STREAM] Potential group message for', username);
          onGroupOp({ type: 'transfer', ...op }, blockNum, txId);
        }
      } else if (op.type === 'custom_json' && op.id === 'hive_messenger_groups') {
        const requiredAuths = op.required_auths || [];
        const requiredPostingAuths = op.required_posting_auths || [];
        const allAuths = [...requiredAuths, ...requiredPostingAuths];

        try {
          const parsedJson = JSON.parse(op.json);
          if (parsedJson.groupId || parsedJson.action) {
            logger.info('[BLOCK STREAM] Group operation detected:', parsedJson.action);
            onGroupOp({ type: 'custom_json', ...op, parsedJson }, blockNum, txId);
          }
        } catch (e) {
          logger.warn('[BLOCK STREAM] Failed to parse group custom_json');
        }
      }
    },
  });
}
