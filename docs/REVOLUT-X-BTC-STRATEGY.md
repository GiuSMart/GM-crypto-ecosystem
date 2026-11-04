# Strategia BTC asimmetrica — integrazione Revolut X

## Obiettivo

Integrare nel GM Crypto Ecosystem le regole del manuale personale BTC come strategia spot separata dal motore di arbitraggio multi-exchange. La prima consegna è un motore matematico deterministico e testabile; non invia ordini e non richiede credenziali.

## Regole estratte dal manuale

- Budget di riferimento: 10.000 EUR, ripartito 40% liquidità (acquisti), 40% scorta crypto (vendite), 20% riserva DCA.
- Accumulo: variazione giornaliera BTC compresa tra -2% e -4% rispetto all'apertura giornaliera; TWAP di 2 ore.
- Riserva: il paragrafo operativo indica attivazione al -8% complessivo. Il paragrafo di allocazione parla invece di ribassi superiori al 5%; questa discrepanza va risolta prima di qualsiasi automazione live. La prima implementazione usa il trigger operativo esplicito di -8%.
- Uscita: ordini limite Take Profit calcolati dal prezzo medio di carico.
- Target: +2%, +3%, +4%, +5%, +8% netti.
- Fee ipotizzate dal manuale: 0,09% acquisto + 0,09% vendita.

## Calcolo Take Profit e verifica del PDF

Per un target netto desiderato r, fee acquisto fb e fee vendita fs, il prezzo minimo di uscita è:

sellPrice = averageEntry × (1 + fb) × (1 + r) / (1 - fs)

Le percentuali sono convertite in frazioni prima del calcolo. Il PDF usa il moltiplicatore 1,0218 per il target +2% e riporta 73.033,15 EUR su un carico di 71.475 EUR. Applicando esattamente entrambe le commissioni dello 0,09% e un rendimento netto del 2% sul capitale investito, il moltiplicatore è 1,02183765 e il prezzo è 73.035,85 EUR. Il prezzo del PDF è quindi una buona approssimazione, ma produce circa +1,9962% netto (circa 199,62 EUR su 10.000 EUR), non 200 EUR esatti. Il motore usa il calcolo esatto e mantiene il profitto in euro proporzionale al controvalore effettivo della posizione.

## Architettura prevista

1. **Revolut X market adapter (read-only):** prezzi, candele e order book BTC/EUR attraverso endpoint ufficiali. Normalizzare i simboli e conservare timestamp, bid/ask e profondità.
2. **BTC asymmetric engine:** classificazione delle fasce giornaliere, budget 40/40/20, prezzo medio di carico e target netti. Separato da engine/arbitrage.ts, che oggi confronta venue differenti.
3. **AI Intelligence:** usare l'AI come livello di spiegazione e valutazione sopra dati reali e risultati del motore. L'AI non deve inventare segnali, prezzi, fee o liquidità; mostra sempre motivazioni, dati utilizzati e incertezza.
4. **Paper trading:** simulare TWAP a tranche su 120 minuti, fill effettivi sul book, fee reali configurate, DCA e uscite limite. Registrare ogni decisione e confrontare risultati attesi/realizzati.
5. **Live trading, fase successiva:** solo dopo backtest e paper test; API key e chiave Ed25519 in secret storage, permessi minimi, IP allowlist ove supportata, ordini limit/conditional/TPSL, limiti di esposizione e perdita giornaliera, kill switch e conferma umana per ogni ordine iniziale.

## Ruolo dell'AI e criteri di qualità

L'AI non crea un vantaggio garantito e non sostituisce il motore. Può:
- sintetizzare struttura multi-timeframe e contesto volatilità;
- spiegare se le regole del manuale sono soddisfatte;
- confrontare prezzo medio, target, fee e slippage;
- evidenziare condizioni anomale e proporre di non operare;
- analizzare risultati paper e suggerire modifiche solo come ipotesi da testare.

Misurare almeno: rendimento netto dopo fee, max drawdown, profit factor, win rate, expectancy, tempo medio in posizione, numero di ordini non eseguiti e differenza tra fill teorici e simulati. Valutare su dati fuori campione e includere periodi laterali, rialzisti e ribassisti.

## Limiti e questioni da chiarire

- La ripartizione 40/40/20 non significa che 10.000 EUR siano tutti investiti: il 40% crypto è un controvalore BTC già posseduto, non liquidità spendibile.
- Il PDF usa 10.000 EUR per gli esempi di profitto. Il motore scala il profitto sul controvalore effettivamente acquistato/venduto.
- Il trigger DCA è discordante tra sezione 2 (>5%) e sezione 4 (-8%); usare -8% solo per la simulazione iniziale e chiedere conferma prima del live.
- Le commissioni 0,09% devono essere sostituite con quelle effettive dell'account Revolut X e del suo livello commissionale.
- Il PDF non specifica stop-loss, limite di perdita giornaliera, tranche TWAP, criteri quantitativi per supporti/resistenze, né regole di uscita d'emergenza. Non inventare questi parametri per il live.
- I target non sono una promessa di rendimento: un ordine limite può non essere eseguito e il prezzo può scendere ulteriormente.

## Stato della prima consegna

src/lib/engine/btc-asymmetric.ts contiene solo funzioni pure per allocazione, classificazione del movimento giornaliero e calcolo dei target. tests/btc-asymmetric.test.ts verifica le regole e riproduce il calcolo corretto del +2% netto. Nessuna chiamata API, credenziale o operazione reale è inclusa in questa fase.
