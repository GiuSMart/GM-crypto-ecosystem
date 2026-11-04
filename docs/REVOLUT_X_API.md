# Revolut X — contratto API verificato e revisione delle Skill `revx-*`

Verificato il **2026-11-04** su fonti ufficiali, non su esempi copiati.

Fonti lette:

- <https://developer.revolut.com/docs/api/revolut-x-crypto-exchange> (panoramica, base URL, autenticazione, firma)
- <https://github.com/revolut-engineering/revolut-x-api> (monorepo ufficiale: `api/`, `mcp/`, `cli/`, `skills/`)
- `revolut-x-api-for-llm.md` nello stesso repo, commit `278c7c1` (riferimento "definitivo" per gli LLM)

## 1. Versioni dei path: due, non una

| Tipo | Prefisso | Autenticazione | Fonte |
|---|---|---|---|
| Market data pubblico | `https://revx.revolut.com/api/2.0/public/...` | nessuna | esempio ufficiale: `/api/2.0/public/order-book/BTC-USD` |
| Account e trading | `https://revx.revolut.com/api/1.0/...` | Ed25519 | esempi di firma: `/api/1.0/orders`, `/api/1.0/orders/active` |

**Trappola reale:** `revolut-x-api-for-llm.md` dichiara `Base URL: https://revx.revolut.com/api/1.0` e
poi elenca i path *senza* versione (`/balances`, `/orders`, `/public/order-book/{symbol}`). Chi lo
segue alla lettera chiama `/api/1.0/public/order-book/BTC-USD` (versione sbagliata) o
`/api/1.0/balances` per errore di composizione. La pagina developer è l'autorità: la versione fa
parte del path, `2.0` per il pubblico e `1.0` per l'autenticato.

Lo stesso documento ufficiale contiene un esempio Node con `/api/1.0/crypto-exchange/orders`, path
che non compare negli altri esempi: **non copiare esempi a memoria**, verificare ogni endpoint nella
referenza laterale del portale.

## 2. Dettagli che rompono un client scritto "a intuito"

- **Formato simbolo asimmetrico**: i path usano il trattino (`BTC-USD`), le risposte usano la barra
  (`BTC/USD`). Va normalizzato in ingresso e in uscita.
- **Importi come stringhe**: tutti i valori monetari e le quantità sono stringhe decimali, mai numeri.
  Vanno trattati come decimali esatti, non convertiti in `float` per i calcoli di fee o PnL.
- **Timestamp**: gli endpoint autenticati vogliono millisecondi Unix (`int64`); gli endpoint
  pubblici restituiscono ISO-8601. Un timestamp in secondi produce `409 Request timestamp is in the
  future` e non un errore di formato.
- **Firma**: `X-Revx-API-Key`, `X-Revx-Timestamp`, `X-Revx-Signature`; il messaggio è
  `timestamp + METODO + path da /api + query senza "?" + body minificato`, concatenati **senza
  separatori**, firmati Ed25519 e codificati base64. Il body deve essere byte-identico a quello
  inviato.
- **Rate limit**: 20 richieste / 10 s sugli endpoint pubblici `last-trades` e `order-book/{symbol}`;
  1000 richieste / minuto sull'autenticato. Un poller di mercato deve stare sotto i 20/10 s, non
  sotto i 20/s.
- **Errori**: envelope unico `{error_id, message, timestamp}`; `409` copre anche timestamp fuori
  finestra; `401` può significare API key non abilitata per l'IP chiamante.
- **Enum ordini**: il lato buy dell'order book è `BUYI`, non `BUY`.
- **Paginazione**: a cursore (`metadata.next_cursor`, `limit` 1–100) su ordini e trade.
- **Range date**: `start_date`/`end_date` al massimo 7 giorni.

## 3. Cosa è stato implementato ora

`src/lib/venues/revolut-x.ts` — contratto puro, senza rete e senza credenziali:

- `publicPath` / `signedPath`: **rifiutano** un path con la versione sbagliata, un URL assoluto, un
  path traversal o una query incorporata;
