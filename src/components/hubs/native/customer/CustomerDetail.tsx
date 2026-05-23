/**
 * Customer Hub — Detail tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/customer-detail.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/quick-search?q=<query>   → typeahead results (min 2 chars)
 *   2. On customer select → GET /api/intel/customer-deep?key=<customer|address|city>
 *      → { jobs, exposure }
 *
 * Entity selection: internal search input with dropdown results, auto-selects
 * from URL param ?k= on mount (state-managed equivalent).
 * Map: real Leaflet map — single green circleMarker at the property location,
 *      dark CartoDB tile layer, zoom 14, matching the original HTML exactly.
 * No props — owns all state.
 */
import { useState, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import {
  KpiCard,
  CardRow,
  Panel,
  fmtMoney,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface JobRecord {
  id: number;
  customer: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  insurance: string | null;
  adjusterName: string | null;
  salesRep: string | null;
  stage: string | null;
  jobType: string | null;
  signedDate: string | null;
  completedDate: string | null;
  jobTotal: number | null;
  customerEmail: string | null;
  customerCell: string | null;
  customerHome: string | null;
  trades: string[];
}

interface ExposureStorm {
  date?: string;
  type?: string;
  mag?: number;
  unit?: string;
  distance?: number;
}

interface ExposureEntry {
  customer?: string;
  addressLine1?: string;
  allStorms?: ExposureStorm[];
}

interface CustomerDeepResponse {
  jobs: JobRecord[];
  exposure: ExposureEntry | null;
  took_ms: number;
}

interface QuickSearchResult {
  customer: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  insurance: string | null;
  salesRep: string | null;
}

interface QuickSearchResponse {
  results: QuickSearchResult[];
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Domain constants (match HTML)
// ---------------------------------------------------------------------------

const UPSELL = ["Siding", "Gutters & Downspouts", "Skylights", "Trim", "Windows", "Soffit & Ventilation"];
const ROOF = new Set(["Roofing", "Metal Roofing", "Flat Roofing", "Cedar Shake Roofing", "Slate Roofing"]);

function isCompleted(j: JobRecord): boolean {
  return /completed|finalized/i.test(j.stage ?? "");
}
function isDead(j: JobRecord): boolean {
  return /dead|cancel/i.test(j.stage ?? "");
}

function custKey(customer: string | null, addressLine1: string | null, city: string | null): string {
  return (
    (customer ?? "").trim().toLowerCase() + "|" +
    (addressLine1 ?? "").trim().toLowerCase() + "|" +
    (city ?? "").trim().toLowerCase()
  );
}

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
  fontSize: 11,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-bg)",
  verticalAlign: "top",
  fontSize: 13,
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 360, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Pill component
// ---------------------------------------------------------------------------

const pillColors: Record<string, React.CSSProperties> = {
  done: { background: "rgba(16,185,129,0.2)", color: "#10b981" },
  gap: { background: "rgba(245,158,11,0.2)", color: "#f59e0b" },
  hail: { background: "rgba(168,139,250,0.2)", color: "#a78bfa" },
  wind: { background: "rgba(94,200,255,0.2)", color: "var(--riq-accent)" },
  dead: { background: "rgba(239,68,68,0.2)", color: "#ef4444" },
};

function Pill({ label, variant }: { label: string; variant: keyof typeof pillColors }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 11,
        marginRight: 3,
        marginBottom: 2,
        ...(pillColors[variant] ?? {}),
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Leaflet property map — matches original customer-detail.html renderMap()
// ---------------------------------------------------------------------------

function PropertyMap({
  lat,
  lng,
  label,
  address,
}: {
  lat: number;
  lng: number;
  label: string;
  address: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let localMap: L.Map | null = null;

    import("leaflet").then((Leaflet) => {
      if (!containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const map = Leaflet.map(containerRef.current, { preferCanvas: true }).setView([lat, lng], 14);
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; OSM &copy; CARTO", maxZoom: 19 },
      ).addTo(map);
      Leaflet.circleMarker([lat, lng], {
        radius: 10,
        fillColor: "#10b981",
        color: "#fff",
        weight: 2,
        fillOpacity: 0.95,
      })
        .bindPopup(`<strong>${label}</strong><br>${address}`)
        .addTo(map);
      mapRef.current = map;
      localMap = map;
    });

    return () => {
      if (localMap) {
        localMap.remove();
        mapRef.current = null;
      }
    };
  }, [lat, lng, label, address]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: 320,
        background: "var(--riq-bg)",
        border: "1px solid var(--riq-border)",
        borderRadius: 6,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Score calculation (matches HTML exactly)
// ---------------------------------------------------------------------------

function calcScoreFull(storms: ExposureStorm[], tradeGaps: string[], hasRoof: boolean, completed: number): number {
  const stormScore = Math.min(100, (storms.length / 10) * 100);
  const tradeGapScore = hasRoof ? Math.min(100, tradeGaps.length * 20) : 30;
  return Math.round(0.4 * stormScore + 0.3 * tradeGapScore + 0.3 * (completed > 0 ? 80 : 40));
}

// ---------------------------------------------------------------------------
// CustomerProfile — renders the detail card once a customer is loaded
// ---------------------------------------------------------------------------

function CustomerProfile({ deep }: { deep: CustomerDeepResponse }) {
  const jobs = deep.jobs;
  if (jobs.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>
        Customer not found
      </div>
    );
  }

  const j0 = jobs[0];
  const trades = new Set<string>();
  for (const j of jobs) for (const t of j.trades) trades.add(t);
  const tradesArr = [...trades];
  const tradeGaps = UPSELL.filter((t) => !trades.has(t));
  const hasRoof = tradesArr.some((t) => ROOF.has(t));
  const carriers = [...new Set(jobs.map((j) => j.insurance).filter(Boolean))] as string[];
  const reps = [...new Set(jobs.map((j) => j.salesRep).filter(Boolean))] as string[];
  const adjusters = [...new Set(jobs.map((j) => j.adjusterName).filter(Boolean))] as string[];
  const totalRev = jobs.reduce((s, j) => s + (j.jobTotal ?? 0), 0);
  const completed = jobs.filter(isCompleted).length;
  const dead = jobs.filter(isDead).length;
  const storms = deep.exposure?.allStorms ?? [];

  const score = calcScoreFull(storms, tradeGaps, hasRoof, completed);
  const scoreCls: React.CSSProperties =
    score >= 60
      ? { color: "#10b981" }
      : score >= 35
      ? { color: "#f59e0b" }
      : { color: "var(--riq-accent)" };

  // Recommendation
  let rec = "";
  if (storms.length > 0 && hasRoof && tradeGaps.length > 0) {
    rec = `Recent storms hit this address. Customer has completed roof work. Pitch ${tradeGaps.slice(0, 3).join(", ")} with storm hook — strongest storm: ${storms[0].type ?? ""} ${storms[0].mag ?? ""} ${storms[0].unit ?? ""} on ${(storms[0].date ?? "").slice(0, 10)}.`;
  } else if (storms.length > 0 && !hasRoof) {
    rec = `Recent strong storms (${storms.length}) hit this address. Customer has never had roof work with us. Re-inspect roof for storm damage.`;
  } else if (dead > 0) {
    rec = `Has dead/cancelled job(s). ${storms.length > 0 ? "BUT recent storms hit. Resurrection candidate." : "No new storm activity yet — watch this address."}`;
  } else if (hasRoof && tradeGaps.length > 0) {
    rec = `Completed roof customer with trade gaps: ${tradeGaps.slice(0, 3).join(", ")}. Cross-sell candidate.`;
  } else {
    rec = `${jobs.length} job(s) on file. ${completed} completed. Standard follow-up.`;
  }

  const addr = [j0.addressLine1, j0.city, j0.state, j0.zip].filter(Boolean).join(", ");
  const sortedJobs = [...jobs].sort((a, b) =>
    (b.signedDate ?? "").localeCompare(a.signedDate ?? "")
  );

  return (
    <div>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--riq-bg) 0%, var(--riq-surface) 100%)",
          border: "1px solid var(--riq-border)",
          borderRadius: 10,
          padding: "20px 24px",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 20,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--riq-accent)" }}>
            {j0.customer ?? "(unknown)"}
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 13, marginTop: 4 }}>{addr}</div>
          <div style={{ marginTop: 6 }}>
            <a
              href={`https://portal.theroofdocs.com/jobs/${j0.id}`}
              target="_blank"
              rel="noreferrer"
              style={{
                background: "rgba(94,200,255,0.15)",
                color: "var(--riq-accent)",
                textDecoration: "none",
                padding: "6px 14px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                display: "inline-block",
              }}
            >
              Open in Portal — view photos &amp; docs
            </a>
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {j0.customerEmail && (
              <a href={`mailto:${j0.customerEmail}`} style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 16 }}>
                {j0.customerEmail}
              </a>
            )}
            {j0.customerCell && (
              <a href={`tel:${j0.customerCell.replace(/\D/g, "")}`} style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 16 }}>
                {j0.customerCell}
              </a>
            )}
            {j0.customerHome && (
              <a href={`tel:${j0.customerHome.replace(/\D/g, "")}`} style={{ color: "var(--riq-accent)", textDecoration: "none" }}>
                {j0.customerHome}
              </a>
            )}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, ...scoreCls }}>{score}</div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, textTransform: "uppercase", marginTop: 4 }}>Quick Score</div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 10, marginTop: 2 }}>
            simple per-customer formula
          </div>
        </div>
      </div>

      {/* Recommendation + KPIs */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: "rgba(94,200,255,0.08)",
            borderLeft: "3px solid var(--riq-accent)",
            padding: "14px 18px",
            borderRadius: "0 6px 6px 0",
            marginBottom: 12,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong>Recommended action:</strong> {rec}
        </div>
        <CardRow>
          <KpiCard label="Total jobs" value={jobs.length} />
          <KpiCard label="Completed" value={completed} />
          <KpiCard label="Dead" value={dead} />
          <KpiCard label="Lifetime revenue" value={fmtMoney(totalRev)} emphasis />
          <KpiCard label="Trades on file" value={tradesArr.length} />
          <KpiCard label="Trade gaps" value={tradeGaps.length} />
          <KpiCard label="Strong storms hit" value={storms.length} />
        </CardRow>
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8 }}>
          <div>
            <strong>Trades done: </strong>
            {tradesArr.length > 0
              ? tradesArr.map((t) => <Pill key={t} label={t} variant="done" />)
              : <span style={{ color: "var(--riq-text-muted)" }}>—</span>}
          </div>
          <div>
            <strong>Trade gaps: </strong>
            {tradeGaps.length > 0
              ? tradeGaps.map((t) => <Pill key={t} label={t} variant="gap" />)
              : <span style={{ color: "var(--riq-text-muted)" }}>—</span>}
          </div>
          {carriers.length > 0 && (
            <div><strong>Carriers: </strong>{carriers.join(", ")}</div>
          )}
          {reps.length > 0 && (
            <div><strong>Reps: </strong>{reps.join(", ")}</div>
          )}
          {adjusters.length > 0 && (
            <div><strong>Adjusters: </strong>{adjusters.join(", ")}</div>
          )}
        </div>
      </div>

      {/* Timeline + Storms grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Panel title="Job Timeline">
          <div style={scrollBox}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Stage</th>
                  <th style={thStyle}>Trades</th>
                  <th style={thNumStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((j) => (
                  <tr key={j.id}>
                    <td style={tdStyle}>
                      {j.signedDate ?? "—"}
                      {" "}
                      <a
                        href={`https://portal.theroofdocs.com/jobs/${j.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in portal"
                        style={{ color: "var(--riq-accent)", textDecoration: "none", fontSize: 11, marginLeft: 4 }}
                      >
                        🔗
                      </a>
                    </td>
                    <td style={tdStyle}>{j.jobType ?? "—"}</td>
                    <td style={tdStyle}>
                      {j.stage ?? "—"}
                      {isDead(j) && <Pill label="DEAD" variant="dead" />}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11 }}>{j.trades.join(", ") || "—"}</td>
                    <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(j.jobTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Storms hitting this property (since first contact)">
          {storms.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>
              No strong storms matched within 2 miles
            </div>
          ) : (
            <div style={scrollBox}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Mag</th>
                    <th style={thNumStyle}>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {storms.slice(0, 20).map((s, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{(s.date ?? "").slice(0, 10)}</td>
                      <td style={tdStyle}>
                        <Pill label={s.type ?? "?"} variant={s.type === "HAIL" ? "hail" : "wind"} />
                      </td>
                      <td style={tdStyle}>{s.mag ?? "—"} {s.unit ?? ""}</td>
                      <td style={tdNumStyle}>{s.distance?.toFixed(2) ?? "—"} mi</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Property location — Leaflet map matching original HTML */}
      {j0.lat != null && j0.lng != null && (
        <Panel title="Property location">
          <PropertyMap
            lat={j0.lat}
            lng={j0.lng}
            label={j0.customer ?? "(unknown)"}
            address={addr}
          />
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CustomerDetail() {
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<QuickSearchResult[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [deep, setDeep] = useState<CustomerDeepResponse | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const qsTokenRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Quick-search typeahead (debounced 200ms, min 2 chars)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const myToken = ++qsTokenRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/intel/quick-search?q=${encodeURIComponent(q)}`, {
          credentials: "include",
        });
        const json = (await res.json()) as QuickSearchResponse;
        if (myToken !== qsTokenRef.current) return;
        setSearchResults(json.results ?? []);
        setShowDropdown(true);
      } catch {
        // silently ignore
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Load customer-deep when key is selected
  useEffect(() => {
    if (!selectedKey) return;
    setDeep(null);
    setDeepError(null);
    setDeepLoading(true);
    fetch(`/api/intel/customer-deep?key=${encodeURIComponent(selectedKey)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CustomerDeepResponse>;
      })
      .then((d) => {
        setDeep(d);
        setDeepLoading(false);
      })
      .catch((e: unknown) => {
        setDeepError((e as Error).message ?? String(e));
        setDeepLoading(false);
      });
  }, [selectedKey]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectCustomer(r: QuickSearchResult) {
    const k = custKey(r.customer, r.addressLine1, r.city);
    setSelectedKey(k);
    setQuery(
      r.customer
        ? r.customer.replace(/\b\w/g, (c) => c.toUpperCase())
        : ""
    );
    setShowDropdown(false);
  }

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {/* Search box */}
      <div
        ref={wrapperRef}
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "14px 16px",
          marginBottom: 16,
          position: "relative",
        }}
      >
        <input
          type="text"
          placeholder="Search any customer or address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setShowDropdown(true)}
          style={{
            width: "100%",
            background: "var(--riq-bg)",
            color: "var(--riq-text)",
            border: "1px solid var(--riq-border)",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        {showDropdown && searchResults.length > 0 && (
          <div
            style={{
              position: "absolute",
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-accent)",
              borderRadius: 6,
              padding: "6px 0",
              maxHeight: 400,
              overflowY: "auto",
              minWidth: 500,
              marginTop: 4,
              zIndex: 100,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              left: 16,
              right: 16,
            }}
          >
            {searchResults.map((r, i) => (
              <div
                key={i}
                onClick={() => selectCustomer(r)}
                style={{ padding: "8px 14px", cursor: "pointer" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--riq-bg)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                <div style={{ color: "var(--riq-accent)", fontSize: 13, fontWeight: 600 }}>
                  {r.customer ?? "(unknown)"}
                </div>
                <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                  {[r.addressLine1, r.city, r.state].filter(Boolean).join(", ")}
                  {" · "}
                  {r.insurance ?? "—"}
                </div>
              </div>
            ))}
          </div>
        )}
        {showDropdown && query.trim().length >= 2 && searchResults.length === 0 && (
          <div
            style={{
              position: "absolute",
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 6,
              padding: "12px 14px",
              left: 16,
              right: 16,
              marginTop: 4,
              zIndex: 100,
              color: "var(--riq-text-muted)",
              fontSize: 13,
            }}
          >
            No matches
          </div>
        )}
      </div>

      {/* Detail area */}
      {!selectedKey && (
        <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>
          Search for a customer above to load their full profile
        </div>
      )}
      {selectedKey && deepLoading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading…
        </div>
      )}
      {selectedKey && deepError && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load customer: {deepError}
        </div>
      )}
      {selectedKey && !deepLoading && !deepError && deep && (
        <CustomerProfile deep={deep} />
      )}
    </div>
  );
}
