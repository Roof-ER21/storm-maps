import { useCallback, useState } from 'react';

const REP_PROFILE_KEY = 'hail-yes:rep-profile';

export interface RepProfile {
  id: string;
  name: string;
  phone: string;
  companyName: string;
  teamCode: string;
  role: 'rep' | 'manager';
  createdAt: string;
}

function loadProfile(): RepProfile | null {
  try {
    const stored = localStorage.getItem(REP_PROFILE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function saveProfile(profile: RepProfile): void {
  localStorage.setItem(REP_PROFILE_KEY, JSON.stringify(profile));
}

export function useRepProfile(): { profile: RepProfile | null; updateProfile: (next: RepProfile) => void } {
  const [profile, setProfile] = useState<RepProfile | null>(loadProfile);

  const updateProfile = useCallback((next: RepProfile) => {
    saveProfile(next);
    setProfile(next);
  }, []);

  return { profile, updateProfile };
}
