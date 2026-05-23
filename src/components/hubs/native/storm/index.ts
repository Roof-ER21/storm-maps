import type { ComponentType } from "react";
import { StormPlaybook } from "./StormPlaybook";
import { StormIntel } from "./StormIntel";
import { StormExposure } from "./StormExposure";
export const stormTabs: Record<string, ComponentType> = {
  playbook: StormPlaybook,
  intel: StormIntel,
  exposure: StormExposure,
};
