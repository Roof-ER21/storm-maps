/**
 * Carrier Orphans — native React (Phase 2d batch1)
 * IntelView id: "carrier-orphans"
 *
 * Data: /api/intel/carrier-orphans
 *
 * Sections:
 *   1. Summary stats (total, actionable, with docs, top-priority)
 *   2. Stage distribution
 *   3. Rep breakdown
 *   4. Filter controls (stage / rep / docs)
 *   5. Sortable table (500-row limit)
 */

import { useState, useMemo } from "react";
import { useFetch, KpiCard, CardRow, Panel } from "../../../homes/HomeCommon";
import type { NativeViewComponent } from "../types";

// ---------------------------------------------------------------------------
// Response shape (verified against /api/intel/carrier-orphans)
// ---------------------------------------------------------------------------
interface OrphanJob {
  jobId: number;
  stage: string;
  address: string;
  hasDocs: boolean;
  jobType: string;
  customer: string;
  hasClaim: boolean;
  jobTotal: number;
  priority: string;
  salesRep: string;
  portalUrl: string;
  signedDate: string;
  claimNumber: string | null;
  hasAdjuster: boolean;
  adjusterName: string | null;
  customerCell: string | null;
  completedDate: string | null;
  customerEmail: string | null;
}

interface CarrierOrphansResponse {
  all: OrphanJob[];
  byRep: { rep: string; count: number }[];
  byStage: Record<string, number>;
  withDocs: number;
  generated: string;
  actionable: OrphanJob[];
  topPriority: OrphanJob[];
  totalOrphans: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type SortDir = "asc" | "desc";
type SortKey = keyof OrphanJob;

const MAX_ROWS = 500;

function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function priorityColor(p: string): string {
  switch ((p ?? "").toLowerCase()) {
    case "high": return "#ef4444";
    case "medium": return "#f59e0b";
    case "low": return "#22c55e";
    default: return "var(--riq-text-muted)";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export const CarrierOrphans: NativeViewComponent = function CarrierOrphans({ navigate: _navigate }) {
  const { data, loading, error } = useFetch<CarrierOrphansResponse>("/api/intel/carrier-orphans");

  const [filterStage, setFilterStage] = useState("all");
  const [filterRep, setFilterRep] = useState("all");
  const [filterDocs, setFilterDocs] = useState("all"); // "all" | "yes" | "no"
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const stages = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.byStage).sort();
  }, [data]);

  const reps = useMemo(() => {
    if (!data) return [];
    return data.byRep.map(r => r.rep).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.all;
    if (filterStage !== "all") rows = rows.filter(r => r.stage === filterStage);
    if (filterRep !== "all") rows = rows.filter(r => r.salesRep === filterRep);
    if (filterDocs === "yes") rows = rows.filter(r => r.hasDocs);
    if (filterDocs === "no") rows = rows.filter(r => !r.hasDocs);
    return rows;
  }, [data, filterStage, filterRep, filterDocs]);

