import { useState } from 'react';

const ONBOARDING_KEY = 'hail-yes:onboarding-complete';

export function useOnboarding(): { showOnboarding: boolean; markComplete: () => void; resetOnboarding: () => void } {
  const [complete, setComplete] = useState(() => localStorage.getItem(ONBOARDING_KEY) === 'true');

  const markComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setComplete(true);
  };

  const reset = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    setComplete(false);
  };

  return { showOnboarding: !complete, markComplete, resetOnboarding: reset };
}
