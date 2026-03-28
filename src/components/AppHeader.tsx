import type { AppView } from '../types/storm';

interface AppHeaderProps {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  pinnedCount: number;
  activeSearchLabel: string | null;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'map', label: 'Storm Map' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'reports', label: 'Reports' },
];

export default function AppHeader({
  activeView,
  onChangeView,
  pinnedCount,
  activeSearchLabel,
}: AppHeaderProps) {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
      <div className="flex flex-col gap-3 px-4 py-3 lg:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-300 ring-1 ring-cyan-400/25 shadow-[0_0_28px_rgba(34,211,238,0.22)]">
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.547a1 1 0 01.64 1.895l-1.04.354L18 10.17V17a1 1 0 01-1 1H3a1 1 0 01-1-1v-6.83l1.847-3.563-1.04-.354a1 1 0 01.64-1.895l1.599.547L9 4.323V3a1 1 0 011-1z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-white">
                HailRecon
              </h1>
              <p className="truncate text-sm text-gray-400">
                {activeSearchLabel || 'Storm intelligence for roofing professionals'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
              {pinnedCount} pinned
            </span>
          </div>
        </div>

        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {NAV_ITEMS.map((item) => {
            const active = item.id === activeView;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-white text-gray-950'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
