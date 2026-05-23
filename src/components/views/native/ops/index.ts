import type { NativeViewComponent } from "../types";
import { OpsSurveillance } from "./OpsSurveillance";
import { Scheduling } from "./Scheduling";
import { ActiveWork } from "./ActiveWork";
import { Receivables } from "./Receivables";
import { OpsTeam } from "./OpsTeam";
import { Notes } from "./Notes";
import { RoofdocsMap } from "./RoofdocsMap";

export const opsViews: Record<string, NativeViewComponent> = {
  "ops-surveillance": OpsSurveillance,
  "scheduling": Scheduling,
  "active-work": ActiveWork,
  "receivables": Receivables,
  "ops-team": OpsTeam,
  "notes": Notes,
  "map": RoofdocsMap,
};
