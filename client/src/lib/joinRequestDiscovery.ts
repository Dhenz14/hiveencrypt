import { hiveClient as optimizedHiveClient } from './hiveClient';
import { GROUP_CUSTOM_JSON_ID } from './groupBlockchain';
import { normalizeHiveTimestamp } from './hive';
import { logger } from './logger';
import type { JoinRequest } from '@shared/schema';

/**
 * Scans blockchain for pending join requests made by a specific user for a group
 * This replaces localStorage tracking for cross-device consistency
 * 
 * @param groupId - Group identifier to filter requests
 * @param username - Username who made the join request
 * @returns Array of pending join requests (newest first)
 */
export async function scanPendingJoinRequests(
  groupId: string,
  username: string
): Promise<JoinRequest[]> {
  logger.info('[JOIN REQUEST DISCOVERY] Scanning for pending requests:', { groupId, username });

  // Define all pre-approval statuses that should be considered "pending"
  const pendingStatuses = ['pending', 'pending_payment_verification', 'approved_free'];

  try {
    // Scan user's custom_json operations for join_request actions
    const history = await optimizedHiveClient.getAccountHistory(
      username,
      1000, // Scan up to 1000 operations (similar to message discovery)
      'custom_json', // Filter only custom_json operations for efficiency
      -1 // Start from latest
    );

    logger.info('[JOIN REQUEST DISCOVERY] Scanned', history.length, 'custom_json operations');

    const pendingRequests: JoinRequest[] = [];
    const approvedRequestIds = new Set<string>(); // Track approved requests to filter them out
    const rejectedRequestIds = new Set<string>(); // Track rejected requests to filter them out

    // First pass: Find all approved/rejected requests for this group
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        // Ensure it's a custom_json operation with our ID
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Track join_approve and join_reject actions
        if (jsonData.action === 'join_approve' && 
            jsonData.groupId === groupId && 
            jsonData.username === username) {
          approvedRequestIds.add(jsonData.requestId);
        }

        if (jsonData.action === 'join_reject' && 
            jsonData.groupId === groupId && 
            jsonData.username === username) {
          rejectedRequestIds.add(jsonData.requestId);
        }
      } catch (parseError) {
        // Skip malformed operations
        continue;
      }
    }

    logger.info('[JOIN REQUEST DISCOVERY] Found', approvedRequestIds.size, 'approved and', rejectedRequestIds.size, 'rejected requests');

    // Second pass: Find pending join_request operations for this group
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        // Ensure it's a custom_json operation with our ID
        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Only process join_request actions for this group and user
        if (jsonData.action !== 'join_request' ||
            jsonData.groupId !== groupId ||
            jsonData.username !== username) {
          continue;
        }

        // Skip if this request was later approved or rejected
        if (approvedRequestIds.has(jsonData.requestId) || 
            rejectedRequestIds.has(jsonData.requestId)) {
          continue;
        }

        // Only include requests with pre-approval statuses (pending, pending_payment_verification, approved_free)
        const status = jsonData.status as JoinRequest['status'];
        if (!pendingStatuses.includes(status)) {
          continue;
        }

        // Create JoinRequest object
        const joinRequest: JoinRequest = {
          requestId: jsonData.requestId,
          username: jsonData.username,
          requestedAt: normalizeHiveTimestamp(jsonData.timestamp || operation[1].timestamp),
          status, // Use actual status from blockchain (not hardcoded 'pending')
          message: jsonData.message,
          txId: operation[1].trx_id,
        };

        pendingRequests.push(joinRequest);
      } catch (parseError) {
        logger.warn('[JOIN REQUEST DISCOVERY] Failed to parse operation:', parseError);
        continue;
      }
    }

    // Deduplicate by requestId (keep newest)
    const deduped = new Map<string, JoinRequest>();
    for (const request of pendingRequests) {
      const existing = deduped.get(request.requestId);
      if (!existing || new Date(request.requestedAt) > new Date(existing.requestedAt)) {
        deduped.set(request.requestId, request);
      }
    }

    // Sort by timestamp (newest first)
    const result = Array.from(deduped.values()).sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

    logger.info('[JOIN REQUEST DISCOVERY] Found', result.length, 'pending requests');
    return result;
  } catch (error) {
    logger.error('[JOIN REQUEST DISCOVERY] Error scanning for pending requests:', error);
    
    // Gracefully handle blockchain errors by returning empty array
    // This prevents the UI from breaking if RPC is down
    return [];
  }
}

