/**
 * Ops Team Performance — native React (Phase 2d batch3)
 *
 * Endpoints:
 *   GET /api/intel/employee-roster
 *     → { byUserId: Record<string, { name: string }>, _lastUpdated, _instructions }
 *
 *   GET /api/intel/ops-team-summary?role=<role>
 *     → { role, people: PersonRow[], total, took_ms }
 *     PersonRow: { name, signed, completed, dead, revenue, closeRate, avgJob }
 *     role values: "projectCoordinator" | "estimator" | "fieldTechId"
 *
 *   GET /api/intel/ops-team-deep?role=<role>&key=<name>
 *     → { summary: { signed, completed, dead, open, revenue },
 *         cities: [{name,count}], carriers: [{name,count}],
 *         reps: [{name,count}], trades: [{name,count}], zips: [{name,count}],
 *         medianCompleteDays: number | null,
 *         bigJobs: [{customer,addressLine1,city,state,stage,signedDate,jobTotal}],
 *         took_ms }
 */
import { useState, useEffect } from "react";
import { fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Types (verified against live prod)
// ---------------------------------------------------------------------------

interface PersonRow {
  name: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
  avgJob: number;
}

interface DeepSummary {
  signed: number;
  completed: number;
  dead: number;
  open: number;
  revenue: number;
}

interface NameCountRow {
  name: string;
  count: number;
}

interface BigJob {
  customer: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  stage: string | null;
  signedDate: string | null;
  jobTotal: number | null;
}

interface OpsTeamDeepResponse {
  summary: DeepSummary;
  cities: NameCountRow[];
  carriers: NameCountRow[];
  reps: NameCountRow[];
  trades: NameCountRow[];
  bigJobs: BigJob[];
  medianCompleteDays: number | null;
}

type OpsRole = "projectCoordinator" | "estimator" | "fieldTechId";

const ROLE_LABELS: Record<OpsRole, string> = {
  projectCoordinator: "Project Coordinators",
  estimator: "Estimators",
  fieldTechId: "Field Techs",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "5px 6px", borderBottom: "1px solid #342c23" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OpsTeam({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [roster, setRoster] = useState<Record<string, { name: string }>>({});
  const [role, setRole] = useState<OpsRole>("projectCoordinator");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [deep, setDeep] = useState<OpsTeamDeepResponse | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);

  // Load roster once
  useEffect(() => {
    fetch("/api/intel/employee-roster", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.byUserId) setRoster(d.byUserId); })
      .catch(() => {/* roster optional */});
  }, []);

  // Load people list when role changes
  useEffect(() => {
    setListLoading(true);
    setSelected(null);
    setDeep(null);
    setPeople([]);
    fetch(`/api/intel/ops-team-summary?role=${encodeURIComponent(role)}`, { credentials: "include" })
      .then((r) => r.json() as Promise<{ people: PersonRow[] }>)
      .then((d) => {
        const p = d.people ?? [];
        setPeople(p);
        setListLoading(false);
        // Auto-select first
        if (p.length > 0) {
          setSelected(p[0].name);
        }
      })
      .catch(() => setListLoading(false));
  }, [role]);

  // Load deep when selected changes
  useEffect(() => {
    if (!selected) return;
    setDeep(null);
    setDeepLoading(true);
    setDeepError(null);
    fetch(`/api/intel/ops-team-deep?role=${encodeURIComponent(role)}&key=${encodeURIComponent(selected)}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OpsTeamDeepResponse>;
      })
      .then((d) => { setDeep(d); setDeepLoading(false); })
      .catch((e: unknown) => { setDeepError((e as Error).message); setDeepLoading(false); });
  }, [selected, role]);

  function displayName(key: string): string {
    if (role === "fieldTechId") {
      const entry = roster[key];
      return entry?.name ?? `Field Tech ${key.slice(0, 8)}…`;
    }
    return key;
  }

  const q = search.trim().toLowerCase();
  const filtered = people.filter((p) => !q || p.name.toLowerCase().includes(q));

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 22px",
    cursor: "pointer",
    color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
    borderBottom: active ? "2px solid var(--riq-accent)" : "2px solid transparent",
    fontSize: 13,
    userSelect: "none" as const,
  });

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* Role tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
        {(["projectCoordinator", "estimator", "fieldTechId"] as OpsRole[]).map((r) => (
          <div key={r} style={tabStyle(role === r)} onClick={() => setRole(r)}>
            {ROLE_LABELS[r]}
          </div>
        ))}
      </div>

      {/* Layout: list pane + detail pane */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
        {/* Left pane */}
        <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "16px 20px" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{ROLE_LABELS[role]}</div>
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
              borderRadius: 4, padding: "6px 10px", fontSize: 13, width: "100%", marginBottom: 10,
              fontFamily: "inherit", outline: "none",
            }}
          />
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
            {filtered.length} people
          </div>
          {listLoading ? (
            <div style={{ color: "var(--riq-text-muted)", fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ maxHeight: 760, overflowY: "auto" }}>
              {filtered.map((p) => (
                <div
                  key={p.name}
                  onClick={() => setSelected(p.name)}
                  style={{
                    padding: "10px 12px",
                    border: `1px solid ${selected === p.name ? "var(--riq-accent)" : "var(--riq-border)"}`,
                    background: selected === p.name ? "#342c23" : "transparent",
                    borderRadius: 6,
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--riq-text)" }}>
                    {displayName(p.name)}
                  </div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>
                    {p.signed} jobs · {p.completed} done · {fmtMoney(p.revenue)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right pane */}
        <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "16px 20px" }}>
          {!selected ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>
              Pick someone
            </div>
          ) : deepLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
          ) : deepError ? (
            <div style={{ padding: 20, color: "#ef4444" }}>Failed: {deepError}</div>
          ) : deep ? (
            <>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{displayName(selected)}</h2>
              <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 16 }}>
                {deep.summary.signed} jobs · {deep.summary.completed} done · {fmtMoney(deep.summary.revenue)} closed revenue
              </div>

              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
                {[
                  { l: "Jobs",           v: fmt(deep.summary.signed) },
                  { l: "Completed",      v: fmt(deep.summary.completed) },
                  { l: "Dead",           v: fmt(deep.summary.dead) },
                  { l: "Open",           v: fmt(deep.summary.open) },
                  { l: "Revenue",        v: fmtMoney(deep.summary.revenue) },
                  { l: "Median sign→done", v: deep.medianCompleteDays != null ? `${deep.medianCompleteDays}d` : "—" },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* 2x2 grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {[
                  { title: "Top cities",       rows: deep.cities   },
                  { title: "Top carriers",      rows: deep.carriers },
                  { title: "Top reps paired",   rows: deep.reps     },
                  { title: "Top trades",        rows: deep.trades   },
                ].map(({ title, rows }) => (
                  <div key={title}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{title}</div>
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      <table style={tblStyle}>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.name}>
                              <td style={tdStyle}>{r.name}</td>
                              <td style={tdNumStyle}>{r.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>

              {/* Top 10 big jobs */}
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, marginTop: 4 }}>Top 10 biggest jobs</div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Customer</th>
                      <th style={thStyle}>Address</th>
                      <th style={thStyle}>Stage</th>
                      <th style={thStyle}>Signed</th>
                      <th style={thNumStyle}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deep.bigJobs.map((j, i) => (
                      <tr key={i}>
                        <td style={tdStyle}>{j.customer ?? "—"}</td>
                        <td style={tdStyle}>{[j.addressLine1, j.city, j.state].filter(Boolean).join(", ")}</td>
                        <td style={tdStyle}>{j.stage ?? "—"}</td>
                        <td style={tdStyle}>{j.signedDate ?? "—"}</td>
                        <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(j.jobTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
