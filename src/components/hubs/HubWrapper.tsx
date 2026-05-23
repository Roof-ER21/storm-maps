/**
 * HubWrapper — generic tabbed iframe shell for a consolidated hub.
 *
 * Reads the `?tab=` query param to decide which sub-view to render;
 * defaults to the first tab in the hub config. Tab changes push a new
 * history entry via window.history.pushState so back-button works.
 *
 * Phase 2b: iframes the underlying HTML page so behavior is identical to
 * pre-restructure. Phase 2c+ will swap iframe `src` for native React.
 */
import { useEffect, useState, useCallback } from "react";
import type { HubConfig } from "./hubs";

interface Props {
  hub: HubConfig;
}

function readTabFromUrl(defaultTab: string): string {
  if (typeof window === "undefined") return defaultTab;
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return tab ?? defaultTab;
}

function writeTabToUrl(tab: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.pushState({}, "", next);
}

export function HubWrapper({ hub }: Props) {
  const defaultTab = hub.tabs[0].id;
  const [activeTab, setActiveTab] = useState<string>(() => readTabFromUrl(defaultTab));

  // Reset to URL tab when hub changes (e.g. navigating between hubs)
  useEffect(() => {
    setActiveTab(readTabFromUrl(defaultTab));
  }, [hub.view, defaultTab]);

  // Listen for back/forward so URL stays in sync with tab state.
  useEffect(() => {
    const onPop = () => setActiveTab(readTabFromUrl(defaultTab));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [defaultTab]);

  const handleTabClick = useCallback((tabId: string) => {
    setActiveTab(tabId);
    writeTabToUrl(tabId);
  }, []);

  const tab = hub.tabs.find((t) => t.id === activeTab) ?? hub.tabs[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          background: "var(--riq-surface)",
          borderBottom: "1px solid var(--riq-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--riq-accent)",
            marginRight: 12,
            letterSpacing: "0.02em",
          }}
        >
          {hub.title}
        </span>
        {hub.tabs.map((t) => {
          const active = t.id === tab.id;
          return (
            <button
              key={t.id}
              onClick={() => handleTabClick(t.id)}
              style={{
                background: active ? "rgba(244,167,56,0.18)" : "transparent",
                border: `1px solid ${active ? "var(--riq-accent)" : "var(--riq-border)"}`,
                color: active ? "var(--riq-accent)" : "var(--riq-text)",
                borderRadius: 5,
                padding: "5px 12px",
                fontSize: 12,
                fontFamily: "inherit",
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <iframe
        key={`${hub.view}:${tab.id}`}
        src={`/${tab.src}`}
        style={{ width: "100%", flex: 1, border: 0, background: "var(--riq-bg)" }}
        title={`${hub.title} — ${tab.label}`}
      />
    </div>
  );
}
