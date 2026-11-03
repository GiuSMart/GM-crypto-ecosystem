# API interne

Tutte le route tranne `/api/auth/login` e `/api/auth/register` richiedono la sessione (cookie `gm_session`, httpOnly). Le mutazioni verificano `Sec-Fetch-Site`/`Origin` e applicano rate limiting per utente/IP.

Formato risposta: `{ ok: true, data: ... }` oppure `{ ok: false, error: "messaggio" }`.

## Autenticazione

| Metodo | Route | Body | Note |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | 8 tentativi/min per IP, lock 15 min dopo 6 errori |
| POST | `/api/auth/register` | `{ displayName, email, password }` | 3/10min, piano FREE, password ≥10 char con maiuscola+numero |
| POST | `/api/auth/logout` | — | revoca sessione corrente |
| POST | `/api/auth/password` | `{ current, next }` | revoca tutte le sessioni e ne crea una nuova |
| DELETE | `/api/auth/sessions` | — | revoca tutto e cancella cookie |

## Mercato e motore

| Metodo | Route | Parametri | Risposta |
|---|---|---|---|
| GET | `/api/market` | `?quote=USD\|EUR` | `{ quote, ts, rows[], errors[] }` — cache 4 s |
| POST | `/api/scan` | — | `ScanSummary { pairsScanned, candidates, executable, bestMarginPct, evaluations[], errors[] }` |
| GET | `/api/reports/export` | `?kind=opportunities\|paper` | CSV con BOM, `Content-Disposition: attachment` |

`ScanSummary.evaluations[]` contiene: `pair, buyVenue, sellVenue, notionalQuote, topAsk, topBid, grossSpreadPct, buyVwap, sellVwap, buyFee, sellFee, transferCost, bufferCost, breakevenSpreadPct, netProfit, marginPct, buySlippagePct, sellSlippagePct, buyDepthQuote, sellDepthQuote, executable, rejectReasons[], dataAgeMs, optimalNotional, curve[]`.

## Paper trading

| Metodo | Route | Body | Esito |
|---|---|---|---|
| POST | `/api/paper/trades` | `{ opportunityId }` | 409 con `reasons[]` se il segnale non è più eseguibile |
| POST | `/api/paper/trades/{id}` | `{}` | chiude al bid ladder live; 409 se profondità insufficiente |

## Configurazione

| Metodo | Route | Body |
|---|---|---|
| PATCH | `/api/settings` | campi `EngineSettings`, `networkFees`, `brandName`, `brandAccent`, `globalBranding` (admin) |
| POST | `/api/fees` | `{ venueId, makerPct, takerPct, note, scope: "user"\|"global" }` |
| POST | `/api/credentials` | `{ venueId, label, apiKey, apiSecret, confirmReadOnly: true }` |
| DELETE | `/api/credentials?id=` | — |
| POST | `/api/wallets` | `{ platform, label, address, chain }` |
| DELETE | `/api/wallets?id=` | — |

## Amministrazione (solo admin)

`GET /api/admin` restituisce il catalogo referral così com'è salvato:
`{ id, platform, name, url, category, active, verified, affiliate_confirmed, sort, updated_at }`,
ordinato per `sort`. È la source of truth usata dagli script di trasferimento: la pagina
`/affiliate` non può esserlo, perché non mostra mai un'offerta disattivata.

`POST /api/admin` con `action`:

- `assign_plan` `{ userId, planId }`
- `set_role` `{ userId, role }`
- `set_status` `{ userId, status }`
- `set_plan_price` `{ planId, priceCents }`
- `grant_live` `{ userId, maxOrderQuote, maxDailyLossQuote, confirm: true, note }`
- `revoke_live` `{ userId }`
- `upsert_referral` `{ id?, platform, name, category, url, tagline, description, howItWorks, tutorial[], terms, rewards, verified, affiliateConfirmed, active, sort }` — `category` deve essere una delle voci di `REFERRAL_CATEGORIES`; `url` deve essere https senza credenziali e non deve essere già presente (altrimenti la richiesta viene rifiutata senza toccare le voci esistenti). Aggiornando una voce già presente l'aggiornamento è **parziale**: i campi omessi mantengono il valore salvato, mentre `""`/`null` li svuotano; `verified`, `affiliateConfirmed` e `active` accettano anche `1`/`0`. Su una voce nuova `platform`, `name`, `category` e `url` sono obbligatori
- `delete_referral` `{ id }`

## Intelligenza

| Metodo | Route | Body | Risposta |
|---|---|---|---|
| POST | `/api/intelligence` | `{ question }` | `{ answer, intent, source }` — deterministico, limitato ai dati del DB |

## Codici di errore

| Codice | Significato |
|---|---|
| 401 | sessione assente/scaduta |
| 403 | cross-site, ruolo insufficiente, limite piano |
| 409 | segnale non più eseguibile / operazione già chiusa |
| 429 | rate limit (con `retryAfterSec`) |
| 502 | venue pubblica non raggiungibile |
