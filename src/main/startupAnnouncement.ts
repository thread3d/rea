import type { Logger } from "pino";

import type { CapabilityAvailabilityFacts } from "../application/CapabilityAvailability.js";
import type {
  OptionalObservationProviders,
  OptionalProviderLoadFailures,
} from "../application/OptionalObservationProviders.js";
import { PRODUCT_IDENTITY } from "../identity.js";

/** Transport that composed the runtime; the HTTP listener reports its URL separately. */
export type StartupTransport = "stdio" | "streamable-http";

/**
 * Startup records ignore the configured log threshold, as the HTTP URL line
 * does: a client host that starts this server shows nothing else, so an operator
 * cannot otherwise tell a healthy idle server from a misconfigured one. A
 * narrower threshold only hides info lines by accident of configuration, while
 * `REA_LOG_LEVEL=silent` is an explicit instruction to write nothing, and the
 * record is informational rather than the only route to the server.
 */
const announce = (
  logger: Logger,
  record: Record<string, unknown>,
  message: string,
): void => {
  if (logger.level === "silent") return;
  logger
    .child({}, { level: "info" })
    .info({ ...record, version: PRODUCT_IDENTITY.packageVersion }, message);
};

/** Report that the deferred stdio server accepts discovery without a composed runtime. */
export const announceDeferredStdioStartup = (logger: Logger): void => {
  announce(
    logger,
    { transport: "stdio", analysis_runtime: "deferred" },
    "MCP server ready",
  );
};

/** Inputs for the record written once each composed analysis runtime is ready. */
export interface AnalysisRuntimeAnnouncement {
  readonly transport: StartupTransport;
  /** Facts the composition observed; absent when the transport had none to report. */
  readonly availability: CapabilityAvailabilityFacts | undefined;
  readonly providers: OptionalObservationProviders;
  readonly providerLoadFailures: OptionalProviderLoadFailures | undefined;
}

/** Enabled optional-feature flags, in the order the composition declared them. */
const enabledFeatures = (
  availability: CapabilityAvailabilityFacts | undefined,
): string[] =>
  Object.entries(availability?.optionalFeatures ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([feature]) => feature);

/** Provider ids whose adapter constructed, and those whose module failed to load. */
const providerIds = (
  providers: OptionalObservationProviders,
  failures: OptionalProviderLoadFailures | undefined,
): { readonly loaded: string[]; readonly failed: string[] } => ({
  loaded: Object.entries(providers)
    .filter(([, provider]) => provider !== undefined)
    .map(([providerId]) => providerId),
  failed: Object.entries(failures ?? {})
    .filter(([, failure]) => failure !== undefined)
    .map(([providerId]) => providerId),
});

/**
 * Report which optional tools and providers the composed runtime detected.
 * These are the same `optionalFeatures` and provider facts `binary_session`
 * reports as capability availability, not a second interpretation of them.
 */
export const announceAnalysisRuntimeReady = (
  logger: Logger,
  announcement: AnalysisRuntimeAnnouncement,
): void => {
  const providers = providerIds(
    announcement.providers,
    announcement.providerLoadFailures,
  );
  announce(
    logger,
    {
      transport: announcement.transport,
      optional_features: enabledFeatures(announcement.availability),
      optional_providers: providers.loaded,
      optional_providers_failed: providers.failed,
    },
    "MCP analysis runtime ready",
  );
};