  const sorted = useMemo(() => {
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...filtered]
      .sort((a, b) => {
        if (sortKey === "priority") {
          const ao = priorityOrder[(a.priority ?? "").toLowerCase()] ?? 99;
          const bo = priorityOrder[(b.priority ?? "").toLowerCase()] ?? 99;
          return sortDir === "asc" ? ao - bo : bo - ao;
        }
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") {
          return sortDir === "desc" ? bv - av : av - bv;
        }
        const as_ = String(av ?? "");
        const bs_ = String(bv ?? "");
        return sortDir === "desc" ? bs_.localeCompare(as_) : as_.localeCompare(bs_);
      })
      .slice(0, MAX_ROWS);
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", color: "var(--riq-text-muted)" }}>
        Loading carrier orphans…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: "20px 24px", color: "#ef4444" }}>
        Failed to load carrier orphans: {error ?? "No data"}
      </div>
    );
  }

  function Th({ k, label }: { k: SortKey; label: string }) {
    const active = k === sortKey;
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{
          cursor: "pointer",
          padding: "8px 10px",
          textAlign: "left",
          fontSize: 12,
          fontWeight: active ? 700 : 500,
          color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
          background: "var(--riq-surface)",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}{active ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
      </th>
    );
  }

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Carrier Orphans</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--riq-text-muted)" }}>
          Jobs where the insurance carrier was never identified — risk of unpaid completion.
          Generated: {fmtDate(data.generated)}
        </p>
      </div>

      {/* Summary KPIs */}
      <CardRow>
        <KpiCard label="Total Orphans" value={data.totalOrphans.toLocaleString()} />
        <KpiCard label="Actionable" value={data.actionable.length.toLocaleString()} />
        <KpiCard label="Top Priority" value={data.topPriority.length.toLocaleString()} />
        <KpiCard label="Have Docs" value={data.withDocs.toLocaleString()} />
      </CardRow>

      {/* Stage breakdown */}
      <div style={{ marginTop: 20 }}><Panel title="Stage Distribution">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stages.map(s => (
            <div key={s} style={{
              padding: "6px 12px",
              background: "var(--riq-surface)",
              borderRadius: 20,
              fontSize: 13,
              border: "1px solid var(--riq-border)",
            }}>
              <span style={{ fontWeight: 600 }}>{s}</span>
              <span style={{ marginLeft: 8, color: "var(--riq-text-muted)" }}>
                {data.byStage[s]}
              </span>
            </div>
          ))}
        </div>
      </Panel></div>

      {/* Rep breakdown */}
      <div style={{ marginTop: 16 }}><Panel title="By Rep">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.byRep
            .sort((a, b) => b.count - a.count)
            .map(r => (
              <div key={r.rep} style={{
                padding: "6px 12px",
                background: "var(--riq-surface)",
                borderRadius: 20,
                fontSize: 13,
                border: "1px solid var(--riq-border)",
              }}>
                <span style={{ fontWeight: 600 }}>{r.rep || "Unassigned"}</span>
                <span style={{ marginLeft: 8, color: "var(--riq-text-muted)" }}>{r.count}</span>
              </div>
            ))}
        </div>
      </Panel></div>

      {/* Filters */}
      <div style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        margin: "20px 0 16px",
        padding: "14px 16px",
        background: "var(--riq-surface)",
        borderRadius: 8,
        border: "1px solid var(--riq-border)",
        alignItems: "center",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--riq-text-muted)" }}>Filter:</span>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>Stage</label>
          <select
            value={filterStage}
            onChange={e => setFilterStage(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--riq-border)", fontSize: 13, background: "var(--riq-bg)", color: "var(--riq-text)" }}
          >
            <option value="all">All Stages</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>Rep</label>
          <select
            value={filterRep}
            onChange={e => setFilterRep(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--riq-border)", fontSize: 13, background: "var(--riq-bg)", color: "var(--riq-text)" }}
          >
            <option value="all">All Reps</option>
            {reps.map(r => <option key={r} value={r}>{r || "Unassigned"}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>Docs</label>
          <select
            value={filterDocs}
            onChange={e => setFilterDocs(e.target.value)}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--riq-border)", fontSize: 13, background: "var(--riq-bg)", color: "var(--riq-text)" }}
          >
            <option value="all">All</option>
            <option value="yes">Has Docs</option>
            <option value="no">No Docs</option>
          </select>
        </div>

        <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--riq-text-muted)" }}>
          Showing {sorted.length.toLocaleString()} of {filtered.length.toLocaleString()}
          {filtered.length > MAX_ROWS && ` (capped at ${MAX_ROWS})`}
        </div>
      </div>

      {/* Main table */}
      <Panel title="Orphan Job List">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th k="priority" label="Priority" />
                <Th k="customer" label="Customer" />
                <Th k="address" label="Address" />
                <Th k="stage" label="Stage" />
                <Th k="salesRep" label="Rep" />
                <Th k="jobTotal" label="Job $" />
                <Th k="hasDocs" label="Docs" />
                <Th k="hasClaim" label="Claim" />
                <Th k="signedDate" label="Signed" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.jobId}
                  style={{
                    background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                    borderBottom: "1px solid var(--riq-border)",
                  }}
                >
                  <td style={{ padding: "7px 10px" }}>
                    <span style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: priorityColor(row.priority) + "20",
                      color: priorityColor(row.priority),
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}>
                      {row.priority || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.customer}</td>
                  <td style={{ padding: "7px 10px", fontSize: 12 }}>{row.address}</td>
                  <td style={{ padding: "7px 10px" }}>{row.stage}</td>
                  <td style={{ padding: "7px 10px" }}>{row.salesRep || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>
                    {fmt$(row.jobTotal)}
                  </td>
                  <td style={{
                    padding: "7px 10px",
                    textAlign: "center",
                    color: row.hasDocs ? "#22c55e" : "#ef4444",
                    fontWeight: 700,
                  }}>
                    {row.hasDocs ? "✓" : "✗"}
                  </td>
                  <td style={{
                    padding: "7px 10px",
                    textAlign: "center",
                    color: row.hasClaim ? "#22c55e" : "var(--riq-text-muted)",
                  }}>
                    {row.hasClaim ? row.claimNumber || "✓" : "—"}
                  </td>
                  <td style={{ padding: "7px 10px", fontSize: 12 }}>
                    {fmtDate(row.signedDate)}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "20px", textAlign: "center", color: "var(--riq-text-muted)" }}>
                    No orphans match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};
