#!/usr/bin/env node
/**
 * i18n parity checker.
 *
 * Exits 1 if:
 *  - Any locale contains a key that is not in the English source
 *    (indicates a stale/obsolete translation).
 *  - A user-facing prefix has missing keys in any locale.
 *
 * Admin console strings (adminTabs.*) are allowed to be missing because
 * they gracefully fall back to English and are not part of the critical path.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const I18N_DIR = path.resolve(__dirname, "..", "src", "i18n");
const LOCALES = ["hi", "kn", "ml", "ta", "te"];

// Prefixes we require full parity for. Missing keys under these prefixes fail the check.
const REQUIRED_PREFIXES = [
  "nav.",
  "common.",
  "auth.",
  "settings.",
  "explore.",
  "home.",
  "prayer.",
  "join.",
  "errors.",
  "banner.",
  "toast.",
  "checkout.",
  "donate.",
  "cookie.",
  "history.",
  "historyPage.",
  "profile.",
];

function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "en.json"), "utf8"));
const enFlat = flatten(en);
const enKeys = new Set(Object.keys(enFlat));

let failed = false;
const warnings = [];
const errors = [];

for (const locale of LOCALES) {
  const filePath = path.join(I18N_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    errors.push(`[${locale}] missing locale file: ${filePath}`);
    failed = true;
    continue;
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const flat = flatten(data);
  const keys = new Set(Object.keys(flat));

  // Required-prefix parity check
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const missingRequired = missing.filter((k) =>
    REQUIRED_PREFIXES.some((p) => k.startsWith(p)),
  );
  const missingOptional = missing.filter(
    (k) => !REQUIRED_PREFIXES.some((p) => k.startsWith(p)),
  );

  if (missingRequired.length) {
    errors.push(
      `[${locale}] missing ${missingRequired.length} required-prefix key(s):\n  - ` +
        missingRequired.slice(0, 20).join("\n  - ") +
        (missingRequired.length > 20 ? `\n  - ...and ${missingRequired.length - 20} more` : ""),
    );
    failed = true;
  }
  if (missingOptional.length) {
    warnings.push(
      `[${locale}] ${missingOptional.length} admin/optional key(s) fall back to English`,
    );
  }

  // Stale (locale-only) keys → hard failure
  const stale = [...keys].filter((k) => !enKeys.has(k));
  if (stale.length) {
    errors.push(
      `[${locale}] has ${stale.length} stale key(s) not present in en.json:\n  - ` +
        stale.join("\n  - "),
    );
    failed = true;
  }
}

if (warnings.length) {
  console.warn("\n⚠  i18n warnings:");
  for (const w of warnings) console.warn("  " + w);
}

if (errors.length) {
  console.error("\n✖ i18n errors:\n");
  for (const e of errors) console.error(e + "\n");
  console.error("i18n parity check FAILED.");
  process.exit(1);
}

console.log("\n✓ i18n parity check passed (required prefixes complete).");
