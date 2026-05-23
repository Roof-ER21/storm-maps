/**
 * Pricing Hub — Library tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/pricing-library.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/pricing-library → single response blob with totals +
 *      materialsByTrade + projectItemsByTrade + components + trades
 *
 * Internal tab picker: Materials | Project items | Components | Trades
 * Filter state: trade dropdown + text search on Materials and Project items.
 * No props — owns all state.
 */
import { useState, useEffect, useMemo } from "react";
import { useFetch, KpiCard, CardRow } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface MaterialItem {
  description?: string;
  displayName?: string;
  subtrade?: string | null;
  component?: string | null;
  /** unit/ordering string shown as a pill */
  ordering?: string | null;
  price?: number | null;
}

interface MaterialsByTradeEntry {
  count: number;
  avgPrice: number | null;
  items: MaterialItem[];
}

interface ProjectItem {
  description?: string;
  subtrade?: string | null;
  component?: string | null;
  selectionType?: string | null;
  markUpPercent?: number | null;
  componentCount: number;
}

interface ComponentEntry {
  component: string;
  description?: string | null;
}

interface TradeEntry {
  tradeID: number;
  name: string;
}

interface LibraryTotals {
  trades: number | null;
  components: number | null;
  materials: number | null;
  projectItems: number | null;
}

interface PricingLibraryResponse {
  totals: LibraryTotals;
  materialsByTrade: Record<string, MaterialsByTradeEntry>;
  projectItemsByTrade: Record<string, ProjectItem[]>;
  components: ComponentEntry[];
  trades: TradeEntry[];
}

// ---------------------------------------------------------------------------
// Internal tab type
// ---------------------------------------------------------------------------

