/**
 * Market-data licence gate.
 *
 * Why this file exists: "the endpoint is public" is not a licence. OKX's API
 * Agreement (§9.4, "Public Endpoint Data") states that its restrictions apply
 * equally to public endpoints and that market data may not be displayed or made
 * available to third parties without OKX's prior written consent. A commercial
 * dashboard is exactly that.
 *
 * So venue market data carries an explicit licence status, and anything that
 * would show venue data to a customer must ask this module first. The gate fails
 * closed: unknown venues and unreviewed venues are refused in a customer-facing
 * context, and `prohibited-without-written-consent` is refused outright.
 *
 * This module performs no network access and never records a credential.
 * The authoritative human-readable record is docs/OKX_DATA_LICENSING.md.
 */

export type DataLicenceStatus =
  /** OKX has expressly prohibited display/redistribution without written consent. */
  | "prohibited-without-written-consent"
  /** No licence review has been completed yet: cannot be relied on commercially. */
  | "unreviewed"
  /** A review (and, where required, an agreement) is on file and permits display. */
  | "cleared";

export type MarketDataLicence = {
  venueId: string;
  status: DataLicenceStatus;
  /** Primary source actually read for this entry. Never a guess. */
  sourceUrl: string;
  checkedAt: string;
  /** True when the source states that redistribution needs prior written consent. */
  redistributionRequiresConsent: boolean | null;
  /** True when the source states its terms cover unauthenticated public endpoints. */
  publicEndpointsCovered: boolean | null;
  /** True when the source imposes a visible attribution obligation. */
  attributionRequired: boolean | null;
  notes: string;
};

/**
 * Populated only with facts that were read from the venue's own pages.
 * Every other venue stays `unreviewed` on purpose: silence is not permission.
 */
export const MARKET_DATA_LICENCES: Record<string, MarketDataLicence> = {
  okx: {
    venueId: "okx",
    status: "prohibited-without-written-consent",
    sourceUrl: "https://www.okx.com/en-us/help/okx-api-agreement",
    checkedAt: "2026-11-04",
    redistributionRequiresConsent: true,
    publicEndpointsCovered: true,
    attributionRequired: false,
    notes:
      "OKX API Agreement §9.4: Market Data may be used solely for the user's own personal, non-commercial trading; reselling, redistributing, publishing or displaying it to any third party requires OKX's prior written consent, and the restrictions apply equally to public endpoints. §9.3 also bars offering the API Services as part of a commercial product or SaaS platform, and building derivative commercial infrastructure on the Agent Trade Kit. The open-source code is MIT; the data is not.",
  },
  kraken: {
    venueId: "kraken",
    status: "unreviewed",
    sourceUrl: "https://www.kraken.com/legal",
    checkedAt: "2026-11-04",
    redistributionRequiresConsent: null,
    publicEndpointsCovered: null,
    attributionRequired: null,
    notes:
      "Public ticker/depth endpoints are currently used without credentials. The terms governing commercial display of this data have not been reviewed yet, so the venue is not cleared for a customer-facing commercial product.",
  },
  coinbase: {
    venueId: "coinbase",
    status: "unreviewed",
    sourceUrl: "https://www.coinbase.com/legal/user_agreement",
    checkedAt: "2026-11-04",
    redistributionRequiresConsent: null,
    publicEndpointsCovered: null,
    attributionRequired: null,
    notes:
      "Public Exchange market data is used without credentials. Commercial display terms have not been reviewed yet; no clearance is implied.",
  },
  bybit: {
    venueId: "bybit",
    status: "unreviewed",
    sourceUrl: "https://www.bybit.com/en/help-center/article/Bybit-Terms-of-Service",
    checkedAt: "2026-11-04",
    redistributionRequiresConsent: null,
    publicEndpointsCovered: null,
    attributionRequired: null,
    notes:
      "Access is market-data only. The terms governing commercial display have not been reviewed yet; no clearance is implied.",
  },
};

/**
 * `internal` = the operator's own analysis (single user, not redistributed).
 * `customer-facing` = any customer, trial user or public page sees the data.
 */
export type DeploymentContext = "internal" | "customer-facing";

export type DisplayDecision = {
  allowed: boolean;
  venueId: string;
  context: DeploymentContext;
  status: DataLicenceStatus | "unknown-venue";
  reason: string;
  licence: MarketDataLicence | null;
};

/**
 * Decide whether venue market data may be shown in this context.
 * Fails closed for unknown venues and for every status except `cleared`.
 */
export function marketDataDisplayDecision(venueId: string, context: DeploymentContext): DisplayDecision {
  const licence = MARKET_DATA_LICENCES[venueId] ?? null;

  if (!licence) {
    return {
      allowed: false,
      venueId,
      context,
      status: "unknown-venue",
      reason: `Venue "${venueId}" non censita: nessuna autorizzazione implicita per i suoi dati di mercato.`,
      licence: null,
    };
  }

  if (licence.status === "cleared") {
    return {
      allowed: true,
      venueId,
      context,
      status: licence.status,
      reason: "Licenza di visualizzazione verificata e registrata.",
      licence,
    };
  }

  if (context === "internal") {
    return {
      allowed: true,
      venueId,
      context,
      status: licence.status,
      reason:
        licence.status === "prohibited-without-written-consent"
          ? "Uso interno e non commerciale del solo operatore, come consentito dai termini della venue. Nessuna ridistribuzione."
          : "Uso interno in attesa di revisione della licenza. Nessun dato viene mostrato a clienti.",
      licence,
    };
  }

  return {
    allowed: false,
    venueId,
    context,
    status: licence.status,
    reason:
      licence.status === "prohibited-without-written-consent"
        ? `I termini di ${venueId} richiedono un consenso scritto preventivo per mostrare i dati di mercato a terzi: visualizzazione verso clienti bloccata.`
        : `Licenza di ${venueId} non ancora verificata: visualizzazione verso clienti bloccata finché la revisione non è registrata.`,
    licence,
  };
}

/** Throwing variant for server code paths that must not continue silently. */
export function assertMarketDataDisplayAllowed(venueId: string, context: DeploymentContext): void {
  const decision = marketDataDisplayDecision(venueId, context);
  if (!decision.allowed) {
    throw new Error(`Market data non visualizzabile (${venueId}/${context}): ${decision.reason}`);
  }
}

/** Venues that may be used for analysis regardless of display clearance. */
export function licenceStatusFor(venueId: string): DataLicenceStatus | "unknown-venue" {
  return MARKET_DATA_LICENCES[venueId]?.status ?? "unknown-venue";
}
