import type { ComponentType } from "react";
import { DenialAnalyze } from "./DenialAnalyze";
import { DenialArchive } from "./DenialArchive";
import { DenialStats } from "./DenialStats";
export const denialTabs: Record<string, ComponentType> = {
  analyze: DenialAnalyze,
  archive: DenialArchive,
  stats: DenialStats,
};
