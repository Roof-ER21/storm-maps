import { lazy } from "react";
import type { NativeViewComponent } from "../types";

export const opsViews: Record<string, NativeViewComponent> = {
  "ops-surveillance": lazy(() => import("./OpsSurveillance").then(m => ({ default: m.OpsSurveillance }))),
  "scheduling":       lazy(() => import("./Scheduling").then(m => ({ default: m.Scheduling }))),
  "active-work":      lazy(() => import("./ActiveWork").then(m => ({ default: m.ActiveWork }))),
  "receivables":      lazy(() => import("./Receivables").then(m => ({ default: m.Receivables }))),
  "ops-team":         lazy(() => import("./OpsTeam").then(m => ({ default: m.OpsTeam }))),
  "notes":            lazy(() => import("./Notes").then(m => ({ default: m.Notes }))),
  "map":              lazy(() => import("./RoofdocsMap").then(m => ({ default: m.RoofdocsMap }))),
};
