# GM CRYPTO ARBITRAGE AI

Piattaforma di monitoraggio multi-venue per opportunità di arbitraggio crypto, con calcolo del **profitto netto** dopo commissioni taker, slippage di profondità, costi di trasferimento e buffer di sicurezza.

> Regola fondante del motore: **NO PROFIT = NO TRADE**. Una differenza di prezzo positiva non è un'opportunità finché tutti i costi stimati non sono inclusi e il margine netto non supera la soglia configurata.

## Stack

| Livello | Scelta | Licenza |
|---|---|---|
| UI + API | Next.js 16 (App Router), React 19, TypeScript 5.9 | MIT / Apache-2.0 |
| Stile | Tailwind CSS 4 | MIT |
| Motore | TypeScript puro (`src/lib/engine`) | — |
| Dati | SQLite via `node:sqlite` (built-in Node ≥22) | — |
| Test | `node:test` + `tsx` | MIT |
| Dati di mercato | API pubbliche Kraken e Coinbase Advanced | — |

Nessuna dipendenza a pagamento. Nessuna API key richiesta per il funzionamento base.

## Avvio

```bash
npm install
npm run dev          # http://localhost:3000
```

Al primo avvio vengono creati automaticamente:

- `data/gm.db` — database SQLite con schema + seed
- `data/master.key` — chiave master AES-256-GCM (permessi 0600) per cifrare le API key

### Account seed

Nel repository **non è contenuta nessuna password**. Al primo avvio:

- se `GM_ADMIN_PASSWORD` / `GM_DEMO_PASSWORD` sono impostate, vengono usate;
- altrimenti il server genera una password casuale, la stampa **una sola volta** nel log di avvio e obbliga il cambio password al primo login.

Email degli account creati: `admin@gmarbitrage.ai` (ruolo admin) e `cliente@demo.it` (cliente demo). L'email admin è sovrascrivibile con `GM_ADMIN_EMAIL`.

## Comandi

```bash
npm run dev        # sviluppo
npm run build      # build di produzione
npm start          # server di produzione
npm test           # test del motore (node:test)
npm run typecheck  # tsc --noEmit
npm run scan       # scansione headless (cron / verifica CLI)
```

## Cosa funziona davvero

- **Dati di mercato reali**: order book e ticker pubblici di Kraken (`api.kraken.com`) e Coinbase (`api.exchange.coinbase.com`), senza credenziali, con throttling per rispettare i rate limit documentati (Kraken ~1 req/s, Coinbase 10 req/s).
- **Motore di arbitraggio**: VWAP di profondità su entrambe le gambe, fee taker, buffer, costi di trasferimento, controllo di staleness, sizing ottimale su più taglie. 14 test automatici coprono i casi critici.
- **Paper trading**: apertura solo su segnali eseguibili, chiusura marcata al book live, confronto atteso/realizzato.
- **Multi-tenant**: account, piani (FREE/PRO/PREMIUM con limiti applicati su scansioni e API key), branding per utente e globale.
- **Affiliate Center**: 7 referral gestiti da database, modificabili dall'admin senza deploy.
- **Sicurezza**: scrypt, sessioni revocabili, cookie httpOnly, CSRF same-origin, rate limiting, AES-256-GCM per le API key, audit log, segregazione per `user_id`.

## Cosa NON è implementato (dichiarato)

- **Live trading**: architettura predisposta (autorizzazione admin + limiti + audit), ma il router ordini lancia sempre un errore intenzionale. Nessun ordine reale parte.
- **Prelievi**: mai richiesti, mai supportati.
- **2FA**, backup automatici, WAF, rate limiter distribuito: non inclusi.
- **PostgreSQL**: lo schema è SQLite portabile; la migrazione è documentata in `docs/ARCHITECTURE.md` ma non eseguita.
- **Integrazioni Wirex / Speed / Crypto Voucher**: nessuna API self-service di trading, quindi restano fuori dal motore (solo registro/referral).

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — livelli, modello dati, sicurezza, scala, migrazione Postgres
- [`docs/PHASES.md`](docs/PHASES.md) — stato reale fase per fase, con costi e limiti
- [`docs/API.md`](docs/API.md) — endpoint interni e payload

## Licenze delle dipendenze

Next.js (MIT), React (MIT), Tailwind CSS (MIT), TypeScript (Apache-2.0), tsx (MIT). `node:sqlite` è parte di Node.js (MIT). Nessuna dipendenza copyleft, nessuna licenza commerciale richiesta.

## Avvertenza

Strumento di analisi e simulazione. Non è consulenza finanziaria. L'arbitraggio comporta rischio di esecuzione, latenza, controparte e cambio. Verifica sempre le commissioni del tuo tier reale.
