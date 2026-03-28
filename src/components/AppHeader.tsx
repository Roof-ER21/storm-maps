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
  { id: 'canvass', label: 'Canvass' },
  { id: 'leads', label: 'Leads' },
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
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(249,115,22,0.24),rgba(124,58,237,0.22))] text-orange-300 ring-1 ring-orange-400/20 shadow-[0_0_30px_rgba(168,85,247,0.24)]">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  d="M5.5 12.5a3 3 0 0 1 .2-6 4.5 4.5 0 0 1 8.72 1.3 2.6 2.6 0 0 1 .08 5.2H5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7.2 13.8 6.4 16M10 13.8 9.2 16.6M12.8 13.8 12 16.3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-white">
                Hail Yes!
              </h1>
              <p className="truncate text-sm text-gray-400">
                {activeSearchLabel || 'Storm intelligence for roofing professionals'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-200">
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
                    ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white shadow-[0_10px_30px_rgba(124,58,237,0.28)]'
                    : 'bg-slate-900 text-gray-300 hover:bg-slate-800 hover:text-white'
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
