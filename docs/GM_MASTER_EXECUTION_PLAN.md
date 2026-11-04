# GM MASTER EXECUTION PLAN

Documento di governo tecnico del progetto **GM Crypto Arbitrage AI Platform**.
Redatto il **2026-11-04** sul repository `GiuSMart/GM-crypto-ecosystem`, branch `main`,
commit di riferimento **`a61c2fb`** (merge PR #15, `chore/production-readiness-headers`).

> Questo documento descrive lo stato **verificato**, non quello desiderato. Ogni
> affermazione è tracciabile a un comando eseguito, a un file letto o a un test.
> Le stime di tempo sono stime, dichiarate come tali; nessuna metrica di
> risparmio è inventata.

## 0. Vocabolario di stato

Nessuna voce viene dichiarata "fatta" senza evidenza. Le etichette usate qui:

| Etichetta | Significato |
|---|---|
| **IMPLEMENTATO** | Il codice esiste e fa ciò che dichiara. |
| **TESTATO** | Esiste un test automatico eseguito e verde su questo commit. |
| **SIMULATO** | Funziona solo su dati/denaro simulati. |
| **IN SVILUPPO** | Parziale, non utilizzabile o non verificato. |
| **BLOCCATO** | Volutamente non attivo (es. live trading). |
| **NON VERIFICATO** | Presente ma senza evidenza sufficiente. |

## 1. Fotografia del repository

| Voce | Valore verificato |
|---|---|
| Stack | Next.js 16.4.3, React 19.3.1, TypeScript 5.9.3, Tailwind 4, SQLite via `node:sqlite` |
| Runtime | Node.js ≥ 22 richiesto da `engines`; qui eseguito Node 26.13.0 |
| Codice | ~9.500 righe in `src/` (62 file TS/TSX), 7 file di test |
| Dipendenze | 50 pacchetti installati, `npm audit` → **0 vulnerabilità** |
| Database | SQLite, 14 tabelle, schema portabile (commentato per Postgres) |
| Dati di mercato | Kraken, Coinbase, Bybit Spot — **solo endpoint pubblici**, nessuna chiave |
| Trading reale | **BLOCCATO** (`executeLiveOrder()` lancia errore intenzionale) |

### Evidenza raccolta su questo commit

| Comando | Esito |
|---|---|
| `npm ci` | ✅ 50 pacchetti, 0 vulnerabilità |
| `npm run typecheck` | ✅ exit 0, nessun errore |
| `npm test` | ✅ **32/32** test verdi |
| `npm run build` | ✅ exit 0, 26 route compilate |

La base è quindi **stabile**: non è il caso di rifare nulla di ciò che già funziona.

## 2. Cosa è realmente implementato (verificato leggendo il codice)

| Componente | File | Stato |
|---|---|---|
| Motore di arbitraggio netto (VWAP, fee, buffer, transfer, staleness, sizing) | `src/lib/engine/arbitrage.ts` | IMPLEMENTATO + TESTATO |
| Regola **NO PROFIT = NO TRADE** | stessa | IMPLEMENTATO + TESTATO |
| Fee: override utente > riferimento, blocco se `unverified` | `src/lib/engine/fees.ts` | IMPLEMENTATO + TESTATO |
| Paper trading apertura/chiusura e P&L | `src/lib/engine/paper.ts`, `src/lib/paper.ts` | IMPLEMENTATO + TESTATO + SIMULATO |
| Analytics performance paper | `src/lib/engine/paper-analytics.ts` | IMPLEMENTATO + TESTATO |
| Adapter venue pubblici (Kraken, Coinbase, Bybit) | `src/lib/venues/*.ts` | IMPLEMENTATO (dati reali) |
| Throttle per venue e rate limiting | `src/lib/rate-limit.ts` | IMPLEMENTATO + TESTATO |
| Auth: scrypt, sessioni revocabili, CSRF, audit log, cifratura AES-256-GCM | `src/lib/auth.ts`, `crypto.ts`, `audit.ts` | IMPLEMENTATO |
| Multi-tenant (`user_id` su ogni query cliente) | `src/lib/db.ts` | IMPLEMENTATO |
| Worker headless opt-in | `scripts/worker.ts` | IMPLEMENTATO + TESTATO (prototipo, 1 istanza) |
| Blocco live con elenco motivato dei blocker | `src/lib/live.ts` | BLOCCATO per progetto |
| **Risk Guard deterministico** | `src/lib/engine/risk-guard.ts` | **IMPLEMENTATO + TESTATO in questo ciclo** (non ancora collegato al router) |
| **Indicatori tecnici deterministici** | `src/lib/engine/indicators.ts` | **IMPLEMENTATO + TESTATO in questo ciclo** (non ancora esposti in UI) |
| **Gate licenze market data** | `src/lib/venues/licensing.ts` | **IMPLEMENTATO + TESTATO in questo ciclo** |

## 3. Problemi bloccanti (P0) trovati in questo audit

| # | Problema | Evidenza | Impatto | Azione |
|---|---|---|---|---|
| **P0-1** | **OKX non è utilizzabile come fonte dati mostrata ai clienti** | OKX API Agreement §9.4: vietata la ridistribuzione/visualizzazione a terzi anche via endpoint pubblici, senza consenso scritto. Vedi `docs/OKX_DATA_LICENSING.md` | Se la PR #16 (adapter OKX) venisse unita e mostrata in dashboard, il prodotto violerebbe i termini e l'architettura commerciale andrebbe rifatta | **NON unire la PR #16 nella user journey cliente.** Gate in `licensing.ts` |
| **P0-2** | `ALLOWED_VENUE_HOSTS` è **codice morto** | `grep -rn ALLOWED_VENUE_HOSTS src` → solo la definizione in `config.ts:488`, zero utilizzi | `docs/ARCHITECTURE.md` dichiarava una difesa SSRF che non esiste per Kraken/Coinbase (solo Bybit valida il proprio override). Documentazione ≠ realtà | Correggere la doc (fatto); il fix vero è nella PR #18 |
| **P0-3** | Workflow CI **duplicati e non eseguibili** | Esistono `.github/workflows/ci.yaml/ci.yaml` e `.github/workflows/ci.yml/ci.yml`: sono **directory**, non file. GitHub Actions ignora tutto ciò che non è `.github/workflows/*.yml` | CI reale è solo `gm-crypto-check.yml`; le due copie morte ingannano chiunque legga il repo e non pinnano gli SHA | Documentato qui; rimozione da fare in una PR dedicata (non elimino file di altri agenti senza revisione) |
| **P0-4** | Lavoro utile **non unito** in `main` | Vedi §4 | Duplicazione di lavoro se un agente riscrive ciò che esiste già | Review + merge selettivo |
| **P0-5** | Nessun Risk Guard collegato | Prima di questo ciclo non esisteva alcun modulo di limiti deterministici | Il "controllo indipendente" richiesto dal §6 non era implementato | Creato e testato; il collegamento al router è in P6 |
| **P0-6** | Protezione branch `main` non attiva | Dichiarato in `README.md` | Merge senza CI verde | Decisione dell'owner su GitHub (azione umana) |

## 4. Inventario dei branch non uniti

Attenzione metodologica: il repository usa **squash merge**. Quindi
`git branch --no-merged main` **sovrastima** il lavoro mancante: un branch il cui
contenuto è già in `main` continua a comparire. Le valutazioni sotto sono state
verificate leggendo il contenuto, non il grafo.

| Branch / PR | Commit avanti | Contenuto | Stato reale in `main` | Raccomandazione |
|---|---|---|---|---|
| `feature/okx-spot-market-data` / **PR #16** | 8 | Adapter OKX EEA, host `eea.okx.com`, test | **ASSENTE** (verificato: non esiste `src/lib/venues/okx.ts`) | **NON unire come dati cliente** (P0-1). Tenere per uso interno |
| `fix/venue-host-guard` / **PR #18** | 3 | Allowlist host + blocco redirect in ogni adapter, test su socket reale | **ASSENTE** (grep: `ALLOWED_VENUE_HOSTS` mai usato) | **Unire per primo**: è il fix di P0-2 |
| `fix/phase1-hardening` | 3 | `guardedMutation()` su `/api/settings`, bootstrap password gate, fix CI | Da verificare nel diff | Unire dopo review |
| `feature/controlled-live-policy` / **PR #22** | 11-12 | Policy di autorizzazione live, limiti, coerenza Revolut X | Da verificare | Review: tocca il perimetro live → richiede audit Security |
| `feature/btc-asymmetric-revolut-x` | 6 | Strategia BTC deterministica + fee take-profit | ASSENTE | Utile per P5, dopo P0 |
| `feature/affiliate-center` | 25 | CRUD referral, categoria, test end-to-end | In parte in `main` (pagina presente) | Verificare residuo |
| `chore/agent-skills-freebuff-handoff` / **PR #21** | 16-18 | Policy AI Collective free-only, backlog, skills | ASSENTE | Documentale: unire dopo review |
| `dependabot/*` **PR #7 #8 #9** | 1 ciascuna | `checkout@7`, `setup-node@7`, `typescript@7` | — | ⚠️ TypeScript 7 è un major: non unire senza typecheck completo. Valutare se i tag esistono |
| `chore/harden-ci-supply-chain` / PR #6 | 2 | SHA pinnati, `npm audit` in CI | **PRESENTE** (in `main`: `gm-crypto-check.yml` pinna gli SHA) | Nulla da fare |

## 5. La decisione OKX (sintesi)

Dettaglio e citazioni in [`OKX_DATA_LICENSING.md`](OKX_DATA_LICENSING.md).

- L'**API Agreement di OKX** (§9.2–9.4, letto il 2026-11-04) concede l'uso dei
  Market Data **solo per uso personale, interno, non commerciale**; vieta di
  rivendere, ridistribuire, pubblicare o **mostrare** i dati a terzi senza
  consenso scritto preventivo, e precisa che la restrizione **vale anche per gli
  endpoint pubblici**.
- Il §9.3 vieta inoltre di offrire gli API Services come parte di un prodotto
  commerciale o SaaS, e di costruire infrastruttura commerciale derivata
  dall'**Agent Trade Kit**.
- Il codice dell'Agent Trade Kit è MIT, **i dati no**: è la trappola principale.
- **Decisione**: OKX resta fuori dalla user journey dei clienti. Nessuna
  installazione dell'Agent Trade Kit in questo ciclo (superficie di
  autorizzazione non necessaria e non verificabile a costo zero).
