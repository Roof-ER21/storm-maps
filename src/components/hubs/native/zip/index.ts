import type { ComponentType } from "react";
import { ZipHot } from "./ZipHot";
import { ZipIntel } from "./ZipIntel";
export const zipTabs: Record<string, ComponentType> = {
  hot: ZipHot,
  intel: ZipIntel,
};
