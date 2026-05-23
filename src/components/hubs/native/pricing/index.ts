import type { ComponentType } from "react";
import { PricingMargins } from "./PricingMargins";
import { PricingLibrary } from "./PricingLibrary";
export const pricingTabs: Record<string, ComponentType> = {
  margins: PricingMargins,
  library: PricingLibrary,
};
