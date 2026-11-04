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
| Dati di mercato | API pubbliche Kraken, Coinbase Exchange e Bybit V5 Spot | — |

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
npm run scan       # scansione headless singola
GM_WORKER_ENABLED=true npm run worker # worker server continuo (una sola istanza)
```

## Cosa funziona davvero

- **Dati di mercato reali**: ticker e order book pubblici di Kraken (`api.kraken.com`), Coinbase Exchange (`api.exchange.coinbase.com`) e Bybit V5 Spot (host EEA predefinito `api.bybit.eu`), senza credenziali. Bybit è solo market-data: commissioni non configurate, quindi i segnali che la coinvolgono richiedono una fee confermata dall'utente. L'idoneità regionale EEA va verificata prima dell'uso in produzione.
- **Motore di arbitraggio**: VWAP di profondità su entrambe le gambe, fee taker, buffer, costi di trasferimento, controllo di staleness, sizing ottimale su più taglie. 32 test automatici (15 sul motore) coprono i casi critici, inclusa la contabilizzazione della fee di trasferimento senza doppio conteggio.
- **Paper trading**: apertura solo su segnali eseguibili, chiusura marcata al book live, confronto atteso/realizzato. La fee di prelievo è già incorporata nella quantità netta all'apertura e non viene sottratta una seconda volta alla chiusura.
- **Multi-tenant**: account, piani (FREE/PRO/PREMIUM con limiti applicati su scansioni e API key), branding per utente e globale.
- **Affiliate Center**: 7 referral gestiti da database, modificabili dall'admin senza deploy.
- **Sicurezza**: scrypt, sessioni revocabili, cookie httpOnly, CSRF same-origin, rate limiting, AES-256-GCM per le API key, audit log, segregazione per `user_id`.

## Worker server (prototipo operativo)

È disponibile un worker headless opt-in per scansioni pubbliche continue: `GM_WORKER_ENABLED=true npm run worker`. L'intervallo è configurabile con `GM_WORKER_INTERVAL_MS` (default 60 s, minimo 30 s, massimo 1 ora). Le scansioni sono seriali, non si sovrappongono nello stesso processo e continuano dopo errori con log strutturati.

**Vincoli di deploy:** avviare una sola istanza worker; web e worker devono usare lo stesso `GM_DB_PATH`/`GM_DATA_DIR` su volume persistente e compatibile con SQLite. Non usare filesystem effimeri/serverless o storage di rete non adatto a SQLite WAL. Il worker non implementa ancora lease distribuito, scheduler gestito dall'hosting, push notifications, né monitoraggio esterno. Non equivale a un servizio 24/7 finché non viene distribuito e monitorato su un host persistente.

## Cosa NON è implementato (dichiarato)

- **Live trading**: architettura predisposta (autorizzazione admin + limiti + audit), ma il router ordini lancia sempre un errore intenzionale. Nessun ordine reale parte.
- **Prelievi**: mai richiesti, mai supportati.
- **2FA**, backup automatici, WAF, rate limiter distribuito: non inclusi. La protezione del branch `main` non è attiva: abilitare le regole di protezione e richiedere CI verde prima dei merge.
- **PostgreSQL**: lo schema è SQLite portabile; la migrazione è documentata in `docs/ARCHITECTURE.md` ma non eseguita.
- **Integrazioni Wirex / Speed / Crypto Voucher**: nessuna API self-service di trading, quindi restano fuori dal motore (solo registro/referral).

## Documentazione

- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) — controlli obbligatori prima del rilascio e del lancio commerciale

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — livelli, modello dati, sicurezza, scala, migrazione Postgres
- [`docs/PHASES.md`](docs/PHASES.md) — stato reale fase per fase, con costi e limiti
- [`docs/API.md`](docs/API.md) — endpoint interni e payload

## Competenze degli agenti AI

- [docs/AGENT_SKILLS.md](docs/AGENT_SKILLS.md) — skills locali e installazione delle Vercel Agent Skills
- [docs/FREEBUFF_HANDOFF.md](docs/FREEBUFF_HANDOFF.md) — istruzioni operative per Freebuff e revisione della PR #20
- [AGENTS.md](AGENTS.md) — regole di progetto per gli agenti AI

## Agent platform e sviluppo assistito

- [docs/GM_AGENT_PLATFORM.md](docs/GM_AGENT_PLATFORM.md) — architettura target per GM MASTER AI, agenti specialistici, orchestrazione e controlli.
- [docs/SKILLS_GOVERNANCE.md](docs/SKILLS_GOVERNANCE.md) — governance delle Skills, API skills.sh, audit, hash e approvazioni.
- [docs/GM_FREEBUFF_EXECUTION_BACKLOG.md](docs/GM_FREEBUFF_EXECUTION_BACKLOG.md) — sequenza di lavoro e criteri di accettazione per Freebuff.

## Licenze delle dipendenze

Next.js (MIT), React (MIT), Tailwind CSS (MIT), TypeScript (Apache-2.0), tsx (MIT). `node:sqlite` è parte di Node.js (MIT). Nessuna dipendenza copyleft, nessuna licenza commerciale richiesta.

## Avvertenza

Strumento di analisi e simulazione. Non è consulenza finanziaria. L'arbitraggio comporta rischio di esecuzione, latenza, controparte e cambio. Verifica sempre le commissioni del tuo tier reale.
## Proprietary code and third-party licensing

GM Crypto Ecosystem's original code is proprietary and all rights are reserved; access to this private repository does not grant a license. Third-party npm packages retain their own licenses and notices. See [LICENSE](LICENSE), [Third-party notices](docs/THIRD_PARTY_NOTICES.md), and the [licensing and permissions register](docs/LICENSING_COMPLIANCE.md). Run `npm run licenses:check` locally; CI blocks new unknown or unapproved dependency licenses. The commercial multi-tenant product remains blocked from distributing exchange data until the required written provider permissions are obtained.
