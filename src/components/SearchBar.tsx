/**
 * SearchBar -- Address/ZIP search using Google Maps Geocoder.
 *
 * Uses geocodeAddress() from geocodeApi.ts directly on form submit.
 * No Places API (AutocompleteService / PlacesService) required —
 * eliminates all Google Places deprecation warnings.
 *
 * Features:
 * - Submit-on-enter / button press → geocodes via Maps JS Geocoder
 * - Recent searches dropdown (up to 5, keyed by placeId)
 * - Loading spinner while geocoding
 * - Inline error message on failure
 * - Clear (×) button when input has text
 * - Fully keyboard-navigable and screen-reader accessible
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
  const [showDropdown, setShowDropdown] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const addToRecent = useCallback((result: SearchResult) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter((r) => r.placeId !== result.placeId);
      return [result, ...filtered].slice(0, 5);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Search handler — geocodes the current query string
  // ---------------------------------------------------------------------------

  const runSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;

      setSearching(true);
      setErrorMsg(null);
      setShowDropdown(false);

      try {
        const result = await geocodeAddress(trimmed);
        if (result) {
          onResult(result);
          setQuery(result.address);
          addToRecent(result);
        } else {
          setErrorMsg('Location not found. Try a different address or ZIP.');
        }
      } catch {
        setErrorMsg('Geocoding failed. Check your connection and try again.');
      } finally {
        setSearching(false);
      }
    },
    [onResult, addToRecent],
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setErrorMsg(null);
    // Show recent searches dropdown when input is cleared
    if (value.length === 0 && recentSearches.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleInputFocus = () => {
    if (query.length === 0 && recentSearches.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleClear = () => {
    setQuery('');
    setErrorMsg(null);
    setShowDropdown(false);
    if (recentSearches.length > 0) {
      // Show recents right after clearing
      setShowDropdown(true);
    }
    inputRef.current?.focus();
  };

  const handleRecentClick = (result: SearchResult) => {
    setQuery(result.address);
    setShowDropdown(false);
    onResult(result);
  };

  // ---------------------------------------------------------------------------
  // Close dropdown when clicking outside
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const showRecents =
    showDropdown && recentSearches.length > 0 && query.length === 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-96 max-w-[calc(100%-2rem)]"
    >
      <form onSubmit={handleSubmit} role="search">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleInputFocus}
            placeholder="Search address or ZIP code..."
            className="w-full rounded-lg bg-white/95 py-2.5 pl-10 pr-10 text-sm text-gray-900 shadow-lg backdrop-blur-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
            aria-label="Search address or ZIP code"
            aria-describedby={errorMsg ? 'search-error' : undefined}
            autoComplete="off"
            disabled={searching}
          />

          {/* Search icon */}
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none"
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

          {/* Loading spinner / Clear button */}
          {searching ? (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2"
              aria-label="Searching…"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-orange-400" />
            </div>
          ) : query.length > 0 ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-gray-600 focus:outline-none focus:text-gray-700"
              aria-label="Clear search"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
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
          className="mt-1 rounded-lg bg-orange-50 px-3 py-1.5 text-xs text-orange-700 shadow"
          role="alert"
        >
          {errorMsg}
        </div>
      )}

      {/* Recent searches dropdown */}
      {showRecents && (
        <div className="mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] text-stone-500 uppercase tracking-wider border-b border-gray-100">
            Recent Searches
          </div>
          {recentSearches.map((result) => (
            <button
              key={result.placeId}
              onClick={() => handleRecentClick(result)}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors focus:outline-none focus:bg-gray-50"
            >
              <svg
                className="w-3.5 h-3.5 text-stone-500 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
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
