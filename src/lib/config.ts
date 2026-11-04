/**
 * Central configuration and the *verified* reference data used by the engine.
 *
 * Rule of this file: every number that represents a real-world cost carries its
 * source and a confidence flag. Nothing here is a guess presented as a fact.
 */

export const APP_NAME = "GM CRYPTO ARBITRAGE AI";
export const AI_NAME = "GM TRADING INTELLIGENCE";

/** Assets we try to arbitrage (normalised ticker symbols). */
export const ASSETS = ["BTC", "ETH", "SOL", "XRP", "ADA", "LINK", "LTC", "DOT"] as const;
export type Asset = (typeof ASSETS)[number];

/** Quote currencies are distinct assets: USDT is never treated as USD. */
export const QUOTES = ["USD", "EUR", "USDT", "USDC"] as const;
export type Quote = (typeof QUOTES)[number];

export type EngineSettings = {
  /** Minimum NET margin (after every cost) required to call an opportunity executable. */
  minMarginPct: number;
  /** Default trade size expressed in quote currency. */
  notionalQuote: number;
  /** Reject when the depth-weighted fill is worse than the top of book by more than this. */
  maxSlippagePct: number;
  /** Extra conservative haircut applied to expected proceeds. */
  safetyBufferPct: number;
  /**
   * prefunded = both venues already hold inventory, no on-chain transfer needed.
   * transfer  = base asset must be withdrawn from the buy venue, so network fees apply.
   * In transfer mode the engine refuses to emit a signal while network fees are unconfirmed,
   * because an unknown cost can never produce a trustworthy net profit.
   */
  transferMode: "prefunded" | "transfer";
  /** Minimum gross top-of-book spread before we spend rate limit budget on order books. */
  candidateSpreadPct: number;
  /** Books older than this are treated as stale and cannot be executed. */
  maxDataAgeMs: number;
  quote: Quote;
  /** Master switch for the whole signal pipeline. */
  monitoringEnabled: boolean;
  /** Paper trading auto-follows executable signals when true. */
  paperAutoFollow: boolean;
  /** Live trading is hard-locked until an admin grants an explicit authorization. */
  liveTradingEnabled: boolean;
  /** Hard risk limits, enforced by the order router (and shown in the UI). */
  maxOrderQuote: number;
  maxDailyLossQuote: number;
  maxOrdersPerHour: number;
};

export const DEFAULT_SETTINGS: EngineSettings = {
  minMarginPct: 0.35,
  notionalQuote: 500,
  maxSlippagePct: 0.6,
  safetyBufferPct: 0.05,
  transferMode: "prefunded",
  candidateSpreadPct: 0.1,
  maxDataAgeMs: 20000,
  quote: "USD",
  monitoringEnabled: true,
  paperAutoFollow: false,
  liveTradingEnabled: false,
  maxOrderQuote: 1000,
  maxDailyLossQuote: 50,
  maxOrdersPerHour: 10,
};

export type ExchangeFee = {
  makerPct: number;
  takerPct: number;
  /** Where the number comes from. Shown in the UI next to every fee. */
  source: string;
  /** verified = read from the operator's official page; unverified = secondary source. */
  confidence: "verified" | "unverified" | "user";
  checkedAt: string;
  note?: string;
};

/**
 * Tier-1 (lowest volume) spot taker/maker fees.
 * Kraken: 0.40% maker / 0.80% taker — https://www.kraken.com/features/fee-schedule (read 2026-11-01).
 * Coinbase Advanced: US Intro tier 0.50% maker / 0.90% taker; EU/UK entry tier 0.25% / 0.50%.
 *   The official table returned 403 to automated reads, so this is flagged `unverified`
 *   and every user is expected to confirm it against their own account tier.
 */
export const REFERENCE_FEES: Record<string, ExchangeFee> = {
  kraken: {
    makerPct: 0.4,
    takerPct: 0.8,
    source: "https://www.kraken.com/features/fee-schedule",
    confidence: "verified",
    checkedAt: "2026-11-01",
    note: "Tier 1 standard spot schedule (best of 30d volume or assets on platform).",
  },
  coinbase: {
    makerPct: 0.5,
    takerPct: 0.9,
    source: "https://www.coinbase.com/advanced-fees",
    confidence: "unverified",
    checkedAt: "2026-11-01",
    note: "US Intro tier. EU/UK intro tier is 0.25% maker / 0.50% taker. Confirm your own tier before trusting signals.",
  },
};

