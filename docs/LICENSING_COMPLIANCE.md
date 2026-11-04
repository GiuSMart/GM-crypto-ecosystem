# GM Crypto Ecosystem — licensing and permissions register

**Project code choice:** proprietary. **Target model:** both personal/proprietary use and a future commercial multi-tenant product.  
**Status:** implementation controls added; third-party and exchange permissions remain conditional / not granted unless documented in writing.

## 1. Project-owned code

The repository is marked private in `package.json` and the package metadata uses
`UNLICENSED`. The root `LICENSE` notice reserves rights in original GM materials.
This is a proprietary notice, not a complete negotiated license agreement. Before
external distribution, confirm the legal rights holder and chain of title for all
contributions, contractor work, generated assets, and imported code. Use separate
written customer terms for any hosted/SaaS offering; do not imply that customers
receive source-code rights.

## 2. Third-party software

- npm dependencies are inventoried in `licenses/third-party-baseline.json`.
- `scripts/check-licenses.mjs` validates the lockfile against the reviewed baseline.
- `scripts/generate-third-party-notices.mjs` collects upstream LICENSE/NOTICE/COPYING files from installed packages into a generated bundle; missing files are reported and can be made blocking with the strict command.
- New permissive dependencies may pass the automated gate; new copyleft, attribution,
  compound, missing, or unknown licenses require explicit review and baseline approval.
- Existing LGPL/MPL/CC-BY entries are recorded exceptions, **not a statement that all
  distribution obligations have been satisfied**. Preserve upstream notices and verify
  the exact binary/source obligations before shipping each platform artifact.
- A proprietary root license does not relicense third-party packages.

## 3. Exchange data and API permissions

Public endpoints do not mean public-domain data. A commercial multi-tenant product must
not expose, redistribute, resell, display, or create third-party-facing derived analytics
from an exchange feed until the relevant exchange/licensor grants the necessary rights
in writing. Do not send exchange data to third-party AI/model training or evaluation
services unless the relevant data terms expressly permit it.

| Provider | Evidence reviewed | Current project permission state | Required action before commercial multi-tenant use |
|---|---|---|---|
| OKX | API Agreement, including commercial API services and market-data restrictions | **Not granted / blocked** | Obtain written API/service approval and separate market-data rights covering SaaS, display, derived analytics, caching, AI processing, territory, users, retention and fees. Public unauthenticated endpoints remain covered. |
| Coinbase | Market Data Terms of Use | **Not granted / blocked** | Obtain express written consent for end-user application, third-party display/redistribution and derived analytics. The standard grant is limited to personal/research or entity internal use. |
| Kraken | API Center and applicable EEA terms | **Not verified / blocked** | Contact marketdata@kraken.com and obtain written scope for commercial use, redistribution, derived data and multi-tenant SaaS; confirm applicable EEA terms. |
| Bybit | API Terms & Conditions | **Not granted / blocked** | Obtain written commercial/API broker/data permission covering the precise SaaS and market-data use. The published terms prohibit repackaging/reselling API or Service Data and commercial exploitation. |
| Revolut X | Crypto Exchange Terms and API permission documentation | **Not granted / blocked** | Obtain written approval for third-party applications and any distribution of market data; API keys are user-scoped and must not be shared. |

Until written permissions are recorded, exchange adapters may only be used within the
limits of the applicable current terms and project authorization. The safest interim
boundary is local, single-user, personal use where permitted; do not expose raw or derived
exchange data to other tenants. This register does not itself authorize any access.

## 4. AI models, agents, skills and news sources

For every model, agent, skill pack, MCP server, browser tool, news provider or smart-money
source, record: provider/version, source URL, code license, model/data license, permitted
commercial use, input retention/training terms, output rights, attribution, territory,
rate limits, security review, and whether customer/exchange data may be sent to it.
A code license such as MIT does not grant rights to market data, model weights, trademarks,
API services, or hosted inference. No customer secrets, API keys, exchange credentials,
or personal data may be sent to an agent without a separate security and privacy approval.

## 5. Regulatory perimeter — Italy / EU

MiCA/CASP analysis depends on the actual service and customer relationship, not on the
product label. A software tool used only by its owner for proprietary trading is materially
different from a service that executes orders, receives/transmits orders, holds assets,
provides custody, operates a trading platform, exchanges crypto-assets for clients,
provides portfolio management, or gives advice to clients. Those activities can fall
within regulated crypto-asset services and require authorization or a valid exemption.

Before offering customer-facing execution, custody, portfolio management, exchange,
order transmission, or personalized crypto advice, obtain an Italian/EU legal opinion
and confirm the relevant CONSOB/Banca d'Italia authorization or notification path. This
repository must not represent that it is licensed or authorized. Pure software/SaaS
analytics still needs a fact-specific perimeter review, consumer, privacy, cybersecurity,
marketing and financial-promotion analysis.

## 6. Release gates

A release intended for customers is blocked until all applicable items are complete:

- [ ] Rights holder and contributor chain of title verified; proprietary terms reviewed.
- [ ] Third-party notices and exact platform artifacts audited.
- [ ] No unapproved or unknown dependency license; SBOM and license report archived.
- [ ] Written exchange/data licenses cover the exact SaaS, display, derived-data, AI and territory scope.
- [ ] AI/model/news licenses and privacy/data-processing terms approved.
- [ ] MiCA/CASP and other applicable regulatory perimeter reviewed by qualified counsel.
- [ ] Customer terms, privacy notice, GDPR roles/DPA, retention and incident procedures reviewed.
- [ ] Security review, operational controls and user consent completed.

No item in this document constitutes a license, regulatory authorization, legal opinion,
or assurance of compliance. Re-check provider terms at each release and whenever they change.

## 7. Primary sources

- [SPDX License List](https://spdx.org/licenses/) and [SPDX license expression guidance](https://spdx.dev/learn/handling-license-info/).
- [OKX API Agreement](https://www.okx.com/help/okx-api-agreement).
- [Coinbase Market Data Terms](https://www.coinbase.com/legal/market_data).
- [Kraken API Center](https://docs-legacy.kraken.com/api/docs/guides/global-intro/) and [Kraken EEA terms](https://www.kraken.com/legal/eea-terms).
- [Bybit API Terms](https://www.bybit.com/en/help-center/article/API-Terms).
- [Revolut Crypto Exchange Terms](https://www.revolut.com/legal/crypto-exchange-terms/).
- [Banca d'Italia — CASPs](https://www.bancaditalia.it/compiti/vigilanza/accesso-mercato/soggetti-mercato-cripto-attivita/casp/index.html).
- [MiCA Regulation (EU) 2023/1114](https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng).
- [ESMA Q&A on proprietary trading under MiCA](https://www.esma.europa.eu/publications-data/questions-answers/2293).