/**
 * Scans blockchain for ALL join requests for a group (for creators/moderators to manage)
 * Filters to only pending requests (not approved/rejected)
 * 
 * @param groupId - Group identifier to filter requests
 * @param creatorUsername - Username of the group creator (used for optimized scanning)
 * @returns Array of pending join requests for the group (newest first)
 */
export async function scanGroupJoinRequests(
  groupId: string,
  creatorUsername: string
): Promise<JoinRequest[]> {
  logger.info('[JOIN REQUEST DISCOVERY] Scanning group join requests:', { groupId, creatorUsername });

  try {
    // Scan creator's custom_json operations for join_request/approve/reject actions
    // The creator's account will have all join_approve and join_reject operations
    const history = await optimizedHiveClient.getAccountHistory(
      creatorUsername,
      1000, // Scan up to 1000 operations
      'custom_json', // Filter only custom_json operations for efficiency
      -1 // Start from latest
    );

    logger.info('[JOIN REQUEST DISCOVERY] Scanned', history.length, 'custom_json operations');

    const allRequests = new Map<string, JoinRequest>(); // Map requestId -> JoinRequest
    const approvedRequestIds = new Set<string>();
    const rejectedRequestIds = new Set<string>();
    const requestUsers = new Set<string>(); // Track unique users who made requests

    // First pass: Find all join_approve and join_reject operations for this group
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Track approved requests
        if (jsonData.action === 'join_approve' && jsonData.groupId === groupId) {
          approvedRequestIds.add(jsonData.requestId);
        }

        // Track rejected requests
        if (jsonData.action === 'join_reject' && jsonData.groupId === groupId) {
          rejectedRequestIds.add(jsonData.requestId);
        }
      } catch (parseError) {
        continue;
      }
    }

    logger.info('[JOIN REQUEST DISCOVERY] Found', approvedRequestIds.size, 'approved and', rejectedRequestIds.size, 'rejected requests');

    // Second pass: Find all join_request operations for this group
    // These could be from the creator's history OR we need to scan each requester's history
    // For now, we'll just scan the creator's history for efficiency
    // In a production system, you'd want to maintain an index of pending requests
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Only process join_request actions for this group
        if (jsonData.action !== 'join_request' || jsonData.groupId !== groupId) {
          continue;
        }

        // Track the requesting user
        if (jsonData.username) {
          requestUsers.add(jsonData.username);
        }

        // Skip if this request was later approved or rejected
        if (approvedRequestIds.has(jsonData.requestId) || 
            rejectedRequestIds.has(jsonData.requestId)) {
          continue;
        }

        // Only include pending requests
        if (jsonData.status !== 'pending') {
          continue;
        }

        const joinRequest: JoinRequest = {
          requestId: jsonData.requestId,
          username: jsonData.username,
          requestedAt: normalizeHiveTimestamp(jsonData.timestamp || operation[1].timestamp),
          status: 'pending',
          message: jsonData.message,
          txId: operation[1].trx_id,
        };

        // Deduplicate: keep newest request per requestId
        const existing = allRequests.get(joinRequest.requestId);
        if (!existing || new Date(joinRequest.requestedAt) > new Date(existing.requestedAt)) {
          allRequests.set(joinRequest.requestId, joinRequest);
        }
      } catch (parseError) {
        logger.warn('[JOIN REQUEST DISCOVERY] Failed to parse operation:', parseError);
        continue;
      }
    }

    // OPTIMIZATION: For groups with many pending requests, we could scan each requester's history
    // This would be more accurate but slower. For now, we rely on the creator's history.
    // If a join_request operation doesn't appear in the creator's history, we'll miss it.
    // This is a trade-off between performance and completeness.

    // Sort by timestamp (newest first)
    const result = Array.from(allRequests.values()).sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

    logger.info('[JOIN REQUEST DISCOVERY] Found', result.length, 'pending join requests from', requestUsers.size, 'unique users');
    return result;
  } catch (error) {
    logger.error('[JOIN REQUEST DISCOVERY] Error scanning group join requests:', error);
    
    // Gracefully handle blockchain errors by returning empty array
    return [];
  }
}

