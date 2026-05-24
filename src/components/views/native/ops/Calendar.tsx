/**
 * Calendar — native React (Phase 8d: event calendar over intel_events)
 *
 * Distinct from `Scheduling` (which is install-pipeline analytics over
 * /api/intel/scheduling). This is the portal's real event feed
 * (events/sales + events/production): Material Delivery, etc.
 *
 *   Today    → GET /api/intel/schedule-today
 *   Week     → GET /api/intel/schedule-week?days=7   (grouped by ET day)
 *   Upcoming → GET /api/intel/schedule-upcoming      (client-filtered by event_type)
 *
 * Built contract-first against server/intel/schedule.ts. Today loads eagerly;
 * Week/Upcoming lazy-load on first open (fetches set state only in async
 * callbacks — never synchronously in an effect). Clean empty states until the
 * portal pull lands.
 */
import { useState, useEffect, useRef } from "react";
import { useFetch, Panel } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response shapes (from server/intel/schedule.ts — note: event id is a string)
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  event_type: string | null;
  audience: string | null;
  start_time: string | null;
  end_time: string | null;
  customer_id: string | null;
  lead_id: string | null;
  supplier_id: string | null;
  notes: string | null;
  source: string | null;
}

interface TodayResp {
  date_et: string;
  total: number;
  by_type: { key: string; count: number }[];
  events: EventRow[];
  took_ms?: number;
}

interface WeekResp {
  days: number;
  total: number;
  by_day: { day: string; count: number; events: EventRow[] }[];
  took_ms?: number;
}

interface UpcomingResp {
  total: number;
  events: EventRow[];
  took_ms?: number;
}

type LoadState = "loading" | "error" | "ok";
type TabId = "today" | "week" | "upcoming";

const ET = "America/New_York";

// ---------------------------------------------------------------------------
// Helpers (pure — no Date.now in render)
// ---------------------------------------------------------------------------

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
}

function fmtRange(s: string | null, e: string | null): string {
  const a = fmtTime(s);
  if (!e) return a;
  const b = fmtTime(e);
  return b === "—" ? a : `${a}–${b}`;
}

function fmtDayHeader(day: string): string {
  const d = new Date(`${day}T12:00:00`); // noon avoids TZ rollover on the date label
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function who(e: EventRow): string {
  if (e.customer_id) return `Customer #${e.customer_id}`;
  if (e.lead_id) return `Lead #${e.lead_id}`;
  if (e.supplier_id) return `Supplier #${e.supplier_id}`;
  return "—";
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "10px 18px",
  cursor: "pointer",
  color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
  borderBottom: active ? "2px solid var(--riq-accent)" : "2px solid transparent",
  fontSize: 13,
  userSelect: "none" as const,
});

const chipStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 9px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  marginRight: 6,
  marginBottom: 6,
  background: "#342c23",
  color: "var(--riq-text-muted)",
};

const selectStyle: React.CSSProperties = {
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const muted: React.CSSProperties = { color: "var(--riq-text-muted)", fontSize: 12, lineHeight: 1.5 };

// ---------------------------------------------------------------------------
// One event row
// ---------------------------------------------------------------------------

function EventItem({ e }: { e: EventRow }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "9px 12px", borderBottom: "1px solid #342c23", alignItems: "baseline" }}>
      <div style={{ minWidth: 110, color: "var(--riq-accent)", fontWeight: 600, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        {fmtRange(e.start_time, e.end_time)}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{e.event_type ?? "(untyped event)"}</div>
        <div style={muted}>
          {who(e)}
          {e.source ? ` · ${e.source}` : ""}
          {e.notes ? ` · ${e.notes}` : ""}
        </div>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 20, ...muted }}>{msg}</div>;
}

