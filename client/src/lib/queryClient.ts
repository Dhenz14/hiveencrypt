import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient for Hive Messenger - 100% Decentralized Architecture
 * 
 * NO DEFAULT FETCHER - All queries must provide their own queryFn
 * that directly calls the Hive blockchain via @hiveio/dhive
 * 
 * We removed the old server-based apiRequest and default fetcher
 * because there is NO BACKEND SERVER in this architecture.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // No default queryFn - each query must specify how to fetch from blockchain
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity, // Data from blockchain doesn't change rapidly
      retry: 1, // Retry once for network issues
    },
    mutations: {
      retry: false,
    },
  },
});