export type VenueStatus =
  | "live-public" // public market data read successfully in this deployment
  | "public-api" // documented public API, key not required for market data
  | "partner-only" // API exists but requires a commercial/partner agreement
  | "no-public-api"; // no public trading API at all

export type VenueKind = "exchange" | "wallet" | "payments" | "voucher";

export type Venue = {
  id: string;
  name: string;
  kind: VenueKind;
  logo: string;
  status: VenueStatus;
  /** Can we pull order books / tickers today, with no credentials? */
  publicMarketData: boolean;
  /** Can the operator read account balances with a (read-only) API key? */
  balanceReadable: boolean;
  /** Is order placement technically possible through the official API? */
  orderPlacement: boolean;
  /** Does the official API allow withdrawals? (We never request that permission.) */
  withdrawalSupported: boolean | null;
  apiDocs: string;
  fee: ExchangeFee | null;
  rateLimitNote: string;
  notes: string;
  verifiedAt: string;
};

/**
 * Integration catalogue. Status reflects what was actually checked against the
 * operators' own documentation on 2026-11-01 — not marketing claims.
 */
export const VENUES: Venue[] = [
  {
    id: "kraken",
    name: "Kraken",
    kind: "exchange",
    logo: "kraken",
    status: "live-public",
    publicMarketData: true,
    balanceReadable: true,
    orderPlacement: true,
    withdrawalSupported: true,
    apiDocs: "https://docs.kraken.com/exchange/api-reference/spot-rest",
    fee: REFERENCE_FEES.kraken,
    rateLimitNote:
      "Public REST endpoints are IP-limited: ~1 call/s stays inside the published limits (support.kraken.com). Private tiers start at 15 calls with 0.33/s decay.",
    notes:
      "Ticker and Depth are public and unauthenticated. Private endpoints need HMAC-signed keys; this build never stores withdrawal-capable keys.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "coinbase",
    name: "Coinbase Advanced",
    kind: "exchange",
    logo: "coinbase",
    status: "live-public",
    publicMarketData: true,
    balanceReadable: true,
    orderPlacement: true,
    withdrawalSupported: true,
    apiDocs: "https://docs.cdp.coinbase.com/exchange/rest-api/requests",
    fee: REFERENCE_FEES.coinbase,
    rateLimitNote:
      "Public REST: 10 requests/second per IP with bursts to 15 (docs.cdp.coinbase.com). Public responses are cached 1s.",
    notes:
      "Public Exchange market data (products / book / ticker) needs no credentials. Advanced Trade also offers a public WebSocket without a JWT.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "bybit",
    name: "Bybit Spot",
    kind: "exchange",
    logo: "bybit",
    status: "public-api",
    publicMarketData: true,
    balanceReadable: false,
    orderPlacement: false,
    withdrawalSupported: null,
    apiDocs: "https://bybit-exchange.github.io/docs/v5/market",
    fee: null,
    rateLimitNote: "Public V5 REST market-data requests are throttled by the adapter; actual limits and availability depend on the API host and account region.",
    notes: "Spot instruments, tickers and order books only. EEA deployments default to api.bybit.eu; verify regional eligibility and the currently supported host before production use. No private account endpoints or order placement are implemented.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "phantom",
    name: "Phantom",
    kind: "wallet",
    logo: "phantom",
    status: "public-api",
    publicMarketData: false,
    balanceReadable: true,
    orderPlacement: false,
    withdrawalSupported: null,
    apiDocs: "https://docs.phantom.com/introduction",
    fee: null,
    rateLimitNote: "Wallet provider calls are rate-limited per dapp domain by the wallet itself.",
    notes:
      "Self-custody wallet: there is no hosted trading API for an account. Balances require the user's own approval through Phantom Connect / injected provider. New Phantom Portal signups are currently paused.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "wirex",
    name: "Wirex",
    kind: "wallet",
    logo: "wirex",
    status: "partner-only",
    publicMarketData: false,
    balanceReadable: false,
    orderPlacement: false,
    withdrawalSupported: null,
    apiDocs: "https://partner.wirexpaychain.com/docs/what-is-the-wirex-pay-partner-api",
    fee: null,
    rateLimitNote: "Partner JWT; quotas are contractual.",
    notes:
      "No self-serve API for a personal Wirex account. Wirex Pay Partner API and Open Banking APIs require commercial/regulatory onboarding: no trading endpoints.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "speed",
    name: "Speed",
    kind: "payments",
    logo: "speed",
    status: "public-api",
    publicMarketData: false,
    balanceReadable: true,
    orderPlacement: false,
    withdrawalSupported: null,
    apiDocs: "https://apidocs.tryspeed.com/reference/introduction",
    fee: null,
    rateLimitNote: "API-key authenticated (HTTP Basic); restricted read-only keys available.",
    notes:
      "Merchant/payment API only (checkouts, payouts, balance). It is a Lightning/stablecoin payment processor, not an order-book venue: 1% external payment fee, 0.2% stablecoin payouts.",
    verifiedAt: "2026-11-01",
  },
  {
    id: "crypto-voucher",
    name: "Crypto Voucher",
    kind: "voucher",
    logo: "cryptovoucher",
    status: "partner-only",
    publicMarketData: false,
    balanceReadable: false,
    orderPlacement: false,
    withdrawalSupported: null,
    apiDocs: "https://cryptovoucher.io/become-a-partner",
    fee: null,
    rateLimitNote: "Merchant API credentials issued after a partnership agreement.",
    notes:
      "Voucher (gift-code) resale. No general public API and no exchange book: the partner API only creates/buys vouchers. Cannot be used as an arbitrage venue.",
    verifiedAt: "2026-11-01",
  },
];

