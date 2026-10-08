import { list, record, text, whole } from "./read.ts";

/** The address the viewport bar shows. */
export function url(page: unknown): string {
  return text(record(page).url);
}

/** The title under the viewport. */
export function title(page: unknown): string {
  return text(record(page).title);
}

/** The width every rectangle of this page is relative to. */
export function width(page: unknown): number {
  return whole(record(page).w);
}

/** The height every rectangle of this page is relative to. */
export function height(page: unknown): number {
  return whole(record(page).h);
}

/** Every element the page offered for an action. */
export function actions(page: unknown): readonly unknown[] {
  return list(record(page).actions);
}

/** The frame as a data URL, or nothing when the server sent no screenshot. */
export function shot(page: unknown): string | null {
  const frame = text(record(page).screenshot);
  return frame === "" ? null : `data:image/jpeg;base64,${frame}`;
}
