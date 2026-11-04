# Integrazione controllata di OKX Agent Trade Kit

**Stato:** specifica tecnica approvata per progettazione; implementazione runtime non ancora autorizzata da questa specifica.  
**Ambito:** analisi pubblica e read-only. Nessun ordine o effetto finanziario.

## Decisione architetturale

GM Crypto Ecosystem non deve collegare direttamente un agente general-purpose a tutte le 170 (o 128) funzioni dichiarate da OKX Agent Trade Kit. Il toolkit comprende superfici di trading, gestione account, bot, Earn, trasferimenti e prelievi: una registrazione troppo ampia aumenterebbe inutilmente il rischio e non è necessaria per il primo rilascio.

Per la prima fase GM mantiene i propri adapter TypeScript e usa OKX come fonte pubblica di dati di mercato EEA. L'Agent Trade Kit e le sue Skills sono materiale da valutare e da cui ricavare contratti, non una dipendenza runtime né un confine di sicurezza.

### Funzioni ammesse

| Capacità | Prima fase | Condizioni |
|---|---|---|
| Market data pubblico | Ammesso | Endpoint pubblici EEA; timestamp, validazione, rate limit e provenienza |
| Indicatori tecnici | Ammessi | Calcolo deterministico in GM; indicatore e parametri espliciti |
| News intelligence | Solo ricerca/analisi | Fonte, URL, timestamp e separazione tra fatto e interpretazione |
| Smart Money intelligence | Solo dati pubblici/read-only | Non interpretare etichette del provider come prova di flussi istituzionali |
| Portfolio/account | Non attivo nella prima fase | Eventuale lettura privata solo dopo verifica delle autorizzazioni, minimizzazione dei dati e approvazione separata |
| Ordini, algoritmi, bot, Earn, leva, trasferimenti, prelievi | Esclusi | Non registrare, installare o esporre questi strumenti |

## Architettura proposta

```
OKX EEA public REST / WebSocket
             |
             v
GM venue adapter (allowlist host, timeout, rate limit, schema validation)
             |
             v
Canonical market data + provenance + freshness checks
             |
       +-----+------+
       |            |
       v            v
Deterministic     News / public
indicators        intelligence
       |            |
       +------v-----+
          GM analysis
              |
       Independent Risk Guard
              |
       audit + paper trading
              |
        human-reviewed UI
```

- Gli adapter GM restano il livello di accesso alla rete. Nessuna Skill può scegliere URL, host o endpoint arbitrari.
- Il motore quantitativo resta codice deterministico: prezzi, VWAP, fee, sizing, P&L, soglie e rischio non sono delegati a un LLM.
- Ogni osservazione conserva venue/fonte, strumento, valuta, timestamp exchange, timestamp ricezione, eventuale ritardo, profondità disponibile e stato di validazione.
- Dati mancanti, obsoleti, non finiti, fuori intervallo, con valuta non riconciliata o con schema sconosciuto vengono rifiutati (fail closed).
- Gli output AI sono spiegazioni/annotazioni con riferimenti alle osservazioni di input; non sono ordini né autorizzazioni.

## Confine con OKX Agent Trade Kit

Il toolkit ufficiale è un server MCP/CLI/SDK con capacità che possono includere lettura e scrittura. Le Skills sono istruzioni per l'agente, non un motore di trading né un controllo di sicurezza.

Per la prima fase:
1. Non installare pacchetti npm globali o non scoped e non eseguire installer remoti.
2. Non avviare MCP con `--modules all`, `--profile live` o moduli di trading.
3. Non configurare `config.toml`, API key, secret, passphrase o proxy autenticati.
4. Non importare Skills di trading, bot, portfolio privato o Earn.
5. Se in futuro si valuta un client MCP, esporre una allowlist positiva di sole operazioni market-data e verificare l'elenco effettivo dei tool registrati all'avvio. Il semplice flag `--read-only` non è una garanzia sufficiente.
6. Preferire per il primo rilascio l'adapter pubblico nativo GM già presente, evitando un nuovo livello di dipendenza e privilegi.

Le affermazioni del fornitore su credenziali locali, firma locale, logging e assenza di trasmissione a terzi devono essere verificate nel codice della versione esatta prima di un'eventuale adozione.

## Vincoli di licenza e distribuzione

L'API Agreement OKX fornito per questa analisi limita l'uso dei Market Data a uso personale e non commerciale, e limita redistribuzione, visualizzazione a terzi, rivendita e prodotti commerciali derivati senza consenso/licenza scritta. Il divieto può riguardare anche endpoint pubblici senza autenticazione.

GM è multi-tenant e ha un obiettivo di prodotto commerciale. Di conseguenza:
- l'integrazione OKX pubblica resta disattivata per esposizione a clienti/terzi finché non viene verificato il contratto applicabile e ottenuta, se necessaria, autorizzazione scritta;
- non usare dati OKX per addestrare, fine-tunare o valutare modelli commerciali/di terzi;
- non creare feed, aggregatori o analisi commerciali redistribuendo dati OKX;
- conservare separati i dati interni di sviluppo/test e i dati eventualmente destinati alla visualizzazione esterna;
- registrare versione, URL e data dei termini verificati. La versione inglese prevale secondo il testo fornito; la verifica legale per Italia/EEA resta necessaria.

