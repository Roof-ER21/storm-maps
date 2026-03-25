// TODO: Hail size color legend component
// - Visual legend showing hail size classes and their colors
// - Matches HAIL_SIZE_CLASSES from types/storm.ts
// - Collapsible for mobile
// - Shows reference objects (quarter, golf ball, etc.)

import { HAIL_SIZE_CLASSES } from '../types/storm';

export default function Legend() {
  return (
    <div className="absolute bottom-6 right-4 z-10 bg-gray-950/90 backdrop-blur rounded-lg p-3 shadow-lg border border-gray-700">
      <h3 className="text-xs font-semibold text-white mb-2 uppercase tracking-wider">Hail Size</h3>
      <div className="space-y-1">
        {HAIL_SIZE_CLASSES.map((cls) => (
          <div key={cls.reference} className="flex items-center gap-2 text-xs text-gray-300">
            <span
              className="w-3 h-3 rounded-sm inline-block flex-shrink-0"
              style={{ backgroundColor: cls.color }}
            />
            <span>{cls.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
