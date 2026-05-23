import type { NativeViewComponent } from "./types";
import { execViews } from "./exec";
import { fieldViews } from "./field";
import { opsViews } from "./ops";

/**
 * Native standalone-view registry (Phase 2d) — mirrors NATIVE_HUB_TABS.
 *
 * Maps an IntelView id -> a native React component that replaces the legacy
 * iframe of public/<page>.html. IntelligenceHub.renderView checks this AFTER
 * hubs and BEFORE the VIEW_FILES iframe fallback: a view renders native when
 * registered, else falls back to its HTML page. Build stays green while pages
 * migrate one at a time.
 *
 * Composed from per-group barrels so parallel work never collides — each owner
 * edits ONLY their barrel + component files, never this file or IntelligenceHub:
 *   exec/  (dcc, batch1)   field/ (dcc, batch2)   ops/ (mac, batch3)
 */
export const NATIVE_VIEWS: Record<string, NativeViewComponent> = {
  ...execViews,
  ...fieldViews,
  ...opsViews,
};
