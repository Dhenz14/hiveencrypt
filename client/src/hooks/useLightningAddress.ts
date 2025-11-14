/**
 * useLightningAddress Hook
 * 
 * React hook for managing user's Lightning Network address
 * Integrates with React Query for caching and automatic refetching
 * 
 * Lightning Network Integration (v2.2.0)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  getAccountMetadata,
  parseLightningAddress,
  updateLightningAddress,
} from '@/lib/accountMetadata';

/**
 * Hook return type
 */
export interface UseLightningAddressResult {
  currentAddress: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  updateAddress: (newAddress: string) => Promise<void>;
  isUpdating: boolean;
  removeAddress: () => Promise<void>;
}

/**
 * Hook for managing user's Lightning Address
 * 
 * Features:
 * - Fetches current address from blockchain (cached)
 * - Updates address via Keychain broadcast
 * - Optimistic updates for instant UI feedback
 * - Error handling with toast notifications
 * - Cache invalidation on updates
 * - Support for removing address (empty string)
 * 
 * @returns UseLightningAddressResult
 */
export function useLightningAddress(): UseLightningAddressResult {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Query for user's current Lightning Address
  const {
    data: metadata,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['lightningAddress', user?.username],
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
  
  // Parse current Lightning Address (null if not set)
  const currentAddress = parseLightningAddress(metadata);
  
  // Mutation for updating Lightning Address
  const mutation = useMutation({
    mutationFn: async (newAddress: string) => {
      if (!user?.username) {
        throw new Error('User not authenticated');
      }
      
      const success = await updateLightningAddress(user.username, newAddress);
      
      if (!success) {
        throw new Error('Failed to update Lightning Address');
      }
      
      return newAddress;
    },
    onMutate: async (newAddress) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['lightningAddress', user?.username] });
      
      // Snapshot current value
      const previousMetadata = queryClient.getQueryData(['lightningAddress', user?.username]);
      
      // Get existing hive_messenger data to preserve min_hbd and other fields
      const existingMessengerData = (previousMetadata as any)?.profile?.hive_messenger || {};
      
      // Optimistically update cache - preserve all existing fields
      queryClient.setQueryData(['lightningAddress', user?.username], (old: any) => ({
        ...old,
        profile: {
          ...(old?.profile ?? {}),
          hive_messenger: {
            ...existingMessengerData,  // Preserve min_hbd, version, etc.
            lightning_address: newAddress || undefined,
          },
        },
      }));
      
      return { previousMetadata };
    },
    onError: (error: any, newAddress, context) => {
      // Revert optimistic update on error
      if (context?.previousMetadata) {
        queryClient.setQueryData(
          ['lightningAddress', user?.username],
          context.previousMetadata
        );
      }
      
      // Show error toast
      toast({
        title: 'Update Failed',
        description: error?.message || 'Could not update Lightning Address. Please try again.',
        variant: 'destructive',
      });
      
      console.error('[useLightningAddress] Update failed:', error);
    },
    onSuccess: (newAddress) => {
      // Invalidate cache to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['lightningAddress', user?.username] });
      
      // Show success toast
      toast({
        title: newAddress ? 'Lightning Address Saved' : 'Lightning Address Removed',
        description: newAddress ? `Lightning tips enabled: ${newAddress}` : 'Lightning tips disabled',
      });
      
      console.log('[useLightningAddress] Successfully updated to:', newAddress || '(removed)');
    },
  });
  
  // Helper function to update address
  const updateAddress = async (newAddress: string): Promise<void> => {
    await mutation.mutateAsync(newAddress);
  };
  
  // Helper function to remove address
  const removeAddress = async (): Promise<void> => {
    await mutation.mutateAsync('');
  };
  
  return {
    currentAddress,
    isLoading,
    isError,
    error: error as Error | null,
    updateAddress,
    isUpdating: mutation.isPending,
    removeAddress,
  };
}
