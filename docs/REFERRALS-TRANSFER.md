# Trasferire il catalogo Affiliate Center tra ambienti

Le offerte referral sono **dati dell'operatore**, non codice: vivono in `data/gm.db`, che è
escluso da Git (`data/` in `.gitignore`). Un push o un deploy non le porta con sé, quindi
un'istanza nuova parte con le 7 offerte di base definite nel seed e nient'altro.

Questo documento descrive come spostare il catalogo da un ambiente all'altro senza duplicati
e senza toccare nient'altro.

## Cosa si trasferisce, e cosa no

| Dato | Trasferire? | Perché |
| --- | --- | --- |
| `referrals` | **sì** | è il catalogo che l'operatore cura a mano |
| `users`, `sessions` | no | appartengono all'ambiente; sovrascriverli disconnetterebbe gli utenti |
| credenziali exchange (cifrate) | no | legate alla chiave AES `data/master.key` dell'ambiente |
| `audit_log` | no | è la storia di *quell*'istanza |
| `data/master.key` | **mai** | chiave di cifratura delle credenziali: non va copiata, si rigenera |

Per questo **non si copia `data/gm.db`**: il file contiene tutto quanto sopra. Si trasferisce
solo la tabella `referrals`, passando dall'API amministrativa — la stessa strada che usa il
pannello, con le stesse validazioni (solo `https`, categorie in allowlist, niente link duplicati).

## Procedura

Tutto si fa con `scripts/referrals-transfer.mjs`. La password viene chiesta in modo nascosto e
non viene mai scritta su disco né passata come argomento.

```bash
# 1. esporta il catalogo dall'ambiente che lo contiene (di norma quello locale)
node scripts/referrals-transfer.mjs export
#    → data/referrals-export.json (permessi 600, contiene solo dati pubblici: nessun segreto)

# 2. controlla cosa succederebbe sull'ambiente di destinazione, senza scrivere
node scripts/referrals-transfer.mjs import \
  --in data/referrals-export.json \
  --base https://produzione.example.com \
  --email admin@example.com
#    ogni riga è marcata "nuova" (URL non ancora in pagina) o "aggiorna" (già presente)

# 3. applica
node scripts/referrals-transfer.mjs import \
  --in data/referrals-export.json \
  --base https://produzione.example.com \
  --email admin@example.com --apply

# 4. verifica in qualsiasi momento
node scripts/referrals-transfer.mjs verify \
  --in data/referrals-export.json \
  --base https://produzione.example.com \
  --email admin@example.com
```

`--base` è obbligatorio in produzione: senza, il comando lavora sullo sviluppo locale
(`http://127.0.0.1:3001`). L'email può arrivare da `GM_ADMIN_EMAIL` invece che da `--email`.

## Dove è consentito inviare la password

Entrambi gli script (`referrals-transfer.mjs` e `set-admin-password.mjs`) accettano `--base`
solo se rispetta queste regole, controllate prima di leggere qualsiasi credenziale:

| Regola | Motivo |
| --- | --- |
| `http://` ammesso **solo** su `localhost`, `127.0.0.1`, `::1` | fuori dal loopback la password viaggerebbe in chiaro |
| ogni altro host richiede `https://` | — |
| fuori dal loopback è ammessa solo la porta `443` (anche esplicita) | `https://host:8443` evita le regole TLS della rete e di solito non è l'istanza che vuoi aggiornare |
| nessun `utente:password@` nella URL | l'API usa il login, non il basic auth |
| nessuna query string, fragment o percorso | gli script aggiungono da soli `/api/...`: `https://host/app` produrrebbe `/app/api/...` |

Una `--base` non valida termina subito con `✗ base URL rifiutata: ...` e nessuna richiesta di rete.
Esempio: `node scripts/referrals-transfer.mjs verify --in x.json --base https://app.example.com`.

## Cosa può fare un import

Lo snapshot è **dato, non istruzione**: prima di ogni richiesta il payload viene ricostruito da
una allowlist di campi (`scripts/lib/transfer-safety.mjs`), con `action: "upsert_referral"`
scritto dal codice. Un file che contiene `"action": "delete_referral"` (o `revoke_live`,
`set_role`, campi estranei come `userId`) viene importato come normale upsert: la pagina e
l'audit log mostrano `admin.upsert_referral`, nessuna voce viene cancellata. Lo stesso vale per
la rotazione password, che parla solo con `/api/auth/*` e non segue redirect.

## Perché non crea duplicati

- Ogni riga porta il proprio `id`, e `upsert_referral` è un `INSERT ... ON CONFLICT(id)`.
  Reimportare lo stesso snapshot aggiorna le righe esistenti invece di aggiungerne altre.
- L'API rifiuta comunque un URL già presente con un altro id (confronto sull'URL normalizzato):
  quegli scarti vengono stampati come «rifiutate» e non bloccano le altre righe.
- Il comando è ripetibile: eseguirlo due volte di fila produce `create: 0`.

## Dati preesistenti

Le 7 offerte di base hanno gli stessi `id` in ogni ambiente (vengono dal seed). Il primo import
su un'istanza nuova le aggiorna con le categorie corrette e aggiunge le voci create a mano,
senza duplicarle. Le voci presenti solo nella destinazione **non vengono toccate**: lo strumento
non cancella mai nulla.

## Se una riga viene rifiutata

| Messaggio | Causa | Rimedio |
| --- | --- | --- |
| `Categoria non valida` | etichetta non in `REFERRAL_CATEGORIES` | correggere la categoria nel pannello o nello snapshot |
| `Link già presente ...` | URL identico su un'altra voce | decidere quale tenere; nessuna cancellazione automatica |
| `Solo link https sono ammessi` | URL `http://` o non valido | correggere il link alla fonte |

## Rollback

Non esiste un "undo" automatico, perché nulla viene cancellato: per tornare indietro si
reimporta uno snapshot precedente (l'upsert riscrive i campi) oppure si disattiva la voce dal
pannello (`active = false`), che la toglie dalla pagina senza perdere i dati.

## Checklist dopo un import in produzione

1. `verify` riporta `N/N` offerte pubblicate.
2. Apri `/affiliate` da account normale: i gruppi sono nell'ordine canonico e i link si aprono
   in una nuova scheda.
3. Le voci create a mano restano `verified = false` finché non vengono controllate: nessun
   beneficio viene promesso agli utenti prima di quella verifica. Se è il proprietario ad
   attestare link, attribuzione e promozione, si spunta «confermato dal proprietario» nel
   modulo referral del pannello (`affiliate_confirmed = 1`): la scheda mostra «confermato dal
   proprietario» e resta distinta da una verifica indipendente delle condizioni.
4. Controlla che il numero di utenti dell'ambiente di destinazione non sia cambiato (segno che
   non è stato copiato il database sbagliato).
