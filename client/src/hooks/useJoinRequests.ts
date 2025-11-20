import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { scanGroupJoinRequests, scanPendingJoinRequests } from '@/lib/joinRequestDiscovery';
import type { JoinRequest } from '@shared/schema';

/**
 * React Query hook for fetching ALL pending join requests for a group
 * Used by ManageMembersModal for group creators/moderators to review requests
 * 
 * @param groupId - Group identifier
 * @param creatorUsername - Username of the group creator
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with pending join requests
 */
export function useJoinRequests(
  groupId: string,
  creatorUsername: string,
  enabled = true
) {
  return useQuery({
    queryKey: ['joinRequests', groupId],
    queryFn: () => scanGroupJoinRequests(groupId, creatorUsername),
    enabled: enabled && !!groupId && !!creatorUsername,
    refetchInterval: 30000, // Poll every 30 seconds for new requests
    staleTime: 20000, // Consider data stale after 20 seconds
    retry: 2, // Retry failed requests twice
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
  });
}

/**
 * React Query hook for checking if current user has pending join requests
 * Used by JoinGroupButton to determine button state
 * 
 * @param groupId - Group identifier
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with user's pending requests for this group
 */
export function useUserPendingRequests(
  groupId: string,
  enabled = true
) {
  const { user } = useAuth();

  return useQuery<JoinRequest[]>({
    queryKey: ['userPendingRequests', groupId, user?.username],
    queryFn: async () => {
      if (!user?.username) {
        return [];
      }
      return scanPendingJoinRequests(groupId, user.username);
    },
    enabled: enabled && !!groupId && !!user?.username,
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 20000, // Consider data stale after 20 seconds
    retry: 2, // Retry failed requests twice
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
  });
}
