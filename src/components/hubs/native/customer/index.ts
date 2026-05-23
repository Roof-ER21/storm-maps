import type { ComponentType } from "react";
import { CustomerList } from "./CustomerList";
import { CustomerDetail } from "./CustomerDetail";
import { PropertyLookup } from "./PropertyLookup";
export const customerTabs: Record<string, ComponentType> = {
  list: CustomerList,
  detail: CustomerDetail,
  lookup: PropertyLookup,
};
