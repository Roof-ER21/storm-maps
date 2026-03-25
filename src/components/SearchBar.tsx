// TODO: Address/ZIP search component
// - Autocomplete input using Google Places API
// - ZIP code search with geocoding
// - Search history (recent addresses)
// - Fly-to-location on selection

export default function SearchBar() {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-96 max-w-[calc(100%-2rem)]">
      <input
        type="text"
        placeholder="Search address or ZIP code..."
        className="w-full px-4 py-2.5 bg-white/95 backdrop-blur rounded-lg shadow-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Search address or ZIP code"
      />
    </div>
  );
}