type LibTab = "materials" | "project" | "components" | "trades";

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-surface)",
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 600, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Formatters (matching the HTML's fmt helpers exactly)
// ---------------------------------------------------------------------------

function fmtMoney2(v: number | null | undefined): string {
  if (v == null || v === 0) return "—";
  return "$" + Number(v).toFixed(2);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

// ---------------------------------------------------------------------------
// Sub-section: Materials
// ---------------------------------------------------------------------------

function MaterialsSection({ data, allTrades }: { data: PricingLibraryResponse; allTrades: string[] }) {
  const [tradeFilter, setTradeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  // Debounce search to match HTML's 200ms setTimeout
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useMemo(() => {
    const out: (MaterialItem & { trade: string })[] = [];
    for (const [t, v] of Object.entries(data.materialsByTrade ?? {})) {
      if (tradeFilter && t !== tradeFilter) continue;
      for (const m of v.items) out.push({ ...m, trade: t });
    }
    if (!searchDebounced) return out;
    return out.filter(
      (r) =>
        (r.description ?? "").toLowerCase().includes(searchDebounced) ||
        (r.component ?? "").toLowerCase().includes(searchDebounced),
    );
  }, [data.materialsByTrade, tradeFilter, searchDebounced]);

  const inputStyle: React.CSSProperties = {
    background: "var(--riq-surface)",
    color: "var(--riq-text)",
    border: "1px solid var(--riq-border)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  };

  const pillStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: "var(--riq-bg)",
    color: "var(--riq-text-muted)",
  };

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          Trade
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            style={inputStyle}
          >
            <option value="">All trades</option>
            {allTrades.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          Search
          <input
            type="text"
            placeholder="material name / component"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 280 }}
          />
        </label>
      </div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginBottom: 8 }}>
        {rows.length} materials
      </div>
      <div style={scrollBox}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Material</th>
              <th style={thStyle}>Trade</th>
              <th style={thStyle}>Subtrade</th>
              <th style={thStyle}>Component</th>
              <th style={thStyle}>Unit</th>
              <th style={thNumStyle}>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={i}>
                <td style={tdStyle}>{m.description ?? m.displayName ?? "—"}</td>
                <td style={tdStyle}>{m.trade}</td>
                <td style={{ ...tdStyle, color: "var(--riq-text-muted)" }}>{m.subtrade ?? "—"}</td>
                <td style={tdStyle}>{m.component ?? "—"}</td>
                <td style={tdStyle}>
                  <span style={pillStyle}>{m.ordering ?? "—"}</span>
                </td>
                <td style={tdNumStyle}>{fmtMoney2(m.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-section: Project items
// ---------------------------------------------------------------------------

function ProjectSection({ data, allTrades }: { data: PricingLibraryResponse; allTrades: string[] }) {
  const [tradeFilter, setTradeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useMemo(() => {
    const out: (ProjectItem & { trade: string })[] = [];
    for (const [t, items] of Object.entries(data.projectItemsByTrade ?? {})) {
      if (tradeFilter && t !== tradeFilter) continue;
      for (const p of items) out.push({ ...p, trade: t });
    }
    if (!searchDebounced) return out;
    return out.filter(
      (r) =>
        (r.description ?? "").toLowerCase().includes(searchDebounced) ||
        (r.component ?? "").toLowerCase().includes(searchDebounced),
    );
  }, [data.projectItemsByTrade, tradeFilter, searchDebounced]);

  const inputStyle: React.CSSProperties = {
    background: "var(--riq-surface)",
    color: "var(--riq-text)",
    border: "1px solid var(--riq-border)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  };

  const pillStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: "var(--riq-bg)",
    color: "var(--riq-text-muted)",
  };

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          Trade
          <select
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            style={inputStyle}
          >
            <option value="">All trades</option>
            {allTrades.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          Search
          <input
            type="text"
            placeholder="description / component"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 280 }}
          />
        </label>
      </div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginBottom: 8 }}>
        {rows.length} project items
      </div>
      <div style={scrollBox}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Trade</th>
              <th style={thStyle}>Subtrade</th>
              <th style={thStyle}>Component</th>
              <th style={thStyle}>Selection</th>
              <th style={thNumStyle}>Markup %</th>
              <th style={thNumStyle}>Line items</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i}>
                <td style={tdStyle}>{p.description ?? "—"}</td>
                <td style={tdStyle}>{p.trade}</td>
                <td style={{ ...tdStyle, color: "var(--riq-text-muted)" }}>{p.subtrade ?? "—"}</td>
                <td style={tdStyle}>{p.component ?? "—"}</td>
                <td style={tdStyle}>
                  <span style={pillStyle}>{p.selectionType ?? "—"}</span>
                </td>
                <td style={tdNumStyle}>
                  {p.markUpPercent != null ? p.markUpPercent + "%" : "—"}
                </td>
                <td style={tdNumStyle}>{p.componentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-section: Components
// ---------------------------------------------------------------------------

function ComponentsSection({ data }: { data: PricingLibraryResponse }) {
  return (
    <div style={scrollBox}>
      <table style={tblStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Component</th>
            <th style={thStyle}>Description</th>
          </tr>
        </thead>
        <tbody>
          {(data.components ?? []).map((c, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <strong>{c.component}</strong>
              </td>
              <td style={{ ...tdStyle, color: "var(--riq-text-muted)" }}>{c.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-section: Trades
// ---------------------------------------------------------------------------

function TradesSection({ data }: { data: PricingLibraryResponse }) {
  const matByTrade = data.materialsByTrade ?? {};
  const projByTrade = data.projectItemsByTrade ?? {};

  return (
    <table style={tblStyle}>
      <thead>
        <tr>
          <th style={thNumStyle}>ID</th>
          <th style={thStyle}>Trade</th>
          <th style={thNumStyle}>Materials</th>
          <th style={thNumStyle}>Project items</th>
          <th style={thNumStyle}>Avg material $</th>
        </tr>
      </thead>
      <tbody>
        {(data.trades ?? []).map((t) => {
          const m = matByTrade[t.name];
          const p = projByTrade[t.name];
          return (
            <tr key={t.tradeID}>
              <td style={tdNumStyle}>{t.tradeID}</td>
              <td style={tdStyle}>
                <strong>{t.name}</strong>
              </td>
              <td style={tdNumStyle}>{m ? m.count : 0}</td>
              <td style={tdNumStyle}>{p ? p.length : 0}</td>
              <td style={tdNumStyle}>{m?.avgPrice ? fmtMoney2(m.avgPrice) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PricingLibrary() {
  const result = useFetch<PricingLibraryResponse>("/api/intel/pricing-library");
  const [activeTab, setActiveTab] = useState<LibTab>("materials");

  const allTrades = useMemo(() => {
    if (!result.data) return [];
    return [
      ...new Set([
        ...Object.keys(result.data.materialsByTrade ?? {}),
        ...Object.keys(result.data.projectItemsByTrade ?? {}),
      ]),
    ].sort();
  }, [result.data]);

  const tabs: { id: LibTab; label: string }[] = [
    { id: "materials", label: "Materials (227)" },
    { id: "project", label: "Project items (96)" },
    { id: "components", label: "Components (72)" },
    { id: "trades", label: "Trades (14)" },
  ];

  const sectionH2: React.CSSProperties = {
    margin: "0 0 6px",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--riq-accent)",
  };

  const descStyle: React.CSSProperties = {
    color: "var(--riq-text-muted)",
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 1.5,
  };

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {result.loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}

      {result.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load: {result.error}
        </div>
      )}

      {!result.loading && !result.error && result.data && (() => {
        const d = result.data;
        const t = d.totals ?? ({} as LibraryTotals);

        return (
          <>
            {/* Overview tiles */}
            <div
              style={{
                background: "var(--riq-surface)",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "18px 22px",
                marginBottom: 16,
              }}
            >
              <h2 style={sectionH2}>Library overview</h2>
              <p style={descStyle}>
                Reference catalogue from the portal&apos;s pricing system. Use as a lookup — &ldquo;what materials are available for Roofing?&rdquo;, &ldquo;which project-meeting items have the highest markup?&rdquo;, etc. Cross-references with the Pricing Margins page for the contractor-cost view.
              </p>
              <CardRow>
                <KpiCard label="Trades" value={fmtInt(t.trades)} />
                <KpiCard label="Components" value={fmtInt(t.components)} />
                <KpiCard label="Materials" value={fmtInt(t.materials)} />
                <KpiCard label="Project items" value={fmtInt(t.projectItems)} />
              </CardRow>
            </div>

            {/* Tabbed section */}
            <div
              style={{
                background: "var(--riq-surface)",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "18px 22px",
                marginBottom: 16,
              }}
            >
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 16,
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "10px 18px",
                      cursor: "pointer",
                      color: activeTab === tab.id ? "var(--riq-accent)" : "var(--riq-text-muted)",
                      borderBottom: `2px solid ${activeTab === tab.id ? "var(--riq-accent)" : "transparent"}`,
                      fontSize: 13,
                    }}
                  >
                    {tab.label}
                  </div>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === "materials" && (
                <MaterialsSection data={d} allTrades={allTrades} />
              )}
              {activeTab === "project" && (
                <ProjectSection data={d} allTrades={allTrades} />
              )}
              {activeTab === "components" && (
                <ComponentsSection data={d} />
              )}
              {activeTab === "trades" && (
                <TradesSection data={d} />
              )}
            </div>

            {/* Footnote */}
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 10 }}>
              Source: <code>/api/intel/pricing-library</code>. Built from 4 portal reference tables (
              <code>pricing-material</code> + <code>pricing-project</code> +{" "}
              <code>pricing-components</code> + <code>trades</code>).
            </div>
          </>
        );
      })()}
    </div>
  );
}
