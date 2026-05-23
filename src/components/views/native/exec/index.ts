import type { NativeViewComponent } from "../types";
import { ExecPage } from "./ExecPage";
import { WeeklyRecap } from "./WeeklyRecap";
import { Analytics } from "./Analytics";
import { Market } from "./Market";
import { Pipeline } from "./Pipeline";
import { CarrierOrphans } from "./CarrierOrphans";

/** Phase 2d batch1 — exec/analytics native views (owner: dcc).
 *  Keys are IntelView ids (see IntelligenceHub VIEW_FILES). */
export const execViews: Record<string, NativeViewComponent> = {
  "exec": ExecPage,
  "weekly-recap": WeeklyRecap,
  "analytics": Analytics,
  "insurance-intel": Market,
  "pipeline-intel": Pipeline,
  "carrier-orphans": CarrierOrphans,
};