- Percorsi possibili per il futuro: (a) consenso scritto/licenza dati OKX;
  (b) uso interno non visualizzato (decisioning server-side); (c) fornitore
  terziario che già detiene i diritti di ridistribuzione.

## 6. Organizzazione degli agenti: cosa era realmente disponibile

Il mandato chiedeva di coinvolgere altre AI. **Verifica effettuata**: in questo
ambiente di lavoro sono accessibili solo l'agente che scrive (io) e un agente di
ricerca web. Codex, Claude Code, Gemini, GitHub Copilot, Cursor, Windsurf, Cline,
AMP, OpenClaw e Vercel Agent Skills **non sono collegati** a questo workspace:
non esistono credenziali, integrazioni o CLI utilizzabili. Come da mandato, ho
proseguito senza attendere e senza simulare agenti inesistenti.

| Ruolo richiesto | Chi lo ha coperto | Evidenza |
|---|---|---|
| GM MASTER AI (orchestratore) | Io: audit → piano → assegnazione → integrazione | questo documento |
| Crypto Architect | Io: mappatura moduli e confini | §2, §7 |
| Quant AI | Io: `indicators.ts` + test | 26 test indicatori |
| Risk Manager AI | Io: `risk-guard.ts` + test | 21 test Risk Guard |
| Security Auditor | Io + ricerca primaria su fonti OKX | `licensing.ts`, `OKX_DATA_LICENSING.md` |
| QA Engineer | Io: suite `node:test`, typecheck, build | 32 → 86 test |
| Exchange Integrator | **non esercitato**: richiede review delle PR esistenti | §4 |
| UI/UX, Performance, News, Smart Money | **non avviati** in questo ciclo | §8 |