function TabBusy({ state, label }: { state: LoadState; label: string }) {
  if (state === "loading") return <div style={{ padding: 30, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  return (
    <div style={{ padding: 20, ...muted }}>
      Couldn't load <strong style={{ color: "var(--riq-text)" }}>{label}</strong> — its Phase 8d endpoint may not be deployed yet.
      Populates automatically once live.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Calendar({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [tab, setTab] = useState<TabId>("today");

  // Today: eager on mount.
  const today = useFetch<TodayResp>("/api/intel/schedule-today");

  // Week / Upcoming: lazy on first open.
  const requested = useRef<Set<TabId>>(new Set());
  const [week, setWeek] = useState<WeekResp | null>(null);
  const [weekErr, setWeekErr] = useState(false);
  const [upcoming, setUpcoming] = useState<UpcomingResp | null>(null);
  const [upcomingErr, setUpcomingErr] = useState(false);

  // Upcoming client-side type filter.
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    if (tab === "today" || requested.current.has(tab)) return;
    requested.current.add(tab);
    if (tab === "week") {
      fetch("/api/intel/schedule-week?days=7", { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<WeekResp>; })
        .then(setWeek)
        .catch(() => setWeekErr(true));
    } else if (tab === "upcoming") {
      fetch("/api/intel/schedule-upcoming", { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<UpcomingResp>; })
        .then(setUpcoming)
        .catch(() => setUpcomingErr(true));
    }
  }, [tab]);

  const ls = (data: unknown, err: boolean): LoadState => (err ? "error" : data ? "ok" : "loading");

  const upcomingTypes = [...new Set((upcoming?.events ?? []).map((e) => e.event_type).filter(Boolean) as string[])].sort();
  const upcomingFiltered = (upcoming?.events ?? []).filter((e) => !typeFilter || e.event_type === typeFilter);

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* TABS */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
        {([
          ["today",    "Today"],
          ["week",     "This Week"],
          ["upcoming", "Upcoming"],
        ] as [TabId, string][]).map(([id, label]) => (
          <div key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {/* TODAY */}
      {tab === "today" && (
        today.loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
        ) : today.error || !today.data ? (
          <div style={{ padding: 20, color: "#ef4444" }}>Failed to load: {today.error}</div>
        ) : (
          <Panel title={`Today — ${today.data.date_et} · ${today.data.total} event${today.data.total === 1 ? "" : "s"}`}>
            {today.data.by_type.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {today.data.by_type.map((t) => (
                  <span key={t.key} style={chipStyle}>{t.key} · {t.count}</span>
                ))}
              </div>
            )}
            {today.data.events.length === 0
              ? <Empty msg="Nothing on the calendar today." />
              : today.data.events.map((e) => <EventItem key={e.id} e={e} />)}
          </Panel>
        )
      )}

      {/* WEEK */}
      {tab === "week" && (
        ls(week, weekErr) !== "ok" || !week ? (
          <TabBusy state={ls(week, weekErr)} label="This Week" />
        ) : (
          <Panel title={`This Week — ${week.total} event${week.total === 1 ? "" : "s"} over ${week.days} days`}>
            {week.by_day.length === 0
              ? <Empty msg="No events in the next 7 days." />
              : week.by_day.map((d) => (
                  <div key={d.day} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--riq-accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {fmtDayHeader(d.day)} · {d.count}
                    </div>
                    {d.events.map((e) => <EventItem key={e.id} e={e} />)}
                  </div>
                ))}
          </Panel>
        )
      )}

      {/* UPCOMING */}
      {tab === "upcoming" && (
        ls(upcoming, upcomingErr) !== "ok" || !upcoming ? (
          <TabBusy state={ls(upcoming, upcomingErr)} label="Upcoming" />
        ) : (
          <Panel
            title={`Upcoming — ${upcomingFiltered.length}${typeFilter ? ` ${typeFilter}` : ""} event${upcomingFiltered.length === 1 ? "" : "s"}`}
            action={
              upcomingTypes.length > 0 ? (
                <select value={typeFilter} onChange={(ev) => setTypeFilter(ev.target.value)} style={selectStyle}>
                  <option value="">All types</option>
                  {upcomingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : undefined
            }
          >
            {upcomingFiltered.length === 0
              ? <Empty msg="No upcoming events." />
              : upcomingFiltered.map((e) => <EventItem key={e.id} e={e} />)}
          </Panel>
        )
      )}

    </div>
  );
}
