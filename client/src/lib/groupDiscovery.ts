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
const PRIMARY_TAG = 'hive-messenger';
const DISCOVERY_TAG = 'group-discovery';
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
  
  return new Promise((resolve) => {
    // Use requestPost for creating a Hive post
    // This is the proper Keychain method for posting
    window.hive_keychain.requestPost(
      username,           // account name
      title,              // post title
      body,               // post body (markdown)
      PRIMARY_TAG,        // parent_permlink (category/first tag)
      null,               // parent_author (null for root posts)
      JSON.stringify(metadata), // json_metadata as string
      permlink,           // unique permlink
      null,               // comment_options (optional)
      (response: any) => {
        if (response.success) {
          logger.info('[GROUP DISCOVERY] ✅ Group published successfully:', response.result);
          resolve({ success: true, permlink });
        } else {
          logger.error('[GROUP DISCOVERY] ❌ Failed to publish group:', response.message);
          resolve({ success: false, error: response.message || 'Failed to publish group' });
        }
      }
    );
  });
}

/**
 * Fetch discoverable groups from Hivemind
 */
export async function fetchDiscoverableGroups(
  limit: number = 20,
  sortBy: 'created' | 'trending' | 'hot' = 'created'
): Promise<DiscoverableGroup[]> {
  logger.info('[GROUP DISCOVERY] Fetching discoverable groups:', { limit, sortBy });
  
  try {
    // Map sort type to Hivemind API method
    const methodMap: Record<string, string> = {
      created: 'get_discussions_by_created',
      trending: 'get_discussions_by_trending',
      hot: 'get_discussions_by_hot',
    };
    
    const method = methodMap[sortBy] || 'get_discussions_by_created';
    
    // Query Hivemind for posts with our tag
    const discussions = await hiveClient.call('condenser_api', method, [
      {
        tag: PRIMARY_TAG,
        limit,
      },
    ]);
    
    if (!discussions || !Array.isArray(discussions)) {
      logger.warn('[GROUP DISCOVERY] No discussions returned');
      return [];
    }
    
    // Filter and parse group posts
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
  } catch (error) {
    logger.error('[GROUP DISCOVERY] Failed to fetch groups:', error);
    return [];
  }
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
 */
export async function isGroupPublished(
  creator: string,
  groupId: string
): Promise<{ published: boolean; permlink?: string }> {
  try {
    // Search for posts by this creator with our tag
    const posts = await hiveClient.call('condenser_api', 'get_discussions_by_blog', [
      {
        tag: creator,
        limit: 100,
      },
    ]);
    
    if (!posts || !Array.isArray(posts)) {
      return { published: false };
    }
    
    for (const post of posts) {
      try {
        const metadata = typeof post.json_metadata === 'string' 
          ? JSON.parse(post.json_metadata) 
          : post.json_metadata;
        
        if (metadata?.hive_messenger?.groupId === groupId) {
          return { published: true, permlink: post.permlink };
        }
      } catch {
        continue;
      }
    }
    
    return { published: false };
  } catch (error) {
    logger.error('[GROUP DISCOVERY] Failed to check if group is published:', error);
    return { published: false };
  }
}
