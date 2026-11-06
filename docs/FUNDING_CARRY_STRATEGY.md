# GM Crypto — Funding-rate carry (spot + perpetual)

**Status: IMPLEMENTATO e TESTATO come motore puro. NON collegato a dati reali, NON
collegato alla dashboard, nessuna esecuzione live.**

Questo documento descrive la strategia di carry sul funding, cosa il repository
implementa davvero, e cosa resta bloccato e perché.

## 1. La strategia

Posizione delta-neutral su due gambe:

1. acquisto a pronti dell'asset (spot long);
2. short di pari nozionale sul perpetual (mark price).

Le due gambe si compensano rispetto alla variazione di prezzo. Il rendimento non
viene dalla direzione del mercato ma da due componenti:

- **funding**: se il rate è positivo, la gamba short incassa a ogni settlement;
- **basis**: lo scarto fra mark del perpetual e prezzo spot tende a convergere.

Delta-neutral **non** significa privo di rischio: il funding può diventare negativo,
il basis può allargarsi, una gamba può eseguire male e la gamba short può essere
liquidata.

## 2. Cosa è implementato

| Modulo | Contenuto |
|---|---|
| `src/lib/engine/funding.ts` | annualizzazione del funding, basis, validazione e statistiche storiche (media, mediana, deviazione, quota positiva, cambi di segno), punteggio descrittivo di persistenza, valutazione di un'opportunità con costi e buffer di liquidazione |
| `src/lib/engine/funding-sim.ts` | simulazione deterministica del carry: funding per periodo, P&L da basis, commissioni e slippage **per gamba**, capitale richiesto, drawdown massimo, liquidazione con terminazione esplicita |
| `src/lib/engine/funding-risk.ts` | controlli specifici del delta-neutral: validazione runtime di ogni input, squilibrio tra le gambe, funding negativo, buffer di liquidazione, slippage reale, gate licenze; i limiti di portafoglio sono **delegati** al Risk Guard |
| `tests/funding.test.ts`, `tests/funding-sim.test.ts`, `tests/funding-risk.test.ts` | test deterministici, nessuna rete |

### Formule usate

- funding annualizzato (%) = `rate × intervalsPerDay × 365 × 100`
- funding sull'orizzonte (%) = `rate × 100 × intervalsPerDay × holdingDays`
- costi andata e ritorno per gamba (quote) = `2 × (legsPerSide / 2) × (fee% + slippage%) / 100 × nozionale della gamba`
- costi totali (quote) = costi gamba spot + costi gamba perpetual
- break-even (giorni) = `costi% / (rate × 100 × intervalsPerDay)`
- buffer di liquidazione (%) = `100 / leverage − maintenanceMargin%`
- P&L funding per periodo = `rate × perpNotional`
- P&L basis = `(entryBasis% − exitBasis%) / 100 × perpNotional`
- liquidazione: quando `margine + P&L cumulato − costi di ingresso ≤ maintenanceMargin% × perpNotional`

## 3. Esempio numerico (scenario, non previsione)

Capitale 10.000 quote per gamba, funding +0,01% ogni 8 ore, 3 settlement al giorno,
commissioni e slippage per gamba 0,05% + 0,02%:

| Voce | Valore |
|---|---|
| Funding 1 giorno | +3 quote |
| Costi andata e ritorno | −28 quote (14 spot + 14 perpetual) |
| Netto giorno 1 | −25 quote |
| Break-even | 9,33 giorni |
| Capitale richiesto (leva 3×) | 13.333 quote |

Il dato importante è il secondo: **un giorno di carry non copre i costi**. Il numero
"3 quote al giorno" è aritmetica, non un rendimento, e la simulazione lo mostra
senza nascondere le commissioni.

## 4. Liquidazione: cosa il modello fa e cosa non può fare

La simulazione separa il **P&L della strategia** (curva del funding meno i costi già
pagati) dal **conto margine** della gamba perpetual (`perpNotional / leverage` più il
P&L). La posizione è liquidata quando il conto margine non copre più il requisito di
mantenimento. A quel punto:

- la simulazione **si interrompe** in quel periodo: nessun funding successivo viene
  incassato;
