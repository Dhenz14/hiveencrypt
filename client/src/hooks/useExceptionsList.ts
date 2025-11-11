/**
 * useExceptionsList Hook
 * 
 * Re-exports useExceptions from centralized ExceptionsContext
 * This maintains backward compatibility while using shared state
 * 
 * Feature: Exceptions List (v2.1.0) - Centralized State Fix
 */

import { useExceptions } from '@/contexts/ExceptionsContext';

/**
 * Hook return type (matches context)
 */
export interface UseExceptionsListResult {
  exceptions: string[];
  isException: (username: string) => boolean;
  addException: (username: string) => void;
  removeException: (username: string) => void;
  toggleException: (username: string) => void;
  isLoading: boolean;
}

/**
 * Hook for managing exceptions/whitelist for minimum HBD filter
 * Now uses centralized context for shared state across all components
 * 
 * @returns UseExceptionsListResult
 */
export function useExceptionsList(): UseExceptionsListResult {
  return useExceptions();
}
