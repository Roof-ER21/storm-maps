// TODO: Main map component using @vis.gl/react-google-maps
// - Full-screen Google Map with satellite/roadmap toggle
// - Renders MESH swath overlays, NEXRAD radar, MRMS tiles
// - Handles click events for storm report details
// - GPS blue dot overlay
// - Integrates with all child layer components

export default function StormMap() {
  return (
    <div className="flex-1 bg-gray-900 flex items-center justify-center text-gray-400">
      <p>Map loads here (Google Maps API key required)</p>
    </div>
  );
}
