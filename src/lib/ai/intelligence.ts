import { REFERENCE_FEES, VENUE_MAP, type EngineSettings, type Quote } from "../config";
import { getUserSettings } from "../db";
import { resolveFee } from "../engine/fees";
import { money, num, pct } from "../format";
import { getBoard, latestOpportunities, latestScan, marginSeries, parsePayload, type Board, type OpportunityRow, type ScanRunRow } from "../market";
import { paperStats, type PaperStats } from "../paper";

export type Insight = {
  id: string;
  title: string;
  tone: "positive" | "neutral" | "warning" | "critical";
  body: string;
  facts: { label: string; value: string }[];
};

export type Snapshot = {
  generatedAt: string;
  settings: EngineSettings;
  scan: ScanRunRow | null;
  evaluations: OpportunityRow[];
  paper: PaperStats;
  series: { ts: string; best: number; executable: number }[];
  fees: { venueId: string; name: string; makerPct: number; takerPct: number; source: string; confidence: string }[];
  board: Board;
};

export async function buildSnapshot(userId: string): Promise<Snapshot> {
  const settings = getUserSettings(userId);
  const scan = latestScan();
  const evaluations = scan ? latestOpportunities(scan.ts) : latestOpportunities(undefined, 20);
  const fees = Object.keys(REFERENCE_FEES).map((venueId) => {
    const resolved = resolveFee(venueId, userId);
    return {
      venueId,
      name: VENUE_MAP[venueId]?.name ?? venueId,
      makerPct: resolved?.makerPct ?? Number.NaN,
      takerPct: resolved?.takerPct ?? Number.NaN,
      source: resolved?.source ?? "n/d",
      confidence: resolved?.confidence ?? "n/d",
    };
  });

  let board: Board = { quote: settings.quote as Quote, ts: 0, rows: [], errors: [] };
  try {
    board = await getBoard(settings.quote as Quote);
  } catch (err) {
    board = { quote: settings.quote as Quote, ts: 0, rows: [], errors: [(err as Error).message] };
  }

  return {
    generatedAt: new Date().toISOString(),
    settings,
    scan,
    evaluations,
    paper: paperStats(userId),
    series: marginSeries(30),
    fees,
    board,
  };
}

const feeFloor = (fees: Snapshot["fees"], a: string, b: string) => {
  const fa = fees.find((f) => f.venueId === a)?.takerPct ?? 0;
  const fb = fees.find((f) => f.venueId === b)?.takerPct ?? 0;
  return fa + fb;
};

