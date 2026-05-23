import { lazy } from "react";
import type { ComponentType } from "react";

export const zipTabs: Record<string, ComponentType> = {
  hot:   lazy(() => import("./ZipHot").then(m => ({ default: m.ZipHot }))),
  intel: lazy(() => import("./ZipIntel").then(m => ({ default: m.ZipIntel }))),
};
