import { pathToFileURL } from "node:url";

// IPC authority belongs to this exact document, never every file:// page.
export function trustedRenderer(url: string, entry: string, devUrl?: string) {
  try {
    const actual = new URL(url);
    actual.hash = "";
    const expected = new URL(devUrl ?? pathToFileURL(entry).href);
    expected.hash = "";
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

export const productionCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
