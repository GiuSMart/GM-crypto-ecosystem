# Stato delle fasi

Stato reale al primo prototipo. Nessuna voce è dichiarata completata senza implementazione e verifica.

## FASE 1 — Struttura, database, dashboard

**Realizzato**
- Next.js 16 + TypeScript + Tailwind 4, struttura in route group autenticato (`src/app/(app)`).
- Database SQLite (`node:sqlite`) con 14 tabelle, seed idempotente (utenti, piani, referral, settings).
- Design system nero/oro/bianco: sidebar responsive, drawer mobile, card, badge, tabelle, grafici SVG senza dipendenze.
- Dashboard Panoramica con KPI, board live, miglior candidato con breakdown costi, curva margine, scarti, stato infrastruttura.

**Funziona**: login/registrazione, sessione cookie, navigazione, persistenza, seed.
**Manca**: 2FA, reset password via email (nessun provider email configurato).
**Costi**: 0.

## FASE 2 — Dati di mercato pubblici

**Realizzato**
- Adapter Kraken (`Ticker`, `Depth`, `AssetPairs`) e Coinbase (`products`, `ticker`, `book`) senza credenziali.
- Scoperta coppie per intersezione reale tra venue (nessuna coppia inventata).
- Cache TTL + throttling per rispettare i limiti documentati.
- Board `/markets` con polling 6 s e indicazione "impossibile" quando lo spread non copre le fee.

**Verificato**: risposte HTTP 200 reali da entrambe le venue, book parse corretto, 10 coppie comuni USD.
**Manca**: WebSocket nativo (oggi polling 6 s con cache 4 s) — Kraken v2 e Coinbase WS sono pubblici e documentati, aggiungibili senza chiavi.
**Costi**: 0.

## FASE 3 — Motore di arbitraggio

**Realizzato**
- `engine/arbitrage.ts` puro: VWAP di profondità su ask e bid, fee taker, buffer, trasferimento, staleness, slippage, sizing multiplo.
- Regola **NO PROFIT = NO TRADE** applicata e testata: 13 test, inclusi spread positivo 0,39% scartato perché le fee valgono 1,70%.
- Scansione con persistenza di ogni valutazione e del motivo di scarto.

**Funziona**: calcolo completo, rifiuto motivato, catena di validazione.
**Manca**: motore Python separato (scelta motivata in `ARCHITECTURE.md`), backtesting storico su candele.
**Costi**: 0.

## FASE 4 — Commissioni e paper trading

**Realizzato**
- Fee di riferimento con fonte e livello di confidenza (Kraken verificata 0,40/0,80; Coinbase non verificata 0,50/0,90).
- Override per utente e globale dalla pagina Commissioni.
- Fee di rete per asset configurabili; vuoto = segnale bloccato in modalità transfer.
- Paper trading: apertura solo su segnale eseguibile, chiusura al bid ladder live, statistiche atteso/realizzato.

**Funziona**: override fee, apertura/chiusura simulazioni, statistiche.
**Manca**: fee maker simulate, P&L aggregato multi-valuta, export PDF (CSV disponibile).
**Costi**: 0.

## FASE 5 — Wallet ed exchange compatibili

**Realizzato**
- Catalogo verificato delle 6 piattaforme con stato API, capacità, limiti e fonti.
- Registro wallet watch-only con validazione indirizzo e rifiuto esplicito di seed phrase.
- API key read-only cifrate AES-256-GCM, con conferma obbligatoria e limite per piano.

**Funziona**: registrazione wallet, salvataggio cifrato, cancellazione, audit.
**Manca**: lettura saldi automatica (richiede firma utente per Phantom; nessuna API self-service per Wirex/Speed/CryptoVoucher). Dichiarato nel prodotto.
**Costi**: 0.

## FASE 6 — Affiliate Center

**Realizzato**
- 7 referral inseriti da database con descrizione, funzionamento, tutorial, condizioni, stato di verifica.
- Gestione CRUD dall'area amministratore (nessun deploy per aggiungerne).
- Badge "ricompense non dichiarate" dove non verificate, senza inventare importi.

