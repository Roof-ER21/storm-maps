/**
 * SearchBar — Address/ZIP search overlay for the map.
 *
 * Positioned absolutely over the map. Triggers geocoding on submit
 * and displays recent search results.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SearchResult } from '../types/storm';
import { geocodeAddress } from '../services/geocodeApi';

interface SearchBarProps {
  onResult: (result: SearchResult) => void;
}

export default function SearchBar({ onResult }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) return;

      setSearching(true);
      setErrorMsg(null);
      setShowRecent(false);

      try {
        const result = await geocodeAddress(searchQuery.trim());
        if (result) {
          onResult(result);
          setQuery(result.address);

          // Add to recent searches (deduplicate by placeId)
          setRecentSearches((prev) => {
            const filtered = prev.filter((r) => r.placeId !== result.placeId);
            return [result, ...filtered].slice(0, 5);
          });
        } else {
          setErrorMsg('Location not found. Try a different address or ZIP.');
        }
      } catch {
        setErrorMsg('Geocoding failed. Check your connection.');
      } finally {
        setSearching(false);
      }
    },
    [onResult],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  const handleRecentClick = (result: SearchResult) => {
    setQuery(result.address);
    setShowRecent(false);
    onResult(result);
  };

  // Close recent searches when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-96 max-w-[calc(100%-2rem)]"
    >
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setErrorMsg(null);
            }}
            onFocus={() => {
              if (recentSearches.length > 0) setShowRecent(true);
            }}
            placeholder="Search address or ZIP code..."
            className="w-full pl-10 pr-10 py-2.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-400"
            aria-label="Search address or ZIP code"
            aria-describedby={errorMsg ? 'search-error' : undefined}
          />

          {/* Search icon */}
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          {/* Loading / Clear button */}
          {searching ? (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
            </div>
          ) : query.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setErrorMsg(null);
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </form>

      {/* Error message */}
      {errorMsg && (
        <div
          id="search-error"
          className="mt-1 px-3 py-1.5 bg-red-50 rounded-lg text-xs text-red-600 shadow"
          role="alert"
        >
          {errorMsg}
        </div>
      )}

      {/* Recent searches dropdown */}
      {showRecent && recentSearches.length > 0 && (
        <div className="mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
            Recent Searches
          </div>
          {recentSearches.map((result) => (
            <button
              key={result.placeId}
              onClick={() => handleRecentClick(result)}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="truncate">{result.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
