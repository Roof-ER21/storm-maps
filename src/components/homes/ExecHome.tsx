/**
 * Exec Home — leadership snapshot.
 *
 * Phase 2b skeleton: revenue + close-rate KPIs, top 5 reps, top 5 ZIPs.
 * Phase 2d will pull in the full exec.html dashboard into native React.
 */
import { useUser } from "../../auth/UserContext";
import { HomeShell, KpiCard, CardRow, Panel, useFetch, fmtMoney, fmtPct } from "./HomeCommon";

interface DashboardKpis {
  total_jobs?: number;
  total_revenue?: number;
  close_rate?: number;
  pipeline_value?: number;
}

interface RepsSummaryRep {
  name: string;
  signed?: number;
  completed?: number;
  revenue?: number;
  completedRevenue?: number;
  closeRate?: number;
}

interface ZipStats {
  zip: string;
  state?: string;
  signed?: number;
  revenue?: number;
}

export function ExecHome({ navigate }: { navigate: (view: string) => void }) {
  const { user } = useUser();
  const kpis = useFetch<DashboardKpis>("/api/intel/dashboard-kpis");
  const reps = useFetch<{ reps: RepsSummaryRep[] }>("/api/intel/reps-summary");
  const zips = useFetch<{ rows: ZipStats[] }>("/api/intel/zip-stats?window=180");

  const topReps = (reps.data?.reps ?? [])
    .filter((r) => r.completedRevenue != null)
    .sort((a, b) => (b.completedRevenue ?? 0) - (a.completedRevenue ?? 0))
    .slice(0, 5);

  const topZips = (zips.data?.rows ?? [])
    .filter((z) => z.revenue != null)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    .slice(0, 5);

  return (
    <HomeShell
      title={`Executive Snapshot${user?.display_name ? ` — ${user.display_name}` : ""}`}
      subtitle="Revenue, top reps, top ZIPs. Phase 2d pulls in the full exec dashboard."
    >
      <CardRow>
        <KpiCard
          label="Total revenue"
          value={fmtMoney(kpis.data?.total_revenue)}
          hint="all-time closed"
        />
        <KpiCard
          label="Close rate"
          value={fmtPct(kpis.data?.close_rate, 1)}
          hint="formula B (b6930c9)"
        />
        <KpiCard
          label="Total jobs"
          value={kpis.data?.total_jobs ?? (kpis.loading ? "…" : "—")}
        />
        <KpiCard
          label="Pipeline value"
          value={fmtMoney(kpis.data?.pipeline_value)}
          emphasis
        />
      </CardRow>

      <Panel
        title="Top 5 reps by completed revenue"
        action={
          <button
            onClick={() => navigate("rep-hub")}
            style={{
              background: "transparent",
              border: "1px solid var(--riq-border)",
              color: "var(--riq-text-muted)",
              borderRadius: 5,
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            View all →
          </button>
        }
      >
        {reps.loading && <Muted>loading…</Muted>}
        {!reps.loading && topReps.length === 0 && <Muted>no data</Muted>}
        {topReps.map((r) => (
          <RowLine key={r.name} left={r.name} right={fmtMoney(r.completedRevenue)} sub={`${r.signed ?? 0} signed · ${r.completed ?? 0} completed`} />
        ))}
      </Panel>

      <Panel
        title="Top 5 ZIPs by revenue (180d)"
        action={
          <button
            onClick={() => navigate("zip-hub")}
            style={{
              background: "transparent",
              border: "1px solid var(--riq-border)",
              color: "var(--riq-text-muted)",
              borderRadius: 5,
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Hot ZIPs →
          </button>
        }
      >
        {zips.loading && <Muted>loading…</Muted>}
        {!zips.loading && topZips.length === 0 && <Muted>no data</Muted>}
        {topZips.map((z) => (
          <RowLine key={z.zip} left={`${z.zip}${z.state ? `, ${z.state}` : ""}`} right={fmtMoney(z.revenue)} sub={`${z.signed ?? 0} signed`} />
        ))}
      </Panel>
    </HomeShell>
  );
}

function RowLine({ left, right, sub }: { left: string; right: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--riq-border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--riq-text)", fontWeight: 600 }}>{left}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--riq-text-muted)", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--riq-accent)" }}>{right}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: "var(--riq-text-muted)", padding: "4px 0" }}>{children}</div>;
}
