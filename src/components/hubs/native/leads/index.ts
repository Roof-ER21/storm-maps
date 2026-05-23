import type { ComponentType } from "react";
import { LeadsIntel } from "./LeadsIntel";
import { LeadsFunnel } from "./LeadsFunnel";
export const leadsTabs: Record<string, ComponentType> = {
  intel: LeadsIntel,
  funnel: LeadsFunnel,
};
