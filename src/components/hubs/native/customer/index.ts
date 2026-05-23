import { lazy } from "react";
import type { ComponentType } from "react";

export const customerTabs: Record<string, ComponentType> = {
  list:   lazy(() => import("./CustomerList").then(m => ({ default: m.CustomerList }))),
  detail: lazy(() => import("./CustomerDetail").then(m => ({ default: m.CustomerDetail }))),
  lookup: lazy(() => import("./PropertyLookup").then(m => ({ default: m.PropertyLookup }))),
};
