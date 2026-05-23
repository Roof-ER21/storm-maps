import type { ComponentType } from "react";

/** A native standalone-view component. Receives `navigate` (like the role
 *  homes) so a migrated page can link to hubs / other views. */
export type NativeViewComponent = ComponentType<{ navigate: (v: string) => void }>;
