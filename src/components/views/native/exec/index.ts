import { lazy } from "react";
import type { NativeViewComponent } from "../types";

/** Phase 2d batch1 — exec/analytics native views (owner: dcc).
 *  Keys are IntelView ids (see IntelligenceHub VIEW_FILES). */
export const execViews: Record<string, NativeViewComponent> = {
  "exec":           lazy(() => import("./ExecPage").then(m => ({ default: m.ExecPage }))),
  "weekly-recap":   lazy(() => import("./WeeklyRecap").then(m => ({ default: m.WeeklyRecap }))),
  "analytics":      lazy(() => import("./Analytics").then(m => ({ default: m.Analytics }))),
  "insurance-intel":lazy(() => import("./Market").then(m => ({ default: m.Market }))),
  "pipeline-intel": lazy(() => import("./Pipeline").then(m => ({ default: m.Pipeline }))),
  "carrier-orphans":lazy(() => import("./CarrierOrphans").then(m => ({ default: m.CarrierOrphans }))),
};