**Funziona**: rendering, link con `rel="sponsored"`, creazione/modifica/eliminazione.
**Manca**: tracking click/conversioni (nessun endpoint di attribuzione).
**Costi**: 0.

## FASE 7 — SaaS e white-label

**Realizzato**
- Ruoli admin/client, piani FREE/PRO/PREMIUM con limiti applicati (scansioni/ora, numero API key) e prezzi configurabili.
- Branding per utente e globale (nome, logo mark, accento, tagline); footer con licenza propria.
- Separazione dati per `user_id` su ogni query; opportunità condivise come fatto di mercato.
- Pagamenti **disattivati** (`payments_configured = 0`, `paymentsEnabled()` false) finché non esiste un provider verificato.

**Manca**: provider di pagamento reale, fatturazione, gestione scadenze, enforcement dei limiti venue/coppie in UI (oggi solo scansioni e API key sono bloccanti).
**Costi**: 0 finché non si attiva un provider.

## FASE 8 — Test di sicurezza e funzionali

**Eseguito**
- 13 test unitari del motore (`npm test`), tutti verdi.
- Typecheck TypeScript completo (`npm run typecheck`).
- Build di produzione (`npm run build`).
- Verifica manuale endpoint: login, sessione, board, scan, paper open/close, export CSV.

**Manca**
- Test end-to-end browser (nessuna automazione browser in questo ambiente).
- Penetration test esterno, test di carico, scansione dipendenze (`npm audit` non eseguito per policy offline).
- Verifica in produzione su HTTPS.

---

## Riepilogo onesto

| Area | Stato |
|---|---|
| Monitoraggio con dati reali | ✅ funzionante |
| Calcolo netto con tutte le fee | ✅ funzionante e testato |
| Paper trading | ✅ funzionante |
| Live trading | ⛔ bloccato per progetto (router non implementato) |
| Integrazioni exchange reali | ✅ Kraken + Coinbase |
| Wallet (Phantom/Wirex/Speed/CryptoVoucher) | ⚠️ solo registro watch-only (limiti reali delle API) |
| Affiliate Center | ✅ funzionante |
| SaaS multi-tenant + white-label | ✅ base solida, pagamenti off |
| Sicurezza | ✅ solida base, 2FA/backup/WAF mancanti |

---

## Moduli futuri — decisi, non in scope

Registrati qui perché l'architettura li preveda senza implementarli adesso. Nessuno di questi ha codice, test o migrazioni nel repository: la priorità è chiudere e stabilizzare piattaforma AI e GM Crypto Ecosystem.

### Sicultura / GM Funding Intelligence (rinviato)

- **Progetto promotore**: Sicultura — gestione e sviluppo di fondi per AI, tecnologia e innovazione.
- **Soggetto giuridico**: non ancora costituito. Nessuna forma (ETS, APS, ODV, SMS, ASD, CER, fondazione, impresa sociale) è stata scelta, e la scelta non va fatta per inseguire un singolo bando.
- **Missione**: multidisciplinare (AI, tecnologia, cultura, sport, formazione, energia, sociale), con agenti specializzati per settore.
- **Cosa farebbe**: ricerca bandi (Sicilia, Italia, UE, programmi internazionali), verifica requisiti, preparazione candidature, monitoraggio scadenze, registro separato di contributi pubblici, donazioni, sponsorizzazioni e investimenti.
- **Vincoli invariati**: budget 0 €, nessun servizio a pagamento, nessuna spesa o operazione finanziaria automatica, nessun IBAN o documento personale raccolto prima della costituzione dell'ente.
- **Autorizzazione umana obbligatoria** per inviare dichiarazioni, firmare, assumere impegni, fornire coordinate bancarie e accettare finanziamenti. L'agente non inventa requisiti, dichiarazioni o dati societari.
- **Prima di partire servono**: forma giuridica e territorio, un catalogo di fonti ufficiali verificabili, e la scelta se le Skill di ricerca restino interne o esterne.

Motivo del rinvio: ogni funzionalità di questo modulo dipende da fonti normative variabili e da un soggetto giuridico che non esiste; costruirla ora significherebbe scrivere requisiti non verificabili.
