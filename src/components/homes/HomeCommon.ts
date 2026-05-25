/**
 * HomeCommon — barrel re-exporting the home/intel card components (./home-cards)
 * and the fetch/format helpers (./home-format). Split into two files so each
 * exports only components OR only non-components (react-refresh / Fast Refresh);
 * this barrel preserves the original `homes/HomeCommon` import path for all
 * existing consumers. Kept as `.ts` (no JSX) so the re-export barrel isn't
 * subject to the component-only Fast Refresh rule.
 */
export * from "./home-cards";
export * from "./home-format";
