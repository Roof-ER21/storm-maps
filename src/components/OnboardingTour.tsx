import { useState } from 'react';

const STEPS = [
  {
    title: 'Welcome to Hail Yes!',
    body: 'Storm intelligence that helps you find hail damage, knock the right doors, and close more roofing deals.',
    icon: 'cloud',
  },
  {
    title: 'Storm Map',
    body: 'Search any address to see NOAA hail history, MRMS radar overlays, and damage swaths. Pin properties to track.',
    icon: 'map',
  },
  {
    title: 'Pipeline',
    body: 'Your targets, canvass routes, and lead pipeline in one place. Track stages from New to Won with deal values.',
    icon: 'pipeline',
  },
  {
    title: 'Evidence',
    body: 'Snap photos with your camera, annotate damage, and build evidence packs for insurance claims.',
    icon: 'camera',
  },
  {
    title: 'Property Lookups',
    body: 'Tap "Lookup Owner" on any lead to auto-fill the homeowner name from public county records — free and unlimited.',
    icon: 'search',
  },
];

export default function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm py-4">
      <div className="w-full max-w-md mx-4 rounded-3xl border border-slate-800 bg-slate-950 p-6 sm:p-8">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-orange-400' : i < step ? 'w-1.5 bg-orange-400/40' : 'w-1.5 bg-slate-700'
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex justify-center mb-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.2),rgba(124,58,237,0.2))] text-orange-300">
            <StepIcon icon={current.icon} />
          </div>
        </div>

        {/* Content */}
        <h2 className="text-center text-xl sm:text-2xl font-bold text-white">{current.title}</h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-400">{current.body}</p>

        {/* Step counter */}
        <p className="mt-4 text-center text-xs text-slate-600">{step + 1} of {STEPS.length}</p>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isLast) onComplete();
              else setStep(step + 1);
            }}
            className="flex-1 rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-3 text-sm font-semibold text-white shadow-lg"
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>

        {/* Skip */}
        {!isLast && (
          <button
            type="button"
            onClick={onComplete}
            className="mt-3 w-full text-center text-xs text-slate-600 hover:text-slate-400"
          >
            Skip tour
          </button>
        )}
      </div>
    </div>
  );
}

function StepIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'cloud':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.5 15a3.5 3.5 0 01.25-7 5.2 5.2 0 0110.05 1.6A3.05 3.05 0 0116.9 15H6.5Z" /><path strokeLinecap="round" d="M8.5 16.6L7.6 19M12 16.6L11.1 19.5M15.5 16.6L14.6 19.2" /></svg>;
    case 'map':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
    case 'pipeline':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M3 8h14M3 12h10M3 16h6" /></svg>;
    case 'camera':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg>;
    case 'search':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
    default:
      return null;
  }
}