/**
 * Checks if a user has a pending join request for a group
 * This is a convenience function that wraps scanPendingJoinRequests
 * 
 * @param groupId - Group identifier
 * @param username - Username to check
 * @returns True if user has a pending request
 */
export async function hasPendingJoinRequest(
  groupId: string,
  username: string
): Promise<boolean> {
  const requests = await scanPendingJoinRequests(groupId, username);
  return requests.length > 0;
}

/**
 * SECURITY FIX: Scans for join_requests that need auto-approval by the creator
 * This is used by the creator's background process to automatically approve
 * requests with status 'approved_free' or 'pending_payment_verification'
 * 
 * @param groupId - Group identifier
 * @param creatorUsername - Username of the group creator (for security - only creator can auto-approve)
 * @returns Array of join requests needing auto-approval
 */
export async function scanAutoApprovalRequests(
  groupId: string,
  creatorUsername: string
): Promise<JoinRequest[]> {
  logger.info('[AUTO APPROVAL] Scanning for auto-approval requests:', { groupId, creatorUsername });

  try {
    // Scan creator's custom_json operations for join_request actions
    // We only scan the creator's history to ensure security - only creator can see these
    const history = await optimizedHiveClient.getAccountHistory(
      creatorUsername,
      1000, // Scan up to 1000 operations
      'custom_json', // Filter only custom_json operations for efficiency
      -1 // Start from latest
    );

    logger.info('[AUTO APPROVAL] Scanned', history.length, 'custom_json operations');

    const autoApprovalRequests: JoinRequest[] = [];
    const approvedRequestIds = new Set<string>(); // Track already approved requests

    // First pass: Find all join_approve operations to avoid duplicate approvals
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Track approved requests
        if (jsonData.action === 'join_approve' && jsonData.groupId === groupId) {
          approvedRequestIds.add(jsonData.requestId);
        }
      } catch (parseError) {
        continue;
      }
    }

    logger.info('[AUTO APPROVAL] Found', approvedRequestIds.size, 'already approved requests');

    // Second pass: Find join_request operations with auto-approval statuses
    for (const [, operation] of history) {
      try {
        if (!operation || !operation[1] || !operation[1].op) {
          continue;
        }

        const op = operation[1].op;

        if (op[0] !== 'custom_json' || op[1].id !== GROUP_CUSTOM_JSON_ID) {
          continue;
        }

        const jsonData = JSON.parse(op[1].json);

        // Only process join_request actions for this group
        if (jsonData.action !== 'join_request' || jsonData.groupId !== groupId) {
          continue;
        }

        // Skip if this request was already approved
        if (approvedRequestIds.has(jsonData.requestId)) {
          continue;
        }

        // Only include requests with auto-approval statuses
        if (jsonData.status !== 'approved_free' && 
            jsonData.status !== 'pending_payment_verification') {
          continue;
        }

        const joinRequest: JoinRequest = {
          requestId: jsonData.requestId,
          username: jsonData.username,
          requestedAt: normalizeHiveTimestamp(jsonData.timestamp || operation[1].timestamp),
          status: jsonData.status,
          message: jsonData.message,
          txId: operation[1].trx_id,
          memberPayment: jsonData.memberPayment, // Include payment proof if present
        };

        autoApprovalRequests.push(joinRequest);
      } catch (parseError) {
        logger.warn('[AUTO APPROVAL] Failed to parse operation:', parseError);
        continue;
      }
    }

    // Deduplicate by requestId (keep newest)
    const deduped = new Map<string, JoinRequest>();
    for (const request of autoApprovalRequests) {
      const existing = deduped.get(request.requestId);
      if (!existing || new Date(request.requestedAt) > new Date(existing.requestedAt)) {
        deduped.set(request.requestId, request);
      }
    }

    // Sort by timestamp (oldest first - FIFO for fairness)
    const result = Array.from(deduped.values()).sort(
      (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
    );

    logger.info('[AUTO APPROVAL] Found', result.length, 'requests needing auto-approval');
    return result;
  } catch (error) {
    logger.error('[AUTO APPROVAL] Error scanning for auto-approval requests:', error);
    
    // Gracefully handle blockchain errors by returning empty array
    return [];
  }
}
