import type { NativeViewComponent } from "../types";
import { LeadScore } from "./LeadScore";
import { FieldGuide } from "./FieldGuide";
import { CheatSheet } from "./CheatSheet";
import { LifetimeTouch } from "./LifetimeTouch";
import { Campaigns } from "./Campaigns";
import { Solar } from "./Solar";
import { SmsReminders } from "./SmsReminders";

export const fieldViews: Record<string, NativeViewComponent> = {
  "lead-score": LeadScore,
  "field-guide": FieldGuide,
  "cheat-sheet": CheatSheet,
  "lifetime-touch": LifetimeTouch,
  "campaigns": Campaigns,
  "solar": Solar,
  "sms-reminders": SmsReminders,
};
