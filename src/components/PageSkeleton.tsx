export default function PageSkeleton() {
  return (
    <div className="flex-1 overflow-hidden px-4 py-5 lg:px-6 animate-pulse">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Hero skeleton */}
        <div className="rounded-[28px] border border-stone-200 bg-white p-6">
          <div className="h-3 w-24 rounded bg-stone-200" />
          <div className="mt-4 h-8 w-72 rounded bg-stone-200" />
          <div className="mt-3 h-4 w-96 max-w-full rounded bg-stone-100" />
          <div className="mt-5 flex gap-2">
            <div className="h-10 w-40 rounded-2xl bg-stone-200" />
            <div className="h-10 w-28 rounded-2xl bg-stone-100" />
          </div>
        </div>

        {/* Metrics row skeleton */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-[24px] border border-stone-200 bg-white p-4">
              <div className="h-8 w-12 rounded bg-stone-200" />
              <div className="mt-2 h-3 w-16 rounded bg-stone-100" />
            </div>
          ))}
        </div>

        {/* Card grid skeleton */}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-3xl border border-stone-200 bg-white p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-stone-200" />
                  <div className="h-3 w-48 rounded bg-stone-100" />
                </div>
                <div className="h-6 w-16 rounded-full bg-stone-200" />
              </div>
              <div className="mt-4 flex gap-2">
                <div className="h-7 w-16 rounded-full bg-stone-100" />
                <div className="h-7 w-16 rounded-full bg-stone-100" />
                <div className="h-7 w-16 rounded-full bg-stone-100" />
              </div>
              <div className="mt-4 h-20 w-full rounded-2xl bg-stone-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
