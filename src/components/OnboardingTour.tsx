import { useState } from 'react';

// 3-step functional walkthrough. Each step maps to a real action a rep
// will take in the next 60 seconds — not a marketing tour. The copy
// names the actual UI they'll see.
const STEPS = [
  {
    title: 'Search a property',
    body: 'Open Storm Map and type the customer\'s address. Hail Yes! pulls every storm date that hit them in the last 6 years.',
    icon: 'search',
  },
  {
    title: 'Look for the green badge',
    body: 'Each storm date shows a confidence badge. Green ✓ Certified = ≥3 independent sources confirm. Amber ⚠ = verify before claiming.',
    icon: 'badge',
  },
  {
    title: 'Pin & generate the PDF',
    body: 'Tap ★ Pin Property in the sidebar, pick the date of loss, hit Generate Report. The PDF stamps Forensic Verification when ≥3 sources confirm.',
    icon: 'doc',
  },
];

export default function OnboardingTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm py-4">
      <div className="w-full max-w-md mx-4 rounded-3xl border border-stone-200 bg-white shadow-xl p-6 sm:p-8">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-orange-400' : i < step ? 'w-1.5 bg-orange-400/40' : 'w-1.5 bg-stone-200'
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
        <h2 className="text-center text-xl sm:text-2xl font-bold text-stone-900">{current.title}</h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-stone-500">{current.body}</p>

        {/* Step counter */}
        <p className="mt-4 text-center text-xs text-stone-400">{step + 1} of {STEPS.length}</p>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-100"
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
            className="mt-3 w-full text-center text-xs text-stone-400 hover:text-stone-600"
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
    case 'search':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
    case 'badge':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
    case 'doc':
      return <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
    default:
      return null;
  }
}
