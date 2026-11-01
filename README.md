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
| Dati di mercato | API pubbliche Kraken, Coinbase Advanced e Bybit V5 Spot | — |

Nessuna dipendenza a pagamento. Nessuna API key richiesta per il funzionamento base e per i dati pubblici di mercato.

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
npm test           # test automatici
npm run typecheck  # tsc --noEmit
npm run scan       # scansione headless (cron / verifica CLI)
```

## Cosa è implementato

- **Dati di mercato**: adapter REST pubblici per Kraken, Coinbase Exchange e Bybit V5 Spot. Bybit supporta scoperta strumenti Spot, ticker e snapshot order book senza credenziali. Host predefinito Bybit EEA: `https://api.bybit.eu`; override limitato a host HTTPS Bybit esplicitamente autorizzati.
- **Motore di arbitraggio**: VWAP di profondità su entrambe le gambe, fee taker, buffer, costi di trasferimento, controllo di staleness, slippage, sizing su più taglie. La regola NO PROFIT = NO TRADE blocca segnali che non coprono tutti i costi configurati.
- **Paper trading**: apertura solo su segnali eseguibili, chiusura marcata al book disponibile, confronto atteso/realizzato.
- **Multi-tenant**: account, piani FREE/PRO/PREMIUM con limiti su scansioni e API key, branding per utente e globale.
- **Affiliate Center**: referral gestiti da database, modificabili dall'admin senza deploy.
- **Sicurezza**: scrypt, sessioni revocabili, cookie httpOnly, CSRF same-origin, rate limiting, AES-256-GCM per le API key, audit log, segregazione per `user_id`.

## Stato e limiti importanti di Bybit

L'adapter Bybit è presente nel codice e registrato tra le venue. Il merge e la CI sul commit di merge hanno avuto esito positivo (typecheck, test e build). **Questo non equivale a una verifica end-to-end dell'endpoint Bybit nel deployment dell'applicazione**: la connettività effettiva, la risposta regionale e la qualità dei dati devono ancora essere controllate nell'ambiente in cui verrà eseguita la piattaforma.

- Solo dati pubblici **Spot**: strumenti, ticker e order book.
- Nessun endpoint privato Bybit: non legge saldi e non invia ordini.
- Commissioni Bybit non configurate: i segnali che richiedono una fee Bybit attendibile devono restare bloccati finché l'operatore non inserisce il proprio tier reale.
- Per utenti/conti EEA verificare prima l'idoneità regionale e l'host API ufficialmente supportato. L'host predefinito è `api.bybit.eu`.
- Non è stato dichiarato alcun test di trading reale.

## Cosa NON è implementato

- **Live trading**: il router ordini lancia intenzionalmente un errore; nessun ordine reale parte.
- **Prelievi**: mai richiesti, mai supportati.
- **2FA**, backup automatici, WAF e rate limiter distribuito: non inclusi.
- **PostgreSQL**: lo schema è SQLite portabile; la migrazione è documentata in `docs/ARCHITECTURE.md` ma non eseguita.
- **Pagamenti SaaS**: disattivati finché non viene configurato e verificato un provider.

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — livelli, modello dati, sicurezza, scala, migrazione Postgres
- [`docs/PHASES.md`](docs/PHASES.md) — stato reale fase per fase, con costi e limiti
- [`docs/API.md`](docs/API.md) — endpoint interni e payload

## Licenze delle dipendenze

Next.js (MIT), React (MIT), Tailwind CSS (MIT), TypeScript (Apache-2.0), tsx (MIT). `node:sqlite` è parte di Node.js. Nessuna dipendenza copyleft, nessuna licenza commerciale richiesta.

## Avvertenza

Strumento di analisi e simulazione. Non è consulenza finanziaria. L'arbitraggio comporta rischio di esecuzione, latenza, controparte, cambio e liquidità. Verifica sempre le commissioni del tuo tier reale.
