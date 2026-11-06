# Stage C — integrazione e riallineamento su main

**Stato: procedura preparata, NON eseguita.** Nessun rebase, nessun force push,
nessuna modifica a `main`. Dati verificati il 2026-11-06 sul repository remoto.

## 1. Topologia verificata

| Elemento | Valore |
|---|---|
| Branch Stage C | `feature/ai-stage-c-route` |
| HEAD verificato (hardening, prima del pannello admin) | `bcf28ba9edf150c74be8e31545d9847901fee6ad` |
| Base dichiarata | `chore/agent-skills-freebuff-handoff`, head `336a832` (PR #21) |
| Stato PR #21 | **aperta in bozza**, branch → `main`, non mergiata |
| `main` | `6cd3033f9bc7098769c75ea1fb40d54fb442a880` |
| Distanza `main...branch` | 23 commit avanti, 3 indietro (a `bcf28ba`; +1 con il pannello admin) |
| PR Stage C | **nessuna aperta** |
| Rebase eseguito | **no** |
| Contenuto AI su `main` | assente: né `src/lib/ai/**` né i documenti Stage A/B/C |

Conclusione: finché #21 è aperta, `main` non contiene la specifica free-only né
`docs/ARCHITECTURE.md` aggiornato. Un rebase diretto su `main` duplicherebbe il
lavoro di #21 e produrrebbe conflitti privi di significato. Il pannello
amministrativo `/admin/ai` è stato aggiunto sopra `bcf28ba`; il branch non è
stato rebasato e non è stata aperta alcuna PR.

## 2. Sovrapposizioni misurate

Confronto tra i file toccati da questo branch (`336a832..HEAD`) e quelli di ogni
PR aperta, ciascuna contro il proprio merge-base con `main`:

| PR | File | Sovrapposizione con Stage C |
|---|---|---|
| #21 | 15 | `docs/ARCHITECTURE.md` |
| #18 | 8 | `docs/ARCHITECTURE.md` |
| #23 | 6 | `docs/ARCHITECTURE.md` |
| #27 | 17 | nessuna |

Nessuna sovrapposizione nel codice applicativo AI (`src/lib/ai/**`, `src/app/api/ai/**`).
L'unico punto contendibile è `docs/ARCHITECTURE.md`, dove la sezione "AI Collective
(Stage C)" va mantenuta accanto alle modifiche delle altre PR, non al posto loro.

## 3. Precondizioni (tutte obbligatorie)

1. #21 è mergiata su `main` (verificare che `main` contenga `docs/GM_AGENT_PLATFORM.md`
   e la sezione AI di `docs/ARCHITECTURE.md`).
2. `main` è stato riletto dopo il merge: `git fetch origin && git log --oneline -5 origin/main`.
3. Il branch di lavoro è pulito (`git status --porcelain` vuoto) e tutti i test
   passano sullo SHA di partenza.
4. Nessuna altra PR è stata mergiata nelle ultime ore: ricontrollare `docs/ARCHITECTURE.md`.

Se una precondizione manca, **fermarsi**: non rebasare "per prova".

## 4. Procedura (da eseguire solo dopo #21)

```bash
git fetch origin
git switch feature/ai-stage-c-route
git status --porcelain                       # deve essere vuoto
git switch -c backup/ai-stage-c-pre-main     # copia di sicurezza, non si tocca
git switch feature/ai-stage-c-route
git rebase --onto origin/main 336a832        # riapplica Stage A/B + C su main
```

`336a832` è la vecchia base: `--onto origin/main 336a832` riapplica solo i tre
commit di Stage C sopra il nuovo `main`.

Se `docs/ARCHITECTURE.md` va in conflitto, la risoluzione corretta è **unire** le
sezioni (mantenere quelle delle PR mergiate e la sezione AI), mai scegliere un lato
in blocco. Dopo la risoluzione:

```bash
git add docs/ARCHITECTURE.md
git rebase --continue
```

Verifica che il rebase non abbia cambiato il contenuto:

```bash
git range-diff 336a832..backup/ai-stage-c-pre-main origin/main..HEAD
```

## 5. Pubblicazione senza force push

Il branch originale non viene riscritto: si pubblica il risultato su un branch
nuovo, così la history pubblicata resta immutabile e il branch precedente resta
recuperabile.

```bash
git switch -c feature/ai-stage-c-main
git push -u origin feature/ai-stage-c-main
```

Poi PR **draft** con base `main`:

```bash
gh pr create --draft --base main --head feature/ai-stage-c-main \
  --title "AI Collective Stage C: free-only gateway, OpenRouter adapter and guarded route" \
  --body-file artifacts/pr-ai-stage-c.md
```

Il corpo PR va aggiornato con l'esito del rebase: SHA, `range-diff`, test e CI sul
nuovo SHA. Nessun merge, nessun deploy, nessuna release.

## 6. Verifiche obbligatorie sul nuovo SHA

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Poi CI `GM Crypto CI` sul branch `feature/ai-stage-c-main` e controllo che la run
sia relativa allo SHA esatto. Solo dopo si può chiedere la review.

## 7. Rollback

- Rebase non soddisfacente: `git rebase --abort` (prima del completamento) oppure
  `git switch feature/ai-stage-c-route` per tornare alla history pubblicata.
- Branch nuovo errato: si elimina solo `feature/ai-stage-c-main`; `backup/ai-stage-c-pre-main`
  e `feature/ai-stage-c-route` restano intatti.
- Nessun comando di questa procedura tocca `main` o i branch di altre PR.
