import type { ComponentType } from "react";
import { AdjusterDirectory } from "./AdjusterDirectory";
import { AdjusterDetail } from "./AdjusterDetail";
import { AdjusterTwin } from "./AdjusterTwin";
export const adjusterTabs: Record<string, ComponentType> = {
  directory: AdjusterDirectory,
  detail: AdjusterDetail,
  twin: AdjusterTwin,
};
