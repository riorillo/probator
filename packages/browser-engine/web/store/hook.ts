import { useSyncExternalStore } from "react";

import { current, subscribe } from "./screen.ts";

/** The screen, redrawn whenever it changes. */
export function useScreen() {
  return useSyncExternalStore(subscribe, current);
}