**Limite dichiarato**: non era disponibile un secondo agente indipendente per la
code review. La revisione è quindi simulata con (a) test deterministici che
falliscono in modo verificabile, (b) rilettura critica esplicita dei propri
moduli. Non è equivalente a una review indipendente e non va presentata come tale.

## 7. Matrice delle dipendenze

| Team | Attività | Dipende da | Parallelizzabile |
|---|---|---|---|
| Security | Host allowlist + redirect (PR #18), CI hygiene | — | Sì, subito |
| Data/Compliance | Gate licenze, revisione termini Kraken/Coinbase/Bybit | — | Sì, subito |
| Risk | Collegamento Risk Guard al flusso di segnale | Risk Guard ✅, modello dati | Sì, dopo P0 |
| Quant | Indicatori + snapshot | serie storiche normalizzate | **Fatto**: contratto `IndicatorSnapshot` pronto |
| Quant | Backtest senza look-ahead | candele storiche (non ancora raccolte) | Dopo P1 |
| Intelligence | News / Smart Money | fonti autorizzate + licenze | Dopo gate licenze |
| UI/UX | Dashboard Risk + indicatori | endpoint API | Dopo Risk/Quant |
| QA | Test end-to-end browser | modulo stabile + browser | Continuo |

Interfacce condivise già definite (contratti TypeScript, nessun mock necessario
perché sono pure): `RiskPolicy`/`RiskVerdict`, `IndicatorSnapshot`, `DisplayDecision`.

## 8. Roadmap per priorità

Stime indicative in **sessioni di lavoro** (una sessione ≈ un ciclo di lavoro
come questo). Non sono impegni né metriche misurate.

### P0 — Stabilizzazione e sicurezza
| # | Attività | Stato | Stima |
|---|---|---|---|
| 1 | Audit + piano | ✅ fatto (questo documento) | — |
| 2 | Correzione doc SSRF/allowlist | ✅ fatto | — |
| 3 | Risk Guard deterministico + test | ✅ fatto | — |
| 4 | Gate licenze market data + test | ✅ fatto | — |
| 5 | Merge PR #18 (host guard) dopo CI verde | ⏳ richiede autorizzazione | 0,5 |
| 6 | Rimozione workflow CI morti | ⏳ da fare in PR dedicata | 0,5 |
| 7 | Verifica isolamento tenant con test dedicati (2 account, ID incrociati) | ⏳ | 1 |
| 8 | Attivare protezione branch `main` | ⏳ azione owner su GitHub | — |

### P1 — Exchange e Market Intelligence
Verifica per venue di: host ufficiali, coppie, ticker, book, timestamp, rate
limit, precisione, fee, profondità, gestione errori. Stato: Kraken/Coinbase/Bybit
presenti; **manca la verifica sistematica documentata** e mancano fee Bybit
(dichiarate non configurate → segnali Bybit correttamente bloccati).
**Revolut X**: nessun adapter; da fare solo su API ufficiali effettivamente
disponibili. **OKX**: bloccato da licenza. Stima: 2-3.

### P2 — Motore di arbitraggio quantitativo
Base solida e testata. Mancano: latenza esplicita nel modello di costo (oggi la
staleness copre il rischio dati, non il tempo di esecuzione), minimum order
size/precisione per venue (non applicati → un segnale potrebbe essere
ineseguibile nella realtà), costi di conversione cross-quote. Stima: 2.

### P3 — AI Market Intelligence
Indicatori deterministici ✅ (RSI, MACD, EMA, SMA, Bollinger, ATR, VWAP,
imbalance, snapshot). Mancano: fetch candele storiche per alimentarli (nessun
endpoint storico implementato), Volume Profile, supporti/resistenze, funding
rate, open interest, correlazioni. L'AI deve **interpretare** `IndicatorSnapshot`,
mai generare valori. Stima: 2-3.

### P4 — News e Smart Money
Non avviati. Da fare solo con fonti pubbliche, data/ora, fonte originale,
dedup, sentiment come **interpretazione etichettata**, e distinzione esplicita
tra dato osservato e ipotesi. Vincolo licenze come per i market data. Stima: 3-4.

### P5 — AI Strategy Intelligence
Non avviato. Richiede prima le candele storiche di P3. Backtest senza
look-ahead, split train/test, out-of-sample, stress test. Nessuna promessa di
rendimento. Stima: 3-4.

### P6 — Paper Trading
Funzionante e onesto. Mancano per il realismo richiesto: riempimenti parziali
(stimati, non tap-for-tap), latenza simulata, ordini rifiutati, slippage
realizzato vs atteso, **collegamento del Risk Guard a ogni apertura/chiusura**.
Stima: 2.

### P7 — Dashboard e notifiche
Dashboard esistente e completa nelle sezioni base. Mancano: Risk Dashboard,
pannello indicatori, vista News, esperienza mobile verificata, alert solo su
eventi verificati (la base `signal-alerts` esiste e filtra già i segnali non
eseguibili). Stima: 3.

## 9. Criteri di completamento (definition of done)

Un'attività è chiusa solo se **tutti** questi punti sono veri:

1. Implementata, non solo rappresentata in UI.
2. Coperta da test automatici che falliscono se la logica si rompe.
3. `npm run typecheck` exit 0.
4. `npm test` verde.
5. `npm run build` exit 0.
6. Documentata (README/docs aggiornati nello stesso commit).
7. Gestisce errori e dati mancanti senza inventare valori (fail closed).
8. Non introduce costi, servizi a pagamento o credenziali.
9. Non rimuove il blocco live, non allarga i limiti di rischio, non tocca il
   trading reale.
10. Nessuna regressione sulle funzionalità esistenti.

## 10. Vincoli permanenti (non negoziabili da nessun agente)

- Live trading **disabilitato**: `executeLiveOrder()` lancia errore;
  `LIVE_EXECUTION_ENABLED = false` in `risk-guard.ts` è un secondo lucchetto
  indipendente da impostazioni e autorizzazioni.
- Nessuna API key con permesso Trade, nessun prelievo, nessun trasferimento,
  nessuna firma di transazione.
- Nessun agente modifica i limiti di rischio: il Risk Guard li riceve e li
  applica, non li scrive.
- Budget **zero**: nessun servizio a pagamento, nessun credito AI, nessun hosting.
- Nessun merge e nessun deploy senza autorizzazione esplicita dell'owner.

## 11. Cosa è stato consegnato in questo ciclo

| File | Tipo | Test |
|---|---|---|
| `src/lib/engine/risk-guard.ts` | nuovo | `tests/risk-guard.test.ts` (21) |
| `src/lib/engine/indicators.ts` | nuovo | `tests/indicators.test.ts` (26) |
| `src/lib/venues/licensing.ts` | nuovo | `tests/licensing.test.ts` (7) |
| `docs/GM_MASTER_EXECUTION_PLAN.md` | nuovo | — |
| `docs/OKX_DATA_LICENSING.md` | nuovo | — |
| `README.md`, `docs/ARCHITECTURE.md` | correzione accuratezza | — |

Suite completa dopo il ciclo: **86 test** (32 preesistenti + 54 nuovi), con
`npm run typecheck` exit 0, `npm test` 86/86 verdi e `npm run build` exit 0,
tutti eseguiti su questo albero di lavoro il 2026-11-04.

## 12. Rischi aperti

| Rischio | Gravità | Mitigazione |
|---|---|---|
| Visualizzare dati OKX a clienti senza licenza | **Alta (legale)** | Gate `licensing.ts` + doc; non unire PR #16 nella UI |
| Kraken/Coinbase/Bybit: termini di visualizzazione commerciale non rivisti | Media | Stato `unreviewed` esplicito; revisione in P0/P1 |
| Nessuna review indipendente disponibile in questo ambiente | Media | Test deterministici + review umana prima del merge |
| Fee Bybit assenti → nessun segnale Bybit | Bassa (conservativo) | Corretto così: costo ignoto = nessun trade |
| SQLite su volume non persistente in deploy | Media | Vincoli dichiarati in `RELEASE_CHECKLIST.md` |
| TypeScript 7 (dependabot) romperebbe la build | Media | Non unire senza typecheck completo |

## 13. Prossime azioni in ordine

1. Autorizzare la review/merge della **PR #18** (host guard) — sblocca P0-2.
2. Decisione owner su **OKX**: richiedere consenso scritto oppure uso interno.
3. Rimuovere i due workflow CI morti (PR dedicata).
4. Collegare il Risk Guard a `openPaperTrade()` e al worker (P6 anticipato, perché
   è il controllo che rende sicuro tutto il resto).
5. Test di isolamento tenant con due account reali.
6. Candele storiche (P3) per alimentare gli indicatori già pronti.

## 14. Aggiornamento implementazione — branch feat/risk-guard-paper-and-historical-candles

Questo aggiornamento è preparato su branch dedicato, basato sul main ripristinato. Non è ancora stato unito e le verifiche CI sul nuovo head sono in attesa.

- openPaperTrade() ora chiama evaluatePaperRisk() prima dell'INSERT; snapshot, decisione e INSERT sono serializzati con BEGIN IMMEDIATE, così aperture concorrenti non possono superare i limiti di esposizione o frequenza. Blocchi e approvazioni vengono scritti nell'audit log.
- Il portfolio è costruito esclusivamente dalle righe paper_trades dello stesso user_id; il budget iniziale è virtuale (1.000 unità quote) e non rappresenta saldi reali.
- Limiti applicati: massimo ordine, esposizione aggregata/per venue/per strategia, perdita realizzata UTC giornaliera, drawdown realizzato, fee verificate, slippage, età dati, liquidità e numero di aperture nella finestra mobile di un'ora.
- Il drawdown è calcolato sul P&L realizzato: le perdite non realizzate delle posizioni aperte non sono mark-to-market e restano una limitazione dichiarata.
- Live rimane impossibile: executeLiveOrder() continua a lanciare errore e LIVE_EXECUTION_ENABLED resta false.
- Kraken OHLC: acquisizione e storage delle sole candele chiuse, intervalli consentiti, validazione dei valori, cursor last, deduplicazione/upsert e snapshot indicatori.
- Endpoint storico admin-only; nessuna esposizione ai tenant mentre i diritti di visualizzazione commerciale Kraken restano non verificati.
- GitHub Actions run #251 sul commit 2a774e21: npm ci, audit produzione (0 vulnerabilità), typecheck, test **100/100** e build tutti verdi. Il build conserva un warning non bloccante di tracing filesystem dinamico in src/lib/paths.ts.

## Aggiornamento roadmap

- Risk Guard su ogni apertura paper: IMPLEMENTATO su questa branch; chiusure non bloccate per consentire la riduzione dell'esposizione.
- OHLC Kraken: IMPLEMENTATO per uso interno admin, con limite massimo 720 righe per risposta e filtro della candela non ancora chiusa.
- Restano da fare: backfill multi-pagina, backtest senza look-ahead, P&L mark-to-market, riempimenti parziali e verifica end-to-end.
- La licenza Kraken è ancora unreviewed: OHLC e indicatori non sono disponibili ai tenant o a terzi.
