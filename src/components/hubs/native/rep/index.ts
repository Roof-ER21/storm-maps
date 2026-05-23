import type { ComponentType } from "react";
import { RepOverview } from "./RepOverview";
import { RepResponse } from "./RepResponse";
export const repTabs: Record<string, ComponentType> = {
  overview: RepOverview,
  response: RepResponse,
};
