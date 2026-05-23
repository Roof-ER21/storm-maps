/**
 * Denial Combat Hub — Archive tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/denial-archive.html.
 *
 * Data flow:
 *   1. On mount (and on filter change / refresh): GET /api/intel/denial-intake/list?carrier=<filter>&limit=200
 *      + GET /api/intel/denial-intake/stats  (parallel)
 *   2. Outcome form: POST /api/intel/denial-intake/:id/outcome
 *      { outcome, outcomeDate?, counterSent?, notes? }
 *
 * Carrier filter is debounced; outcome filter is local (no re-fetch).
 * No props — owns all state.
 */
import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface IntakeEntry {
  id: number;
  created_at: string | null;
  carrier: string | null;
  identified_carrier: string | null;
  identified_adjuster: string | null;
  claim_number: string | null;
  appeal_strength: string | null;
  latest_outcome: string | null;
  preview: string | null;
}

interface StatsResponse {
  total: number;
  byOutcome: Array<{ outcome: string; count: number }>;
  byCarrier: Array<{ carrier: string; count: number }>;
}

interface ListResponse {
  entries: IntakeEntry[];
  count: number;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const ACCENT = "var(--riq-accent)";
const MUTED = "var(--riq-text-muted)";
const TEXT = "var(--riq-text)";
const SURFACE = "var(--riq-surface)";
const BORDER = "var(--riq-border)";
const BG = "var(--riq-bg)";

const RED = "#ef4444";
const GREEN = "#10b981";
const YELLOW = "#f59e0b";

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: MUTED,
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: `1px solid ${BORDER}`,
};

const tdStyle: React.CSSProperties = {
  padding: "7px 6px",
  borderBottom: "1px solid #342c23",
  verticalAlign: "top",
};

// ---------------------------------------------------------------------------
// Pill helpers
// ---------------------------------------------------------------------------

function OutcomePill({ outcome }: { outcome: string | null }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    approved: { bg: "rgba(16,185,129,0.2)", color: GREEN, label: "✓ Approved" },
    partial: { bg: "rgba(245,158,11,0.2)", color: YELLOW, label: "◐ Partial" },
    denied: { bg: "rgba(239,68,68,0.2)", color: RED, label: "✗ Denied" },
    pending: { bg: "#342c23", color: MUTED, label: "… Pending" },
    withdrawn: { bg: "#342c23", color: MUTED, label: "↩ Withdrawn" },
  };
  const s = outcome ? map[outcome] : null;
  if (!s) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: "#342c23",
          color: MUTED,
        }}
      >
        —
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

function AppealPill({ strength }: { strength: string | null }) {
  if (!strength) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: "#342c23",
          color: MUTED,
        }}
      >
        —
      </span>
    );
  }
  const isGood = strength === "very-strong" || strength === "strong";
  const isMed = strength === "moderate";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: isGood ? "rgba(16,185,129,0.2)" : isMed ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)",
        color: isGood ? GREEN : isMed ? YELLOW : RED,
      }}
    >
      {strength}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline outcome form — renders as a separate row below the target row
// ---------------------------------------------------------------------------

