import type { ComponentType } from "react";
import { carrierTabs } from "./carrier";
import { stormTabs } from "./storm";
import { denialTabs } from "./denial";
import { adjusterTabs } from "./adjuster";
import { repTabs } from "./rep";
import { customerTabs } from "./customer";
import { leadsTabs } from "./leads";
import { pricingTabs } from "./pricing";
import { zipTabs } from "./zip";

/**
 * Per-hub map of tab-id -> native React component.
 *
 * HubWrapper renders the native component when an entry exists for
 * (hub.view, tab.id); otherwise it falls back to the legacy iframe of the
 * tab's HTML page. This lets Phase 2c migrate hubs one at a time while the
 * build stays green and every hub keeps working.
 */
export const NATIVE_HUB_TABS: Record<string, Record<string, ComponentType>> = {
  "carrier-hub": carrierTabs,
  "storm-hub": stormTabs,
  "denial-hub": denialTabs,
  "adjuster-hub": adjusterTabs,
  "rep-hub": repTabs,
  "customer-hub": customerTabs,
  "leads-hub": leadsTabs,
  "pricing-hub": pricingTabs,
  "zip-hub": zipTabs,
};
