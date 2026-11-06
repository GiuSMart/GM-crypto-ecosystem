#!/usr/bin/env node
/**
 * Recovers the LICENSE/NOTICE files that published npm tarballs actually carry.
 *
 * Why tarballs: the tarball is the exact artifact this project installs and
 * redistributes, so its notices are the authoritative ones. Every download is
 * checked against the `integrity` hash already recorded in package-lock.json, so a
 * tampered or substituted tarball is rejected instead of being copied in.
 *
 * Packages whose tarball ships no notice file at all are recorded as verified
 * absences, with the declared licence and the tarball hash, rather than being
 * filled with a license text someone guessed. Nothing here is invented.
 *
 * Requires network access. Run it only when maintaining the notices bundle: CI
 * validates the committed output and never downloads anything.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const upstreamRoot = path.join(root, "licenses", "upstream");
const manifestPath = path.join(upstreamRoot, "manifest.json");
const noticePattern = /^(license|licence|copying|notice)([-_.]|$)/i;
const concurrency = 6;
const timeoutMs = 30_000;

const packageName = (lockPathName) => {
  const marker = "/node_modules/";
  const nested = lockPathName.lastIndexOf(marker);
  return nested >= 0 ? lockPathName.slice(nested + marker.length) : lockPathName.replace(/^node_modules\//, "");
};

const folderName = (lockPathName, version) => `${packageName(lockPathName).replace(/\//g, "__")}@${version}`;

function installedNoticeFiles(lockPathName) {
  try {
    return fs
      .readdirSync(path.resolve(root, lockPathName), { withFileTypes: true })
      .filter((entry) => entry.isFile() && noticePattern.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Minimal ustar reader: only the header fields needed to walk entries. */
function readTarEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "")
        .trim();
    const name = field(0, 100);
    const prefix = field(345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 12), 8);
    if (!Number.isFinite(size) || size < 0) break;
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    if ((type === "0" || type === "48") && noticePattern.test(path.posix.basename(fullName))) {
      entries.push({ name: fullName, content: buffer.subarray(dataStart, dataStart + size) });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function verifyIntegrity(buffer, integrity) {
  if (typeof integrity !== "string" || integrity.length === 0) {
    return "lockfile records no integrity hash";
  }
  const [algorithm, digest] = integrity.split(/\s+/)[0].split("-");
  if (!algorithm || !digest) return "integrity hash is malformed";
  const actual = crypto.createHash(algorithm).update(buffer).digest("base64");
  return actual === digest ? null : `integrity mismatch (${algorithm})`;
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function recover(lockPathName, metadata) {
  const version = metadata.version ?? "0.0.0";
  const record = {
    version,
    license: typeof metadata.license === "string" ? metadata.license : null,
    resolved: metadata.resolved ?? null,
    integrity: metadata.integrity ?? null,
  };
  if (!metadata.resolved) return { record: { ...record, status: "unavailable" }, files: [] };

  let tarball;
  try {
    tarball = await download(metadata.resolved);
  } catch (error) {
    return { record: { ...record, status: "unavailable", error: String(error.message ?? error) }, files: [] };
  }

  const integrityProblem = verifyIntegrity(tarball, metadata.integrity);
  if (integrityProblem) {
    return { record: { ...record, status: "rejected", error: integrityProblem }, files: [] };
  }

  let entries;
  try {
    entries = readTarEntries(zlib.gunzipSync(tarball));
  } catch (error) {
    return { record: { ...record, status: "unavailable", error: String(error.message ?? error) }, files: [] };
  }

  if (entries.length === 0) {
    // Verified outcome: this publisher ships no notice file in the artifact.
    return { record: { ...record, status: "no-notice-file", files: [] }, files: [] };
  }

  const directory = path.join(upstreamRoot, folderName(lockPathName, version));
  fs.mkdirSync(directory, { recursive: true });
  const files = [];
  const used = new Set();
  for (const entry of entries) {
    const base = path.posix.basename(entry.name);
    let target = base;
    let counter = 2;
    while (used.has(target)) target = `${counter++}-${base}`;
    used.add(target);
    fs.writeFileSync(path.join(directory, target), entry.content);
    files.push({
      path: path.posix.join("licenses/upstream", folderName(lockPathName, version), target),
      source: entry.name,
      sha256: crypto.createHash("sha256").update(entry.content).digest("hex"),
    });
  }
  return { record: { ...record, status: "notice-files", files }, files };
}

const targets = Object.entries(lock.packages ?? {}).filter(
  ([lockPathName]) => lockPathName && installedNoticeFiles(lockPathName).length === 0,
);

const packages = {};
let recovered = 0;
let absent = 0;
const failures = [];

for (let index = 0; index < targets.length; index += concurrency) {
  const batch = targets.slice(index, index + concurrency);
  const results = await Promise.all(
    batch.map(async ([lockPathName, metadata]) => [lockPathName, await recover(lockPathName, metadata)]),
  );
  for (const [lockPathName, result] of results) {
    packages[packageName(lockPathName)] = result.record;
    if (result.record.status === "notice-files") recovered += 1;
    else if (result.record.status === "no-notice-file") absent += 1;
    else failures.push(`${packageName(lockPathName)}: ${result.record.status} (${result.record.error ?? "unknown"})`);
  }
  process.stdout.write(`processed ${Math.min(index + concurrency, targets.length)}/${targets.length}\r`);
}

const manifest = {
  schemaVersion: 1,
  source: "published npm tarballs; every download verified against the lockfile integrity hash",
  packages: Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))),
};
fs.mkdirSync(upstreamRoot, { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nRecovered notice files for ${recovered} package(s).`);
console.log(`Verified ${absent} package(s) whose tarball ships no notice file.`);
if (failures.length) {
  console.log(`Unavailable: ${failures.length}`);
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`Wrote ${path.relative(root, manifestPath)}`);
if (failures.length && process.argv.includes("--strict")) process.exitCode = 2;
