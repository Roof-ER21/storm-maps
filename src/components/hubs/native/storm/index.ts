import { lazy } from "react";
import type { ComponentType } from "react";

export const stormTabs: Record<string, ComponentType> = {
  playbook: lazy(() => import("./StormPlaybook").then(m => ({ default: m.StormPlaybook }))),
  intel:    lazy(() => import("./StormIntel").then(m => ({ default: m.StormIntel }))),
  exposure: lazy(() => import("./StormExposure").then(m => ({ default: m.StormExposure }))),
};
