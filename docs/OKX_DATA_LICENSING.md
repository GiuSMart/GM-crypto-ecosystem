# OKX market data — verifica delle condizioni di licenza

Verifica eseguita il **2026-11-04**. Fonti primarie lette direttamente; ciò che
non è stato possibile verificare è elencato come tale, senza deduzioni.

## Esito in una riga

**I termini di OKX non consentono di mostrare dati di mercato OKX a clienti o di
usarli in un prodotto commerciale senza un consenso scritto preventivo. La
restrizione vale anche per gli endpoint pubblici.** Di conseguenza OKX **non**
può alimentare la dashboard cliente di GM nella configurazione attuale.

## Clausole rilevanti (OKX API Agreement)

Fonte: <https://www.okx.com/en-us/help/okx-api-agreement> (§9.2–9.5, §1.2–1.13,
§3.1–3.2; consultato il 2026-11-04).

| Clausola | Contenuto rilevante |
|---|---|
| §9.2 Licenza limitata | Licenza revocabile, non esclusiva, non trasferibile, **non sublicenziabile**, solo per (a) scopi interni propri, (b) gestione del proprio conto OKX. |
| §9.3 Restrizione non commerciale | Salvo autorizzazione scritta, non si può commercializzare, rivendere, sublicenziare o distribuire gli API Services / Agent Trade Kit a terzi; né **offrire gli API Services come parte di un prodotto commerciale, piattaforma SaaS**, servizio di segnali, marketplace di strategie; né creare infrastruttura commerciale derivata da MCP Server, Skills, CLI, SDK. |
| §9.4 Market Data | I Market Data sono proprietari di OKX o dei suoi licenzianti. Uso consentito **solo personale e non commerciale**. Vietato rivendere, ridistribuire, pubblicare, **mostrare** o rendere altrimenti disponibili a terzi senza consenso scritto preventivo; usarli per prodotti concorrenti, aggregatori, feed di prezzo o piattaforme di analytics; usarli per addestrare o valutare modelli AI destinati alla commercializzazione. |
| §9.4 "Public Endpoint Data" | Le restrizioni **valgono allo stesso modo** per i dati ottenuti da endpoint pubblici e autenticati: il fatto che siano pubblicamente accessibili **non** conferisce alcun diritto di ridistribuzione o sfruttamento commerciale. |
| §9.5 Marchi | Uso di marchi, nomi e loghi OKX subordinato a consenso scritto. Nessun obbligo di attribuzione trovato. |
| §1.8 / §3.2(a) | "Market Data" comprende espressamente ticker, order book, storico trade, candele/OHLCV (anche storiche), funding rate, mark/index price, open interest, volumi. |
| §3.1 / §8.1(c) | Rate limit per endpoint nella documentazione ufficiale; aggirarli è vietato. |

Nota sulla distinzione di §9.3: fare trading sul **proprio** conto non è
"rivendita commerciale"; **operare gli API Services come servizio per altri**
richiede approvazione scritta preventiva. GM è nella seconda categoria.

## La trappola principale

`https://github.com/okx/agent-trade-kit` è distribuito con **licenza MIT**.
La licenza MIT copre **il codice**, non **i dati** che quel codice recupera: i
Market Data restano soggetti al §9.4. "Endpoint pubblico" e "codice open source"
non sono una licenza sui dati.

## Host e perimetro regionale (verificato)

- Gli utenti **EEA** devono usare `eea.okx.com` (la richiesta fallisce
  diversamente); gli utenti US `us.okx.com`. Fonte: <https://www.okx.com/help/api-faq>.
- Entità EEA: **OKX Europe Limited** (Malta, CASP autorizzata MFSA ai sensi del
  Markets in Crypto-Assets Act, Cap. 647) per i residenti EEA;
  **OKX Europe Markets Limited** (MFSA, impresa di investimento MiFID II) per
  prodotti in strumenti finanziari.
  Fonti: <https://www.okx.com/help/terms-of-service-eea>,
  <https://www.okx.com/en-eu/help/okx-europe-market-ltd-oem-terms-of-service>.
- **Non verificato**: quale entità contragga per gli API Services in EEA e se il
  testo dell'API Agreement letto (servito su path `en-us`) sia quello operativo
  per un utente EEA.

## Non verificato (dichiarato, non dedotto)

- Esistenza di un programma pubblico di licenza dati OKX (prezzi, contatti, tempi).
- Valori numerici esatti dei rate limit per endpoint (`docs-v5` non accessibile
  per dimensione della pagina al momento della verifica).
- Obblighi specifici MiCA a carico di un **ridistributore** a valle.
- Se una licenza commerciale OKX imponga attribuzione, watermark o limiti di
  conservazione dei dati.

## Conseguenze tecniche

### Cosa è stato fatto

- `src/lib/venues/licensing.ts`: registro delle licenze per venue e gate
  `marketDataDisplayDecision(venueId, context)` che **fallisce chiuso**.
  - OKX → `prohibited-without-written-consent`: consentito solo `internal`,
    bloccato in `customer-facing`.
  - Kraken/Coinbase/Bybit → `unreviewed`: consentito `internal`, bloccato in
    `customer-facing` finché una revisione non è registrata.
  - Venue sconosciuta → bloccata sempre (nessun permesso implicito).
- `tests/licensing.test.ts` prova che il gate si apre **solo** per una venue
  esplicitamente `cleared`.

### Cosa NON è stato fatto, di proposito

- Nessuna installazione dell'**OKX Agent Trade Kit** (MCP Server, Skills, CLI,
  SDK): §9.3/§9.5 vietano di costruirvi infrastruttura commerciale derivata e la
  superficie di autorizzazione non è verificabile a costo zero. I moduli di
  trading, bot, Earn, trasferimenti e prelievi restano fuori.
- Nessuna unione della **PR #16** (adapter OKX) in una parte del prodotto
  visibile ai clienti.
- Il gate **non è ancora collegato alle pagine**: farlo ora bloccherebbe la
  dashboard esistente, perché nessuna venue è `cleared`. Va collegato insieme
  alla decisione commerciale (vedi sotto).

### Percorsi possibili

| Opzione | Cosa comporta | Costo | Rischio |
|---|---|---|---|
| **A. Consenso scritto / licenza dati OKX** | Richiesta formale a OKX; poi la venue diventa `cleared` e il gate si apre | 0 € di software, tempo legale | Tempi e condizioni ignoti |
| **B. Uso interno non visualizzato** | OKX usato solo server-side nel decisioning; il valore grezzo non raggiunge mai il cliente | 0 € | Interpretazione di §9.4 da validare legalmente |
| **C. Fornitore terziario** | Dati da un vendor che già detiene i diritti di ridistribuzione | Possibile costo | Contro il vincolo budget zero |
| **D. Esclusione** | OKX fuori dal perimetro; si resta su Kraken/Coinbase/Bybit | 0 € | Meno venue |

Raccomandazione tecnica: **B come default prudente, A come obiettivo
commerciale**. In nessun caso la dashboard cliente deve mostrare ticker, book o
candele targate OKX prima di A.

## Nota per Kraken, Coinbase, Bybit

Lo stato `unreviewed` non significa "vietato": significa **non ancora
verificato**. La checklist `docs/RELEASE_CHECKLIST.md` §6 richiede già una
revisione legale prima del lancio commerciale. Questa verifica va completata
prima di presentare il prodotto come servizio a pagamento, e l'esito va
registrato in `MARKET_DATA_LICENCES`.

---

*Questa è un'analisi tecnica dei termini pubblicati dalle venue, non un parere
legale. Prima della commercializzazione serve una consulenza qualificata
Italia/UE.*
