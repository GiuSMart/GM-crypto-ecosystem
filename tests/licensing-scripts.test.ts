import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The compliance scripts read package-lock.json, licenses/ and node_modules from
// process.cwd(), so every test runs them inside a throwaway fixture directory.
const REPO_ROOT = process.cwd();

type FixtureOptions = {
  packages: Record<string, { version?: string; license?: string }>;
  baseline?: Record<string, string | Record<string, unknown>>;
  files?: Record<string, Record<string, string>>;
  extraFiles?: Record<string, string>;
};

type Fixture = { dir: string; cleanup: () => void };

const packageJson = (name: string, license: string | null): string =>
  JSON.stringify({ name, version: "1.0.0", license }, null, 2);

function createFixture(options: FixtureOptions): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-licensing-"));
  const packages: Record<string, unknown> = {
    "": { name: "fixture-app", version: "1.0.0", license: "UNLICENSED" },
  };
  for (const [name, meta] of Object.entries(options.packages)) {
    packages[`node_modules/${name}`] = {
      version: meta.version ?? "1.0.0",
      license: meta.license,
    };
  }
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify(
      { name: "fixture-app", version: "1.0.0", lockfileVersion: 3, packages },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(dir, "licenses"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "licenses", "third-party-baseline.json"),
    JSON.stringify(
      {
        packages: Object.fromEntries(
          Object.entries(options.baseline ?? {}).map(([name, value]) => [
            name,
            typeof value === "string" ? { license: value } : value,
          ]),
        ),
      },
      null,
      2,
    ),
  );
  for (const [packagePath, files] of Object.entries(options.files ?? {})) {
    const packageDir = path.join(dir, "node_modules", packagePath);
    fs.mkdirSync(packageDir, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(packageDir, fileName), content);
    }
  }
  for (const [relativePath, content] of Object.entries(options.extraFiles ?? {})) {
    const target = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

type RunResult = { status: number; stdout: string; stderr: string };

function runScript(script: string, cwd: string, args: string[] = []): RunResult {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  // spawnSync keeps stdout and stderr for every exit code: the gate emits its
  // REVIEW warnings on stderr even when it exits 0.
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("check-licenses passes a lockfile containing only reviewed permissive licences", (t) => {
  const fixture = createFixture({
    packages: { alpha: { license: "MIT" }, beta: { license: "Apache-2.0" } },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /License inventory: 2 packages/);
  assert.match(result.stdout, /License check passed/);
});

test("check-licenses blocks a newly introduced copyleft dependency", (t) => {
  const fixture = createFixture({
    packages: { alpha: { license: "MIT" }, "new-gpl": { license: "GPL-3.0-only" } },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /new restrictive\/attribution license "GPL-3\.0-only"/);
  assert.match(result.stderr, /License check failed with 1 blocking issue/);
});

test("check-licenses blocks an unknown licence expression", (t) => {
  const fixture = createFixture({ packages: { weird: { license: "Weird-1.0" } } });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown or unapproved license "Weird-1\.0"/);
});

test("check-licenses blocks packages without licence metadata", (t) => {
  const fixture = createFixture({ packages: { unnamed: {} } });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unnamed: missing license metadata/);
});

test("check-licenses blocks when an approved baseline entry changes licence", (t) => {
  const fixture = createFixture({
    packages: { alpha: { license: "GPL-3.0-only" } },
    baseline: { alpha: "MIT" },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /alpha: license changed from "MIT" to "GPL-3\.0-only" — manual review and baseline update required/,
  );
});

const documentedException = {
  license: "LGPL-3.0-only",
  reason: "Transitive build dependency, consumed unmodified.",
  obligations: "Ship the LGPL text and keep the library replaceable.",
  reviewDueOn: "2027-01-31",
};

test("check-licenses blocks a baseline exception that is not documented", (t) => {
  // The baseline used to be a silent trust anchor: this entry passed with exit 0 as
  // soon as someone copied the licence string into it.
  const fixture = createFixture({
    packages: { legacy: { license: "LGPL-3.0-only" } },
    baseline: { legacy: "LGPL-3.0-only" },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseline exception is not documented/);
  assert.match(result.stderr, /reason, obligations, reviewDueOn/);
});

test("check-licenses accepts a documented baseline exception and surfaces its review date", (t) => {
  const fixture = createFixture({
    packages: { legacy: { license: "LGPL-3.0-only" } },
    baseline: { legacy: documentedException },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 0);
  assert.match(result.stderr, /documented baseline exception \(LGPL-3\.0-only\); review due 2027-01-31/);
});

test("check-licenses rejects a baseline exception with an unparsable review date", (t) => {
  const fixture = createFixture({
    packages: { legacy: { license: "LGPL-3.0-only" } },
    baseline: { legacy: { ...documentedException, reviewDueOn: "31/01/2027" } },
  });
  t.after(fixture.cleanup);

  const result = runScript("check-licenses.mjs", fixture.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reviewDueOn/);
});

test("generate-third-party-notices bundles upstream licence text", (t) => {
  const fixture = createFixture({
    packages: { alpha: { license: "MIT" } },
    files: {
      alpha: {
        "package.json": packageJson("alpha", "MIT"),
        LICENSE: "MIT Licence text\n",
      },
    },
  });
  t.after(fixture.cleanup);

  const result = runScript("generate-third-party-notices.mjs", fixture.dir);

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /Included 1 license\/notice file\(s\); 0 package\(s\) verified as shipping none; 0 package\(s\) require manual notice retrieval/,
  );
  const generated = fs.readFileSync(
    path.join(fixture.dir, "artifacts", "THIRD_PARTY_NOTICES.generated.md"),
    "utf8",
  );
  assert.match(generated, /MIT Licence text/);
  assert.match(generated, /- Declared license: MIT/);
});

test("generate-third-party-notices fails only in strict mode when notices are missing", (t) => {
  const fixture = createFixture({
    packages: { delta: { license: "MIT" } },
    files: { delta: { "package.json": packageJson("delta", "MIT") } },
  });
  t.after(fixture.cleanup);

  const relaxed = runScript("generate-third-party-notices.mjs", fixture.dir);
  assert.equal(relaxed.status, 0);
  assert.match(relaxed.stdout, /1 package\(s\) require manual notice retrieval/);

  const strict = runScript("generate-third-party-notices.mjs", fixture.dir, ["--strict"]);
  assert.equal(strict.status, 2);

  const generated = fs.readFileSync(
    path.join(fixture.dir, "artifacts", "THIRD_PARTY_NOTICES.generated.md"),
    "utf8",
  );
  assert.match(generated, /\*\*not found\*\* \(run `npm run licenses:upstream`\)/);
});

test("generate-third-party-notices refuses lockfile paths outside node_modules", (t) => {
  const fixture = createFixture({ packages: { "../../outside": { license: "MIT" } } });
  t.after(fixture.cleanup);

  const result = runScript("generate-third-party-notices.mjs", fixture.dir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing package path outside node_modules/);
});

test("generate-sbom emits one CycloneDX 1.5 component per lockfile entry", (t) => {
  const fixture = createFixture({
    packages: { alpha: { license: "MIT" }, "scope/node_modules/beta": { license: "ISC" } },
  });
  t.after(fixture.cleanup);

  const result = runScript("generate-sbom.mjs", fixture.dir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /with 2 npm components/);

  const bom = JSON.parse(
    fs.readFileSync(
      path.join(fixture.dir, "artifacts", "gm-crypto-ecosystem.cdx.json"),
      "utf8",
    ),
  ) as { bomFormat: string; specVersion: string; components: { name: string; purl: string }[] };

  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.5");
  assert.deepEqual(
    bom.components.map((component) => component.name).sort(),
    ["alpha", "beta"],
  );
  assert.equal(
    bom.components.find((component) => component.name === "alpha")?.purl,
    "pkg:npm/alpha@1.0.0",
  );
});

test("generate-sbom marks packages without licence metadata as NOASSERTION", (t) => {
  const fixture = createFixture({ packages: { gamma: {} } });
  t.after(fixture.cleanup);

  runScript("generate-sbom.mjs", fixture.dir);
  const bom = JSON.parse(
    fs.readFileSync(
      path.join(fixture.dir, "artifacts", "gm-crypto-ecosystem.cdx.json"),
      "utf8",
    ),
  ) as { components: { licenses: { expression: string }[] }[] };

  assert.equal(bom.components[0]?.licenses[0]?.expression, "NOASSERTION");
});

/* -------------------------------------------------------------------------- */
/* Upstream recovery: verified notices and verified absences                   */
/* -------------------------------------------------------------------------- */

test("notices include a notice file recovered from a verified upstream tarball", (t) => {
  const fixture = createFixture({
    packages: { delta: { license: "MIT" } },
    files: { delta: { "package.json": packageJson("delta", "MIT") } },
    extraFiles: {
      "licenses/upstream/manifest.json": JSON.stringify({
        schemaVersion: 1,
        packages: {
          delta: {
            version: "1.0.0",
            license: "MIT",
            status: "notice-files",
            files: [{ path: "licenses/upstream/delta@1.0.0/LICENSE", source: "package/LICENSE", sha256: "00" }],
          },
        },
      }),
      "licenses/upstream/delta@1.0.0/LICENSE": "Recovered MIT text\n",
    },
  });
  t.after(fixture.cleanup);

  const result = runScript("generate-third-party-notices.mjs", fixture.dir, ["--strict"]);

  assert.equal(result.status, 0);
  const generated = fs.readFileSync(
    path.join(fixture.dir, "artifacts", "THIRD_PARTY_NOTICES.generated.md"),
    "utf8",
  );
  assert.match(generated, /Recovered MIT text/);
  assert.match(generated, /integrity verified against the lockfile/);
});

test("notices accept a verified absence instead of an invented licence text", (t) => {
  const fixture = createFixture({
    packages: { epsilon: { license: "MIT" } },
    files: { epsilon: { "package.json": packageJson("epsilon", "MIT") } },
    extraFiles: {
      "licenses/upstream/manifest.json": JSON.stringify({
        schemaVersion: 1,
        packages: { epsilon: { version: "1.0.0", license: "MIT", status: "no-notice-file", files: [] } },
      }),
    },
  });
  t.after(fixture.cleanup);

  const result = runScript("generate-third-party-notices.mjs", fixture.dir, ["--strict"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 package\(s\) verified as shipping none; 0 package\(s\) require manual notice retrieval/);
  const generated = fs.readFileSync(
    path.join(fixture.dir, "artifacts", "THIRD_PARTY_NOTICES.generated.md"),
    "utf8",
  );
  assert.match(generated, /none shipped by the publisher/);
});

test("notices still fail in strict mode when there is neither a file nor a record", (t) => {
  const fixture = createFixture({
    packages: { zeta: { license: "MIT" } },
    files: { zeta: { "package.json": packageJson("zeta", "MIT") } },
  });
  t.after(fixture.cleanup);

  const result = runScript("generate-third-party-notices.mjs", fixture.dir, ["--strict"]);

  assert.equal(result.status, 2);
});
