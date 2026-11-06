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
| `src/lib/engine/funding.ts` | annualizzazione del funding, basis, statistiche storiche (media, mediana, deviazione, quota positiva, cambi di segno), punteggio descrittivo di persistenza, valutazione di un'opportunità con costi e buffer di liquidazione |
| `src/lib/engine/funding-sim.ts` | simulazione deterministica del carry: funding per periodo, P&L da basis, commissioni e slippage su entrambe le gambe, capitale richiesto, drawdown massimo, liquidazione |
| `src/lib/engine/funding-risk.ts` | controlli specifici del delta-neutral: squilibrio tra le gambe, funding negativo, buffer di liquidazione, gate licenze; i limiti di portafoglio sono **delegati** al Risk Guard |
| `tests/funding.test.ts`, `tests/funding-sim.test.ts`, `tests/funding-risk.test.ts` | test deterministici, nessuna rete |

### Formule usate

- funding annualizzato (%) = `rate × intervalsPerDay × 365 × 100`
- funding sull'orizzonte (%) = `rate × 100 × intervalsPerDay × holdingDays`
- costi andata e ritorno (%) = `2 × legsPerSide × (fee% + slippage%)`
- break-even (giorni) = `costi% / (rate × 100 × intervalsPerDay)`
- buffer di liquidazione (%) = `100 / leverage − maintenanceMargin%`
- P&L funding per periodo = `rate × perpNotional`
- P&L basis = `(entryBasis% − exitBasis%) / 100 × perpNotional`

## 3. Esempio numerico (scenario, non previsione)

Capitale 10.000 quote per gamba, funding +0,01% ogni 8 ore, 3 settlement al giorno,
commissioni e slippage per gamba 0,05% + 0,02%:

| Voce | Valore |
|---|---|
| Funding 1 giorno | +3 quote |
| Costi andata e ritorno | −28 quote |
| Netto giorno 1 | −25 quote |
| Break-even | 9,33 giorni |
| Capitale richiesto (leva 3×) | 13.333 quote |

Il dato importante è il secondo: **un giorno di carry non copre i costi**. Il numero
"3 quote al giorno" è aritmetica, non un rendimento, e la simulazione lo mostra
senza nascondere le commissioni.

## 4. Perché non è collegato ai dati reali

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

## 5. Cosa NON è implementato, e non va raccontato come tale

- Nessun adapter HTTP per SWAP OKX EEA: richiede la licenza di cui sopra e la
  decisione sulla PR #16.
- Nessun modello AI che "prevede" il funding: `persistenceScore` è una descrizione
  deterministica delle osservazioni passate, senza pretesa previsionale.
- Nessun backtest su dati storici reali: la simulazione richiede una serie di rate
  fornita dall'esterno.
- Nessuna integrazione in dashboard, nessun job periodico, nessuna esecuzione live.
  `executeLiveOrder()` resta un hard stop.

## 6. Rischi da tenere presenti

- **Funding negativo**: il costo può erodersi in poche ore, non in giorni.
- **Basis divergente**: lo short può perdere sul mark anche con funding positivo.
- **Liquidazione**: leva alta e margine di mantenimento riducono il buffer; il
  controllo blocca sotto la soglia configurata.
- **Esecuzione a una gamba sola**: se il perp non si apre, la posizione diventa
  direzionale; da qui il controllo di squilibrio.
- **Dati obsoleti**: oltre `maxDataAgeMs` la valutazione fallisce chiusa.