export function analyse(s: Snapshot): Insight[] {
  const insights: Insight[] = [];
  const topBoard = s.board.rows[0];
  const bestEval = s.evaluations
    .slice()
    .sort((a, b) => (Number.isFinite(b.margin_pct) ? b.margin_pct : -1e9) - (Number.isFinite(a.margin_pct) ? a.margin_pct : -1e9))[0];

  /* 1 — live market read */
  if (topBoard) {
    const floor = feeFloor(s.fees, topBoard.bestBuy?.venue ?? "", topBoard.bestSell?.venue ?? "");
    const gap = floor - topBoard.grossSpreadPct;
    insights.push({
      id: "market",
      title: "Lettura del mercato in tempo reale",
      tone: topBoard.grossSpreadPct > floor ? "positive" : "neutral",
      body: topBoard.grossSpreadPct > floor
        ? `Lo spread top-of-book più ampio è su ${topBoard.pair}: ${pct(topBoard.grossSpreadPct)} tra ${VENUE_MAP[topBoard.bestBuy!.venue]?.name} (ask ${money(topBoard.bestBuy!.ask)}) e ${VENUE_MAP[topBoard.bestSell!.venue]?.name} (bid ${money(topBoard.bestSell!.bid)}). Supera il pavimento fee di ${pct(floor)}, quindi merita una verifica di profondità.`
        : `Nessuna divergenza supera i costi. Lo spread top-of-book più ampio è ${pct(topBoard.grossSpreadPct)} su ${topBoard.pair}, ma le sole fee taker delle due gambe valgono ${pct(floor)}: mancano ${pct(gap)} perché il netto possa essere positivo.`,
      facts: [
        { label: "Coppia più ampia", value: topBoard.pair },
        { label: "Spread lordo", value: pct(topBoard.grossSpreadPct) },
        { label: "Pavimento fee taker", value: pct(floor) },
        { label: "Book aggiornati", value: new Date(s.board.ts).toLocaleTimeString("it-IT") },
      ],
    });
  } else {
    insights.push({
      id: "market",
      title: "Mercato non disponibile",
      tone: "warning",
      body: s.board.errors.length
        ? `Le API pubbliche hanno risposto con errori: ${s.board.errors.join("; ")}. Nessun prezzo viene inventato: finché i dati mancano, il motore non produce segnali.`
        : "Nessuna coppia comune tra le venue collegate: verifica le integrazioni attive.",
      facts: [],
    });
  }

  /* 2 — best evaluated signal with full cost stack */
  if (bestEval) {
    const payload = parsePayload(bestEval);
    const fees = (payload.fees ?? {}) as { buy?: number; sell?: number };
    const depth = (payload.buyDepthQuote as number | undefined) ?? 0;
    const depthSell = (payload.sellDepthQuote as number | undefined) ?? 0;
    insights.push({
      id: "top-signal",
      title: `Miglior candidato: ${bestEval.pair} ${VENUE_MAP[bestEval.buy_venue]?.name} → ${VENUE_MAP[bestEval.sell_venue]?.name}`,
      tone: bestEval.executable ? "positive" : "warning",
      body: bestEval.executable
        ? `Supera tutti i controlli: netto ${money(bestEval.net_profit)} su ${money(bestEval.notional)} (${pct(bestEval.margin_pct)}), margine sopra la soglia del ${num(s.settings.minMarginPct, 2)}%.`
        : `Scartato dal motore. ${bestEval.reject_reason ?? "Motivo non registrato."}`,
      facts: [
        { label: "Spread lordo", value: pct(bestEval.gross_spread_pct) },
        { label: "VWAP acquisto", value: money(bestEval.buy_vwap) },
        { label: "VWAP vendita", value: money(bestEval.sell_vwap) },
        { label: "Fee acquisto", value: `${money(bestEval.fee_buy)} (${num(fees.buy, 3)}%)` },
        { label: "Fee vendita", value: `${money(bestEval.fee_sell)} (${num(fees.sell, 3)}%)` },
        { label: "Buffer sicurezza", value: money(bestEval.buffer_cost) },
        { label: "Costo trasferimento", value: money(bestEval.transfer_cost) },
        { label: "Profitto netto", value: money(bestEval.net_profit) },
        { label: "Margine netto", value: pct(bestEval.margin_pct) },
        { label: "Liquidità entro slippage", value: `${money(depth)} / ${money(depthSell)}` },
      ],
    });
  }

  /* 3 — why the rest failed */
  if (s.evaluations.length > 1) {
    const rejected = s.evaluations.filter((e) => !e.executable);
    const categories = new Map<string, number>();
    for (const e of rejected) {
      const reason = (e.reject_reason ?? "").split(" | ")[0] || "non specificato";
      categories.set(reason, (categories.get(reason) ?? 0) + 1);
    }
    insights.push({
      id: "rejections",
      title: "Perché le altre opportunità sono state scartate",
      tone: "neutral",
      body: `${rejected.length} su ${s.evaluations.length} candidati non superano i controlli. Il motore registra il motivo per ogni scarto, così il rifiuto è verificabile e non arbitrario.`,
      facts: [...categories.entries()].slice(0, 6).map(([reason, count]) => ({ label: reason.slice(0, 90), value: `${count}×` })),
    });
  }

  /* 4 — fees and their provenance */
  insights.push({
    id: "fees",
    title: "Commissioni usate nel calcolo",
    tone: s.fees.some((f) => f.confidence !== "verified") ? "warning" : "neutral",
    body:
      "Le gambe di arbitraggio attraversano lo spread, quindi il calcolo usa sempre la fee TAKER. " +
      (s.fees.some((f) => f.confidence !== "verified")
        ? "Almeno una commissione non è verificata su fonte ufficiale: confermala con il tuo tier reale prima di fidarti del margine."
        : "Tutte le commissioni derivano dalla schedule ufficiale dell'operatore."),
    facts: s.fees.map((f) => ({
      label: `${f.name} (${f.confidence})`,
      value: `maker ${num(f.makerPct, 2)}% / taker ${num(f.takerPct, 2)}%`,
    })),
  });

  /* 5 — risk register */
  const risks: string[] = [
    "Latenza: tra la lettura del book e l'esecuzione il prezzo può muoversi; il buffer di sicurezza copre solo in parte questo rischio.",
    s.settings.transferMode === "transfer"
      ? "Modalità transfer: le fee di rete devono essere inserite manualmente, altrimenti ogni segnale viene bloccato."
      : "Modalità prefunded: presuppone inventario già presente su entrambe le venue (capitale diviso).",
    "Le API pubbliche hanno rate limit: scansioni troppo frequenti possono essere rallentate o limitate.",
    "Nessun ordine reale viene inviato: il router live non è implementato e i prelievi sono esclusi per progetto.",
  ];
  if (s.paper.closedCount === 0) risks.push("Nessun paper trade chiuso: non esiste ancora una validazione empirica del modello di costo.");
  insights.push({
    id: "risk",
    title: "Rischi da tenere sotto controllo",
    tone: "warning",
    body: "Elenco generato dalle condizioni operative correnti, non da stime inventate.",
    facts: risks.map((r, i) => ({ label: `Rischio ${i + 1}`, value: r })),
  });

  /* 6 — paper trading */
  insights.push({
    id: "paper",
    title: "Paper trading",
    tone: s.paper.realizedTotal > 0 ? "positive" : s.paper.realizedTotal < 0 ? "critical" : "neutral",
    body: s.paper.closedCount
      ? `Su ${s.paper.closedCount} operazioni chiuse il risultato simulato è ${money(s.paper.realizedTotal)} con win rate ${num(s.paper.winRate ?? 0, 1)}%.`
      : "Nessuna operazione chiusa. Apri un paper trade da un segnale eseguibile per confrontare profitto atteso e realizzato.",
    facts: [
      { label: "Aperte", value: String(s.paper.openCount) },
      { label: "Chiuse", value: String(s.paper.closedCount) },
      { label: "Atteso su aperte", value: money(s.paper.expectedTotal) },
      { label: "Realizzato", value: money(s.paper.realizedTotal) },
    ],
  });

  /* 7 — grounded improvement proposals */
  const proposals: string[] = [];
  if (s.settings.transferMode === "transfer") proposals.push("Inserisci le fee di rete reali per ogni asset in Impostazioni per sbloccare i segnali in modalità transfer.");
  if (s.evaluations.some((e) => (e.reject_reason ?? "").includes("Margine netto"))) {
    proposals.push("Alcuni segnali sono positivi ma sotto la soglia: riduci la soglia solo se accetti margini più sottili, non per far comparire operazioni.");
  }
  proposals.push("Aggiungi una terza venue pubblica per aumentare le combinazioni di prezzo confrontabili.");
  proposals.push("Registra il tuo tier fee reale (o un override) per ogni venue: il margine netto dipende direttamente da quel numero.");
  insights.push({
    id: "proposals",
    title: "Miglioramenti proposti al sistema",      tone: "neutral",
    body: "Suggerimenti derivati dallo stato reale della configurazione.",
    facts: proposals.map((p, i) => ({ label: `Proposta ${i + 1}`, value: p })),
  });

  return insights;
}

