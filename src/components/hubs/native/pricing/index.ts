import { lazy } from "react";
import type { ComponentType } from "react";

export const pricingTabs: Record<string, ComponentType> = {
  margins: lazy(() => import("./PricingMargins").then(m => ({ default: m.PricingMargins }))),
  library: lazy(() => import("./PricingLibrary").then(m => ({ default: m.PricingLibrary }))),
};
