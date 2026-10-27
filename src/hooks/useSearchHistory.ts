import { useState, useEffect, useCallback } from 'react';

/**
 * useSearchHistory
 * Custom hook managing per-user search history stored safely in localStorage.
 * - Key: buyoll_search_history_<userId> or buyoll_search_history_guest
 * - Ignores empty or single-character queries
 * - Case-insensitive deduplication (moves repeated query to front)
 * - Maximum 8 items, newest first
 * - Safe error handling (try/catch for private browsing / quota limits)
 */
export function useSearchHistory(userId?: number | string | null) {
  const storageKey = userId ? `buyoll_search_history_${userId}` : 'buyoll_search_history_guest';

  const [history, setHistory] = useState<string[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
      }
    } catch (e) {
      // Ignore localStorage errors
    }
    return [];
  });

  // Reload history whenever user ID / storage key changes
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(Array.isArray(parsed) ? parsed.slice(0, 8) : []);
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    }
  }, [storageKey]);

  // Add query to history
  const addSearch = useCallback(
    (query: string) => {
      const trimmed = (query || '').trim();
      // Ignore empty or 1-character queries
      if (!trimmed || trimmed.length <= 1) return;

      setHistory((prev) => {
        // Case-insensitive deduplication: remove previous occurrences
        const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
        // Prepend newest query and keep max 8 items
        const updated = [trimmed, ...filtered].slice(0, 8);

        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // Quota or private browsing fallback
        }
        return updated;
      });
    },
    [storageKey]
  );

  // Remove a single query
  const removeSearch = useCallback(
    (queryToRemove: string) => {
      setHistory((prev) => {
        const updated = prev.filter((item) => item.toLowerCase() !== queryToRemove.toLowerCase());
        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // Ignore
        }
        return updated;
      });
    },
    [storageKey]
  );

  // Clear all queries
  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore
    }
  }, [storageKey]);

  return { history, addSearch, removeSearch, clearHistory };
}
