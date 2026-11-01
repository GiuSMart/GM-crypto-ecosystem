import { ASSETS, NETWORK_FEES } from "./config";
import { one, run } from "./db";

export type NetworkFeeTable = Record<string, { feeInBase: number | null; source: string }>;

/**
 * On-chain withdrawal fees are NOT pre-filled with invented numbers.
 * Leaving them empty deliberately blocks transfer-mode signals until the operator
 * enters a real value: an unknown cost can never justify a trade.
 */
export function getNetworkFees(): NetworkFeeTable {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = 'network_fees'");
  const stored: NetworkFeeTable = row ? safeParse(row.value) : {};
  const table: NetworkFeeTable = {};
  for (const asset of ASSETS) {
    table[asset] = stored[asset] ?? NETWORK_FEES[asset] ?? { feeInBase: null, source: "not configured" };
  }
  return table;
}

function safeParse(value: string): NetworkFeeTable {
  try {
    return JSON.parse(value) as NetworkFeeTable;
  } catch {
    return {};
  }
}

export function saveNetworkFee(asset: string, feeInBase: number | null, source: string): NetworkFeeTable {
  if (!(ASSETS as readonly string[]).includes(asset)) throw new Error(`Asset non supportato: ${asset}`);
  const table = getNetworkFees();
  table[asset] = { feeInBase, source: source.slice(0, 200) };
  run(
    "INSERT INTO settings(key, value) VALUES('network_fees', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(table),
  );
  return table;
}
