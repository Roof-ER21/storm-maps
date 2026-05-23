import { lazy } from "react";
import type { NativeViewComponent } from "../types";

export const fieldViews: Record<string, NativeViewComponent> = {
  "lead-score":     lazy(() => import("./LeadScore").then(m => ({ default: m.LeadScore }))),
  "field-guide":    lazy(() => import("./FieldGuide").then(m => ({ default: m.FieldGuide }))),
  "cheat-sheet":    lazy(() => import("./CheatSheet").then(m => ({ default: m.CheatSheet }))),
  "lifetime-touch": lazy(() => import("./LifetimeTouch").then(m => ({ default: m.LifetimeTouch }))),
  "campaigns":      lazy(() => import("./Campaigns").then(m => ({ default: m.Campaigns }))),
  "solar":          lazy(() => import("./Solar").then(m => ({ default: m.Solar }))),
  "sms-reminders":  lazy(() => import("./SmsReminders").then(m => ({ default: m.SmsReminders }))),
};
