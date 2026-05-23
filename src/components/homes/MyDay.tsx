/**
 * My Day — employee personal home.
 *
 * Phase 2b skeleton: greets user, surfaces top hot ZIPs + recent storms,
 * links to the field-critical hubs. Phase 2d pulls in the full personal-rep
 * queue (lifetime touch + my leads).
 */
import { useUser } from "../../auth/UserContext";
import { HomeShell, KpiCard, CardRow, Panel, useFetch, fmtMoney } from "./HomeCommon";

interface DashboardKpis {
  hero?: {
    total?: number;
    completed?: number;
    dead?: number;
  };
}

interface ZipRow {
  zip: string;
  state?: string;
  signed?: number;
  revenue?: number;
}

export function MyDay({ navigate }: { navigate: (view: string) => void }) {
  const { user } = useUser();
  const kpis = useFetch<DashboardKpis>("/api/intel/dashboard-kpis");
  const zips = useFetch<{ zips: ZipRow[] }>("/api/intel/zip-stats?window=30");

  const hero = kpis.data?.hero;
  const decided = hero ? (hero.completed ?? 0) + (hero.dead ?? 0) : 0;
  const closeRate = hero && decided > 0 ? (hero.completed ?? 0) / decided : null;

  const topZips = (zips.data?.zips ?? [])
    .sort((a, b) => (b.signed ?? 0) - (a.signed ?? 0))
    .slice(0, 8);

  return (
    <HomeShell
      title={`Good day${user?.display_name ? `, ${user.display_name}` : ""}`}
      subtitle="Field-ready tools. Phase 2d wires in your personal lifetime-touch queue."
    >
      <CardRow>
        <KpiCard
          label="Jobs (all-time)"
          value={hero?.total ?? (kpis.loading ? "…" : "—")}
        />
        <KpiCard
          label="Avg close rate"
          value={closeRate != null ? `${(closeRate * 100).toFixed(1)}%` : "—"}
          hint="organization-wide"
        />
      </CardRow>

      <Panel
        title="Hot ZIPs — last 30 days"
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
            All ZIPs →
          </button>
        }
      >
        {zips.loading && <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>loading…</div>}
        {!zips.loading && topZips.length === 0 && <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>no recent activity</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          {topZips.map((z) => (
            <div
              key={z.zip}
              style={{
                background: "var(--riq-surface-elev)",
                border: "1px solid var(--riq-border)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--riq-accent)" }}>{z.zip}{z.state ? `, ${z.state}` : ""}</div>
              <div style={{ fontSize: 11, color: "var(--riq-text-muted)", marginTop: 2 }}>{z.signed ?? 0} signed · {fmtMoney(z.revenue)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Field tools">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Tile label="🎯 Lead Score"        onClick={() => navigate("lead-score")} />
          <Tile label="🔮 Predictor"         onClick={() => navigate("predictor")} />
          <Tile label="⚖️ Denial Combat"     onClick={() => navigate("denial-hub")} />
          <Tile label="🪞 Adjuster Twin"     onClick={() => navigate("adjuster-hub")} />
          <Tile label="🌪 Storm Response"    onClick={() => navigate("storm-hub")} />
          <Tile label="💞 Lifetime Touch"    onClick={() => navigate("lifetime-touch")} />
          <Tile label="📍 Hot ZIPs"          onClick={() => navigate("zip-hub")} />
          <Tile label="👥 Customer"          onClick={() => navigate("customer-hub")} />
        </div>
      </Panel>
    </HomeShell>
  );
}

function Tile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "var(--riq-surface-elev)",
        border: "1px solid var(--riq-border)",
        color: "var(--riq-text)",
        borderRadius: 6,
        padding: "12px 14px",
        textAlign: "left",
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}
