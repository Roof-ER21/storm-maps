/**
 * SearchBar -- Address/ZIP search with Google Places Autocomplete.
 *
 * Uses useMapsLibrary('places') from @vis.gl/react-google-maps
 * for autocomplete suggestions. Falls back to manual geocoding
 * when Places is unavailable.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import type { SearchResult } from '../types/storm';
import { geocodeAddress } from '../services/geocodeApi';

interface SearchBarProps {
  onResult: (result: SearchResult) => void;
}

export default function SearchBar({ onResult }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<
    google.maps.places.AutocompletePrediction[]
  >([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteServiceRef =
    useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef =
    useRef<google.maps.places.PlacesService | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the Places library
  const placesLib = useMapsLibrary('places');

  // Initialize autocomplete service when places library loads
  useEffect(() => {
    if (!placesLib) return;
    autocompleteServiceRef.current =
      new placesLib.AutocompleteService();

    // PlacesService needs an HTMLDivElement or Map as attribution container
    const attrDiv = document.createElement('div');
    placesServiceRef.current = new placesLib.PlacesService(attrDiv);
  }, [placesLib]);

  // Fetch autocomplete predictions
  const fetchPredictions = useCallback(
    (input: string) => {
      if (!autocompleteServiceRef.current || input.trim().length < 2) {
        setPredictions([]);
        return;
      }

      autocompleteServiceRef.current.getPlacePredictions(
        {
          input,
          componentRestrictions: { country: 'us' },
          types: ['address', 'geocode'],
        },
        (results, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            results
          ) {
            setPredictions(results);
            setShowDropdown(true);
          } else {
            setPredictions([]);
          }
        },
      );
    },
    [],
  );

  // Handle input change with debounce
  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      setErrorMsg(null);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (value.trim().length >= 2) {
        debounceRef.current = setTimeout(() => {
          fetchPredictions(value);
        }, 300);
      } else {
        setPredictions([]);
        setShowDropdown(false);
      }
    },
    [fetchPredictions],
  );

  // Select a prediction and geocode it
  const handleSelectPrediction = useCallback(
    (prediction: google.maps.places.AutocompletePrediction) => {
      setQuery(prediction.description);
      setPredictions([]);
      setShowDropdown(false);

      if (!placesServiceRef.current) {
        // Fallback to manual geocoding
        geocodeAddress(prediction.description).then((result) => {
          if (result) {
            onResult(result);
            addToRecent(result);
          }
        });
        return;
      }

      // Use PlacesService to get details (lat/lng)
      placesServiceRef.current.getDetails(
        {
          placeId: prediction.place_id,
          fields: ['geometry', 'formatted_address'],
        },
        (place, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            place?.geometry?.location
          ) {
            const result: SearchResult = {
              address:
                place.formatted_address || prediction.description,
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              placeId: prediction.place_id,
            };
            onResult(result);
            setQuery(result.address);
            addToRecent(result);
          }
        },
      );
    },
    [onResult],
  );

  // Fallback manual search via geocoding API
  const handleManualSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) return;

      setSearching(true);
      setErrorMsg(null);
      setShowDropdown(false);
      setPredictions([]);

      try {
        const result = await geocodeAddress(searchQuery.trim());
        if (result) {
          onResult(result);
          setQuery(result.address);
          addToRecent(result);
        } else {
          setErrorMsg(
            'Location not found. Try a different address or ZIP.',
          );
        }
      } catch {
        setErrorMsg('Geocoding failed. Check your connection.');
      } finally {
        setSearching(false);
      }
    },
    [onResult],
  );

  const addToRecent = (result: SearchResult) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter(
        (r) => r.placeId !== result.placeId,
      );
      return [result, ...filtered].slice(0, 5);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleManualSearch(query);
  };

  const handleRecentClick = (result: SearchResult) => {
    setQuery(result.address);
    setShowDropdown(false);
    onResult(result);
  };

  // Close dropdown when clicking outside
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
    return () =>
      document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const showRecents =
    showDropdown &&
    predictions.length === 0 &&
    recentSearches.length > 0 &&
    query.length === 0;

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
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              if (predictions.length > 0) {
                setShowDropdown(true);
              } else if (
                recentSearches.length > 0 &&
                query.length === 0
              ) {
                setShowDropdown(true);
              }
            }}
            placeholder="Search address or ZIP code..."
            className="w-full pl-10 pr-10 py-2.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-400"
            aria-label="Search address or ZIP code"
            aria-describedby={errorMsg ? 'search-error' : undefined}
            autoComplete="off"
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
                setPredictions([]);
                setShowDropdown(false);
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

      {/* Autocomplete predictions dropdown */}
      {showDropdown && predictions.length > 0 && (
        <div className="mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
          {predictions.map((prediction) => (
            <button
              key={prediction.place_id}
              onClick={() => handleSelectPrediction(prediction)}
              className="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors border-b border-gray-50 last:border-0"
            >
              <svg
                className="w-4 h-4 text-gray-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">
                  {prediction.structured_formatting
                    .main_text}
                </div>
                <div className="truncate text-xs text-gray-400">
                  {prediction.structured_formatting
                    .secondary_text}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Recent searches dropdown */}
      {showRecents && (
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
