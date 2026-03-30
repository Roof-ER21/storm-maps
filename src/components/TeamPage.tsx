import { useEffect, useState } from 'react';
import type { CanvassRouteStop, LeadStage } from '../types/storm';
import type { RepProfile } from '../hooks/useRepProfile';

const TEAM_ROSTER_KEY = 'hail-yes:team-roster';

export interface TeamMemberSnapshot {
  repId: string;
  repName: string;
  role: 'rep' | 'manager';
  snapshotAt: string;
  totalLeads: number;
  leadsByStage: Record<LeadStage, number>;
  overdueReminders: number;
  dueTodayReminders: number;
  totalCanvassStops: number;
  visitedToday: number;
  territories: string[];
}

function generateId(): string {
  return `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRoster(): TeamMemberSnapshot[] {
  try {
    const stored = localStorage.getItem(TEAM_ROSTER_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveRoster(roster: TeamMemberSnapshot[]) {
  localStorage.setItem(TEAM_ROSTER_KEY, JSON.stringify(roster));
}

interface TeamPageProps {
  routeStops: CanvassRouteStop[];
  repProfile: RepProfile | null;
  onUpdateProfile: (profile: RepProfile) => void;
  searchLabel: string | null;
  onLogout?: () => void;
}

const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', inspection_set: 'Inspection Set', won: 'Won', lost: 'Lost',
};

const STAGE_COLORS: Record<LeadStage, string> = {
  new: 'text-sky-300', contacted: 'text-amber-300', inspection_set: 'text-violet-300', won: 'text-emerald-300', lost: 'text-slate-400',
};

export default function TeamPage({ routeStops, repProfile, onUpdateProfile, searchLabel, onLogout }: TeamPageProps) {
  const [name, setName] = useState(repProfile?.name || '');
  const [phone, setPhone] = useState(repProfile?.phone || '');
  const [companyName, setCompanyName] = useState(repProfile?.companyName || '');
  const [teamCode, setTeamCode] = useState(repProfile?.teamCode || '');
  const [role, setRole] = useState<'rep' | 'manager'>(repProfile?.role || 'rep');
  const [roster, setRoster] = useState<TeamMemberSnapshot[]>(loadRoster);

  // Auto-sync own data to roster when profile exists
  useEffect(() => {
    if (!repProfile) return;
    const today = new Date().toISOString().slice(0, 10);
    const activeLeads = routeStops.filter((s) =>
      s.outcome === 'interested' || s.outcome === 'follow_up' || s.outcome === 'inspection_booked',
    );
    const leadsByStage: Record<LeadStage, number> = { new: 0, contacted: 0, inspection_set: 0, won: 0, lost: 0 };
    for (const lead of activeLeads) leadsByStage[lead.leadStage] = (leadsByStage[lead.leadStage] || 0) + 1;

    const snapshot: TeamMemberSnapshot = {
      repId: repProfile.id,
      repName: repProfile.name,
      role: repProfile.role,
      snapshotAt: new Date().toISOString(),
      totalLeads: activeLeads.length,
      leadsByStage,
      overdueReminders: activeLeads.filter((s) => s.reminderAt && s.reminderAt < today && s.leadStage !== 'won' && s.leadStage !== 'lost').length,
      dueTodayReminders: activeLeads.filter((s) => s.reminderAt === today && s.leadStage !== 'won' && s.leadStage !== 'lost').length,
      totalCanvassStops: routeStops.length,
      visitedToday: routeStops.filter((s) => s.visitedAt?.startsWith(today)).length,
      territories: searchLabel ? [searchLabel] : [],
    };

    const updatedRoster = [snapshot, ...roster.filter((m) => m.repId !== repProfile.id)];
    saveRoster(updatedRoster);
    setRoster(updatedRoster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repProfile, routeStops, searchLabel]);

  const handleSetup = () => {
    if (!name.trim()) return;
    const profile: RepProfile = {
      id: repProfile?.id || generateId(),
      name: name.trim(),
      phone: phone.trim(),
      companyName: companyName.trim(),
      teamCode: teamCode.trim().toUpperCase(),
      role,
      createdAt: repProfile?.createdAt || new Date().toISOString(),
    };
    onUpdateProfile(profile);
  };

  const handleImportTeamData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.teamSnapshot && typeof data.teamSnapshot === 'object') {
          const snapshot = data.teamSnapshot as TeamMemberSnapshot;
          setRoster((prev) => {
            const filtered = prev.filter((m) => m.repId !== snapshot.repId);
            const next = [snapshot, ...filtered];
            saveRoster(next);
            return next;
          });
        }
      } catch {
        window.alert('Invalid team data file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleExportMyData = () => {
    if (!repProfile) return;
    const mySnapshot = roster.find((m) => m.repId === repProfile.id);
    if (!mySnapshot) return;
    const blob = new Blob([JSON.stringify({ teamSnapshot: mySnapshot }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hail-yes-team-${repProfile.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const teamMembers = roster;

  const totalWon = teamMembers.reduce((sum, m) => sum + (m.leadsByStage.won || 0), 0);
  const totalLeads = teamMembers.reduce((sum, m) => sum + m.totalLeads, 0);
  const totalOverdue = teamMembers.reduce((sum, m) => sum + m.overdueReminders, 0);

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.14),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_24%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="rounded-[28px] border border-slate-800 bg-slate-950/88 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">Team</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {repProfile ? `${repProfile.name}'s Team` : 'Set Up Your Profile'}
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            {repProfile
              ? 'Share your data with the team and import others to see the full picture.'
              : 'Create your rep profile to start tracking team activity.'}
          </p>
        </div>

        {/* Profile setup / edit */}
        <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {repProfile ? 'Your Profile' : 'Quick Setup'}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <label htmlFor="team-rep-name" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Name</label>
              <input id="team-rep-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="team-phone" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Phone</label>
              <input id="team-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your phone number" className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="team-company" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Company</label>
              <input id="team-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company name" className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="team-code" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Team Code</label>
              <input id="team-code" value={teamCode} onChange={(e) => setTeamCode(e.target.value)} placeholder="e.g. HAILYES-DFW" className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="team-role" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Role</label>
              <select id="team-role" value={role} onChange={(e) => setRole(e.target.value as 'rep' | 'manager')} className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none">
                <option value="rep">Sales Rep</option>
                <option value="manager">Sales Manager</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 sm:gap-2">
            <button type="button" onClick={handleSetup} className="flex-1 min-w-[140px] sm:flex-none rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 sm:px-4 py-3 sm:py-2.5 text-sm font-semibold text-white">
              {repProfile ? 'Update Profile' : 'Create Profile'}
            </button>
            {repProfile && (
              <>
                <button type="button" onClick={handleExportMyData} className="rounded-2xl border border-slate-800 bg-slate-900 px-3 sm:px-4 py-3 sm:py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                  Export My Data
                </button>
                <label className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 px-3 sm:px-4 py-3 sm:py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                  Import Team Member
                  <input type="file" accept=".json" className="hidden" onChange={handleImportTeamData} />
                </label>
              </>
            )}
          </div>
          {onLogout && (
            <div className="mt-4 border-t border-slate-800 pt-4">
              <button type="button" onClick={onLogout} className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/20">
                Log Out
              </button>
            </div>
          )}
        </div>

        {/* Team stats */}
        {teamMembers.length > 0 && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
              <p className="text-2xl font-semibold text-white">{teamMembers.length}</p>
              <p className="mt-1 text-xs text-slate-500">Team Members</p>
            </div>
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
              <p className="text-2xl font-semibold text-white">{totalLeads}</p>
              <p className="mt-1 text-xs text-slate-500">Total Leads</p>
            </div>
            <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
              <p className="text-2xl font-semibold text-emerald-300">{totalWon}</p>
              <p className="mt-1 text-xs text-slate-500">Total Won</p>
            </div>
            <div className={`rounded-[24px] border p-4 ${totalOverdue > 0 ? 'border-red-500/20 bg-red-500/[0.06]' : 'border-slate-800 bg-slate-950/82'}`}>
              <p className={`text-2xl font-semibold ${totalOverdue > 0 ? 'text-red-300' : 'text-white'}`}>{totalOverdue}</p>
              <p className="mt-1 text-xs text-slate-500">Overdue Across Team</p>
            </div>
          </div>
        )}

        {/* Team roster */}
        {teamMembers.length > 0 && (
          <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Team Roster</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {teamMembers.map((member) => {
                const isMe = repProfile?.id === member.repId;
                return (
                  <div key={member.repId} className={`rounded-2xl border p-4 ${isMe ? 'border-orange-400/25 bg-orange-500/[0.04]' : 'border-slate-800 bg-slate-900/60'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">{member.repName}</p>
                          {isMe && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[9px] font-bold text-orange-300">YOU</span>}
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold text-slate-400">
                            {member.role === 'manager' ? 'Manager' : 'Rep'}
                          </span>
                        </div>
                        {member.territories.length > 0 && (
                          <p className="mt-1 text-xs text-slate-500 truncate">{member.territories.join(', ')}</p>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-600">
                        {formatTimeAgo(member.snapshotAt)}
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
                        <p className="text-lg font-semibold text-white">{member.totalLeads}</p>
                        <p className="text-[9px] text-slate-500">Leads</p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-2 text-center">
                        <p className="text-lg font-semibold text-emerald-300">{member.leadsByStage.won || 0}</p>
                        <p className="text-[9px] text-slate-500">Won</p>
                      </div>
                      <div className={`rounded-lg border p-2 text-center ${member.overdueReminders > 0 ? 'border-red-500/15 bg-red-500/[0.04]' : 'border-slate-800 bg-slate-950/60'}`}>
                        <p className={`text-lg font-semibold ${member.overdueReminders > 0 ? 'text-red-300' : 'text-white'}`}>{member.overdueReminders}</p>
                        <p className="text-[9px] text-slate-500">Overdue</p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-0.5 sm:gap-1.5">
                      {(Object.entries(member.leadsByStage) as Array<[LeadStage, number]>)
                        .filter(([, count]) => count > 0)
                        .map(([stage, count]) => (
                          <span key={stage} className={`text-[8px] sm:text-[9px] font-semibold ${STAGE_COLORS[stage]}`}>
                            {count} {STAGE_LABELS[stage]}
                          </span>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {teamMembers.length === 0 && repProfile && (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No team data yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Export your data and share it with teammates. Import their files to build the team view.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
