import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dataDir, dbFile } from "../scripts/lib/runtime-paths.mjs";

const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("runtime paths default to the project data directory", () => {
  withEnv({ GM_DATA_DIR: undefined, GM_DB_PATH: undefined }, () => {
    assert.equal(dataDir(), path.join(process.cwd(), "data"));
    assert.equal(dbFile(), path.join(process.cwd(), "data", "gm.db"));
  });
});

test("GM_DATA_DIR relocates the default database and bootstrap data", () => {
  withEnv({ GM_DATA_DIR: "/var/lib/gm-instance", GM_DB_PATH: undefined }, () => {
    assert.equal(dataDir(), "/var/lib/gm-instance");
    assert.equal(dbFile(), path.join("/var/lib/gm-instance", "gm.db"));
  });
});

test("GM_DB_PATH takes precedence over GM_DATA_DIR", () => {
  withEnv({ GM_DATA_DIR: "/var/lib/gm-instance", GM_DB_PATH: "/mnt/sqlite/custom.db" }, () => {
    assert.equal(dataDir(), "/var/lib/gm-instance");
    assert.equal(dbFile(), "/mnt/sqlite/custom.db");
  });
});
