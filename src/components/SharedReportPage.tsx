import { useEffect, useState } from 'react';
import { getShareableReport } from '../services/api';

interface ReportData {
  address: string;
  lat: number;
  lng: number;
  stormDate: string;
  stormLabel: string;
  maxHailInches: number;
  maxWindMph: number;
  eventCount: number;
  repName: string | null;
  repPhone: string | null;
  companyName: string | null;
  homeownerName: string | null;
  createdAt: string;
}

export default function SharedReportPage({ slug }: { slug: string }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getShareableReport(slug)
      .then((data) => {
        if (data) setReport(data as unknown as ReportData);
        else setError('Report not found or has expired.');
      })
      .catch(() => setError('Failed to load report.'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen overflow-y-auto bg-[#faf9f7] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen overflow-y-auto bg-[#faf9f7] flex items-center justify-center px-4">
        <div className="max-w-md rounded-3xl border border-stone-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-stone-900">Report Not Available</p>
          <p className="mt-2 text-sm text-stone-500">{error || 'This report may have expired or been removed.'}</p>
        </div>
      </div>
    );
  }

  const hailLabel = report.maxHailInches > 0 ? `${report.maxHailInches}" hail` : 'Hail activity';
  const windLabel = report.maxWindMph > 0 ? `${report.maxWindMph} mph wind` : null;
  const sizeDesc = hailNickname(report.maxHailInches);

  return (
    <div className="min-h-screen overflow-y-auto overflow-x-hidden bg-[#faf9f7]">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur px-4 py-4">
        <div className="mx-auto max-w-2xl flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white font-bold text-sm">
            H!
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900">Hail Yes!</p>
            <p className="text-xs text-stone-500">Storm Damage Intelligence</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Homeowner greeting */}
        {report.homeownerName && (
          <p className="text-sm text-stone-500 mb-2">
            Prepared for <span className="text-stone-900 font-semibold">{report.homeownerName}</span>
          </p>
        )}

        <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 leading-tight">
          Your property was in a<br />
          <span className="bg-[linear-gradient(135deg,#fb923c,#a855f7)] bg-clip-text text-transparent">
            documented hail zone
          </span>
        </h1>

        <p className="mt-4 text-base text-stone-500 leading-relaxed">
          NOAA storm records show hail activity near <span className="text-stone-900 font-medium">{report.address}</span> on{' '}
          <span className="text-stone-900 font-medium">{report.stormLabel}</span>. This data is used by insurance companies
          to validate damage claims.
        </p>

        {/* Property location map */}
        <div className="mt-8 overflow-hidden rounded-3xl border border-stone-200">
          <img
            src={`https://maps.googleapis.com/maps/api/staticmap?center=${report.lat},${report.lng}&zoom=15&size=640x300&scale=2&maptype=roadmap&markers=color:red%7C${report.lat},${report.lng}&key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}`}
            alt={`Map of ${report.address}`}
            className="w-full h-auto"
            loading="lazy"
          />
        </div>

        {/* Storm data card */}
        <div className="mt-8 rounded-3xl border border-stone-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Storm Event Details</p>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-3xl font-bold text-stone-900">{hailLabel}</p>
              <p className="mt-1 text-sm text-stone-500">{sizeDesc} size hail</p>
            </div>
            {windLabel && (
              <div>
                <p className="text-3xl font-bold text-stone-900">{windLabel}</p>
                <p className="mt-1 text-sm text-stone-500">Sustained wind speed</p>
              </div>
            )}
            <div>
              <p className="text-3xl font-bold text-stone-900">{report.eventCount}</p>
              <p className="mt-1 text-sm text-stone-500">NOAA reports nearby</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-stone-900">{report.stormLabel}</p>
              <p className="mt-1 text-sm text-stone-500">Date of loss</p>
            </div>
          </div>
        </div>

        {/* What this means */}
        <div className="mt-8 rounded-3xl border border-stone-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">What This Means For You</p>
          <div className="mt-4 space-y-4 text-sm text-stone-600 leading-relaxed">
            <p>
              Hail of this size ({sizeDesc}) is known to cause damage to roofing materials including
              asphalt shingles, gutters, flashing, and siding. Damage may not be visible from the ground.
            </p>
            <p>
              Most homeowners insurance policies cover hail damage with no increase to your premium
              for filing a weather-related claim. A professional inspection can determine if damage exists.
            </p>
            <p className="font-semibold text-stone-900">
              We offer free, no-obligation roof inspections and can help guide you through the
              insurance claim process if damage is found.
            </p>
          </div>
        </div>

        {/* Rep contact */}
        {report.repName && (
          <div className="mt-8 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Your Local Specialist</p>
            <p className="mt-3 text-lg font-semibold text-stone-900">{report.repName}</p>
            {report.companyName && <p className="mt-1 text-sm text-stone-500">{report.companyName}</p>}
            {report.repPhone && (
              <a
                href={`tel:${report.repPhone.replace(/[^\d+]/g, '')}`}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Call {report.repName.split(' ')[0]} — {report.repPhone}
              </a>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 rounded-3xl bg-[linear-gradient(135deg,rgba(249,115,22,0.15),rgba(124,58,237,0.15))] border border-orange-500/20 p-6 text-center">
          <p className="text-lg font-semibold text-stone-900">Ready to schedule a free inspection?</p>
          <p className="mt-2 text-sm text-stone-500">
            We'll check your roof, document any damage with photos, and help you file with your
            insurance company — all at no cost to you.
          </p>
          {report.repPhone ? (
            <a
              href={`tel:${report.repPhone.replace(/[^\d+]/g, '')}`}
              className="mt-5 inline-block rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-6 py-3 text-sm font-semibold text-white shadow-lg"
            >
              Schedule Free Inspection
            </a>
          ) : (
            <p className="mt-4 text-sm text-stone-400">Contact your local roofing specialist to get started.</p>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-stone-400">
          Data sourced from NOAA Storm Events Database. Report generated {formatDate(report.createdAt)}.
        </p>
      </main>
    </div>
  );
}

function hailNickname(inches: number): string {
  if (inches >= 4.5) return 'Softball';
  if (inches >= 2.5) return 'Tennis ball';
  if (inches >= 1.75) return 'Golf ball';
  if (inches >= 1.5) return 'Ping pong ball';
  if (inches >= 1) return 'Quarter';
  return 'Small';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
