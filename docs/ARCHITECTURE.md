# Architettura

## Perché TypeScript e non Python

La richiesta indicava Python + FastAPI come preferenza per il motore. In questa prima release il motore è **TypeScript puro** (`src/lib/engine/arbitrage.ts`) perché:

1. Il motore deve girare **accanto** alle API che servono la dashboard: un solo processo, un solo deploy, zero latenza di rete fra UI e calcolo.
2. Le funzioni sono pure e deterministiche (nessun I/O, nessun `Date.now()` implicito), quindi testabili in isolamento — 13 test con `node:test`.
3. Con budget zero, un secondo servizio Python significherebbe un secondo host/container da gestire.

Le API pubbliche (Kraken/Coinbase) sono le stesse raggiungibili da Python; il motore è un puro calcolo su order book. Se servirà un servizio Python (es. backtesting numerico pesante), il contratto è già definito da `Evaluation` e `CostModel`: basta esporre `/scan` e consumarlo. Vedi `docs/PHASES.md`, Fase 3.

## Livelli

```
┌────────────────────────────────────────────────────────────┐
│ UI (React Server Components)                               │
│ src/app/(app)/*  — dashboard, mercati, paper, affiliate    │
│ src/components/* — client components (form, board live)    │
└──────────────────────────┬─────────────────────────────────┘
                           │ fetch interno / server functions
┌──────────────────────────▼─────────────────────────────────┐
│ API routes (Node runtime)                                  │
│ /api/market /api/scan /api/paper /api/settings /api/admin  │
│ /api/credentials /api/wallets /api/fees /api/intelligence  │
│ /api/reports/export /api/auth/*                            │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│ Dominio                                                    │
│ engine/arbitrage.ts  (puro, testato)                       │
│ engine/fees.ts       (override > riferimento)              │
│ venues/{kraken,coinbase}.ts (adapter, throttling)          │
│ market.ts            (cache TTL, scan, persistenza)        │
│ paper.ts, live.ts, plans.ts, network-fees.ts               │
│ ai/intelligence.ts   (analisi deterministica grounded)     │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│ db.ts (node:sqlite) + schema.ts + audit.ts + crypto.ts     │
└────────────────────────────────────────────────────────────┘
```

## Modello dati

| Tabella | Ruolo | Note multi-tenant |
|---|---|---|
| `users` | account, ruolo, piano, branding personale | radice del tenant |
| `sessions` | sessioni (hash del token) | revoca per utente |
| `settings` | default globali (engine, branding, network_fees) | condivisi |
| `user_settings` | override del motore per utente | filtrato per `user_id` |
| `fee_overrides` | fee reali per venue (`user_id NULL` = globale) | priorità: utente > globale > riferimento |
| `credentials` | API key cifrate read-only | cifrate AES-256-GCM |
| `wallets` | indirizzi watch-only | nessuna chiave privata |
| `pairs` | cache coppie (opzionale, oggi risolta a runtime) | globale |
| `opportunities` | valutazioni del motore (`user_id NULL`) | fatto di mercato condiviso |
| `scan_runs` | esecuzioni del motore | globale |
| `paper_trades` | simulazioni | per utente |
| `referrals`, `plans`, `subscriptions` | catalogo commerciale | piani globali, sottoscrizioni per utente |
| `live_authorizations` | doppio consenso live | per utente + admin |
| `audit_log` | registro attività | per utente, visibile tutto all'admin |

Le opportunità sono **osservazioni di mercato condivise** (una scansione vale per tutti i tenant): il filtro del singolo utente applica la propria soglia in lettura. I paper trade sono dati privati e filtrati per `user_id` in ogni query.

## Motore: modello di costo

```
buySpend    = VWAP_ask(notional) × qty + fee_taker_buy
sellProceeds= VWAP_bid(qty) − fee_taker_sell
net         = sellProceeds − buffer − transferFee − buySpend
margin%     = net / buySpend × 100
```

Controlli bloccanti: book freschi entro `maxDataAgeMs`, riempimento completo su entrambe le gambe, slippage entro `maxSlippagePct`, fee di rete nota se `transferMode = transfer`, `net > 0`, `margin ≥ minMarginPct`.

Il sizing cerca la taglia con margine migliore tra 0.25×, 0.5×, 1×, 1.5×, 2× del notional, perché su book sottili la taglia grande distrugge l'edge.

## Rate limit e rispetto delle API

