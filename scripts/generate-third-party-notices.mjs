#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const outputDir = path.join(root, "artifacts");
const outputPath = path.join(outputDir, "THIRD_PARTY_NOTICES.generated.md");
const sections = [
  "# Generated third-party license notices",
  "",
  "> Generated from installed node_modules and package-lock.json. Review before redistribution.",
  ""
];
const missing = [];
let included = 0;

for (const [lockPathName, metadata] of Object.entries(lock.packages ?? {})) {
  if (!lockPathName) continue;
  const packageDir = path.resolve(root, lockPathName);
  const modulesRoot = path.resolve(root, "node_modules") + path.sep;
  if (!packageDir.startsWith(modulesRoot)) {
    throw new Error("Refusing package path outside node_modules: " + lockPathName);
  }
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    missing.push(lockPathName + ": package.json not found after npm ci");
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const files = fs.readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(license|licence|copying|notice)([-_.]|$)/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  sections.push("## " + (pkg.name ?? lockPathName) + " " + (pkg.version ?? metadata.version ?? ""));
  sections.push("");
  sections.push("- Declared license: " + (typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? metadata.license ?? "UNDECLARED")));
  sections.push("- Lockfile path: " + lockPathName);
  if (!files.length) {
    sections.push("- Upstream LICENSE/NOTICE file: **not found in installed package directory** (manual retrieval required).");
    missing.push((pkg.name ?? lockPathName) + "@" + (pkg.version ?? metadata.version ?? "unknown") + ": no LICENSE/NOTICE file found");
  } else {
    for (const file of files) {
      const fullPath = path.join(packageDir, file);
      const text = fs.readFileSync(fullPath, "utf8");
      sections.push("");
      sections.push("### " + file);
      sections.push("");
      sections.push("~~~text");
      sections.push(text.replace(/~~~/g, "~ ~ ~"));
      sections.push("~~~");
      included += 1;
    }
  }
  sections.push("");
}

sections.push("## Generation summary", "");
sections.push("- Packages processed: " + (Object.keys(lock.packages ?? {}).length - 1));
sections.push("- License/notice files included: " + included);
sections.push("- Packages requiring manual notice retrieval: " + missing.length);
if (missing.length) {
  sections.push("", "### Missing notice files", "");
  for (const item of missing) sections.push("- " + item);
}
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, sections.join("\n") + "\n");
console.log("Generated " + path.relative(root, outputPath));
console.log("Included " + included + " license/notice file(s); " + missing.length + " package(s) require manual notice retrieval.");
if (missing.length && process.argv.includes("--strict")) process.exitCode = 2;
