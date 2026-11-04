# Third-party software notices

This inventory is generated from the committed `package-lock.json` and records the
package metadata declared by npm. It is an inventory aid, not a legal opinion and
not proof that every upstream copyright notice or license text has been reviewed.

## Current lockfile snapshot

- Packages recorded: **129** (excluding the root project).
- MIT: **80**
- Apache-2.0: **17**
- ISC: **3**
- BSD-3-Clause: **1**
- 0BSD: **1**
- LGPL / MPL / CC-BY / compound expressions: **27**

The complete name/version/license snapshot is in
[`../licenses/third-party-baseline.json`](../licenses/third-party-baseline.json).

## Packages requiring retained notices or legal review

The current lockfile includes LGPL-3.0-or-later components from the
`@img/sharp-libvips-*` family and `@img/sharp-wasm32`; MPL-2.0 components from
`lightningcss` and its platform packages; and CC-BY-4.0 metadata for
`caniuse-lite`. Compound expressions for some Sharp platform packages must be read
as stated by the package metadata, not simplified to a single permissive license.

Before distributing binaries, containers, installers, or hosted deployments, verify
the actual transitive artifacts included for each target platform, obtain the
corresponding license texts and notices from the exact package versions, and satisfy
any source-offer, modification, attribution, or notice obligations that apply.
This file does not itself satisfy those obligations.

## Required maintenance

1. Run `npm ci` and `npm run licenses:check` after every dependency or lockfile change.
2. Review any new package, changed license expression, unknown declaration, or copyleft
   package before approval. New restrictive or unknown licenses fail CI.
3. Refresh the baseline only after human review; never regenerate it automatically in CI.
4. Preserve upstream LICENSE, NOTICE, attribution, and source-offer materials for the
   exact versions and artifacts distributed.
5. Generate a fresh machine-readable report with `npm run licenses:report` before a release.

## Scope

This inventory covers npm packages in `package-lock.json` only. It does not yet cover
fonts, icons, images, datasets, exchange market data, news feeds, AI model weights,
container base images, operating-system packages, Git submodules, copied snippets,
external services, or content supplied at runtime. Those require separate provenance
and permission records.
