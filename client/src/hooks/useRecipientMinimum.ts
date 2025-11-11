/**
 * useRecipientMinimum Hook
 * 
 * React hook for fetching a recipient's minimum HBD requirement
 * Used by MessageComposer to validate send amounts before broadcast
 * 
 * Phase 3 of Minimum HBD Filter Feature (v2.0.0)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getAccountMetadata,
  parseMinimumHBD,
  DEFAULT_MINIMUM_HBD,
} from '@/lib/accountMetadata';

/**
 * Hook return type
 */
export interface UseRecipientMinimumResult {
  recipientMinimum: string;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for fetching a recipient's minimum HBD requirement
 * 
 * Features:
 * - Fetches recipient's account metadata
 * - Parses their minimum HBD setting
 * - Returns default (0.001) if not set
 * - Caches results for performance
 * - Automatically refetches on stale data
 * 
 * @param recipientUsername - Hive username to fetch minimum for
 * @returns UseRecipientMinimumResult
 */
export function useRecipientMinimum(
  recipientUsername: string | null | undefined
): UseRecipientMinimumResult {
  const {
    data: metadata,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['recipientMinimum', recipientUsername],
    queryFn: async () => {
      if (!recipientUsername) {
        throw new Error('No recipient username provided');
      }
      return await getAccountMetadata(recipientUsername);
    },
    enabled: !!recipientUsername,
    staleTime: 10 * 60 * 1000, // Consider fresh for 10 minutes
    gcTime: 30 * 60 * 1000,    // Keep in cache for 30 minutes
    retry: 2,                   // Retry failed requests twice
  });
  
  // Parse recipient's minimum (with fallback to default)
  const recipientMinimum = parseMinimumHBD(metadata) || DEFAULT_MINIMUM_HBD;
  
  return {
    recipientMinimum,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