- Cache TTL condivisa: board 4 s, book 2,5 s, universo coppie 30 min.
- Coda serializzata per venue: Kraken 1100 ms tra chiamate, Coinbase 120 ms.
- Scansione: al massimo 5-6 direzioni (le migliori per spread lordo) per non bruciare budget di rate limit.
- Limite di piano: scansioni/ora convertite in token bucket per minuto.

## Sicurezza

- Password: scrypt (N=16384, r=8, p=1), salt per utente, formato auto-descrittivo.
- Sessioni: token casuale 32 byte, in DB solo SHA-256, cookie `httpOnly` + `SameSite=Lax` + `Secure` in produzione, TTL 7 giorni, revoca singola o totale.
- CSRF: controllo `Sec-Fetch-Site`/`Origin` su ogni mutazione.
- Rate limiting in-process (token bucket) su login (8/min IP), registrazione (3/10min), mutazioni (10-30/min utente). L'IP viene da `x-real-ip` (header a valore singolo che il reverse proxy sovrascrive) oppure dall'**ultimo** hop di `x-forwarded-for`: il primo hop è scrivibile dal client e consentiva di ruotare il bucket a ogni richiesta (`src/lib/client-ip.ts`).
- Segreti: AES-256-GCM, chiave master da `GM_ENCRYPTION_KEY` o `data/master.key` (0600). Mai loggati, mai restituiti.
- URL esterni limitati a host noti (`ALLOWED_VENUE_HOSTS`) per ridurre superficie SSRF.
- Nessuna seed phrase raccolta; il form wallet rifiuta input multi-parola e il form API key rifiuta valori sospetti.

### Debito tecnico dichiarato

2FA assente; rate limiter non distribuito; nessun backup automatico; SQLite non cifrato at-rest (solo i segreti applicativi); nessun WAF/reverse proxy.

### Content-Security-Policy

Ogni risposta porta una CSP costruita da `src/lib/security-headers.ts` (testata in `tests/security-headers.test.ts`), non scritta a mano in `next.config.ts`: `default-src 'self'`, nessuna origine remota per script, stili, font o immagini, `object-src`/`base-uri`/`frame-ancestors` a `'none'`, `form-action 'self'`, `upgrade-insecure-requests` in produzione.

`script-src` include `'unsafe-inline'` perché il payload di idratazione dell'App Router è inline e non esiste un middleware che coni un nonce per richiesta: senza quel permesso le pagine si idratano a metà. La policy blocca quindi l'iniezione di script da origini remote, il framing e il dirottamento di `<base>`, ma non un `<script>` inline iniettato. `'unsafe-eval'` e `ws:`/`wss:` esistono solo in sviluppo (source map webpack, hot reload) e non raggiungono la produzione.

## Migrazione a PostgreSQL

Lo schema è SQL portabile. Passi:

1. Sostituire `node:sqlite` con `pg` e un adapter `query(sql, params)`.
2. `INTEGER` booleani → `boolean`; `TEXT` JSON → `jsonb`; `TEXT` id → `uuid` (o mantenere gli id applicativi).
3. Aggiungere `CREATE INDEX` già presenti; creare un pool e passare a transazioni dove serve (apertura paper trade).
4. Rate limiter su Redis per il multi-istanza.

## White-label / duplicazione per cliente

Ogni installazione ha: proprio database, proprio `master.key`, proprio dominio, proprio branding (globale o per utente). Il codice non contiene segreti: le chiavi arrivano da env. Duplicare = nuovo deploy + nuove credenziali, non copia del database.


## Worker server headless

`npm run worker` avvia `scripts/worker.ts` solo se `GM_WORKER_ENABLED=true`. Il processo esegue scansioni globali con dati pubblici, una alla volta, attende l'intervallo dopo il completamento e registra log strutturati. `GM_WORKER_INTERVAL_MS` è limitato tra 30 secondi e 1 ora (default 60 secondi). Arresto ordinato su `SIGINT`/`SIGTERM`.

Il worker è un processo separato ma usa lo stesso SQLite dell'app: `GM_DB_PATH` o `GM_DATA_DIR` devono puntare a un volume persistente condiviso correttamente tra web e worker sullo stesso host. Avviare una sola replica: non è ancora presente un lock distribuito/lease per impedire scansioni concorrenti tra più istanze. SQLite WAL non va collocato su storage di rete non compatibile. Serverless o filesystem effimeri non sono supportati per questo worker. Non include scheduler dell'hosting, push, alert in background o supervisione esterna; l'effettiva disponibilità 24/7 dipende da deploy, volume persistente e process manager.
