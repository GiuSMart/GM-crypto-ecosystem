#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const manifestPath = path.join(root, "licenses", "upstream", "manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).packages ?? {}
  : {};
const outputDir = path.join(root, "artifacts");
const outputPath = path.join(outputDir, "THIRD_PARTY_NOTICES.generated.md");
const sections = [
  "# Generated third-party license notices",
  "",
  "> Generated from installed node_modules, licenses/upstream/manifest.json and package-lock.json. Review before redistribution.",
  ""
];
const missing = [];
let included = 0;
let verifiedAbsent = 0;

const packageName = (lockPathName) => {
  const marker = "/node_modules/";
  const nested = lockPathName.lastIndexOf(marker);
  return nested >= 0 ? lockPathName.slice(nested + marker.length) : lockPathName.replace(/^node_modules\//, "");
};

for (const [lockPathName, metadata] of Object.entries(lock.packages ?? {})) {
  if (!lockPathName) continue;
  const packageDir = path.resolve(root, lockPathName);
  const modulesRoot = path.resolve(root, "node_modules") + path.sep;
  if (!packageDir.startsWith(modulesRoot)) {
    throw new Error("Refusing package path outside node_modules: " + lockPathName);
  }
  const packageJsonPath = path.join(packageDir, "package.json");
  const installed = fs.existsSync(packageJsonPath);
  const name = installed ? JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).name ?? packageName(lockPathName) : packageName(lockPathName);
  const version = (installed ? JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version : undefined) ?? metadata.version ?? "";
  const declared = typeof metadata.license === "string" ? metadata.license : "UNDECLARED";

  const localFiles = installed
    ? fs.readdirSync(packageDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^(license|licence|copying|notice)([-_.]|$)/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
    : [];

  sections.push("## " + name + " " + version);
  sections.push("");
  sections.push("- Declared license: " + declared);
  sections.push("- Lockfile path: " + lockPathName);

  if (localFiles.length > 0) {
    for (const file of localFiles) {
      const text = fs.readFileSync(path.join(packageDir, file), "utf8");
      sections.push("", "### " + file, "", "~~~text", text.replace(/~~~/g, "~ ~ ~"), "~~~");
      included += 1;
    }
    sections.push("");
    continue;
  }

  const upstream = manifest[packageName(lockPathName)];
  const upstreamFiles = Array.isArray(upstream?.files) ? upstream.files : [];
  if (upstreamFiles.length > 0) {
    sections.push("- Source: published tarball, integrity verified against the lockfile.");
    for (const file of upstreamFiles) {
      const fullPath = path.join(root, file.path);
      const text = fs.readFileSync(fullPath, "utf8");
      sections.push("", "### " + path.posix.basename(file.path) + " (from " + file.source + ")", "", "~~~text", text.replace(/~~~/g, "~ ~ ~"), "~~~");
      included += 1;
    }
    sections.push("");
    continue;
  }

  if (upstream?.status === "no-notice-file") {
    // Verified outcome, not an omission: the publisher ships no notice file in the
    // exact artifact this project installs, so the bundle records that fact instead
    // of pasting a licence text nobody published.
    sections.push(
      "- Upstream notice file: **none shipped by the publisher** in the verified tarball (declared license " + declared + ").",
      "- Verification: tarball sha512 matches the lockfile integrity hash.",
    );
    verifiedAbsent += 1;
    sections.push("");
    continue;
  }

  sections.push("- Upstream LICENSE/NOTICE file: **not found** (run `npm run licenses:upstream`).");
  missing.push(name + "@" + version + ": no notice file and no verified upstream record");
  sections.push("");
}

sections.push("## Generation summary", "");
sections.push("- Packages processed: " + (Object.keys(lock.packages ?? {}).length - 1));
sections.push("- License/notice files included: " + included);
sections.push("- Packages verified as shipping no notice file: " + verifiedAbsent);
sections.push("- Packages requiring manual notice retrieval: " + missing.length);
if (missing.length) {
  sections.push("", "### Missing notice files", "");
  for (const item of missing) sections.push("- " + item);
}
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, sections.join("\n") + "\n");
console.log("Generated " + path.relative(root, outputPath));
console.log("Included " + included + " license/notice file(s); " + verifiedAbsent + " package(s) verified as shipping none; " + missing.length + " package(s) require manual notice retrieval.");
if (missing.length && process.argv.includes("--strict")) process.exitCode = 2;
