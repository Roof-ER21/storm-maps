// TODO: Left sidebar with storm dates and layer controls
// - List of recent storm dates with hail size indicators
// - Layer visibility toggles (MESH, NEXRAD, MRMS, Storm Reports)
// - Opacity sliders per layer
// - GPS tracking toggle
// - Canvassing alert status

export default function Sidebar() {
  return (
    <aside className="w-80 bg-gray-950 text-white flex flex-col border-r border-gray-800">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold tracking-tight">Storm Maps</h1>
        <p className="text-xs text-gray-400 mt-1">Hail Intelligence for Roofing Pros</p>
      </div>
      <div className="flex-1 p-4 sidebar-scroll overflow-y-auto">
        <p className="text-sm text-gray-500">Storm dates will appear here</p>
      </div>
    </aside>
  );
}