export const VENUE_MAP: Record<string, Venue> = Object.fromEntries(VENUES.map((v) => [v.id, v]));

/** Venues the engine can actually read books from, with no credentials. */
export const ARBITRAGE_VENUES = VENUES.filter((v) => v.publicMarketData && v.kind === "exchange").map((v) => v.id);

/**
 * Withdrawal / network fees per asset.
 * Deliberately NOT pre-filled: an unconfirmed network cost must block a transfer-mode
 * signal instead of silently becoming zero. Operators enter real values in Settings.
 */
export const NETWORK_FEES: Record<string, { feeInAsset: number | null; source: string }> = Object.fromEntries(
  ASSETS.map((a) => [a, { feeInAsset: null, source: "not configured" }]),
);

export const PLANS = [
  {
    id: "free",
    name: "FREE",
    priceCents: 0,
    currency: "EUR",
    interval: "month",
    tagline: "Monitoraggio limitato e paper trading",
    limits: { venues: 2, pairs: 3, scansPerHour: 30, historyDays: 7, apiKeys: 0 },
    features: [
      "Dashboard e prezzi in tempo reale (dati pubblici)",
      "2 venue, 3 coppie monitorate",
      "Paper trading illimitato",
      "30 scansioni/ora",
      "Storico 7 giorni",
    ],
  },
  {
    id: "pro",
    name: "PRO",
    priceCents: 2900,
    currency: "EUR",
    interval: "month",
    tagline: "Monitoraggio avanzato, più exchange e notifiche",
    limits: { venues: 6, pairs: 12, scansPerHour: 240, historyDays: 90, apiKeys: 3 },
    features: [
      "Tutti gli exchange integrati",
      "12 coppie + soglie personalizzate",
      "Notifiche e alert di margine",
      "Storico 90 giorni",
      "Export CSV",
    ],
  },
  {
    id: "premium",
    name: "PREMIUM",
    priceCents: 7900,
    currency: "EUR",
    interval: "month",
    tagline: "Analisi avanzate, report e strumenti professionali",
    limits: { venues: 12, pairs: 40, scansPerHour: 1200, historyDays: 365, apiKeys: 10 },
    features: [
      "Tutto PRO",
      "GM Trading Intelligence avanzata + report PDF/CSV",
      "White-label (logo, nome, colore)",
      "Storico 12 mesi e audit completo",
      "Soglie multiple e risk engine configurabile",
    ],
  },
] as const;

/**
 * Ordered catalogue of referral categories used by the Affiliate Center.
 *
 * The order of this array IS the display order: offers are grouped by category,
 * then sorted by platform inside each group. Add a new category here before
 * saving an offer that needs it — the admin API only accepts these values, so
 * the page can never fall into an unsorted pile of free-text labels.
 */
export const REFERRAL_CATEGORIES = [
  "Finanza / Conto personale",
  "Finanza / Exchange",
  "Finanza / Pagamenti e voucher",
  "Wallet / Conto personale",
  "Business / Conto aziendale",
  "Digitale / Strumenti",
] as const;

/** Bucket used for rows created before categories existed (or with none set). */
export const REFERRAL_UNCLASSIFIED = "Altro / Non classificato";

/**
 * Baseline referral catalogue seeded on first boot (INSERT OR IGNORE only, so a
 * running database is never overwritten). Links supplied by the owner are NOT
 * hard-coded here: they are added at runtime from the admin panel, which is what
 * lets the Affiliate Center grow without a redeploy. New baseline entries still
 * need a category from REFERRAL_CATEGORIES so the page can order them.
 */