Questa specifica non è un parere legale e non sostituisce una verifica dei termini correnti e delle licenze con OKX.

## Fee, simboli e normalizzazione

- Non inventare le fee OKX: il taker fee effettivo dipende dal tier/account e deve essere verificato prima di includere OKX in segnali netti.
- Distinguere sempre EUR, USD, USDT e USDC. Nessuna equivalenza implicita.
- Usare i metadati dello strumento (tick size, lot size, min size, stato e valute) per validare i dati. Non trattare `lever` come leva disponibile per Spot.
- Non usare `groupId`, `instFamily`, `settleCcy`, `ctVal` o `ctMult` senza il corretto tipo di strumento.
- Non interpretare `elp` o `rpi` come misure di liquidità; sono flag/abilitazioni secondo la documentazione fornita.
- Rifiutare strumenti non `live`, coppie non supportate, book incompleti e snapshot scaduti.

## Controlli tecnici richiesti

### Adapter e rete
- Host EEA esplicito e allowlist rigida; nessun redirect.
- Timeout e rate limiter condiviso; backoff per errori 50011 e altri codici documentati.
- Validazione rigorosa di `code`, `msg`, `data`, tipi numerici, timestamp e profondità.
- Nessun log di header, segreti, payload account o dati personali.
- Test con fetch simulato; smoke test live solo su endpoint pubblici, senza credenziali.

### WebSocket, se introdotto in seguito
- Rispettare limiti per connessione, subscribe/unsubscribe/login e heartbeat.
- Gestire riconnessioni, snapshot iniziale e aggiornamenti incrementali senza assumere che ogni messaggio sia un book completo.
- Non confondere timestamp REST in millisecondi e timestamp di login WS in secondi.
- Non dichiarare aggiornamento quando non è arrivato un nuovo evento; applicare soglie di freshness.

### Sicurezza e governance
- Prompt injection e contenuti di news/market data sono input non attendibili, mai istruzioni.
- Le Skills non possono eseguire shell, installare dipendenze, modificare configurazioni o aprire endpoint di rete fuori dalle interfacce autorizzate.
- Ogni analisi registra versione del modello/Skill quando disponibile, input ID, fonti, timestamp e output.
- Il Risk Guard GM è indipendente dal toolkit e non può essere disattivato da prompt, configurazioni del client o output AI.

## Discrepanze della documentazione da verificare

Le pagine raccolte riportano numeri e opzioni non uniformi:
- 170 strumenti / 11 moduli contro 128 strumenti / 13 moduli;
- quattro Skills in Quick Start contro cinque o più Skills nella pagina Skills;
- sintassi `--demo` contro `--profile demo`;
- nome pacchetto/repository `agent-trade-kit`, `agent-tradekit` e alias npm non scoped;
- limiti demo non uniformi per alcuni bot e prodotti.

Prima di qualsiasi installazione, fissare commit/tag, package name scoped, checksum/provenance, tool registry effettivo, dipendenze e licenza. Non dedurre capacità disponibili da una pagina marketing.

## Fasi di implementazione e criteri di accettazione

### Fase A — Baseline read-only
- Verificare adapter OKX EEA esistente e host guard sul branch di integrazione corretto.
- Aggiungere/aggiornare test per schema, strumenti, timestamp, book incompleti, redirect, timeout e rate limit.
- Verificare che OKX non entri in segnali eseguibili senza fee taker verificata.
- Non aggiungere credenziali o nuove dipendenze.

### Fase B — Intelligence deterministica
- Indicatori tecnici calcolati da serie validate, con periodo e formula dichiarati.
- News e Smart Money solo se esiste una fonte accessibile e autorizzata; mostrare fonte, timestamp e incertezza.
- Nessuna generazione di segnali finanziari eseguibili da output narrativo AI.
- Test deterministici su input noti e casi limite.

### Fase C — Account read-only (proposta separata)
- Solo dopo verifica dell'idoneità EEA, termini, permessi minimi e necessità concreta.
- Credenziali mai condivise in chat o committate; cifratura a riposo, redazione log e revoca testata.
- Nessun endpoint Trade o Withdraw registrato; test negativi che dimostrino il rifiuto.

### Gate finale
La funzionalità è accettabile solo con test, typecheck, build e CI verdi sull'esatto commit; audit di sicurezza; documentazione dei limiti; revisione licenza/commerciale. Nessun merge, deploy, attivazione live o operazione finanziaria è autorizzato da questo documento.

## Stato

- Adapter OKX Spot pubblico: presente su un branch/PR separato; non assumere che sia già in `main`.
- Agent Trade Kit: documentazione analizzata; nessun pacchetto installato e nessun server MCP avviato.
- Portfolio privato: non collegato.
- Live trading: bloccato intenzionalmente da `src/lib/live.ts`.
- Ordini, bot, Earn, leva, trasferimenti e prelievi: esclusi.