function OutcomeFormRow({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [outcome, setOutcome] = useState("");
  const [outcomeDate, setOutcomeDate] = useState(today);
  const [counterSent, setCounterSent] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    background: "#342c23",
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderRadius: 4,
    padding: "5px 8px",
    fontFamily: "inherit",
    fontSize: 12,
  };

  async function submit() {
    if (!outcome) { alert("Pick an outcome"); return; }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/intel/denial-intake/${id}/outcome`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          outcomeDate: outcomeDate || null,
          counterSent,
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (e: unknown) {
      setErr((e as Error).message ?? String(e));
      setSaving(false);
    }
  }

  return (
    <tr>
      <td
        colSpan={9}
        style={{
          background: "#1e1a16",
          padding: "14px 18px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", fontSize: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: MUTED, fontSize: 11, textTransform: "uppercase" }}>Outcome *</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              <option value="approved">✓ Approved (full flip)</option>
              <option value="partial">◐ Partial flip</option>
              <option value="denied">✗ Denied (re-affirmed)</option>
              <option value="pending">… Still pending</option>
              <option value="withdrawn">↩ Withdrawn</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: MUTED, fontSize: 11, textTransform: "uppercase" }}>Outcome date</span>
            <input
              type="date"
              value={outcomeDate}
              onChange={(e) => setOutcomeDate(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 5 }}>
            <input
              type="checkbox"
              checked={counterSent}
              onChange={(e) => setCounterSent(e.target.checked)}
            />
            <span style={{ color: TEXT }}>Counter-letter sent</span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 260 }}>
            <span style={{ color: MUTED, fontSize: 11, textTransform: "uppercase" }}>
              Notes (what carrier said / what we sent)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Free-text: which arguments worked, adjuster response, etc."
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={submit}
              disabled={saving}
              style={{
                background: ACCENT,
                color: "#1a1612",
                border: "none",
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                color: MUTED,
                border: `1px solid ${BORDER}`,
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
        {err && <div style={{ marginTop: 8, color: RED, fontSize: 12 }}>Failed: {err}</div>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DenialArchive() {
  const [allEntries, setAllEntries] = useState<IntakeEntry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [carrierFilter, setCarrierFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [openFormId, setOpenFormId] = useState<number | null>(null);

  // Debounce timer ref for carrier filter
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(carrier: string) {
    setLoading(true);
    setLoadErr(null);
    try {
      const url =
        "/api/intel/denial-intake/list" +
        (carrier ? `?carrier=${encodeURIComponent(carrier)}` : "?limit=200");
      const [listRes, statsRes] = await Promise.all([
        fetch(url, { credentials: "include" }),
        fetch("/api/intel/denial-intake/stats", { credentials: "include" }),
      ]);
      const listData = (await listRes.json()) as ListResponse;
      const statsData = (await statsRes.json()) as StatsResponse;
      setAllEntries(listData.entries ?? []);
      setStats(statsData);
    } catch (e: unknown) {
      setLoadErr((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  function onCarrierChange(val: string) {
    setCarrierFilter(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(val), 500);
  }

  // Local outcome filter (no re-fetch)
  const filteredRows = allEntries.filter((r) => {
    if (outcomeFilter === "all") return true;
    if (outcomeFilter === "none") return !r.latest_outcome;
    return r.latest_outcome === outcomeFilter;
  });

  const inputStyle: React.CSSProperties = {
    background: "#342c23",
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderRadius: 5,
    padding: "7px 11px",
    fontSize: 13,
    fontFamily: "inherit",
  };

  // Stats derived values
  const outcomeOf = (k: string) =>
    (stats?.byOutcome ?? []).find((x) => x.outcome === k)?.count ?? 0;
  const statsCards: Array<{ label: string; value: number }> = [
    { label: "Total intakes", value: stats?.total ?? 0 },
    { label: "Approved", value: outcomeOf("approved") },
    { label: "Partial", value: outcomeOf("partial") },
    { label: "Denied", value: outcomeOf("denied") },
  ];

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: TEXT }}>
      {loading && (
        <div style={{ padding: 50, textAlign: "center", color: ACCENT }}>Loading archive…</div>
      )}
      {loadErr && !loading && (
        <div style={{ padding: 20, color: RED }}>Failed to load: {loadErr}</div>
      )}
      {!loading && !loadErr && (
        <>
          {/* Stats section */}
          <div
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "18px 22px",
              marginBottom: 16,
            }}
          >
            <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: ACCENT }}>
              Denial intake archive
            </h2>
            <p style={{ color: MUTED, fontSize: 13, marginBottom: 14, marginTop: 0, lineHeight: 1.5 }}>
              Every denial that flows through the Analyzer is archived here. Each row links back to the original analysis + lets you mark outcomes. As outcomes accumulate, RIQ learns which counter-letter strategies actually flip denials.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
                marginBottom: 4,
              }}
            >
              {statsCards.map((c) => (
                <div
                  key={c.label}
                  style={{ background: "#342c23", borderRadius: 6, padding: "11px 14px" }}
                >
                  <div style={{ fontSize: 21, fontWeight: 700, color: ACCENT }}>
                    {c.value.toLocaleString()}
                  </div>
                  <div style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                    {c.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table section */}
          <div
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "18px 22px",
              marginBottom: 16,
            }}
          >
            <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: ACCENT }}>
              Recent intakes
            </h2>

            {/* Filter bar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Filter by carrier (e.g. Allstate)"
                value={carrierFilter}
                onChange={(e) => onCarrierChange(e.target.value)}
                style={inputStyle}
              />
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="all">All outcomes</option>
                <option value="approved">Approved</option>
                <option value="partial">Partial</option>
                <option value="denied">Denied</option>
                <option value="pending">Pending</option>
                <option value="none">No outcome yet</option>
              </select>
              <button
                onClick={() => load(carrierFilter)}
                style={{
                  background: ACCENT,
                  color: BG,
                  border: 0,
                  padding: "7px 14px",
                  borderRadius: 5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Refresh
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    {["#", "Date", "Carrier", "Adjuster", "Claim #", "Appeal", "Outcome", "Mark", "Preview"].map(
                      (h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        style={{ padding: "60px 20px", textAlign: "center", color: MUTED }}
                      >
                        No intakes match these filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.flatMap((r) => {
                      const date = r.created_at
                        ? new Date(r.created_at).toLocaleDateString()
                        : "—";
                      const rows: React.ReactNode[] = [
                        <tr key={r.id} id={`row-${r.id}`}>
                          <td style={tdStyle}>#{r.id}</td>
                          <td style={tdStyle}>{date}</td>
                          <td style={tdStyle}>{r.identified_carrier ?? r.carrier ?? "—"}</td>
                          <td style={tdStyle}>{r.identified_adjuster ?? "—"}</td>
                          <td style={tdStyle}>{r.claim_number ?? "—"}</td>
                          <td style={tdStyle}>
                            <AppealPill strength={r.appeal_strength} />
                          </td>
                          <td style={tdStyle}>
                            <OutcomePill outcome={r.latest_outcome} />
                          </td>
                          <td style={tdStyle}>
                            <button
                              onClick={() =>
                                setOpenFormId(openFormId === r.id ? null : r.id)
                              }
                              style={{
                                background: r.latest_outcome ? "transparent" : ACCENT,
                                color: r.latest_outcome ? MUTED : "#1a1612",
                                border: r.latest_outcome ? `1px solid ${BORDER}` : "none",
                                borderRadius: 4,
                                padding: "3px 10px",
                                fontSize: 11,
                                fontWeight: r.latest_outcome ? 400 : 600,
                                cursor: "pointer",
                              }}
                            >
                              {r.latest_outcome ? "+ update" : "Mark outcome"}
                            </button>
                          </td>
                          <td style={{ ...tdStyle, maxWidth: 280 }}>
                            <div style={{ color: MUTED, fontSize: 11, marginTop: 3, lineHeight: 1.4, fontStyle: "italic" }}>
                              {(r.preview ?? "").slice(0, 200)}
                            </div>
                          </td>
                        </tr>,
                      ];
                      if (openFormId === r.id) {
                        rows.push(
                          <OutcomeFormRow
                            key={`form-${r.id}`}
                            id={r.id}
                            onClose={() => setOpenFormId(null)}
                            onSaved={() => {
                              setOpenFormId(null);
                              load(carrierFilter);
                            }}
                          />,
                        );
                      }
                      return rows;
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
