import type * as XlsxNamespace from "xlsx";

export type Xlsx = typeof XlsxNamespace;

let loaded: Xlsx | null = null;
let pending: Promise<Xlsx> | null = null;

/**
 * The spreadsheet reader is the heaviest dependency here and only the upload path
 * needs it, so it loads on demand instead of riding along with the first paint.
 * Await this before calling any of the parse functions.
 */
export async function loadXlsx(): Promise<Xlsx> {
  if (loaded) return loaded;
  if (!pending) {
    pending = import("xlsx").then((module) => {
      loaded = module;
      return module;
    });
  }
  return pending;
}

/** The loaded reader. Throws if reached before loadXlsx() has resolved. */
export function xlsx(): Xlsx {
  if (!loaded) throw new Error("The spreadsheet reader has not finished loading yet.");
  return loaded;
}
