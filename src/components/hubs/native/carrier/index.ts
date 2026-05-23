import type { ComponentType } from "react";
import { CarrierOverview } from "./CarrierOverview";
import { CarrierTrades } from "./CarrierTrades";
import { CarrierPlaybook } from "./CarrierPlaybook";
import { CarrierAlgorithms } from "./CarrierAlgorithms";

export const carrierTabs: Record<string, ComponentType> = {
  overview: CarrierOverview,
  trades: CarrierTrades,
  playbook: CarrierPlaybook,
  algorithms: CarrierAlgorithms,
};
