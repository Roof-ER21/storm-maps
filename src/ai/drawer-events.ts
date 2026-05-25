/**
 * AI drawer window-event names + dispatchers. Kept out of ChatDrawer.tsx so that
 * component file exports only components (react-refresh / Fast Refresh). The FAB
 * (rendered outside ChatDrawer) dispatches these to open/close without prop drilling.
 */
export const DRAWER_OPEN_EVENT = 'riq:ai-drawer-open';
export const DRAWER_CLOSE_EVENT = 'riq:ai-drawer-close';
export const DRAWER_TOGGLE_EVENT = 'riq:ai-drawer-toggle';

export function dispatchDrawerToggle() {
  window.dispatchEvent(new Event(DRAWER_TOGGLE_EVENT));
}
export function dispatchDrawerOpen() {
  window.dispatchEvent(new Event(DRAWER_OPEN_EVENT));
}
export function dispatchDrawerClose() {
  window.dispatchEvent(new Event(DRAWER_CLOSE_EVENT));
}
