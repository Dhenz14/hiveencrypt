/**
 * Group Discovery - Publish and discover groups via Hive posts
 * 
 * Uses Hive's native post system with tags for decentralized group discovery.
 * Groups are published as posts with specific tags that can be queried via Hivemind.
 */

import { hiveClient } from './hiveClient';
import { logger } from './logger';
import type { PaymentSettings } from '@shared/schema';

// Discovery tags
// Note: Tags starting with "hive-" are treated as community tags and don't work well with get_discussions_by_created
// We use 'group-discovery' for querying and 'hive-messenger' as the parent_permlink for community
const PRIMARY_TAG = 'hive-messenger';  // Used as parent_permlink (community)
const DISCOVERY_TAG = 'group-discovery';  // Used for querying (regular tag)
const QUERY_TAG = 'group-discovery';  // Tag used for Hivemind queries
const APP_NAME = 'hive-messenger';
const APP_VERSION = '1.0.0';

/**
 * Published group metadata stored in post json_metadata
 */
export interface PublishedGroupMetadata {
  groupId: string;
  creator: string;
  groupName: string;
  description?: string;
  paymentRequired: boolean;
  paymentAmount?: string;
  paymentType?: 'one_time' | 'recurring';
  recurringInterval?: number;
  autoApprove: boolean;
  memberCount: number;
  publishedAt: string;
}

/**
 * Discoverable group from Hivemind query
 */
export interface DiscoverableGroup {
  groupId: string;
  creator: string;
  groupName: string;
  description: string;
  paymentRequired: boolean;
  paymentAmount?: string;
  paymentType?: 'one_time' | 'recurring';
  recurringInterval?: number;
  autoApprove: boolean;
  memberCount: number;
  publishedAt: string;
  // Post metadata
  author: string;
  permlink: string;
  votes: number;
  comments: number;
  payout: string;
  created: string;
}

/**
 * Generate a unique permlink for group discovery post
 */
function generatePermlink(groupId: string): string {
  const timestamp = Date.now();
  const shortId = groupId.substring(0, 8);
  return `hive-messenger-group-${shortId}-${timestamp}`;
}

// App URL for sharing
const APP_URL = 'https://hive-encrypt-theycallmethank.replit.app';

/**
 * Format the post body with group information - written as a natural social post
 */
function formatPostBody(
  groupName: string,
  description: string,
  groupId: string,
  creator: string,
  paymentSettings?: PaymentSettings,
  memberCount: number = 1
): string {
  const joinLink = `${APP_URL}/join/${groupId}`;
  
  // Start with a friendly, natural announcement
  let body = `Hey everyone! I just created a group called **"${groupName}"** on Hive Messenger and I'd love for you to join!\n\n`;
  
  // Add the description if provided
  if (description) {
    body += `${description}\n\n`;
  }
  
  // Entry fee info in a natural way
  if (paymentSettings?.enabled) {
    body += `The entry fee is **${paymentSettings.amount} HBD**`;
    if (paymentSettings.type === 'recurring' && paymentSettings.recurringInterval) {
      body += ` (renewed every ${paymentSettings.recurringInterval} days)`;
    }
    body += `. `;
    if (paymentSettings.autoApprove) {
      body += `Once you pay, you'll be added automatically - no waiting!\n\n`;
    } else {
      body += `After payment, I'll approve your request to join.\n\n`;
    }
  } else {
    body += `It's completely **free** to join!\n\n`;
  }
  
  // How to join
  body += `### How to Join\n\n`;
  body += `Search for **"${groupName}"** in the app, or use this direct link:\n`;
  body += `**[Join ${groupName}](${joinLink})**\n\n`;
  
  // About Hive Messenger
  body += `---\n\n`;
  body += `### What is Hive Messenger?\n\n`;
  body += `[Hive Messenger](${APP_URL}) is a **decentralized, end-to-end encrypted** messaging app built on the Hive blockchain. `;
  body += `Your messages are private and secure - no central servers, no data mining, just direct blockchain-powered communication.\n\n`;
  
  body += `**Key Features:**\n`;
  body += `- End-to-end encrypted messages using your Hive memo keys\n`;
  body += `- Login securely with Hive Keychain\n`;
  body += `- Group chats with friends and communities\n`;
  body += `- Send Bitcoin tips via Lightning Network\n`;
  body += `- Works on mobile and desktop as a PWA\n`;
  body += `- 100% decentralized - no central server or database\n\n`;
  
  body += `**Get the app:** [${APP_URL}](${APP_URL})\n\n`;
  
  // Group details footer
  body += `---\n\n`;
  body += `**Group Details:**\n`;
  body += `- Created by: @${creator}\n`;
  body += `- Current members: ${memberCount}\n`;
  body += `- Group ID: \`${groupId}\`\n`;
  
  return body;
}

