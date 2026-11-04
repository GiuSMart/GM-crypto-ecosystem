#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const components = [];

for (const [lockPathName, metadata] of Object.entries(lock.packages ?? {})) {
  if (!lockPathName) continue;
  const marker = "/node_modules/";
  const nestedIndex = lockPathName.lastIndexOf(marker);
  const name = nestedIndex >= 0
    ? lockPathName.slice(nestedIndex + marker.length)
    : lockPathName.replace(/^node_modules\//, "");
  const version = metadata.version ?? "0.0.0";
  const purlName = name.startsWith("@") ? name.replace("@", "%40") : name;
  const component = {
    type: "library",
    name,
    version,
    purl: "pkg:npm/" + purlName + "@" + version,
    licenses: [{ expression: typeof metadata.license === "string" ? metadata.license : "NOASSERTION" }],
    properties: [
      { name: "gm:lockfile-path", value: lockPathName },
      { name: "npm:dev", value: String(Boolean(metadata.dev)) },
      { name: "npm:optional", value: String(Boolean(metadata.optional)) }
    ]
  };
  if (metadata.integrity) component.hashes = [{ alg: "SHA-512", content: metadata.integrity.replace(/^sha512-/, "") }];
  components.push(component);
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:" + randomUUID(),
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: lock.name ?? "gm-crypto-ecosystem",
      version: lock.version ?? "0.0.0",
      licenses: [{ license: { name: "Proprietary; see LICENSE" } }]
    }
  },
  components
};

const outputDir = path.join(root, "artifacts");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "gm-crypto-ecosystem.cdx.json");
fs.writeFileSync(outputPath, JSON.stringify(bom, null, 2) + "\n");
console.log("Generated " + path.relative(root, outputPath) + " with " + components.length + " npm components.");
