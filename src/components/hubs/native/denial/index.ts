import { lazy } from "react";
import type { ComponentType } from "react";

export const denialTabs: Record<string, ComponentType> = {
  analyze: lazy(() => import("./DenialAnalyze").then(m => ({ default: m.DenialAnalyze }))),
  archive: lazy(() => import("./DenialArchive").then(m => ({ default: m.DenialArchive }))),
  stats:   lazy(() => import("./DenialStats").then(m => ({ default: m.DenialStats }))),
};
