import { lazy } from "react";
import type { ComponentType } from "react";

export const leadsTabs: Record<string, ComponentType> = {
  intel:  lazy(() => import("./LeadsIntel").then(m => ({ default: m.LeadsIntel }))),
  funnel: lazy(() => import("./LeadsFunnel").then(m => ({ default: m.LeadsFunnel }))),
};
