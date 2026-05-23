/**
 * Storm Hub — Playbook tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/storm-playbook.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/storm-playbook → array of PlaybookStorm (storms × trade-gap buckets)
 *   No secondary fetches — all data arrives in one blob.
 *
 * Storm selection: internal picker (list sorted by affectedCustomers, auto-select first).
 * Trade selection: tab-style picker (auto-select first trade by bucket size).
 * No props — owns all state.
 */
import { useState, useEffect, useMemo } from "react";
import { useFetch } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface PlaybookCustomer {
  customer: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  carrier: string | null;
  rep: string | null;
  trades: string[];
  lat: number | null;
  lng: number | null;
}

interface PlaybookStorm {
  stormDate: string;
  stormType: string;
  stormMagnitude: number | null;
  stormUnit: string | null;
  stormCity: string | null;
  stormCounty: string | null;
  stormState: string;
  affectedCustomers: number;
  tradeGapBuckets: Record<string, PlaybookCustomer[]>;
}

// The endpoint returns an array directly
type PlaybookResponse = PlaybookStorm[];

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--riq-surface)",
  fontSize: 12,
  verticalAlign: "top",
};

const pillDoneStyle: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(16,185,129,0.2)",
  color: "#10b981",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 11,
  marginRight: 2,
};

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCSV(storm: PlaybookStorm, trade: string) {
  const rows = storm.tradeGapBuckets[trade] ?? [];
  const headers = ["Customer", "Address", "City", "State", "Zip", "Phone", "Email", "Carrier", "Rep", "Trades", "Lat", "Lng"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const row = [
      r.customer, r.address, r.city, r.state, r.zip,
      r.phone, r.email, r.carrier, r.rep,
      (r.trades ?? []).join(";"), r.lat, r.lng,
    ].map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`));
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const tag = `${(storm.stormDate ?? "").slice(0, 10)}-${trade.replace(/[^a-z0-9]+/gi, "_")}`;
  a.download = `storm-playbook-${tag}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Storm list item
// ---------------------------------------------------------------------------

function StormListItem({
  storm,
  active,
  onClick,
}: {
  storm: PlaybookStorm;
  active: boolean;
  onClick: () => void;
}) {
  const date = (storm.stormDate ?? "").slice(0, 10);
  const daysAgo = Math.floor((Date.now() - new Date(storm.stormDate).getTime()) / 86_400_000);
  const typeCls = storm.stormType === "HAIL" ? "hail" : "wind";
  const pillColor = typeCls === "hail" ? "#a78bfa" : "var(--riq-accent)";
  const pillBg = typeCls === "hail" ? "rgba(168,139,250,0.2)" : "rgba(94,200,255,0.2)";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px",
        border: `1px solid ${active ? "var(--riq-accent)" : "var(--riq-border)"}`,
        background: active ? "rgba(244,167,56,0.08)" : "transparent",
        borderRadius: 6,
        marginBottom: 8,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "var(--riq-accent)", fontSize: 14 }}>{date}</span>
        <span
          style={{
            background: "rgba(94,200,255,0.2)",
            color: "var(--riq-accent)",
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {storm.affectedCustomers} customers
        </span>
      </div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 4 }}>
        <span
          style={{
            display: "inline-block",
            background: pillBg,
            color: pillColor,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 11,
            marginRight: 6,
          }}
        >
          {storm.stormType}
        </span>
        {storm.stormMagnitude} {storm.stormUnit ?? ""} · {daysAgo}d ago
      </div>
      <div style={{ color: "var(--riq-text)", fontSize: 12, marginTop: 2 }}>
        {storm.stormCity ?? ""}, {storm.stormCounty ?? ""}, {storm.stormState}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right pane — storm detail with trade tabs and customer table
// ---------------------------------------------------------------------------

function StormDetail({ storm }: { storm: PlaybookStorm }) {
  const trades = useMemo(
    () =>
      Object.keys(storm.tradeGapBuckets).sort(
        (a, b) => (storm.tradeGapBuckets[b]?.length ?? 0) - (storm.tradeGapBuckets[a]?.length ?? 0),
      ),
    [storm],
  );

  const [activeTrade, setActiveTrade] = useState<string>(trades[0] ?? "");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");

  // Reset trade when storm changes
  useEffect(() => {
    setActiveTrade(trades[0] ?? "");
    setSearch("");
    setStateFilter("");
  }, [storm, trades]);

  const date = (storm.stormDate ?? "").slice(0, 10);
  const daysAgo = Math.floor((Date.now() - new Date(storm.stormDate).getTime()) / 86_400_000);

  const rawRows = activeTrade ? (storm.tradeGapBuckets[activeTrade] ?? []) : [];

  // Collect unique states for dropdown
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const r of rawRows) if (r.state) set.add(r.state);
    return [...set].sort();
  }, [rawRows]);

  const filtered = useMemo(() => {
    let rows = rawRows;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.customer ?? "").toLowerCase().includes(q) ||
          (r.address ?? "").toLowerCase().includes(q) ||
          (r.carrier ?? "").toLowerCase().includes(q) ||
          (r.rep ?? "").toLowerCase().includes(q),
      );
    }
    if (stateFilter) rows = rows.filter((r) => r.state === stateFilter);
    return rows;
  }, [rawRows, search, stateFilter]);

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
        {date} — {storm.stormType} {storm.stormMagnitude} {storm.stormUnit ?? ""}
      </h2>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
        {storm.stormCity ?? ""}, {storm.stormCounty ?? ""}, {storm.stormState} · {daysAgo} days ago ·{" "}
        {storm.affectedCustomers} customers within 2 miles
      </div>

      {/* Trade tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 14,
          borderBottom: "1px solid var(--riq-border)",
          flexWrap: "wrap",
        }}
      >
        {trades.map((t) => (
          <div
            key={t}
            onClick={() => setActiveTrade(t)}
            style={{
              padding: "8px 14px",
              cursor: "pointer",
              color: t === activeTrade ? "var(--riq-accent)" : "var(--riq-text-muted)",
              borderBottom: `2px solid ${t === activeTrade ? "var(--riq-accent)" : "transparent"}`,
              fontSize: 12,
            }}
          >
            {t}{" "}
            <span style={{ fontSize: 11, color: t === activeTrade ? "var(--riq-accent)" : "var(--riq-text-muted)" }}>
              {storm.tradeGapBuckets[t]?.length ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          Search
          <input
            type="text"
            placeholder="customer / address / carrier / rep"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: 280,
              background: "var(--riq-bg)",
              color: "var(--riq-text)",
              border: "1px solid var(--riq-border)",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          State
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            style={{
              background: "var(--riq-bg)",
              color: "var(--riq-text)",
              border: "1px solid var(--riq-border)",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            <option value="">All</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          &nbsp;
          <button
            onClick={() => activeTrade && exportCSV(storm, activeTrade)}
            style={{
              background: "var(--riq-accent)",
              color: "#1a1612",
              border: "none",
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Export CSV
          </button>
        </label>
      </div>

      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
        {filtered.length} customers missing {activeTrade}
      </div>

      <div style={{ maxHeight: 600, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Address</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Carrier</th>
              <th style={thStyle}>Phone / Email</th>
              <th style={thStyle}>Rep</th>
              <th style={thStyle}>Trades on file</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td style={tdStyle}>
                  <strong>{r.customer ?? "—"}</strong>
                </td>
                <td style={tdStyle}>
                  {r.address ?? "—"}
                  <br />
                  <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                    {r.city ?? ""} {r.zip ?? ""}
                  </span>
                </td>
                <td style={tdStyle}>{r.state ?? "—"}</td>
                <td style={tdStyle}>{r.carrier ?? "—"}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 12 }}>{r.phone ?? ""}</span>
                  {r.phone && r.email && <br />}
                  <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{r.email ?? ""}</span>
                </td>
                <td style={tdStyle}>{r.rep ?? "—"}</td>
                <td style={tdStyle}>
                  {(r.trades ?? []).map((t) => (
                    <span key={t} style={pillDoneStyle}>
                      {t}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StormPlaybook() {
  const { data, loading, error } = useFetch<PlaybookResponse>("/api/intel/storm-playbook");

  const [activeIdx, setActiveIdx] = useState(0);

  const playbook = data ?? [];

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}
      {error && (
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load storm playbook: {error}</div>
      )}
      {!loading && !error && playbook.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>
          No recent storms with ≥3 affected customers.
        </div>
      )}
      {!loading && !error && playbook.length > 0 && (
        <>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 12 }}>
            Last 180 days of strong storms (hail ≥0.75" / wind ≥55mph). Pick a storm, then a trade gap → instant
            call list of customers in the storm's path who don't yet have that trade.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "360px 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Left pane — storm list */}
            <div
              style={{
                background: "var(--riq-surface)",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "16px 20px",
              }}
            >
              <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
                Recent strong storms
              </h2>
              <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
                {playbook.length} storms · sorted by customers affected
              </div>
              <div style={{ maxHeight: 720, overflowY: "auto" }}>
                {playbook.map((s, idx) => (
                  <StormListItem
                    key={idx}
                    storm={s}
                    active={idx === activeIdx}
                    onClick={() => setActiveIdx(idx)}
                  />
                ))}
              </div>
            </div>

            {/* Right pane — storm detail */}
            <div
              style={{
                background: "var(--riq-surface)",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "16px 20px",
              }}
            >
              {playbook[activeIdx] ? (
                <StormDetail key={activeIdx} storm={playbook[activeIdx]} />
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>
                  Pick a storm
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
