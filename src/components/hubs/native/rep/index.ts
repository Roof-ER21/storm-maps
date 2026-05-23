import { lazy } from "react";
import type { ComponentType } from "react";

export const repTabs: Record<string, ComponentType> = {
  overview: lazy(() => import("./RepOverview").then(m => ({ default: m.RepOverview }))),
  response: lazy(() => import("./RepResponse").then(m => ({ default: m.RepResponse }))),
};
