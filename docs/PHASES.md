# Stato delle fasi

Stato aggiornato dopo l'integrazione dell'adapter Bybit Spot. Le voci distinguono codice implementato, test automatici e verifiche runtime: non sono equivalenti.

## FASE 1 — Struttura, database, dashboard

**Realizzato**
- Next.js 16 + TypeScript + Tailwind 4, struttura in route group autenticato (`src/app/(app)`).
- Database SQLite (`node:sqlite`) con schema e seed idempotente.
- Design system nero/oro/bianco, sidebar responsive, drawer mobile, card, badge, tabelle e grafici.
- Dashboard Panoramica con KPI, board, breakdown dei costi, margini, scarti e stato infrastruttura.

**Funziona**: login/registrazione, sessione cookie, navigazione e persistenza.
**Manca**: 2FA e reset password via email (nessun provider email configurato).
**Costi**: 0 per il prototipo.

## FASE 2 — Dati di mercato pubblici

**Adapter implementati**
- Kraken: ticker, depth e scoperta coppie tramite API pubbliche.
- Coinbase Exchange: prodotti, ticker e book tramite API pubbliche.
- Bybit V5 Spot: scoperta strumenti Spot, ticker e snapshot order book; nessuna credenziale richiesta. Adapter in `src/lib/venues/bybit.ts`, registrato in `src/lib/venues/index.ts`.
- Quote supportate dal motore: USD, EUR e USDT; USDT è trattato come asset distinto da USD.
- Cache, throttling per venue, timeout e controlli sui timestamp/order book.
- Bybit usa per default `https://api.bybit.eu`; gli override sono limitati a host HTTPS Bybit consentiti dal codice.

**Verifiche**
- La CI sul commit di merge `03029f63ca686b02701b92c8449f136eff21dd10` è riuscita: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- La CI verifica compilazione, test e build; **non prova da sola la raggiungibilità live dell'API Bybit**.
- Da completare: test runtime nell'ambiente di deploy su `instruments-info`, `tickers` e `orderbook` dell'host EEA, con confronto di timestamp e simboli.

**Limiti Bybit**
- Solo market data Spot pubblici; nessun endpoint account, saldi o invio ordini.
- Fee Bybit non configurata: non considerare eseguibile un'opportunità che coinvolge Bybit finché non viene verificato e inserito il tier commissionale effettivo.
- Verificare l'idoneità regionale e l'host API consentito per l'account EEA prima dell'uso operativo.
**Costi**: 0 per le API pubbliche, soggetto ai limiti e alle condizioni dell'exchange.

## FASE 3 — Motore di arbitraggio

**Realizzato**
- `engine/arbitrage.ts` puro: VWAP di profondità su ask e bid, fee taker, buffer, trasferimento, staleness, slippage e sizing multiplo.
- Regola **NO PROFIT = NO TRADE**: nessun segnale eseguibile se il profitto netto non supera costi e soglia configurata.
- Scansione con persistenza delle valutazioni e dei motivi di scarto.

**Manca**: backtesting storico su candele e analisi della latenza end-to-end.

## FASE 4 — Commissioni e paper trading

**Realizzato**
- Fee di riferimento e override per utente/globale.
- Fee di rete configurabili; costo sconosciuto in modalità transfer blocca il segnale.
- Paper trading con apertura su segnali eseguibili e chiusura al book disponibile.

**Manca**: fee maker simulate, P&L aggregato multi-valuta ed export PDF.

## FASE 5 — Wallet ed exchange compatibili

**Realizzato**
- Catalogo venue con capacità e limiti dichiarati.
- Registro wallet watch-only; rifiuto esplicito di seed phrase.
- API key read-only cifrate AES-256-GCM, ove supportate.

**Manca**: lettura saldi automatica per le integrazioni che richiedono firma wallet o accordi partner.

## FASE 6 — Affiliate Center

**Realizzato**
- Catalogo referral da database con descrizione, tutorial, condizioni e stato di verifica.
- Gestione dall'area amministratore.
- Nessun importo premio dichiarato senza verifica.

**Manca**: tracking click/conversioni.

## FASE 7 — SaaS e white-label

**Realizzato**
- Ruoli admin/client, piani FREE/PRO/PREMIUM e limiti configurabili.
- Branding per utente e globale.
- Separazione dati per `user_id`.
- Pagamenti disattivati finché non viene configurato un provider verificato.

**Manca**: provider di pagamento reale, fatturazione, gestione scadenze e ulteriori enforcement dei limiti.

## FASE 8 — Test di sicurezza e funzionali

**Eseguito**
- CI GitHub Actions sul commit di merge: installazione dipendenze, typecheck, test automatici e build di produzione tutti completati con esito positivo.
- Test automatici unitari per motore, dati e rate limiting presenti nel repository.

**Manca**
- Test end-to-end browser e verifica runtime delle tre venue nell'ambiente di deploy.
- Penetration test esterno, test di carico e verifica dipendenze aggiornata.
- Verifica in produzione su HTTPS, backup e monitoraggio.

---

## Riepilogo onesto

| Area | Stato |
|---|---|
| Adapter market data Kraken | Implementato; verifiche runtime già documentate nel prototipo |
| Adapter market data Coinbase | Implementato; verifiche runtime già documentate nel prototipo |
| Adapter market data Bybit Spot | Implementato e compilato; test runtime EEA ancora da completare |
| Motore netto e controlli di rischio | Implementato e coperto da test automatici |
| Paper trading | Implementato; da validare con flusso dati multi-venue completo |
| Live trading | Bloccato: router ordini non operativo |
| Commissioni Bybit | Non configurate; segnali con Bybit da trattare come non eseguibili |
| Wallet | Watch-only / integrazioni limitate |
| SaaS e white-label | Base implementata; pagamenti disattivati |
| Sicurezza | Base applicativa presente; 2FA, backup automatici e WAF mancanti |

## Prossimi controlli prima dell'uso operativo

1. Avviare l'app nell'ambiente previsto e verificare le risposte pubbliche Bybit EEA.
2. Verificare che BTC/USDT (e le altre coppie comuni) siano identificate allo stesso modo su tutte le venue.
3. Confrontare bid, ask, profondità e timestamp; rifiutare book incompleti o obsoleti.
4. Inserire solo fee effettive confermate per ciascun account.
5. Eseguire paper trading e confrontare P&L atteso e simulato.

Nessuna di queste verifiche autorizza ordini reali: il live trading resta disattivato.
