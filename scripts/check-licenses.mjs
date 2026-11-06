#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lockPath = path.join(root, "package-lock.json");
const baselinePath = path.join(root, "licenses", "third-party-baseline.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const permissiveIds = new Set([
  "MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause",
  "0BSD", "Zlib", "Unlicense", "CC0-1.0"
]);
const restrictedPattern = /GPL|LGPL|AGPL|MPL|EPL|CDDL|CC-BY|SSPL|BUSL|OSL|CPAL|CPL/i;
const packages = [];
const errors = [];
const review = [];
const counts = Object.create(null);

function isKnownPermissiveExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) return false;
  const tokens = expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:AND|OR|WITH)\s+|\s+/i)
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => permissiveIds.has(token));
}

/**
 * A retained restricted licence is only acceptable when the exception is documented:
 * why it is acceptable, which obligations it creates, and when it must be reviewed
 * again. Without those fields the baseline would turn any copyleft dependency into an
 * implicit approval, which is exactly the hole this check has to close.
 */
function undocumentedException(entry) {
  const problems = [];
  if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) problems.push("reason");
  if (typeof entry.obligations !== "string" || entry.obligations.trim().length < 10) problems.push("obligations");
  if (typeof entry.reviewDueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewDueOn)) problems.push("reviewDueOn");
  return problems;
}

for (const [lockPathName, metadata] of Object.entries(lock.packages ?? {})) {
  if (!lockPathName) continue;
  const name = lockPathName.replace(/^node_modules\//, "");
  const version = metadata.version ?? null;
  const license = typeof metadata.license === "string" ? metadata.license.trim() : null;
  const previous = baseline.packages?.[name];

  counts[license ?? "MISSING"] = (counts[license ?? "MISSING"] ?? 0) + 1;
  packages.push({ name, version, license });

  if (!license) {
    errors.push(`${name}: missing license metadata`);
    continue;
  }

  if (previous) {
    if (previous.license !== license) {
      errors.push(`${name}: license changed from "${previous.license}" to "${license}" — manual review and baseline update required`);
    } else if (restrictedPattern.test(license)) {
      const undocumented = undocumentedException(previous);
      if (undocumented.length > 0) {
        errors.push(
          `${name}@${version}: baseline exception is not documented (missing or invalid: ${undocumented.join(", ")}) — record reason, obligations and reviewDueOn`,
        );
      } else {
        review.push(`${name}@${version}: documented baseline exception (${license}); review due ${previous.reviewDueOn}`);
      }
    }
    continue;
  }

  if (isKnownPermissiveExpression(license)) {
    continue;
  }

  if (restrictedPattern.test(license)) {
    errors.push(`${name}@${version}: new restrictive/attribution license "${license}" — manual approval required`);
  } else {
    errors.push(`${name}@${version}: unknown or unapproved license "${license}" — manual review required`);
  }
}

for (const name of Object.keys(baseline.packages ?? {})) {
  if (!packages.some((item) => item.name === name)) {
    review.push(`${name}: package no longer present in current lockfile; remove from baseline only after review`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  source: "package-lock.json",
  packageCount: packages.length,
  licenseCounts: counts,
  packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
  reviewRequired: review,
  errors
};

if (process.argv.includes("--report")) {
  const output = path.join(root, "artifacts", "third-party-licenses.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${path.relative(root, output)}`);
}

console.log(`License inventory: ${report.packageCount} packages`);
console.log("License counts:", counts);
console.log(`Review-required baseline entries: ${review.length}`);
for (const item of review) console.warn(`REVIEW: ${item}`);
if (errors.length) {
  for (const item of errors) console.error(`BLOCK: ${item}`);
  console.error(`License check failed with ${errors.length} blocking issue(s).`);
  process.exitCode = 1;
} else {
  console.log("License check passed: no new unapproved or unknown license expressions.");
}
