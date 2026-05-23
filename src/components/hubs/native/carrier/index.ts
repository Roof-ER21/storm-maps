import { lazy } from "react";
import type { ComponentType } from "react";

export const carrierTabs: Record<string, ComponentType> = {
  overview:   lazy(() => import("./CarrierOverview").then(m => ({ default: m.CarrierOverview }))),
  trades:     lazy(() => import("./CarrierTrades").then(m => ({ default: m.CarrierTrades }))),
  playbook:   lazy(() => import("./CarrierPlaybook").then(m => ({ default: m.CarrierPlaybook }))),
  algorithms: lazy(() => import("./CarrierAlgorithms").then(m => ({ default: m.CarrierAlgorithms }))),
};