/**
 * Publish a group to the blockchain as a discoverable post
 */
export async function publishGroupToDiscovery(
  username: string,
  groupId: string,
  groupName: string,
  description: string,
  memberCount: number,
  paymentSettings?: PaymentSettings
): Promise<{ success: boolean; permlink?: string; error?: string }> {
  logger.info('[GROUP DISCOVERY] Publishing group:', { groupId, groupName });
  
  if (!window.hive_keychain) {
    return { success: false, error: 'Hive Keychain not installed' };
  }
  
  const permlink = generatePermlink(groupId);
  const title = `Come join "${groupName}" on Hive Messenger!`;
  const body = formatPostBody(groupName, description, groupId, username, paymentSettings, memberCount);
  
  // Build json_metadata with group info
  const metadata: {
    tags: string[];
    app: string;
    format: string;
    hive_messenger: PublishedGroupMetadata;
  } = {
    tags: [PRIMARY_TAG, DISCOVERY_TAG, 'hive', 'messaging', 'chat'],
    app: `${APP_NAME}/${APP_VERSION}`,
    format: 'markdown',
    hive_messenger: {
      groupId,
      creator: username,
      groupName,
      description,
      paymentRequired: paymentSettings?.enabled || false,
      paymentAmount: paymentSettings?.amount,
      paymentType: paymentSettings?.type,
      recurringInterval: paymentSettings?.recurringInterval,
      autoApprove: paymentSettings?.autoApprove ?? true,
      memberCount,
      publishedAt: new Date().toISOString(),
    },
  };
  
  logger.info('[GROUP DISCOVERY] About to call Keychain requestPost with:', {
    username,
    title,
    permlink,
    parent_permlink: PRIMARY_TAG,
  });

  // Timeout for Keychain response (60 seconds to allow user to approve)
  const KEYCHAIN_TIMEOUT = 60000;
  
  return new Promise((resolve) => {
    let resolved = false;
    
    // Set timeout to catch cases where Keychain popup closes without responding
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger.error('[GROUP DISCOVERY] ❌ Keychain request timed out - popup may have closed');
        resolve({ 
          success: false, 
          error: 'Keychain request timed out. The popup may have closed unexpectedly. Please try again and approve the popup when it appears.' 
        });
      }
    }, KEYCHAIN_TIMEOUT);
    
    try {
      // Use requestPost for creating a Hive post
      // This is the proper Keychain method for posting
      // For root posts (not comments), parent_author must be empty string ""
      window.hive_keychain.requestPost(
        username,           // account name
        title,              // post title
        body,               // post body (markdown)
        PRIMARY_TAG,        // parent_permlink (category/first tag)
        '',                 // parent_author (empty string for root posts, NOT null)
        JSON.stringify(metadata), // json_metadata as string
        permlink,           // unique permlink
        '',                 // comment_options (empty string, not null)
        (response: any) => {
          if (resolved) return; // Already timed out
          resolved = true;
          clearTimeout(timeoutId);
          
          if (response.success) {
            logger.info('[GROUP DISCOVERY] ✅ Group published successfully:', response.result);
            resolve({ success: true, permlink });
          } else {
            const errorMsg = response.message || 'Failed to publish group';
            logger.error('[GROUP DISCOVERY] ❌ Failed to publish group:', errorMsg);
            
            // Check for user cancellation
            if (errorMsg.toLowerCase().includes('cancel') || 
                errorMsg.toLowerCase().includes('rejected') ||
                errorMsg.toLowerCase().includes('denied')) {
              resolve({ 
                success: false, 
                error: 'You need to approve the Keychain popup to publish the group. Please try again and click "Approve" when prompted.' 
              });
            } else {
              resolve({ success: false, error: errorMsg });
            }
          }
        }
      );
    } catch (error) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('[GROUP DISCOVERY] ❌ Exception calling Keychain:', errorMsg);
        resolve({ success: false, error: `Keychain error: ${errorMsg}` });
      }
    }
  });
}

