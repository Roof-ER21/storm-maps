import { lazy } from "react";
import type { ComponentType } from "react";

export const adjusterTabs: Record<string, ComponentType> = {
  directory: lazy(() => import("./AdjusterDirectory").then(m => ({ default: m.AdjusterDirectory }))),
  detail:    lazy(() => import("./AdjusterDetail").then(m => ({ default: m.AdjusterDetail }))),
  twin:      lazy(() => import("./AdjusterTwin").then(m => ({ default: m.AdjusterTwin }))),
};
