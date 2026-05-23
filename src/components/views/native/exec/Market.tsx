/**
 * Insurance Market Intelligence — native React (Phase 2d batch1)
 * IntelView id: "insurance-intel"
 *
 * Data (same as insurance-intel.html):
 *   GET /api/intel/naic-complaint-index  → { source, sources, carriers: Record<name, NaicEntry>, sourceUrl, lastUpdated }
 *   GET /api/intel/live-market-intel     → { sources, generated, ohioTop70_2024, mdMarketHardening_2024 }
 *   GET /api/intel/insurer-rankings      → { source, rankings, generated, countyRisk, methodology, stateDetails }
 *   GET /api/intel/carrier-patents       → { model, patents, byCarrier: Record<name, patent[]>, generated }
 *   GET /api/intel/denial-sources-full   → DenialCase[]
 *   GET /api/intel/storm-exposure        → StormExposureRecord[]  (2557 items)
 */
import { useState, useEffect, useMemo } from "react";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface NaicEntry {
  index: number | null;
  rating: string;
  amBest?: string | null;
  note?: string;
  marketConduct?: string | null;
  byState?: Record<string, unknown>;
}

interface NaicResponse {
  carriers: Record<string, NaicEntry>;
  sourceUrl?: string;
  source?: string;
}

interface OhioCarrier {
  name: string;
  marketSharePct: number;
  dwp2024: number;
}

interface CountyNonRenewal {
  county: string;
  nr2021: number;
  nr2022?: number;
  nr2023: number;
  changePct21to23: number;
}

interface MdMarketHardening {
  statewide?: {
    nonRenewalChangePct2021to2023: string;
  };
  countyNonRenewals?: CountyNonRenewal[];
}

interface OhioTop70 {
  carriers: OhioCarrier[];
  totalMarketDWP: number;
}

interface MarketIntelResponse {
  sources?: unknown;
  generated?: string;
  ohioTop70_2024?: OhioTop70;
  mdMarketHardening_2024?: MdMarketHardening;
}

interface CountyRiskRow {
  State: string;
  County: string;
  "Risk Tier": string;
  "Event Type": string;
  "Approx. Event Count (5yr)": number;
  "Max Hail Size (in.)": number;
  "Est. Total Property Damage ($)": number;
}

interface RankingsResponse {
  countyRisk?: CountyRiskRow[];
}

interface PatentsResponse {
  byCarrier: Record<string, unknown[]>;
}

interface DenialCase {
  carrier?: string;
  outcome?: string;
  threadId?: string;
}

interface ClaimHistoryEntry {
  carrier: string;
  outcome: string;
  paidOut?: number;
  estimated?: number;
  hasSupplement?: boolean;
  supplementStatus?: string | null;
}

interface StormExposureRecord {
  customer?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  carriers?: string[];
  trades?: string[];
  hasDenied?: boolean;
  hasPartial?: boolean;
  stormCount?: number;
  tradeGaps?: string[];
  claimHistory?: ClaimHistoryEntry[];
  customerCell?: string;
  customerEmail?: string;
}

// ---------------------------------------------------------------------------
// City → MD County mapping (same as HTML)
// ---------------------------------------------------------------------------

const CITY_TO_COUNTY: Record<string, string> = {
  "bowie": "Prince Georges", "upper marlboro": "Prince Georges", "clinton": "Prince Georges",
  "oxon hill": "Prince Georges", "fort washington": "Prince Georges", "hyattsville": "Prince Georges",
  "college park": "Prince Georges", "greenbelt": "Prince Georges", "lanham": "Prince Georges",
  "germantown": "Montgomery", "gaithersburg": "Montgomery", "silver spring": "Montgomery",
  "rockville": "Montgomery", "bethesda": "Montgomery", "poolesville": "Montgomery",
  "olney": "Montgomery", "damascus": "Montgomery", "clarksburg": "Montgomery",
  "annapolis": "Anne Arundel", "odenton": "Anne Arundel", "crofton": "Anne Arundel",
  "millersville": "Anne Arundel", "severn": "Anne Arundel", "glen burnie": "Anne Arundel",
  "baltimore": "Baltimore", "towson": "Baltimore", "catonsville": "Baltimore",
  "pikesville": "Baltimore", "owings mills": "Baltimore", "randallstown": "Baltimore",
  "frederick": "Frederick", "waldorf": "Charles", "white plains": "Charles",
  "la plata": "Charles", "columbia": "Howard", "ellicott city": "Howard",
  "laurel": "Prince Georges", "beltsville": "Prince Georges", "springfield": "Prince Georges",
};

