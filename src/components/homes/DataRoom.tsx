/**
 * Data Room — analytics persona home.
 *
 * Phase 2b skeleton: data quality flags (orphans), top intel surfaces.
 * Phase 6 ties this into the AI chat for ad-hoc queries.
 */
import { useUser } from "../../auth/UserContext";
import { HomeShell, KpiCard, CardRow, Panel, useFetch } from "./HomeCommon";

interface CarriersSummary {
  carriers: Array<{ name: string; total: number; complaint_index?: number }>;
}

interface RepsSummaryShape {
  reps: Array<{ name: string; signed?: number }>;
}

export function DataRoom({ navigate }: { navigate: (view: string) => void }) {
  const { user } = useUser();
  const carriers = useFetch<CarriersSummary>("/api/intel/carriers-summary");
  const reps = useFetch<RepsSummaryShape>("/api/intel/reps-summary");

  const carrierCount = carriers.data?.carriers?.length ?? 0;
  const repCount = reps.data?.reps?.length ?? 0;

  return (
    <HomeShell
      title={`Data Room${user?.display_name ? ` — ${user.display_name}` : ""}`}
      subtitle="Analytics surfaces, anomaly flags, intel exploration. Phase 6 adds the AI chat."
    >
      <CardRow>
        <KpiCard label="Carriers tracked"    value={carrierCount || (carriers.loading ? "…" : "—")} />
        <KpiCard label="Sales reps"           value={repCount || (reps.loading ? "…" : "—")} />
        <KpiCard label="Intel blobs"          value="33" hint="see Admin Console for freshness" />
      </CardRow>

      <Panel title="Deep dive surfaces">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Tile label="🏢 Carrier Hub"      onClick={() => navigate("carrier-hub")} />
          <Tile label="📋 Adjuster Hub"     onClick={() => navigate("adjuster-hub")} />
          <Tile label="🎯 Rep Hub"          onClick={() => navigate("rep-hub")} />
          <Tile label="📝 Notes Search"     onClick={() => navigate("notes")} />
          <Tile label="📊 Denial Stats"     onClick={() => navigate("denial-hub")} />
          <Tile label="🚧 Carrier Orphans"  onClick={() => navigate("carrier-orphans")} />
          <Tile label="🧬 Pipeline DNA"     onClick={() => navigate("pipeline-intel")} />
          <Tile label="🛡 Market Intel"     onClick={() => navigate("insurance-intel")} />
        </div>
      </Panel>

      <Panel title="Coming in Phase 6 — AI Data Chat">
        <div style={{ fontSize: 13, color: "var(--riq-text-muted)", lineHeight: 1.6 }}>
          Ask questions in natural language — "carriers with denial rate &gt; 30% in MD this quarter", "reps whose
          close rate dropped &gt;10pts month-over-month". Returns ranked answers + a "show me the query" toggle so
          you can verify the math.
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
