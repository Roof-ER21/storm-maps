/**
 * Shared card / shell components for the role-home + intel pages. Split from the
 * format helpers (home-format.ts) so each file exports only components OR only
 * non-components (react-refresh / Fast Refresh). Re-exported via the HomeCommon barrel.
 */
import { type ReactNode } from "react";

export function HomeShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "24px 32px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--riq-accent)", margin: 0, letterSpacing: "-0.01em" }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 13, color: "var(--riq-text-muted)", marginTop: 4 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 16, marginTop: 20 }}>{children}</div>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--riq-surface)",
        border: `1px solid ${emphasis ? "var(--riq-accent)" : "var(--riq-border)"}`,
        borderRadius: 8,
        padding: "14px 16px",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--riq-text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: emphasis ? "var(--riq-accent)" : "var(--riq-text)" }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--riq-text-muted)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function CardRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--riq-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--riq-accent)" }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "12px 16px" }}>{children}</div>
    </div>
  );
}
