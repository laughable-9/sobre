/**
 * passkey-kit pins its own copy of `@stellar/stellar-sdk` under
 * `node_modules/passkey-kit/node_modules/`. That bundled copy's
 * `lib/minimal/bindings/config.js` does:
 *
 *     require("../../package.json")
 *
 * which resolves to `lib/package.json`, but the real package.json sits one
 * level up at the package root. Turbopack catches this at module resolution
 * time and refuses to compile — silently swallowed under the old next dev
 * cache, but it bites the moment `.next` is cleared.
 *
 * Fix: copy the real package.json into `lib/` so the relative require lands.
 * Runs as a postinstall step so `npm install` doesn't undo the fix.
 *
 * No-ops gracefully when the broken file doesn't exist (passkey-kit updates,
 * Linux/macOS/Windows differences). Never fail npm install over this.
 */

import { copyFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkgDir = resolve(
  root,
  "node_modules/passkey-kit/node_modules/@stellar/stellar-sdk",
);
const src = resolve(pkgDir, "package.json");
const dst = resolve(pkgDir, "lib/package.json");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (await exists(src)) {
  try {
    await copyFile(src, dst);
    console.log(`[fix-passkey-kit] copied package.json into lib/`);
  } catch (err) {
    console.warn(`[fix-passkey-kit] skipped: ${err.message}`);
  }
} else {
  console.log("[fix-passkey-kit] nothing to do (no nested stellar-sdk)");
}
