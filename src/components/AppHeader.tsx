import { useEffect, useRef, useState } from 'react';
import type { AppView } from '../types/storm';

interface AppHeaderProps {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  pinnedCount: number;
  activeSearchLabel: string | null;
  onOpenAi?: () => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'map', label: 'Storm Map' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'reports', label: 'Reports' },
];

export default function AppHeader({
  activeView,
  onChangeView,
  pinnedCount,
  activeSearchLabel,
  onOpenAi,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on outside click / Escape — same pattern as SearchBar dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  const activeLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label ?? 'Hail Yes!';

  const handleNavClick = (view: AppView) => {
    onChangeView(view);
    setMenuOpen(false);
  };

  return (
    <header className="relative border-b border-stone-200 bg-white/95 backdrop-blur">
      {/* MOBILE: Single 44px row — hamburger + active page label + pin badge + settings.
          The full 2-row layout (logo + tagline + nav tabs) is restored at lg:. */}
      <div className="flex items-center gap-2 px-3 h-11 lg:hidden" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-900 leading-tight">
            {activeLabel}
          </p>
          {activeSearchLabel && (
            <p className="truncate text-[11px] text-stone-500 leading-tight">
              {activeSearchLabel}
            </p>
          )}
        </div>

        <span
          className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
          title={`${pinnedCount} pinned propert${pinnedCount === 1 ? 'y' : 'ies'}`}
        >
          {pinnedCount}<span className="sr-only"> pinned</span>
          <span aria-hidden="true" className="ml-0.5">★</span>
        </span>

        <button
          type="button"
          onClick={() => onChangeView('team')}
          aria-label="Team & Settings"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
            activeView === 'team'
              ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
              : 'bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-900'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Hamburger dropdown sheet — anchored to header, covers below it. */}
        {menuOpen && (
          <div
            role="menu"
            aria-label="Navigation"
            className="absolute left-0 right-0 top-11 z-30 border-b border-stone-200 bg-white shadow-lg"
          >
            <div className="flex flex-col gap-1 p-2">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleNavClick(item.id)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold text-left transition-colors ${
                    item.id === activeView
                      ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
                      : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === activeView && (
                    <span aria-hidden="true" className="text-xs">●</span>
                  )}
                </button>
              ))}
              {onOpenAi && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onOpenAi();
                    setMenuOpen(false);
                  }}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold text-left bg-orange-50 text-orange-600 hover:bg-orange-100 ring-1 ring-orange-200"
                >
                  AI Intel
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* DESKTOP: Original 2-row layout — logo + title + tagline, full nav tab bar.
          Untouched from previous behavior; only the wrapper switches at lg:. */}
      <div className="hidden lg:flex flex-col gap-3 px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(249,115,22,0.15),rgba(124,58,237,0.12))] text-orange-500 ring-1 ring-orange-300/30">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5.5 12.5a3 3 0 0 1 .2-6 4.5 4.5 0 0 1 8.72 1.3 2.6 2.6 0 0 1 .08 5.2H5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7.2 13.8 6.4 16M10 13.8 9.2 16.6M12.8 13.8 12 16.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-stone-900">Hail Yes!</h1>
              <p className="truncate text-sm text-stone-500">
                {activeSearchLabel || 'Storm intelligence for roofing professionals'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
              {pinnedCount} pinned
            </span>
            <button
              type="button"
              onClick={() => onChangeView('team')}
              aria-label="Team & Settings"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                activeView === 'team'
                  ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
                  : 'bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-900'
              }`}
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="-mx-1 flex gap-1.5 sm:gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeView(item.id)}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
                item.id === activeView
                  ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white shadow-[0_10px_30px_rgba(124,58,237,0.28)]'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
              }`}
            >
              {item.label}
            </button>
          ))}
          {onOpenAi && (
            <button
              type="button"
              onClick={onOpenAi}
              className="shrink-0 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors bg-orange-50 text-orange-600 hover:bg-orange-100 ring-1 ring-orange-200"
            >
              AI Intel
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
