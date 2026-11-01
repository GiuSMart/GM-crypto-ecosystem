import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { clientMeta, currentUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { planLimits } from "@/lib/plans";
import { opportunityHistory } from "@/lib/market";
import { listPaperTrades } from "@/lib/paper";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);
  const { ip } = await clientMeta();
  if (!rateLimit(`export:${user.id}`, 10, 60_000).ok) return jsonError("Troppi export. Attendi un minuto.", 429);

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "opportunities";
  const settings = getUserSettings(user.id);
  const limits = planLimits(user.plan);

  let header: string[];
  let rows: (string | number)[][];

  if (kind === "paper") {
    header = ["id", "pair", "buy_venue", "sell_venue", "notional", "qty", "buy_vwap", "sell_vwap", "expected_profit", "expected_margin_pct", "status", "realized_profit", "realized_margin_pct", "opened_at", "closed_at"];
    rows = listPaperTrades(user.id, 1000).map((t) => [
      t.id, t.pair, t.buy_venue, t.sell_venue, t.notional, t.qty, t.buy_vwap, t.sell_vwap,
      t.expected_profit, t.expected_margin_pct, t.status, t.realized_profit ?? "", t.realized_margin_pct ?? "", t.opened_at, t.closed_at ?? "",
    ]);
  } else {
    header = ["ts", "pair", "buy_venue", "sell_venue", "notional", "gross_spread_pct", "fee_buy", "fee_sell", "buffer_cost", "transfer_cost", "net_profit", "margin_pct", "executable", "reject_reason"];
    rows = opportunityHistory(limits.historyDays * 24, 5000).map((o) => [
      o.ts, o.pair, o.buy_venue, o.sell_venue, o.notional, o.gross_spread_pct, o.fee_buy, o.fee_sell,
      o.buffer_cost, o.transfer_cost, o.net_profit, o.margin_pct, o.executable ? "yes" : "no", o.reject_reason ?? "",
    ]);
  }

  const csv = [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  const suffix = `${kind}-${new Date().toISOString().slice(0, 10)}`;

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gm-${suffix}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