// Best Hive RPC nodes ordered by reliability (from beacon.peakd.com monitoring)
const DISCOVERY_NODES = [
  'https://api.hive.blog',         // Official - 100% score
  'https://api.deathwing.me',      // 100% score
  'https://api.openhive.network',  // 100% score
  'https://techcoderx.com',        // 100% score
  'https://hiveapi.actifit.io',    // 100% score
  'https://rpc.mahdiyari.info',    // 100% score
  'https://api.syncad.com',        // 100% score
  'https://anyx.io',               // 88% score - fallback only
];

/**
 * Make a single hedged RPC call to a node
 */
async function hedgedCall<T>(
  node: string,
  method: string,
  params: any,
  timeout: number
): Promise<{ success: true; result: T; node: string } | { success: false; error: string; node: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(node, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: `condenser_api.${method}`,
        params: [params],
        id: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, node };
    }
    
    const data = await response.json();
    
    if (data.error) {
      return { success: false, error: data.error.message || 'RPC error', node };
    }
    
    if (data.result && Array.isArray(data.result)) {
      return { success: true, result: data.result as T, node };
    }
    
    return { success: false, error: 'Invalid response', node };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMsg, node };
  }
}

/**
 * Fetch discoverable groups from Hivemind with HEDGED parallel requests
 * Fires requests to top 3 nodes simultaneously for speed
 */
export async function fetchDiscoverableGroups(
  limit: number = 20,
  sortBy: 'created' | 'trending' | 'hot' = 'created'
): Promise<DiscoverableGroup[]> {
  logger.info('[GROUP DISCOVERY] Fetching discoverable groups:', { limit, sortBy });
  
  // Map sort type to Hivemind API method
  const methodMap: Record<string, string> = {
    created: 'get_discussions_by_created',
    trending: 'get_discussions_by_trending',
    hot: 'get_discussions_by_hot',
  };
  
  const method = methodMap[sortBy] || 'get_discussions_by_created';
  const params = { tag: QUERY_TAG, limit };
  
  logger.info('[GROUP DISCOVERY] Querying with tag:', QUERY_TAG, 'method:', method);
  
  // Phase 1: Hedged parallel requests to top 3 nodes (2s timeout)
  const topNodes = DISCOVERY_NODES.slice(0, 3);
  logger.info('[GROUP DISCOVERY] Hedged parallel requests to:', topNodes.join(', '));
  
  const parallelPromises = topNodes.map(node => hedgedCall<any[]>(node, method, params, 2000));
  const results = await Promise.allSettled(parallelPromises);
  
  // Use first successful result
  let discussions: any[] | null = null;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      discussions = result.value.result;
      logger.info('[GROUP DISCOVERY] Hedged success from:', result.value.node, 'posts:', discussions.length);
      break;
    }
  }
  
  // Phase 2: Sequential fallback if all parallel requests failed
  if (!discussions) {
    logger.warn('[GROUP DISCOVERY] Hedged requests failed, trying sequential fallback');
    const remainingNodes = DISCOVERY_NODES.slice(3);
    
    for (const node of remainingNodes) {
      const result = await hedgedCall<any[]>(node, method, params, 5000);
      if (result.success) {
        discussions = result.result;
        logger.info('[GROUP DISCOVERY] Sequential success from:', result.node, 'posts:', discussions.length);
        break;
      }
      logger.warn('[GROUP DISCOVERY] Sequential failed:', result.node, result.error);
    }
  }
  
  if (!discussions) {
    logger.error('[GROUP DISCOVERY] All nodes failed');
    return [];
  }
  
  // Filter and parse group posts (metadata already in response, no extra calls needed)
  const groups: DiscoverableGroup[] = [];
  
  for (const post of discussions) {
    try {
      // Parse json_metadata
      const metadata = typeof post.json_metadata === 'string' 
        ? JSON.parse(post.json_metadata) 
        : post.json_metadata;
      
      // Check if this is a Hive Messenger group post
      if (!metadata?.hive_messenger?.groupId) {
        continue;
      }
      
      const groupData = metadata.hive_messenger as PublishedGroupMetadata;
      
      groups.push({
        groupId: groupData.groupId,
        creator: groupData.creator,
        groupName: groupData.groupName,
        description: groupData.description || '',
        paymentRequired: groupData.paymentRequired,
        paymentAmount: groupData.paymentAmount,
        paymentType: groupData.paymentType,
        recurringInterval: groupData.recurringInterval,
        autoApprove: groupData.autoApprove,
        memberCount: groupData.memberCount,
        publishedAt: groupData.publishedAt,
        // Post metadata
        author: post.author,
        permlink: post.permlink,
        votes: post.net_votes || 0,
        comments: post.children || 0,
        payout: post.pending_payout_value || '0.000 HBD',
        created: post.created,
      });
    } catch (parseError) {
      // Skip posts that don't have valid group metadata
      continue;
    }
  }
  
  logger.info('[GROUP DISCOVERY] Found', groups.length, 'discoverable groups');
  return groups;
}