/* -------------------------------------------------------------------------- */
/* Question answering                                                          */
/* -------------------------------------------------------------------------- */

const INTENTS: { id: string; test: RegExp; build: (s: Snapshot) => string }[] = [
  {
    id: "best",
    test: /miglior|opportun|arbitragg|conviene|segnal/i,
    build: (s) => {
      const best = s.evaluations.slice().sort((a, b) => b.margin_pct - a.margin_pct)[0];
      if (!best) return "Non c'è ancora nessuna scansione registrata. Avvia una scansione dalla dashboard: senza dati reali non posso indicare opportunità.";
      const payload = parsePayload(best);
      return [
        `Miglior candidato registrato: ${best.pair} su ${VENUE_MAP[best.buy_venue]?.name} → ${VENUE_MAP[best.sell_venue]?.name}.`,
        `Spread lordo ${pct(best.gross_spread_pct)}, fee ${money(best.fee_buy)} + ${money(best.fee_sell)}, buffer ${money(best.buffer_cost)}, netto ${money(best.net_profit)} (${pct(best.margin_pct)}).`,
        `Soglia minima ${num(s.settings.minMarginPct, 2)}% — esito: ${best.executable ? "ESEGUIBILE" : "SCARTATO"}.`,
        best.executable ? "" : `Motivo: ${best.reject_reason ?? "non registrato"}.`,
        payload.breakevenSpreadPct ? `Lo spread necessario per andare in pari è ${pct(Number(payload.breakevenSpreadPct))}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  },
  {
    id: "fees",
    test: /commission|fee|cost[oi]|spread|margine/i,
    build: (s) =>
      `Uso sempre la fee taker, perché l'arbitraggio attraversa lo spread. ${s.fees
        .map((f) => `${f.name}: ${num(f.takerPct, 2)}% taker (${f.confidence})`)
        .join("; ")}. Al netto aggiungo buffer ${num(s.settings.safetyBufferPct, 3)}% e, in modalità transfer, la fee di rete reale. Se una fee non è configurata il segnale viene bloccato.`,
  },
  {
    id: "risk",
    test: /rischi|rischio|sicurezza|pericol/i,
    build: (_s) =>
      "Rischi principali: latenza tra lettura e invio ordine, profondità insufficiente oltre il primo livello, fee taker che erodono lo spread, fee di rete variabili, rate limit delle API pubbliche. Inoltre questa build non invia ordini reali e non gestisce prelievi.",
  },
  {
    id: "paper",
    test: /paper|simul|backtest|risultat/i,
    build: (s) =>
      `Paper trading: ${s.paper.openCount} aperte, ${s.paper.closedCount} chiuse, realizzato ${money(s.paper.realizedTotal)}, atteso sulle aperte ${money(s.paper.expectedTotal)}${
        s.paper.winRate !== null ? `, win rate ${num(s.paper.winRate, 1)}%` : ""
      }.`,
  },
  {
    id: "venues",
    test: /exchange|venue|kraken|coinbase|phantom|wirex|speed|voucher/i,
    build: (_s) =>
      "Solo Kraken e Coinbase Advanced espongono order book pubblici senza credenziali, quindi solo loro entrano nel motore. Phantom è un wallet self-custody (firma, non order book). Wirex e Crypto Voucher hanno API partner-only; Speed ha una API pagamenti, non di trading. Nessuna di queste viene simulata come exchange.",
  },
  {
    id: "why",
    test: /perch|no profit|scart|rifiut/i,
    build: (s) => {
      const rejected = s.evaluations.filter((e) => !e.executable);
      if (!rejected.length) return "Nell'ultima scansione non ci sono candidati scartati da spiegare.";
      return `Scarti dell'ultima scansione: ${rejected
        .map((e) => `${e.pair} (${e.reject_reason ?? "motivo non registrato"})`)
        .slice(0, 5)
        .join("; ")}.`;
    },
  },
];

export function answer(question: string, s: Snapshot): { answer: string; source: "deterministic" | "llm"; intent: string } {
  const q = question.trim();
  if (!q) {
    return { answer: "Scrivi una domanda su opportunità, commissioni, rischi o paper trading.", source: "deterministic", intent: "empty" };
  }
  const intent = INTENTS.find((i) => i.test.test(q));
  if (intent) return { answer: intent.build(s), source: "deterministic", intent: intent.id };

  return {
    answer:
      "Posso rispondere solo con i dati raccolti dal motore: opportunità, commissioni, motivi di scarto, rischi, profondità, paper trading, stato delle integrazioni. " +
      "Prova con «qual è la migliore opportunità?», «spiegami le commissioni», «perché è stato scartato?», «come va il paper trading?». " +
      "Non invento prezzi né commissioni: se un dato non è nel database, lo dico.",
    source: "deterministic",
    intent: "fallback",
  };
}