- il basis non realizzato **non viene pagato** (`basisPnlQuote = 0`);
- `ok` è `false` e il motivo è esplicito: una simulazione liquidata non è un risultato;
- `liquidationIndex`, `liquidationDay` ed `equityAtLiquidationQuote` rendono
  verificabile l'istante e il capitale residuo.

Limite dichiarato, non nascosto: il basis è mark-to-market solo all'uscita, quindi
una liquidazione causata da un allargamento del basis **fra** due settlement non è
simulata. Ogni risultato porta il campo `limitations` con questa nota.

## 5. Fail-closed sui dati

- **Storico funding**: una sola osservazione malformata (rate non finito, timestamp
  non valido o duplicato) fa rifiutare l'**intera** serie. Filtrare le righe corrotte
  e calcolare le statistiche sul resto renderebbe un feed rotto apparentemente
  stabile. `validateFundingHistory()` restituisce i motivi; `fundingHistoryStats()`
  restituisce `null`.
- **Slippage nel Funding Risk**: non esiste un default. `expectedSlippagePct` è
  obbligatorio e misurato; se manca o non è valido, `SLIPPAGE_INVALID` blocca e il
  Risk Guard riceve `Infinity` (quindi blocca anche con `SLIPPAGE_LIMIT`). Passare
  zero avrebbe disattivato in silenzio la soglia `maxSlippagePct`.
- **Validazione runtime**: nozionali, funding rate, buffer, squilibrio massimo, età
  dati e slippage devono essere finiti e nei domini ammessi; flag e `context`
  devono essere valori noti. Un NaN non può più saltare un confronto, perché ogni
  campo è controllato prima delle regole di business.
- **Opportunità**: `venueId` e `instrumentId` non vuoti, `indexPrice > 0`,
  `nowMs` esplicito, `nextFundingAt` non nel passato e non oltre 48 ore,
  `intervalsPerDay` e `legsPerSide` interi positivi, `allowNegativeFunding` booleano.
- **Costi**: fee e slippage sono applicati al nozionale di **ciascuna** gamba, in
  ingresso e in uscita; `spotCostsQuote` e `perpCostsQuote` sono esposti separatamente.
  I costi di uscita sono addebitati anche in caso di liquidazione, perché la fee reale
  di liquidazione non è nota e sottostimarla gonfierebbe il risultato.

## 6. Perché non è collegato ai dati reali

Il gate licenze (`src/lib/venues/licensing.ts`) registra OKX come
`prohibited-without-written-consent`: l'API Agreement (§9.4) vieta la
visualizzazione e la ridistribuzione dei market data a terzi, **anche su endpoint
pubblici**, senza consenso scritto. `evaluateDeltaNeutralRisk` interroga quel gate a
ogni valutazione:

- `context: "internal"` (solo operatore) → consentito nei limiti dei termini;
- `context: "customer-facing"` → **bloccato** con `LICENCE_BLOCKED`.

Di conseguenza non è stata aggiunta alcuna UI che mostri funding, basis o mark price
di OKX a un utente diverso dall'operatore, e non è stato creato un secondo adapter
OKX: esiste già la PR #16, non ancora unita.

## 7. Cosa NON è implementato, e non va raccontato come tale

- Nessun adapter HTTP per SWAP OKX EEA: richiede la licenza di cui sopra e la
  decisione sulla PR #16.
- Nessun modello AI che "prevede" il funding: `persistenceScore` è una descrizione
  deterministica delle osservazioni passate, senza pretesa previsionale.
- Nessun backtest su dati storici reali: la simulazione richiede una serie di rate
  fornita dall'esterno.
- Nessuna integrazione in dashboard, nessun job periodico, nessuna esecuzione live.
  `executeLiveOrder()` resta un hard stop.

## 8. Rischi da tenere presenti

- **Funding negativo**: il costo può erodersi in poche ore, non in giorni.
- **Basis divergente**: lo short può perdere sul mark anche con funding positivo, e
  il modello non simula la liquidazione causata dal basis fra due settlement.
- **Liquidazione**: leva alta e margine di mantenimento riducono il buffer; il
  controllo blocca sotto la soglia configurata e la simulazione termina.
- **Esecuzione a una gamba sola**: se il perp non si apre, la posizione diventa
  direzionale; da qui il controllo di squilibrio.
- **Dati obsoleti**: oltre `maxDataAgeMs` la valutazione fallisce chiusa.
