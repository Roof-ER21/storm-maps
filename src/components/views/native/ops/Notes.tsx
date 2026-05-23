/**
 * Notes Search — native React (Phase 2d batch3)
 *
 * Endpoint:
 *   GET /api/intel/notes
 *   → NoteRow[]   (raw array, not wrapped)
 *   NoteRow: { id, lat, lng, zip, city, notes, stage, state, address, customer, jobTotal,
 *              salesRep, insurance, signedDate, upsellNotes, installNotes, statusUpdate }
 */
import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types (verified against live prod)
// ---------------------------------------------------------------------------

interface NoteRow {
  id: number;
  customer: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  stage: string | null;
  salesRep: string | null;
  insurance: string | null;
  signedDate: string | null;
  jobTotal: number | null;
  notes: string | null;
  upsellNotes: string | null;
  installNotes: string | null;
  statusUpdate: string | null;
  lat?: number | null;
  lng?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(s: string | null | undefined, q: string): string {
  if (!q || !s) return esc(s);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return esc(s).replace(re, '<mark style="background:rgba(245,158,11,0.3);color:inherit;padding:0 2px">$1</mark>');
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const kpiStyle: React.CSSProperties = {
  background: "var(--riq-surface)",
  border: "1px solid var(--riq-border)",
  borderRadius: 8,
  padding: "14px 16px",
};

const inputStyle: React.CSSProperties = {
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const NOTE_TYPES = [
  { value: "",              label: "All types" },
  { value: "upsellNotes",  label: "Upsell notes" },
  { value: "notes",        label: "General notes" },
  { value: "installNotes", label: "Install notes" },
  { value: "statusUpdate", label: "Status updates" },
] as const;


const STAGE_OPTS = [
  "Job Completed",
  "Pending Approval",
  "Appointment Pending",
  "Inspection Pending",
  "Dead",
  "Scheduled",
  "Downpayment",
] as const;

type NoteTypeKey = "upsellNotes" | "notes" | "installNotes" | "statusUpdate";

function noteCardBorderStyle(type: NoteTypeKey): React.CSSProperties {
  const map: Record<NoteTypeKey, React.CSSProperties> = {
    upsellNotes:  { background: "rgba(245,158,11,0.1)",  borderLeft: "3px solid #f59e0b" },
    notes:        { background: "rgba(16,185,129,0.08)", borderLeft: "3px solid #10b981" },
    installNotes: { background: "rgba(94,200,255,0.1)",  borderLeft: "3px solid var(--riq-accent)" },
    statusUpdate: { background: "rgba(168,139,250,0.08)",borderLeft: "3px solid #a78bfa" },
  };
  return { ...map[type], padding: "8px 10px", borderRadius: "0 4px 4px 0", marginTop: 6 };
}

const LABEL_MAP: Record<NoteTypeKey, string> = {
  upsellNotes:  "Upsell",
  notes:        "Notes",
  installNotes: "Install",
  statusUpdate: "Status",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Notes({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [all, setAll] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [fSearch, setFSearch] = useState("");
  const [fType, setFType] = useState("");
  const [fState, setFState] = useState("");
  const [fRep, setFRep] = useState("");
  const [fCarrier, setFCarrier] = useState("");
  const [fJobType] = useState("");
  const [fStage, setFStage] = useState("");
  const [fSince, setFSince] = useState("");

  useEffect(() => {
    fetch("/api/intel/notes", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NoteRow[]>;
      })
      .then((d) => { setAll(d); setLoading(false); })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>
      </div>
    );
  }

  // Derived filter option lists
  const states   = [...new Set(all.map((n) => n.state).filter(Boolean) as string[])].sort();
  const reps     = [...new Set(all.map((n) => n.salesRep).filter(Boolean) as string[])].sort();
  const carriers = [...new Set(all.map((n) => n.insurance).filter(Boolean) as string[])].sort();

  // Apply filters
  const q = fSearch.trim().toLowerCase();
  let filtered = all;
  if (fType) filtered = filtered.filter((r) => r[fType as NoteTypeKey]);
  if (q) filtered = filtered.filter((r) =>
    [r.notes, r.installNotes, r.upsellNotes, r.statusUpdate, r.customer, r.address].some(
      (f) => f && f.toLowerCase().includes(q)
    )
  );
  if (fState)   filtered = filtered.filter((r) => r.state === fState);
  if (fRep)     filtered = filtered.filter((r) => r.salesRep === fRep);
  if (fCarrier) filtered = filtered.filter((r) => r.insurance === fCarrier);
  if (fJobType) filtered = filtered.filter((r) => (r as NoteRow & { jobType?: string }).jobType === fJobType);
  if (fStage)   filtered = filtered.filter((r) => r.stage === fStage);
  if (fSince)   filtered = filtered.filter((r) => r.signedDate && r.signedDate >= fSince);

  const display = filtered.slice(0, 300);

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { l: "Total jobs with notes", v: all.length.toLocaleString() },
          { l: "Upsell notes",          v: all.filter((n) => n.upsellNotes).length.toLocaleString() },
          { l: "General notes",         v: all.filter((n) => n.notes).length.toLocaleString() },
          { l: "Install notes",         v: all.filter((n) => n.installNotes).length.toLocaleString() },
          { l: "Status updates",        v: all.filter((n) => n.statusUpdate).length.toLocaleString() },
        ].map(({ l, v }) => (
          <div key={l} style={kpiStyle}>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: "var(--riq-accent)", marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "flex-end", marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Search notes (text)
            <input
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="e.g. dog, gate, supplement, leak"
              style={{ ...inputStyle, width: 320 }}
            />
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Note type
            <select value={fType} onChange={(e) => setFType(e.target.value)} style={selectStyle}>
              {NOTE_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            State
            <select value={fState} onChange={(e) => setFState(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Sales Rep
            <select value={fRep} onChange={(e) => setFRep(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {reps.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Carrier
            <select value={fCarrier} onChange={(e) => setFCarrier(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Stage
            <select value={fStage} onChange={(e) => setFStage(e.target.value)} style={selectStyle}>
              <option value="">All</option>
              {STAGE_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
            Signed since
            <input type="date" value={fSince} onChange={(e) => setFSince(e.target.value)} style={{ ...inputStyle, width: 130 }} />
          </label>
        </div>

        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
          {filtered.length.toLocaleString()} matching jobs
          {filtered.length > 300 ? ` (showing first 300)` : ""}
        </div>

        {/* Results */}
        <div style={{ maxHeight: 820, overflowY: "auto" }}>
          {display.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>No matches.</div>
          ) : (
            display.map((r) => (
              <div
                key={r.id}
                style={{
                  background: "#342c23",
                  border: "1px solid var(--riq-border)",
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 12,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--riq-accent)" }}>{r.customer ?? "—"}</span>
                    <span style={{ color: "var(--riq-text-muted)", fontSize: 12, marginLeft: 8 }}>{r.address ?? ""}</span>
                  </div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                    {r.insurance ?? "—"} · {r.salesRep ?? "—"} · {r.stage ?? "—"} · {r.signedDate ?? "—"} · #{r.id}
                  </div>
                </div>

                {/* Note blocks */}
                {(["notes", "upsellNotes", "installNotes", "statusUpdate"] as NoteTypeKey[]).map((key) => {
                  const text = r[key];
                  if (!text) return null;
                  return (
                    <div key={key} style={noteCardBorderStyle(key)}>
                      <span style={{ fontSize: 10, textTransform: "uppercase" as const, color: "var(--riq-text-muted)", marginRight: 6 }}>
                        {LABEL_MAP[key]}
                      </span>
                      <span
                        style={{ whiteSpace: "pre-wrap" as const, lineHeight: 1.5, fontSize: 13 }}
                        dangerouslySetInnerHTML={{ __html: highlight(text, q) }}
                      />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