/**
 * Search for groups by name or description
 */
export async function searchDiscoverableGroups(
  query: string,
  limit: number = 20
): Promise<DiscoverableGroup[]> {
  // For now, fetch all and filter client-side
  // In the future, could use Hivemind's search API if available
  const allGroups = await fetchDiscoverableGroups(100, 'created');
  
  if (!query.trim()) {
    return allGroups.slice(0, limit);
  }
  
  const lowerQuery = query.toLowerCase();
  
  return allGroups
    .filter(group => 
      group.groupName.toLowerCase().includes(lowerQuery) ||
      group.description.toLowerCase().includes(lowerQuery) ||
      group.creator.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit);
}

/**
 * Check if a group has already been published
 * Uses multiple RPC nodes for resilience
 */
export async function isGroupPublished(
  creator: string,
  groupId: string
): Promise<{ published: boolean; permlink?: string }> {
  logger.debug('[GROUP DISCOVERY] Checking if group is published:', { creator, groupId });
  
  // Hedged parallel request to top 3 nodes for speed
  const topNodes = DISCOVERY_NODES.slice(0, 3);
  const params = { tag: creator, limit: 100 };
  
  const parallelPromises = topNodes.map(node => hedgedCall<any[]>(node, 'get_discussions_by_blog', params, 2000));
  const results = await Promise.allSettled(parallelPromises);
  
  // Check parallel results first
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      const posts = result.value.result;
      for (const post of posts) {
        try {
          const metadata = typeof post.json_metadata === 'string' 
            ? JSON.parse(post.json_metadata) 
            : post.json_metadata;
          
          if (metadata?.hive_messenger?.groupId === groupId) {
            logger.info('[GROUP DISCOVERY] Found existing published group:', post.permlink);
            return { published: true, permlink: post.permlink };
          }
        } catch {
          continue;
        }
      }
      // Successfully checked - group not found
      logger.debug('[GROUP DISCOVERY] Group not yet published');
      return { published: false };
    }
  }
  
  // Sequential fallback to remaining nodes
  const remainingNodes = DISCOVERY_NODES.slice(3);
  for (const node of remainingNodes) {
    const result = await hedgedCall<any[]>(node, 'get_discussions_by_blog', params, 5000);
    if (result.success) {
      for (const post of result.result) {
        try {
          const metadata = typeof post.json_metadata === 'string' 
            ? JSON.parse(post.json_metadata) 
            : post.json_metadata;
          
          if (metadata?.hive_messenger?.groupId === groupId) {
            logger.info('[GROUP DISCOVERY] Found existing published group:', post.permlink);
            return { published: true, permlink: post.permlink };
          }
        } catch {
          continue;
        }
      }
      return { published: false };
    }
  }
  
  // All nodes failed - assume not published to allow user to try publishing
  logger.error('[GROUP DISCOVERY] All RPC nodes failed for publish check - assuming not published');
  return { published: false };
}
