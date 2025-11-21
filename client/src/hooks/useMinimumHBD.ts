/**
 * useMinimumHBD Hook
 * 
 * React hook for managing user's minimum HBD preference
 * Integrates with React Query for caching and automatic refetching
 * 
 * Phase 2 of Minimum HBD Filter Feature (v2.0.0)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  getAccountMetadata,
  parseMinimumHBD,
  updateMinimumHBD,
  DEFAULT_MINIMUM_HBD,
} from '@/lib/accountMetadata';

/**
 * Hook return type
 */
export interface UseMinimumHBDResult {
  currentMinimum: string;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  updateMinimum: (newMinimum: string) => Promise<void>;
  isUpdating: boolean;
  resetToDefault: () => Promise<void>;
}

/**
 * Hook for managing user's minimum HBD preference
 * 
 * Features:
 * - Fetches current minimum from blockchain (cached)
 * - Updates minimum via Keychain broadcast
 * - Optimistic updates for instant UI feedback
 * - Error handling with toast notifications
 * - Cache invalidation on updates
 * 
 * @returns UseMinimumHBDResult
 */
export function useMinimumHBD(): UseMinimumHBDResult {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Query for user's current minimum HBD setting
  const {
    data: metadata,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['minimumHBD', user?.username],
    queryFn: async () => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }
      return await getAccountMetadata(user.username);
    },
    enabled: !!user?.username,
    staleTime: 5 * 60 * 1000,  // Consider fresh for 5 minutes
    gcTime: 10 * 60 * 1000,    // Keep in cache for 10 minutes
    retry: 2,                   // Retry failed requests twice
  });
  
  // Parse current minimum (with fallback to default)
  const currentMinimum = parseMinimumHBD(metadata) || DEFAULT_MINIMUM_HBD;
  
  // Mutation for updating minimum HBD
  const mutation = useMutation({
    mutationFn: async (newMinimum: string) => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }
      
      const success = await updateMinimumHBD(user.username, newMinimum);
      
      if (!success) {
        throw new Error('Failed to update minimum HBD');
      }
      
      return newMinimum;
    },
    onMutate: async (newMinimum) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['minimumHBD', user?.username] });
      
      // Snapshot current value
      const previousMetadata = queryClient.getQueryData(['minimumHBD', user?.username]);
      
      // Optimistically update cache
      // Guard against undefined profile (common for accounts without posting metadata)
      queryClient.setQueryData(['minimumHBD', user?.username], (old: any) => ({
        ...old,
        profile: {
          ...(old?.profile ?? {}),
          hive_messenger: {
            min_hbd: newMinimum,
            version: '1.0',
          },
        },
      }));
      
      return { previousMetadata };
    },
    onError: (error: any, newMinimum, context) => {
      // Revert optimistic update on error
      if (context?.previousMetadata) {
        queryClient.setQueryData(
          ['minimumHBD', user?.username],
          context.previousMetadata
        );
      }
      
      // Show error toast
      toast({
        title: 'Update Failed',
        description: error?.message || 'Could not update minimum HBD. Please try again.',
        variant: 'destructive',
      });
      
      console.error('[useMinimumHBD] Update failed:', error);
    },
    onSuccess: (newMinimum) => {
      // Show success toast immediately
      toast({
        title: 'Preference Saved',
        description: `Minimum HBD updated to ${newMinimum}`,
      });
      
      console.log('[useMinimumHBD] Successfully updated to:', newMinimum);
      
      // BLOCKCHAIN FIX: Add 2-second delay before invalidating cache
      // This allows the Hive blockchain to propagate the account_update2 operation
      // Without this delay, the refetch happens too quickly and gets stale data
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['minimumHBD', user?.username] });
        console.log('[useMinimumHBD] Cache invalidated after blockchain propagation delay');
      }, 2000);
    },
  });
  
  // Helper function to update minimum
  const updateMinimum = async (newMinimum: string): Promise<void> => {
    await mutation.mutateAsync(newMinimum);
  };
  
  // Helper function to reset to default
  const resetToDefault = async (): Promise<void> => {
    await mutation.mutateAsync(DEFAULT_MINIMUM_HBD);
  };
  
  return {
    currentMinimum,
    isLoading,
    isError,
    error: error as Error | null,
    updateMinimum,
    isUpdating: mutation.isPending,
    resetToDefault,
  };
}