- `publicUrl` / `signedUrl`: compongono l'URL dalla sola origine `https://revx.revolut.com`;
- `dashSymbol` / `slashSymbol`: conversione esplicita tra forma richiesta e forma di risposta;
- `serializeQuery`: query stabile e ordinata (stessa stringa ⇒ stessa firma);
- `buildSigningMessage`: applica l'ordine documentato, esige timestamp a 13 cifre, rifiuta un body
  non minificato e **rifiuta di firmare un path pubblico** come se fosse autenticato.

Test: `tests/revolut-x-contract.test.ts` (8 casi, offline). Deliberatamente assenti: client HTTP,
gestione chiavi, invio ordini. Il trading reale resta disabilitato (`executeLiveOrder()` lancia
sempre); questi helper servono a market data e paper trading.

## 4. Revisione delle sette Skill `revx-*`

Le Skill **non sono nel nostro repository**: compaiono solo come riferimenti nei documenti della
PR #21 (`AGENTS`/`FREEBUFF_HANDOFF`/`SKILLS_GOVERNANCE`). I file reali stanno a monte, in
`revolut-engineering/revolut-x-api`, cartella `skills/`, commit `278c7c1`: sette directory con un
solo `SKILL.md` ciascuna, nessuno script eseguibile allegato.

| Skill | Byte | SHA-256 (primi 16) | Contenuto | Verdetto |
|---|---|---|---|---|
| `revx-account` | 10925 | `679bd51bcf809e20` | saldi e storico account via CLI | adottabile, sola lettura |
| `revx-market` | 3959 | `d154b858bdc4d1c2` | ticker, candele, order book | adottabile, sola lettura |
| `revx-monitor` | 6912 | `b9bcafc9b812d28b` | alert su prezzo/RSI | adottabile, sola lettura |
| `revx-strategy` | 27062 | `fba314de2a7f9be6` | backtest grid, nessun `order place` | adottabile con dati simulati |
| `revx-telegram` | 5208 | `93ab9fb96dec6364` | connettore notifiche, gestisce bot token e chat id | **gated**: segreti e uscita dati |
| `revx-auth` | 5042 | `ab8615b1af89b98a` | generazione keypair, `chmod 600`, scrittura config | **gated**: chiavi private |
| `revx-trading` | 17487 | `8b3455f7f9480dd0` | `revx order place/replace/cancel` su denaro reale | **gated**: ordini reali |

Tutte e sette hanno frontmatter valido (`name` = directory, solo `name`/`description`, nessun BOM,
nessun CRLF), quindi passano il controllo strutturale. Il rischio non è strutturale ma operativo:

1. **Dipendono da un binario globale** (`npm install -g @revolut/revolut-x-cli`): la Skill descrive
   comandi che, eseguiti, muovono denaro vero. Installare la Skill significa installare il CLI.
2. **`revx-auth` è proattiva**: su errore di autenticazione istruisce l'agente a "run the fix
   yourself", creando keypair e modificando `~/.config/revolut-x/` senza chiedere conferma, e accetta
   l'override `REVOLUTX_CONFIG_DIR`. In un agente automatico questo va bloccato.
3. **`revx-trading` è esplicita** ("NEVER execute … without explicit user confirmation. These
   commands move real money") e contiene la guardia giusta, ma è comunque la Skill che impartisce
   ordini: incompatibile con la modalità live disabilitata.
4. **`revx-telegram`** gestisce un token bot e un chat id (segreti in config locale) e apre un canale
   di uscita verso terzi.

Regola operativa proposta: adottare `revx-market` e `revx-account` (sola lettura, nessun ordine),
`revx-monitor` e `revx-strategy` in ambiente simulato; **non installare** `revx-auth`,
`revx-trading`, `revx-telegram` finché il live controllato non è approvato, e in ogni caso mai con
chiavi reali in CI o in un agente autonomo. L'installazione resta una decisione del proprietario:
questo documento è la revisione preliminare, non un'approvazione.

## 5. Aperto

- Nessuna chiave API è stata richiesta, creata o salvata; nessuna chiamata autenticata è stata fatta.
- Verifica end-to-end del market data reale non eseguita: richiede rete verso `revx.revolut.com` e
  non è disponibile in CI.
- Da decidere: se il primo client HTTP debba essere solo pubblico (2.0) e se le Skill di sola lettura
  vadano vendorizzate con hash nel repository o consumate dal monte.