function cityToCounty(city: string | undefined): string | null {
  if (!city) return null;
  return CITY_TO_COUNTY[city.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Threat score
// ---------------------------------------------------------------------------

function threatScore(denyRate: number, naicIndex: number | null, patentCount: number): number {
  const denyNorm = Math.min(denyRate / 100, 1);
  const naicNorm = Math.min((naicIndex ?? 0.5) / 2.5, 1);
  const patNorm = Math.min((patentCount) / 10, 1);
  return Math.round((denyNorm * 0.4 + naicNorm * 0.4 + patNorm * 0.2) * 100);
}

// ---------------------------------------------------------------------------
// Carrier stats from exposure data
// ---------------------------------------------------------------------------

interface CarrierStat {
  carrier: string;
  total: number;
  denied: number;
  partial: number;
  fullPaid: number;
  inProgress: number;
  supplements: number;
  totalPaid: number;
  denyRate: number;
  naicIndex: number | null;
  naicRating: string | null;
  amBest: string | null;
  marketConduct: string | null;
  patents: number;
  caseCount: number;
  threatScore: number;
}

function buildCarrierStats(
  exposure: StormExposureRecord[],
  naic: Record<string, NaicEntry>,
  patentsData: PatentsResponse,
  cases: DenialCase[],
): CarrierStat[] {
  const map: Record<string, {
    carrier: string; total: number; denied: number; partial: number; fullPaid: number;
    inProgress: number; supplements: number; totalPaid: number;
  }> = {};

  for (const cust of exposure) {
    for (const c of (cust.claimHistory ?? [])) {
      if (!c.carrier) continue;
      const k = c.carrier;
      if (!map[k]) map[k] = { carrier: k, total: 0, denied: 0, partial: 0, fullPaid: 0, inProgress: 0, supplements: 0, totalPaid: 0 };
      const s = map[k];
      s.total++;
      if (c.outcome === "denied") s.denied++;
      else if (c.outcome === "partial-paid" || c.outcome === "partial-dead") s.partial++;
      else if (c.outcome === "full-paid") s.fullPaid++;
      else if (c.outcome === "in-progress") s.inProgress++;
      if (c.hasSupplement) s.supplements++;
      s.totalPaid += c.paidOut ?? 0;
    }
  }

  return Object.values(map)
    .filter((s) => s.total >= 3)
    .map((s) => {
      const denyRate = s.total > 0 ? Math.round((s.denied / s.total) * 100) : 0;
      // Match NAIC entry
      const naicEntry = naic[s.carrier] ?? Object.entries(naic).find(([k]) => {
        const kl = k.toLowerCase();
        const cl = s.carrier.toLowerCase();
        return cl.startsWith(kl.split(" ")[0]) || kl.startsWith(cl.split(" ")[0]);
      })?.[1] ?? null;

      // Match patents
      const patCarrier = Object.keys(patentsData.byCarrier).find((k) =>
        k.toLowerCase().includes(s.carrier.toLowerCase().split(" ")[0]) ||
        s.carrier.toLowerCase().includes(k.toLowerCase().split(" ")[0])
      );
      const patents = patCarrier ? (patentsData.byCarrier[patCarrier] ?? []).length : 0;

      const caseCount = cases.filter((c) => {
        const cn = (c.carrier ?? "").toLowerCase();
        const sn = s.carrier.toLowerCase();
        return cn.includes(sn.split(" ")[0]) || sn.includes(cn.split(" ")[0]);
      }).length;

      return {
        ...s, denyRate,
        naicIndex: naicEntry?.index ?? null,
        naicRating: naicEntry?.rating ?? null,
        amBest: naicEntry?.amBest ?? null,
        marketConduct: naicEntry?.marketConduct ?? null,
        patents, caseCount,
        threatScore: threatScore(denyRate, naicEntry?.index ?? null, patents),
      };
    });
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thBase: React.CSSProperties = {
  textAlign: "left", padding: "6px 10px", background: "#1e1a16", color: "var(--riq-text-muted)",
  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px",
  borderBottom: "1px solid var(--riq-border)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
};
const tdBase: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "middle" };
const cardStyle: React.CSSProperties = { background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 20px", marginBottom: 16 };

function naicPill(idx: number | null): string {
  if (idx == null) return "—";
  if (idx <= 0.5) return "low";
  if (idx <= 1.0) return "avg";
  return "high";
}

function naicPillColor(idx: number | null): string {
  if (idx == null) return "var(--riq-text-muted)";
  if (idx <= 0.5) return "#10b981";
  if (idx <= 1.0) return "#f59e0b";
  return "#ef4444";
}

function threatBarColor(ts: number): string {
  if (ts >= 60) return "#ef4444";
  if (ts >= 35) return "#f59e0b";
  return "#10b981";
}

// ---------------------------------------------------------------------------
// At-risk customer row
// ---------------------------------------------------------------------------

interface RiskRow {
  customer?: string;
  address?: string;
  city?: string;
  state?: string;
  carrier: string;
  outcome: string;
  paidOut: number;
  estimated: number;
  hasSupplement: boolean;
  tradeGaps: string[];
  stormCount: number;
  nonRenewalRisk: boolean;
  county: string | null;
  threatScore: number;
  email?: string;
  phone?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Market({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [naic, setNaic] = useState<Record<string, NaicEntry> | null>(null);
  const [market, setMarket] = useState<MarketIntelResponse | null>(null);
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);
  const [patents, setPatents] = useState<PatentsResponse | null>(null);
  const [cases, setCases] = useState<DenialCase[]>([]);
  const [exposure, setExposure] = useState<StormExposureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState("Loading carrier data…");
  const [error, setError] = useState<string | null>(null);

  // Carrier matrix sort
  const [matrixSort, setMatrixSort] = useState<{ key: keyof CarrierStat; asc: boolean }>({ key: "threatScore", asc: false });

  // Risk table state
  const [riskSearch, setRiskSearch] = useState("");
  const [riskCarrier, setRiskCarrier] = useState("");
  const [riskState, setRiskState] = useState("");
  const [riskOutcome, setRiskOutcome] = useState("");
  const [riskPage, setRiskPage] = useState(0);
  const PER_PAGE = 25;

  useEffect(() => {
    async function load() {
      try {
        setLoadingStage("Loading carrier data…");
        const [naicR, mktR, rankR, patR, caseR] = await Promise.all([
          fetch("/api/intel/naic-complaint-index", { credentials: "include" }).then((r) => r.json()) as Promise<NaicResponse>,
          fetch("/api/intel/live-market-intel", { credentials: "include" }).then((r) => r.json()).catch(() => null) as Promise<MarketIntelResponse | null>,
          fetch("/api/intel/insurer-rankings", { credentials: "include" }).then((r) => r.json()).catch(() => null) as Promise<RankingsResponse | null>,
          fetch("/api/intel/carrier-patents", { credentials: "include" }).then((r) => r.json()) as Promise<PatentsResponse>,
          fetch("/api/intel/denial-sources-full", { credentials: "include" }).then((r) => r.json()).catch(() => []) as Promise<DenialCase[] | { entries?: DenialCase[] }>,
        ]);
        setNaic(naicR.carriers ?? naicR as unknown as Record<string, NaicEntry>);
        setMarket(mktR);
        setRankings(rankR);
        setPatents(patR);
        const casesArr = Array.isArray(caseR) ? caseR : ((caseR as { entries?: DenialCase[] }).entries ?? []);
        setCases(casesArr);

        setLoadingStage("Loading storm exposure data…");
        const expR = await fetch("/api/intel/storm-exposure", { credentials: "include" }).then((r) => r.json()) as StormExposureRecord[] | { data?: StormExposureRecord[]; all?: StormExposureRecord[] };
        setExposure(Array.isArray(expR) ? expR : (expR.data ?? expR.all ?? []));
        setLoading(false);
      } catch (e: unknown) {
        setError((e as Error).message ?? String(e));
        setLoading(false);
      }
    }
    load();
  }, []);

  const carrierStats = useMemo<CarrierStat[]>(() => {
    if (!naic || !patents || exposure.length === 0) return [];
    return buildCarrierStats(exposure, naic, patents, cases);
  }, [naic, patents, cases, exposure]);

  const riskData = useMemo<RiskRow[]>(() => {
    if (!carrierStats.length) return [];
    const countyData = market?.mdMarketHardening_2024?.countyNonRenewals ?? [];
    const risks: RiskRow[] = [];
    for (const cust of exposure) {
      if (!cust.hasDenied && !cust.hasPartial) continue;
      if (!cust.tradeGaps || cust.tradeGaps.length === 0) continue;
      const worstClaim =
        (cust.claimHistory ?? []).find((c) => c.outcome === "denied") ??
        (cust.claimHistory ?? []).find((c) => c.outcome === "partial-paid" || c.outcome === "partial-dead");
      if (!worstClaim) continue;
      const county = cityToCounty(cust.city);
      let nrRisk = false;
      if (cust.state === "MD" && county) {
        const mdData = countyData.find((c) =>
          c.county.toLowerCase().replace(/'/g, "").includes(county.toLowerCase().replace(/'/g, ""))
        );
        nrRisk = !!(mdData && mdData.changePct21to23 >= 60);
      }
      const carrierStat = carrierStats.find((s) => s.carrier === worstClaim.carrier);
      risks.push({
        customer: cust.customer,
        address: cust.addressLine1,
        city: cust.city,
        state: cust.state,
        carrier: worstClaim.carrier,
        outcome: worstClaim.outcome,
        paidOut: worstClaim.paidOut ?? 0,
        estimated: worstClaim.estimated ?? 0,
        hasSupplement: worstClaim.hasSupplement ?? false,
        tradeGaps: cust.tradeGaps ?? [],
        stormCount: cust.stormCount ?? 0,
        nonRenewalRisk: nrRisk,
        county,
        threatScore: carrierStat?.threatScore ?? 0,
      });
    }
    risks.sort((a, b) => {
      if (a.nonRenewalRisk !== b.nonRenewalRisk) return a.nonRenewalRisk ? -1 : 1;
      if (b.threatScore !== a.threatScore) return b.threatScore - a.threatScore;
      return b.stormCount - a.stormCount;
    });
    return risks;
  }, [carrierStats, exposure, market]);

  const riskFiltered = useMemo(() => {
    return riskData.filter((r) => {
      if (riskSearch && !`${r.customer ?? ""}${r.address ?? ""}${r.city ?? ""}`.toLowerCase().includes(riskSearch.toLowerCase())) return false;
      if (riskCarrier && r.carrier !== riskCarrier) return false;
      if (riskState && r.state !== riskState) return false;
      if (riskOutcome && r.outcome !== riskOutcome) return false;
      return true;
    });
  }, [riskData, riskSearch, riskCarrier, riskState, riskOutcome]);

  const riskCarriers = useMemo(() => [...new Set(riskData.map((r) => r.carrier).filter(Boolean))].sort(), [riskData]);

  const sortedMatrix = useMemo(() => {
    return [...carrierStats].sort((a, b) => {
      const va = a[matrixSort.key] as number | string | null;
      const vb = b[matrixSort.key] as number | string | null;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return matrixSort.asc ? cmp : -cmp;
    });
  }, [carrierStats, matrixSort]);

  const mdCountyData = market?.mdMarketHardening_2024?.countyNonRenewals ?? [];
  const ohioTop10 = market?.ohioTop70_2024?.carriers?.slice(0, 10) ?? [];
  const ohRiskCounties = rankings?.countyRisk?.filter((r) => r.State === "OH" && r["Risk Tier"]?.includes("Very High")) ?? [];

  function toggleMatrixSort(key: keyof CarrierStat) {
    setMatrixSort((prev) => prev.key === key ? { key, asc: !prev.asc } : { key, asc: false });
  }

  function outcomePillColor(o: string) {
    if (o === "denied") return "#ef4444";
    if (o === "partial-paid" || o === "partial-dead") return "#f59e0b";
    if (o === "full-paid") return "#10b981";
    return "var(--riq-text-muted)";
  }

  const inputStyle: React.CSSProperties = { background: "#342c23", border: "1px solid var(--riq-border)", color: "var(--riq-text)", padding: "5px 10px", borderRadius: 5, fontSize: 12, fontFamily: "inherit" };

  const riskPageCount = Math.ceil(riskFiltered.length / PER_PAGE);
  const riskSlice = riskFiltered.slice(riskPage * PER_PAGE, (riskPage + 1) * PER_PAGE);

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>{loadingStage}</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Error: {error}</div>
      </div>
    );
  }

  // Alert strip from NAIC data
  const allstate = naic?.["Allstate"];
  const mdStats = market?.mdMarketHardening_2024?.statewide;
  const worstCarrier = [...carrierStats].sort((a, b) => b.denyRate - a.denyRate)[0];

  // Top stats
  const totalCustomers = exposure.length;
  const withClaims = exposure.filter((c) => c.claimHistory && c.claimHistory.length > 0).length;
  const mdAtRisk = riskData.filter((r) => r.state === "MD" && r.nonRenewalRisk).length;
  const totalDenied = carrierStats.reduce((s, c) => s + c.denied, 0);
  const totalSupps = carrierStats.reduce((s, c) => s + c.supplements, 0);

  // MD county customer overlap
  const custByCounty: Record<string, { total: number; atRisk: number }> = {};
  for (const c of exposure.filter((c) => c.state === "MD")) {
    const county = cityToCounty(c.city);
    if (!county) continue;
    if (!custByCounty[county]) custByCounty[county] = { total: 0, atRisk: 0 };
    custByCounty[county].total++;
    if (c.hasDenied || c.hasPartial) custByCounty[county].atRisk++;
  }

  // ACV risk count
  const acvCarriers = ["Allstate", "State Farm", "Nationwide", "Farmers"];
  const acvRiskCount = exposure.filter((cust) =>
    (cust.carriers ?? []).some((c) => acvCarriers.includes(c)) &&
    !(cust.trades ?? []).includes("Roofing") &&
    (cust.stormCount ?? 0) > 0
  ).length;

  const callout = (color: "red" | "yellow" | "green" | "blue"): React.CSSProperties => {
    const map = {
      red: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)" },
      yellow: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)" },
      green: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)" },
      blue: { bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.25)" },
    };
    return { borderRadius: 7, padding: "12px 16px", marginBottom: 10, fontSize: 12, lineHeight: 1.6, background: map[color].bg, border: `1px solid ${map[color].border}` };
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* Alert strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {allstate?.marketConduct && (
          <div style={{ ...callout("red"), flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "var(--riq-accent)", marginBottom: 2, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Allstate — Regulatory Finding
            </div>
            {allstate.marketConduct}
          </div>
        )}
        {mdStats && (
          <div style={{ ...callout("yellow"), flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "var(--riq-accent)", marginBottom: 2, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              MD Market Hardening (Nov 2024)
            </div>
            Non-renewals up {mdStats.nonRenewalChangePct2021to2023} statewide 2021–2023. #1 reason: maintenance (roofs). 11/29 carriers now restrict coverage by roof age.
          </div>
        )}
        {worstCarrier && (
          <div style={{ ...callout("blue"), flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "var(--riq-accent)", marginBottom: 2, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Highest Denial Rate: {worstCarrier.carrier}
            </div>
            {worstCarrier.denyRate}% of {worstCarrier.total} claims in your book were denied. {worstCarrier.patents} AI patents + {worstCarrier.caseCount} logged cases.
          </div>
        )}
      </div>

      {/* Top stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          { v: totalCustomers.toLocaleString(), l: "Customers w/ storm exposure", l2: `${withClaims.toLocaleString()} have filed claims` },
          { v: riskData.length.toLocaleString(), l: "At-risk (denied or partial)", l2: `${totalDenied.toLocaleString()} total denials in book`, red: true },
          { v: mdAtRisk.toLocaleString(), l: "MD customers in NR hot zones", l2: "Montgomery + Prince George's surge", yellow: true },
          { v: totalSupps.toLocaleString(), l: "Total supplements on record", l2: `${carrierStats.length} carriers tracked` },
        ].map((s) => (
          <div key={s.l} style={{ background: "#342c23", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.red ? "#ef4444" : s.yellow ? "#f59e0b" : "var(--riq-accent)" }}>{s.v}</div>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.l}</div>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 2 }}>{s.l2}</div>
          </div>
        ))}
      </div>

      {/* Carrier Threat Matrix + MD Non-Renewal Hot Zones */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>

        {/* Carrier Threat Matrix */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Carrier Threat Matrix</h2>
            <span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>{sortedMatrix.length} carriers</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.4 }}>
            Threat score = actual denial rate (40%) + NAIC complaint index (40%) + AI patent count (20%). Click column headers to re-sort.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  {(["carrier", "threatScore", "denyRate", "naicIndex", "amBest", "total", "denied", "supplements", "patents"] as (keyof CarrierStat)[]).map((k) => (
                    <th key={k} style={thBase} onClick={() => toggleMatrixSort(k)}>
                      {k === "threatScore" ? "Threat" : k === "denyRate" ? "Deny%" : k === "naicIndex" ? "NAIC" : k === "amBest" ? "AM Best" : k === "total" ? "In Book" : k.charAt(0).toUpperCase() + k.slice(1)}
                      {matrixSort.key === k ? (matrixSort.asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMatrix.map((s) => (
                  <tr key={s.carrier}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>
                      {s.carrier}
                      {s.marketConduct && <span title={s.marketConduct} style={{ color: "#ef4444", marginLeft: 4, cursor: "help" }}>⚠</span>}
                    </td>
                    <td style={tdBase}>
                      <span style={{ fontSize: 12, fontWeight: 700, marginRight: 6, color: threatBarColor(s.threatScore) }}>{s.threatScore}</span>
                      <span style={{ display: "inline-block", width: 80, height: 6, background: "var(--riq-border)", borderRadius: 3, verticalAlign: "middle", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${s.threatScore}%`, background: threatBarColor(s.threatScore), borderRadius: 3 }} />
                      </span>
                    </td>
                    <td style={{ ...tdBase, color: s.denyRate >= 50 ? "#ef4444" : s.denyRate >= 35 ? "#f59e0b" : "#10b981", fontWeight: 700 }}>{s.denyRate}%</td>
                    <td style={{ ...tdBase, color: naicPillColor(s.naicIndex) }}>{s.naicIndex != null ? s.naicIndex : "—"} {s.naicIndex != null ? `(${naicPill(s.naicIndex)})` : ""}</td>
                    <td style={tdBase}>{s.amBest ?? "—"}</td>
                    <td style={tdBase}>{s.total.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: s.denied > 50 ? "#ef4444" : "var(--riq-text)" }}>{s.denied.toLocaleString()}</td>
                    <td style={tdBase}>{s.supplements.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: s.patents > 0 ? "#a78bfa" : "var(--riq-text-muted)" }}>{s.patents > 0 ? s.patents : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* MD Non-Renewal Hot Zones */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>MD Non-Renewal Hot Zones</h2>
          <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.4 }}>
            Nov 2024 · MIA Survey. Company-initiated non-renewals by county (2021→2023).
          </p>
          <div style={callout("red")}>
            <strong>Root cause: #1 non-renewal reason = maintenance (roofs).</strong> 11/29 carriers now restrict coverage by roof age.
          </div>
          <table style={{ ...tblStyle, marginTop: 8 }}>
            <thead>
              <tr>
                {["County", "NR 2021", "NR 2023", "Surge", "Your Customers"].map((h) => (
                  <th key={h} style={{ ...thBase, cursor: "default" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mdCountyData.slice(0, 15).map((c) => {
                const custData = Object.entries(custByCounty).find(([k]) =>
                  c.county.toLowerCase().replace(/'/g, "").includes(k.toLowerCase().replace(/'/g, ""))
                )?.[1];
                return (
                  <tr key={c.county}>
                    <td style={{ ...tdBase, fontWeight: 600 }}>{c.county}</td>
                    <td style={{ ...tdBase, color: "var(--riq-text-muted)" }}>{c.nr2021.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: "#ef4444", fontWeight: 700 }}>{c.nr2023.toLocaleString()}</td>
                    <td style={{ ...tdBase, color: c.changePct21to23 >= 100 ? "#ef4444" : c.changePct21to23 >= 60 ? "#f59e0b" : "var(--riq-text-muted)", fontWeight: 700 }}>
                      +{c.changePct21to23}%
                    </td>
                    <td style={tdBase}>
                      {custData ? (
                        <span>
                          <strong>{custData.total}</strong>
                          {custData.atRisk > 0 && (
                            <span style={{ marginLeft: 4, background: "rgba(239,68,68,0.18)", color: "#ef4444", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
                              {custData.atRisk} at-risk
                            </span>
                          )}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* At-Risk Customer Outreach List */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>At-Risk Customer Outreach List</h2>
          <span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>{riskFiltered.length} customers</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
          Customers with denied or partial claims + unmet trade gaps. Highest-priority re-engagement targets.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            placeholder="Search name, address, city…"
            value={riskSearch}
            onChange={(e) => { setRiskSearch(e.target.value); setRiskPage(0); }}
          />
          <select style={inputStyle} value={riskCarrier} onChange={(e) => { setRiskCarrier(e.target.value); setRiskPage(0); }}>
            <option value="">All carriers</option>
            {riskCarriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select style={inputStyle} value={riskState} onChange={(e) => { setRiskState(e.target.value); setRiskPage(0); }}>
            <option value="">All states</option>
            <option value="MD">MD</option>
            <option value="VA">VA</option>
            <option value="PA">PA</option>
          </select>
          <select style={inputStyle} value={riskOutcome} onChange={(e) => { setRiskOutcome(e.target.value); setRiskPage(0); }}>
            <option value="">All outcomes</option>
            <option value="denied">Denied</option>
            <option value="partial-paid">Partial paid</option>
            <option value="partial-dead">Partial dead</option>
          </select>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                {["Customer", "Carrier", "Outcome", "Storms Hit", "Trade Gaps", "Location", "NR Risk"].map((h) => (
                  <th key={h} style={{ ...thBase, cursor: "default" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {riskSlice.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tdBase, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.address}>{r.customer ?? "—"}</td>
                  <td style={tdBase}>{r.carrier ?? "—"}</td>
                  <td style={{ ...tdBase, color: outcomePillColor(r.outcome) }}>
                    {r.outcome}
                    {r.hasSupplement && <span style={{ marginLeft: 4, background: "rgba(245,158,11,0.18)", color: "#f59e0b", padding: "2px 5px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>supp</span>}
                  </td>
                  <td style={{ ...tdBase, color: r.stormCount > 3 ? "#ef4444" : r.stormCount > 1 ? "#f59e0b" : "var(--riq-text-muted)" }}>{r.stormCount}</td>
                  <td style={{ ...tdBase, color: "var(--riq-text-muted)", fontSize: 11 }}>
                    {r.tradeGaps.slice(0, 3).join(", ")}{r.tradeGaps.length > 3 ? ` +${r.tradeGaps.length - 3}` : ""}
                  </td>
                  <td style={tdBase}>{r.city ?? ""}{r.state ? `, ${r.state}` : ""}</td>
                  <td style={tdBase}>
                    {r.nonRenewalRisk && <span style={{ background: "rgba(239,68,68,0.18)", color: "#ef4444", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>NR</span>}
                  </td>
                </tr>
              ))}
              {riskSlice.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdBase, textAlign: "center", color: "var(--riq-text-muted)" }}>No matches</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 12, color: "var(--riq-text-muted)" }}>
          <button
            disabled={riskPage === 0}
            onClick={() => setRiskPage((p) => Math.max(0, p - 1))}
            style={{ background: "#342c23", border: "1px solid var(--riq-border)", color: "var(--riq-text)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: riskPage === 0 ? "default" : "pointer", opacity: riskPage === 0 ? 0.4 : 1 }}
          >
            ← Prev
          </button>
          <span>Page {riskPage + 1} of {Math.max(1, riskPageCount)} ({riskFiltered.length} total)</span>
          <button
            disabled={riskPage >= riskPageCount - 1}
            onClick={() => setRiskPage((p) => Math.min(riskPageCount - 1, p + 1))}
            style={{ background: "#342c23", border: "1px solid var(--riq-border)", color: "var(--riq-text)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: riskPage >= riskPageCount - 1 ? "default" : "pointer", opacity: riskPage >= riskPageCount - 1 ? 0.4 : 1 }}
          >
            Next →
          </button>
        </div>
      </div>

      {/* MD County Detail + OH Expansion */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div style={cardStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>MD Market Intelligence</h2>
          <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.4 }}>
            Your customers mapped to Maryland's hardest-hit non-renewal counties.
          </p>
          <div style={{ fontSize: 12, marginBottom: 8, color: "var(--riq-text-muted)" }}>
            Based on customer addresses — <strong style={{ color: "var(--riq-text)" }}>{exposure.filter((c) => c.state === "MD").length} MD customers</strong> in storm-exposure data.
          </div>
          {Object.entries(custByCounty)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 8)
            .map(([county, stats]) => {
              const nrData = mdCountyData.find((c) =>
                c.county.toLowerCase().replace(/'/g, "").includes(county.toLowerCase().replace(/'/g, ""))
              );
              return (
                <div key={county} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{county} County</span>
                  <span>{stats.total} customers</span>
                  {stats.atRisk > 0 && <span style={{ background: "rgba(245,158,11,0.18)", color: "#f59e0b", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>{stats.atRisk} at-risk</span>}
                  {nrData && <span style={{ background: nrData.changePct21to23 >= 100 ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)", color: nrData.changePct21to23 >= 100 ? "#ef4444" : "#f59e0b", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>NR +{nrData.changePct21to23}%</span>}
                </div>
              );
            })}
          <div style={{ ...callout("yellow"), marginTop: 12 }}>
            <strong>The play:</strong> Call homeowners in Montgomery and Prince George's counties whose carrier has a high complaint index. Carrier likely non-renewed or is about to. They need a roof inspection to qualify for new coverage.
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Ohio Expansion Opportunity</h2>
          <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
            2024 OH homeowners market: <strong>$4.684B</strong>. Very High storm risk counties. Published June 25, 2025 by Ohio DOI.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
            {ohioTop10.map((c) => {
              const name = c.name.replace(/ GRP$/, "").replace(/ INS$/, "").replace(/ MUT$/, "").replace(/ CAS$/, "");
              const color = c.marketSharePct >= 10 ? "#ef4444" : c.marketSharePct >= 7 ? "#f59e0b" : "#10b981";
              return (
                <div key={c.name} style={{ background: "#342c23", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{c.marketSharePct}%</div>
                  <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 2, lineHeight: 1.3 }}>{name}</div>
                  <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 2 }}>${(c.dwp2024 / 1e6).toFixed(0)}M</div>
                </div>
              );
            })}
          </div>
          <div style={callout("blue")}>
            <strong>Allegheny County (Pittsburgh):</strong> Very High risk tier — 130 storm events in 5 years, 3" max hail, $22M property damage. State Farm alone = $962M in OH.
          </div>
          {ohRiskCounties.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginBottom: 6 }}>NOAA Very High Risk Counties (5yr avg)</div>
              {ohRiskCounties.map((c) => (
                <div key={c.County} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{c.County}</span>
                  <span style={{ background: "rgba(239,68,68,0.18)", color: "#ef4444", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>{c["Approx. Event Count (5yr)"]} events</span>
                  <span style={{ color: "var(--riq-text-muted)" }}>{c["Max Hail Size (in.)"]}" hail</span>
                  <span style={{ color: "#f59e0b" }}>${(c["Est. Total Property Damage ($)"] / 1e6).toFixed(0)}M dmg</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Roof Age Trap */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>The Roof Age Trap — ACV vs Replacement Cost</h2>
        <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
          11 of 29 carriers surveyed by MD MIA restrict wind/hail claims based on roof age. These customers think they have replacement cost coverage — but they'll get ACV when they file.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 12 }}>
          <div style={callout("red")}>
            <strong>What ACV means for a $20,000 roof:</strong> If the roof is 15 years old and has 20-year shingles, the carrier may depreciate 75% → pays $5,000 instead of $20,000.
          </div>
          <div style={callout("yellow")}>
            <strong>Which carriers do this:</strong> Allstate, State Farm, Nationwide are the most aggressive. Erie and USAA are typically more favorable on replacement cost.
          </div>
          <div style={callout("green")}>
            <strong>The counter:</strong> Request the full policy declarations page before the adjuster visit. Confirm RCV vs ACV language. If ACV-only, document the roof install date and get the adjuster to confirm age-depreciation math in writing before accepting settlement.
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>
          <strong style={{ color: "var(--riq-text)" }}>{acvRiskCount} customers</strong> with a high-ACV-risk carrier + no roof completed + storm exposure. These homeowners may not know their wind/hail claim will be capped at ACV.
        </div>
      </div>
    </div>
  );
}
