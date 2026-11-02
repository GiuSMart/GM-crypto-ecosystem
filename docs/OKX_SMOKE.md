# Smoke test live OKX EEA (opzionale, sola lettura)

Verifica che gli endpoint pubblici OKX EEA usati dall'adapter rispondano davvero con la
struttura attesa. Non è un test di redditività, non produce segnali e non tocca fee,
strategie o logica di trading.

## Cosa fa

Tre richieste in sequenza, con spaziatura di 150 ms e timeout di 9 secondi ciascuna:

1. `GET https://eea.okx.com/api/v5/public/instruments?instType=SPOT`
2. `GET https://eea.okx.com/api/v5/market/tickers?instType=SPOT`
3. `GET https://eea.okx.com/api/v5/market/books?instId=<strumento scelto>&sz=5`

Controlli:

- HTTP **200**, `code === "0"`, `data` è una lista non vuota;
- strumenti con `instId`, `baseCcy`, `quoteCcy`, `state`, e almeno uno `live` compatibile
  con `ASSETS`/`QUOTES`;
- il ticker contiene **esattamente** l'`instId` annunciato dalla discovery di quel giro,
  con `bid > 0`, `ask > 0` e `ask >= bid` (nessun fallback a coppie ricostruite);
- il book usa lo stesso `instId`, ha entrambi i lati non vuoti e un `ts` in millisecondi
  non più vecchio di 30 secondi e non oltre 5 secondi nel futuro.

Nessuna API key, nessun header `Authorization`, nessun endpoint privato, nessun ordine,
deposito o prelievo.

## Perché i redirect sono bloccati

`fetch` segue i redirect per default. `https://eea.okx.com/` risponde **302 verso
`https://www.okx.com/`**, e `www.okx.com` serve gli stessi payload con HTTP 200. Senza
protezione, un redirect seguito farebbe passare il controllo su un host diverso da quello
autorizzato: un falso positivo silenzioso.

Per questo ogni richiesta usa `redirect: "error"` e verifica anche l'origine e il percorso
della risposta. Lo stesso blocco è attivo nell'adapter (`src/lib/venues/okx.ts`).

## Come si esegue

Disattivato per default: senza la variabile non parte alcuna richiesta.

```bash
npm run smoke:okx                             # stampa "disattivato", nessuna rete
GM_OKX_SMOKE=true npm run smoke:okx           # esegue le 3 richieste pubbliche
```

Solo `GM_OKX_SMOKE=true` (case-insensitive, spazi ignorati) attiva il test, come per
`GM_WORKER_ENABLED`. Uscita `0` se tutti i controlli passano, `1` al primo fallimento.

## Test automatici

`tests/okx-smoke.test.ts` contiene 11 test con `fetch` simulato, senza rete:

- gate chiuso per `undefined`, `""`, `"1"`, `"false"`, `"yes"`, `"0"` → zero chiamate;
- percorso felice con 3 richieste e `redirect: "error"` su ognuna;
- redirect rifiutato; 200 da origine diversa; HTTP 500; `code` non zero; `data` non lista;
- strumento senza campo obbligatorio; ticker assente; prezzi non validi; book vecchio.

## Limiti

- Non è eseguito dalla CI: `npm test` copre solo i test offline e il workflow non invoca
  lo script. Va lanciato a mano.
- È vincolato all'orologio locale per la freschezza del book: uno skew di sistema oltre
  30 secondi lo fa fallire (comportamento coerente con l'adapter).
- Non dice nulla su fee, spread netto o opportunità eseguibili: con fee OKX non
  configurate la venue resta non eseguibile per progetto.
