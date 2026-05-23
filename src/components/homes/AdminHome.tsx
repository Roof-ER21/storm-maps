/**
 * Admin Home — system console for the platform owner.
 *
 * Phase 2b skeleton: shows data freshness, refresh state, user count.
 * Phase 6 adds AI usage rollup + pattern-gate hits + error log feed.
 */
import { useUser } from "../../auth/UserContext";
import { HomeShell, KpiCard, CardRow, Panel, useFetch, fmtAgo } from "./HomeCommon";

interface IntelHealthFile {
  available?: boolean;
  bytes?: number;
  ageHours?: number;
  source?: string;
}

interface IntelHealth {
  status?: string;
  generated?: string;
  oldestFileHours?: number;
  files?: Record<string, IntelHealthFile>;
}

interface RefreshStatus {
  state: "idle" | "running" | "success" | "error";
  startedAt?: string | null;
  finishedAt?: string | null;
  consumer?: string | null;
}

export function AdminHome({ navigate }: { navigate: (view: string) => void }) {
  const { user } = useUser();
  const health = useFetch<IntelHealth>("/api/intel/health");
  const refresh = useFetch<RefreshStatus>("/api/intel/refresh/status");

  const files = Object.entries(health.data?.files ?? {});
  const blobCount = files.length;
  const freshest = files.length
    ? files.reduce((a, b) => ((a[1].ageHours ?? Infinity) <= (b[1].ageHours ?? Infinity) ? a : b))
    : null;
  const oldest = files.length
    ? files.reduce((a, b) => ((a[1].ageHours ?? -1) >= (b[1].ageHours ?? -1) ? a : b))
    : null;
  const fmtHrs = (h?: number) =>
    h == null ? "—" : h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;

  return (
    <HomeShell
      title={`Admin Console — ${user?.display_name ?? user?.email ?? "operator"}`}
      subtitle="Data freshness, refresh state, system health. Phase 6 will add AI usage + pattern-gate."
    >
      <CardRow>
        <KpiCard
          label="Intel blobs"
          value={blobCount || (health.loading ? "…" : "—")}
          hint={blobCount ? `out of 33 expected` : "endpoint unavailable"}
        />
        <KpiCard
          label="Freshest blob"
          value={freshest ? fmtHrs(freshest[1].ageHours) : "—"}
          hint={freshest?.[0]}
        />
        <KpiCard
          label="Oldest blob"
          value={oldest ? fmtHrs(oldest[1].ageHours) : "—"}
          hint={oldest?.[0]}
          emphasis={oldest ? (oldest[1].ageHours ?? 0) > 168 : false}
        />
        <KpiCard
          label="Refresh state"
          value={refresh.data?.state ?? (refresh.loading ? "…" : "unknown")}
          hint={refresh.data?.startedAt ? `started ${fmtAgo(refresh.data.startedAt)}` : undefined}
        />
      </CardRow>

      {/* Prominent switch-to-Exec-Home, since admin often wears the exec hat. */}
      <button
        onClick={() => navigate("exec-home")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          background: "rgba(244,167,56,0.10)",
          border: "2px solid rgba(244,167,56,0.5)",
          borderRadius: 10,
          padding: "14px 20px",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 28 }}>📊</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--riq-accent)" }}>
            Switch to Exec Home
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginTop: 2 }}>
            Revenue · top reps · top ZIPs · pipeline DNA — leadership view in one click
          </div>
        </div>
        <span style={{ fontSize: 18, color: "var(--riq-accent)", fontWeight: 800 }}>→</span>
      </button>

      <Panel title="Top intel surfaces">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <NavTile label="📋 Master Guide"    onClick={() => navigate("master-guide")} />
          <NavTile label="🏢 Carrier Hub"     onClick={() => navigate("carrier-hub")} />
          <NavTile label="🌪 Storm Hub"       onClick={() => navigate("storm-hub")} />
          <NavTile label="⚖️ Denial Hub"      onClick={() => navigate("denial-hub")} />
          <NavTile label="📈 Analytics"       onClick={() => navigate("analytics")} />
          <NavTile label="🔬 Data Room"       onClick={() => navigate("data-room")} />
        </div>
      </Panel>

      <Panel title="Coming in Phase 6">
        <div style={{ fontSize: 13, color: "var(--riq-text-muted)", lineHeight: 1.6 }}>
          AI usage rollup · pattern-gate hits · error log feed · user role management UI · refresh trigger button.
        </div>
      </Panel>
    </HomeShell>
  );
}

function NavTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "var(--riq-surface-elev)",
        border: "1px solid var(--riq-border)",
        color: "var(--riq-text)",
        borderRadius: 6,
        padding: "10px 14px",
        textAlign: "left",
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