export const REFERRALS = [
  {
    id: "phantom",
    platform: "Phantom",
    category: "Wallet / Conto personale",
    name: "Phantom Wallet",
    url: "https://phantom.com/r/OmegaGold",
    tagline: "Wallet self-custody Solana / EVM / Bitcoin",
    description:
      "Wallet non-custodial per Solana, Ethereum e Bitcoin. Serve per detenere gli asset e firmare le transazioni: non è un exchange e non espone un order book.",
    howItWorks:
      "Installi l'estensione o l'app, crei un wallet e annoti la seed phrase su carta (mai condividerla, mai digitarla in questa piattaforma). Il wallet firma le operazioni; i prezzi e l'arbitraggio restano su GM CRYPTO ARBITRAGE AI.",
    tutorial: [
      "Apri il link referral e installa l'estensione o l'app Phantom.",
      "Crea un nuovo wallet e salva la recovery phrase offline.",
      "Copia il tuo indirizzo pubblico (mai la seed phrase) e registralo in Wallets.",
      "Collega il wallet solo tramite signature request quando serve.",
    ],
    terms: "Programma referral pubblico Phantom; condizioni e requisiti di idoneità sono definiti da Phantom e possono cambiare.",
    rewards: "Non verificato: la piattaforma non dichiara importi finché non sono confermati sul sito ufficiale.",
    verified: false,
    affiliateConfirmed: false,
    accent: "violet",
  },
  {
    id: "wirex",
    platform: "Wirex",
    category: "Finanza / Conto personale",
    name: "Wirex",
    url: "https://wirex.onelink.me/gi8H/referral?deep_link_sub1=referral_code:0x780D97Eabebb3934eBA4bb21E31eCD311a5bA590",
    tagline: "Conto crypto + carta",
    description:
      "App che combina conto multi-valuta, carta di pagamento e acquisto crypto. Utile per movimentare stablecoin e prelevare su carta, non come venue di arbitraggio.",
    howItWorks:
      "Registrazione con il link referral, verifica KYC, emissione carta. I saldi restano nel conto Wirex: nessuna API self-service per leggere o tradare il conto personale.",
    tutorial: [
      "Apri il link referral Wirex dal pulsante qui sotto.",
      "Completa la registrazione e la verifica KYC richiesta.",
      "Ordina la carta e annota le commissioni del tuo piano.",
      "Inserisci il conto come voce manuale in Wallets (nessuna API pubblica).",
    ],
    terms: "Programma referral Wirex; i premi dipendono dal paese e dal piano e sono definiti da Wirex.",
    rewards: "Non verificato in questa build.",
    verified: false,
    affiliateConfirmed: false,
    accent: "blue",
  },
  {
    id: "speed",
    platform: "Speed",
    category: "Finanza / Pagamenti e voucher",
    name: "Speed",
    url: "https://links.speed.app/referral?referral_code=LZCSNA",
    tagline: "Wallet + pagamenti Lightning",
    description:
      "App di pagamento su Lightning e stablecoin. Ha una API merchant documentata (checkout, payout, saldo) ma nessun order book: non è utilizzabile come venue di arbitraggio.",
    howItWorks:
      "Registrazione con codice referral, poi wallet per pagamenti immediati. Per l'integrazione merchant servono API key (sk_live_/rk_live_) create in Developers → API Keys.",
    tutorial: [
      "Apri il link referral Speed.",
      "Registrati e completa la verifica.",
      "Per la parte merchant crea una restricted key in sola lettura.",
      "Non inserire mai la seed phrase: solo API key con privilegi minimi.",
    ],
    terms: "Programma referral Speed; condizioni definite da Speed.",
    rewards: "Non verificato: nessun importo dichiarato.",
    verified: false,
    affiliateConfirmed: false,
    accent: "green",
  },
  {
    id: "kraken",
    platform: "Kraken",
    category: "Finanza / Exchange",
    name: "Kraken Pro",
    url: "https://invite.kraken.com/JDNW/b0zu2lzt",
    tagline: "Exchange con API pubblica e privata",
    description:
      "Exchange spot con API ufficiali REST e WebSocket. In questa build è una delle due venue realmente collegate: ticker e order book sono letti dalle API pubbliche, senza credenziali.",
    howItWorks:
      "Registrati con il link, verifica l'identità. Per i saldi serve una API key con solo permessi di lettura, senza permesso di prelievo. Nessuna chiave privata viene richiesta.",
    tutorial: [
      "Apri il link invito Kraken e crea l'account.",
      "Completa la verifica (KYC).",
      "In Impostazioni → API crea una key con Query Funds soltanto.",
      "Inseriscila in Exchanges: viene cifrata AES-256-GCM e non è mai mostrata in chiaro.",
    ],
    terms: "Invite Kraken: eventuali bonus sono stabiliti da Kraken.",
    rewards: "Non verificato.",
    verified: true,
    affiliateConfirmed: false,
    accent: "purple",
  },
  {
    id: "coinbase",
    platform: "Coinbase",
    category: "Finanza / Exchange",
    name: "Coinbase Advanced",
    url: "https://coinbase.com/join/UNHURJ3?src=android-link",
    tagline: "Exchange con API Advanced Trade",
    description:
      "Exchange con API Advanced Trade: market data pubblici senza autenticazione, order book completo e API privata per saldi e ordini. Seconda venue realmente collegata in questa build.",
    howItWorks:
      "Registrati con il link, completa il KYC, poi crea una API key con permessi view-only per la lettura saldi. Le fee dipendono dal tuo tier: verificale e inseriscile in Fees.",
    tutorial: [
      "Apri il link Coinbase e crea l'account.",
      "Completa la verifica e imposta il metodo di pagamento.",
      "Crea una API key Advanced Trade in sola lettura.",
      "Registra la key in Exchanges e imposta il tuo tier fee reale.",
    ],
    terms: "Invite Coinbase; condizioni stabilite da Coinbase.",
    rewards: "Non verificato.",
    verified: true,
    affiliateConfirmed: false,
    accent: "blue",
  },
  {
    id: "crypto-voucher",
    platform: "Crypto Voucher",
    category: "Finanza / Pagamenti e voucher",
    name: "Crypto Voucher",
    url: "https://cryptovoucher.io?refm=ltcstaking",
    tagline: "Voucher crypto prepagati",
    description:
      "Vendita di voucher crypto (codici riscattabili on-chain). Non è un exchange e non ha un'API pubblica generale: solo un'API partner per la creazione di voucher.",
    howItWorks:
      "Acquisti un voucher e lo riscatti a un indirizzo. Serve come canale di ingresso/uscita, non come venue di prezzo.",
    tutorial: [
      "Apri il link voucher.",
      "Scegli taglio e asset.",
      "Riscatta il codice a un indirizzo che controlli.",
      "Le commissioni di riscatto dipendono dalla rete.",
    ],
    terms: "Le condizioni sono del merchant Crypto Voucher; l'API è riservata a partner con accordo.",
    rewards: "Non verificato.",
    verified: false,
    affiliateConfirmed: false,
    accent: "gold",
  },
  {
    id: "freebuff",
    platform: "Freebuff",
    category: "Digitale / Strumenti",
    name: "Freebuff",
    url: "https://freebuff.com/?ref=ref-0c66b73f-1c56-4497-b17a-b80ad4a84934",
    tagline: "Ambiente di sviluppo AI (strumento interno)",
    description:
      "Piattaforma usata per sviluppare questo software. Non è un exchange né un servizio finanziario e non va rivenduta: il prodotto commerciale è il software GM, con infrastruttura propria.",
    howItWorks:
      "Strumento di sviluppo. Nel prodotto finale resta fuori dalla user journey dei clienti.",
    tutorial: [
      "Apri il link Freebuff (uso interno dello sviluppatore).",
      "Usa la piattaforma per evolvere il codice.",
      "Non inserire chiavi API dei clienti in strumenti esterni.",
    ],
    terms: "Licenza Freebuff: il software commercializzato è GM CRYPTO ARBITRAGE AI, non l'accesso a Freebuff o ai suoi modelli.",
    rewards: "Non applicabile.",
    verified: true,
    affiliateConfirmed: false,
    accent: "gold",
  },
] as const;

export const COOKIE_NAME = "gm_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Approved origins for public market-data adapters (SSRF guard).
 * Enforced by assertAllowedVenueBase() in src/lib/venues/hosts.ts.
 * Only unauthenticated public market-data hosts belong here: authenticated APIs such as
 * the Coinbase brokerage host (api.coinbase.com, HTTP 401 without credentials) are not
 * public market data and must not be added to this list.
 */
export const ALLOWED_VENUE_HOSTS = ["api.kraken.com", "api.exchange.coinbase.com", "api.bybit.eu", "api.bytick.eu", "api-testnet.bybit.eu", "api.bybit.com", "api.bytick.com", "api-testnet.bybit.com"];
