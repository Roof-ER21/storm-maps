interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

export default function LandingPage({ onGetStarted, onLogin }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Nav */}
      <header className="border-b border-slate-800/50 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white font-bold text-sm">H!</div>
            <span className="text-lg font-bold">Hail Yes!</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onLogin} className="text-sm font-semibold text-slate-400 hover:text-white">Log In</button>
            <button type="button" onClick={onGetStarted} className="rounded-xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2 text-sm font-semibold text-white shadow-lg">Start Free</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-300">Storm Intelligence for Roofing Pros</p>
        <h1 className="mt-4 text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">
          Find the hail.<br />
          <span className="bg-[linear-gradient(135deg,#fb923c,#a855f7)] bg-clip-text text-transparent">Knock the right doors.</span><br />
          Close more deals.
        </h1>
        <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-400 leading-relaxed">
          NOAA storm maps, canvassing routes, lead pipeline, evidence capture, and free property owner
          lookups — all in one app that works on your phone. No contracts. No per-seat pricing.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button type="button" onClick={onGetStarted} className="w-full sm:w-auto rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-8 py-4 text-base font-semibold text-white shadow-[0_10px_40px_rgba(124,58,237,0.3)] hover:opacity-95">
            Start Free Trial
          </button>
          <button type="button" onClick={onLogin} className="w-full sm:w-auto rounded-2xl border border-slate-700 px-8 py-4 text-base font-semibold text-white hover:bg-slate-800">
            Log In
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-600">No credit card required. Free for 14 days.</p>
      </section>

      {/* Competitor callout */}
      <section className="mx-auto max-w-4xl px-4 pb-16">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8 text-center">
          <p className="text-sm text-slate-400">
            Roofers using HailTrace + SPOTIO + AccuLynx pay <span className="text-white font-semibold">$400+/month</span> for
            storm maps, canvassing, and CRM — and still can't capture evidence or look up property owners.
          </p>
          <p className="mt-3 text-lg font-semibold text-orange-300">
            Hail Yes! does all of it. Starting at $0.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Everything you need</p>
        <h2 className="mt-3 text-center text-3xl font-bold">One app. Zero excuses.</h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon="map" title="Storm Intelligence" desc="NOAA hail history, MRMS radar, damage swaths, and a neighborhood heat map — all overlaid on Google Maps." />
          <FeatureCard icon="route" title="Canvass Routes" desc="Auto-build knock-now routes from the worst storm dates. GPS tracking, turn-by-turn, and door-by-door outcome logging." />
          <FeatureCard icon="pipeline" title="Lead Pipeline" desc="Stages from New to Won with deal values, reminders, bulk actions, filters, and a post-win closeout checklist." />
          <FeatureCard icon="camera" title="Evidence Capture" desc="Snap photos, annotate damage with arrows and circles, extract GPS from EXIF, and build evidence packs for adjusters." />
          <FeatureCard icon="owner" title="Free Owner Lookups" desc="Tap any lead to auto-fill the homeowner name from 37 county public records — free, unlimited, no data subscription." />
          <FeatureCard icon="share" title="Homeowner Reports" desc="Generate a shareable storm report link to text homeowners. Shows NOAA data, hail size, and your contact info." />
          <FeatureCard icon="alert" title="Storm Alerts" desc="Background polling detects new hail in your territory. Push notifications get you to the neighborhood first." />
          <FeatureCard icon="team" title="Team Sync" desc="Rep profiles, deal value tracking, team roster with lead counts. See who's crushing it and who needs help." />
          <FeatureCard icon="offline" title="Works Offline" desc="PWA with service worker caching. The app loads even when your phone has no signal in the field." />
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-5xl px-4 pb-20" id="pricing">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Simple pricing</p>
        <h2 className="mt-3 text-center text-3xl font-bold">No per-seat fees. No surprises.</h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <PricingCard
            name="Starter"
            price="Free"
            period="forever"
            desc="For solo reps trying it out"
            features={['Storm maps + NOAA history', 'Up to 10 active leads', 'Evidence capture + camera', 'Property owner lookups', 'Shareable reports']}
            cta="Start Free"
            onCta={onGetStarted}
            highlighted={false}
          />
          <PricingCard
            name="Pro"
            price="$49"
            period="/month"
            desc="For active storm chasers"
            features={['Unlimited leads + pipeline', 'CSV homeowner import', 'Deal value tracking', 'Storm alerts + push notifications', 'Team sync + rep profiles', 'Post-win checklists', 'Priority support']}
            cta="Start 14-Day Trial"
            onCta={onGetStarted}
            highlighted
          />
          <PricingCard
            name="Company"
            price="$149"
            period="/month"
            desc="For roofing companies with teams"
            features={['Everything in Pro', 'Unlimited team members', 'Multi-territory management', 'Data export + backup', 'Dedicated onboarding', 'Custom branding (coming soon)']}
            cta="Start 14-Day Trial"
            onCta={onGetStarted}
            highlighted={false}
          />
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-4 pb-20 text-center">
        <h2 className="text-3xl font-bold">Ready to beat your competitors to the door?</h2>
        <p className="mt-4 text-slate-400">Start free. No credit card. Upgrade when you're closing deals.</p>
        <button type="button" onClick={onGetStarted} className="mt-8 rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-10 py-4 text-base font-semibold text-white shadow-[0_10px_40px_rgba(124,58,237,0.3)]">
          Get Started Free
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8 text-center text-xs text-slate-600">
        <p>Hail Yes! by Roof-ER21. Storm data from NOAA. Property data from public county records.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.15),rgba(124,58,237,0.15))] text-orange-300">
        <FeatureIcon name={icon} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
    </div>
  );
}

function PricingCard({ name, price, period, desc, features, cta, onCta, highlighted }: {
  name: string; price: string; period: string; desc: string;
  features: string[]; cta: string; onCta: () => void; highlighted: boolean;
}) {
  return (
    <div className={`rounded-3xl border p-6 sm:p-8 ${highlighted ? 'border-orange-500/30 bg-[linear-gradient(180deg,rgba(249,115,22,0.08),rgba(124,58,237,0.06))] ring-1 ring-orange-500/20' : 'border-slate-800 bg-slate-900/50'}`}>
      {highlighted && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300 mb-4">Most Popular</p>}
      <p className="text-sm font-semibold text-slate-400">{name}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-white">{price}</span>
        <span className="text-sm text-slate-500">{period}</span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{desc}</p>
      <button type="button" onClick={onCta} className={`mt-6 w-full rounded-2xl px-4 py-3 text-sm font-semibold ${highlighted ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white shadow-lg' : 'border border-slate-700 text-white hover:bg-slate-800'}`}>
        {cta}
      </button>
      <ul className="mt-6 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
            <svg className="h-4 w-4 mt-0.5 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureIcon({ name }: { name: string }) {
  const cls = "h-6 w-6";
  switch (name) {
    case 'map': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
    case 'route': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6-5.33-6-11a6 6 0 1112 0c0 5.67-6 11-6 11z" /></svg>;
    case 'pipeline': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M3 8h14M3 12h10M3 16h6" /></svg>;
    case 'camera': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg>;
    case 'owner': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
    case 'share': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>;
    case 'alert': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
    case 'team': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
    case 'offline': return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" /></svg>;
    default: return null;
  }
}
