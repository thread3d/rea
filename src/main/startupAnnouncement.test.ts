import pino, { type LevelWithSilent } from "pino";
import { describe, expect, it } from "vitest";

import { PRODUCT_IDENTITY } from "../identity.js";
import {
  announceAnalysisRuntimeReady,
  announceDeferredStdioStartup,
} from "./startupAnnouncement.js";

/** Emit through a logger at `level` and parse the JSON records it wrote. */
const announceAt = (
  level: LevelWithSilent,
  announce: (logger: pino.Logger) => void,
): Record<string, unknown>[] => {
  const lines: string[] = [];
  announce(pino({ level }, { write: (line) => lines.push(line) }));
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe("MCP startup announcements", () => {
  it("announces a deferred stdio server above a threshold that hides info", () => {
    expect(
      announceAt("warn", (logger) => {
        announceDeferredStdioStartup(logger);
      }),
    ).toEqual([
      expect.objectContaining({
        msg: "MCP server ready",
        transport: "stdio",
        analysis_runtime: "deferred",
        version: PRODUCT_IDENTITY.packageVersion,
      }),
    ]);
  });

  it("announces detection above a threshold that hides info lines", () => {
    expect(
      announceAt("error", (logger) => {
        announceAnalysisRuntimeReady(logger, {
          transport: "streamable-http",
          availability: undefined,
          providers: {},
          providerLoadFailures: undefined,
        });
      }),
    ).toEqual([
      expect.objectContaining({
        msg: "MCP analysis runtime ready",
        transport: "streamable-http",
      }),
    ]);
  });

  it("writes nothing when the operator selected silent logging", () => {
    expect(
      announceAt("silent", (logger) => {
        announceDeferredStdioStartup(logger);
        announceAnalysisRuntimeReady(logger, {
          transport: "stdio",
          availability: undefined,
          providers: {},
          providerLoadFailures: undefined,
        });
      }),
    ).toEqual([]);
  });

  it("reports the enabled optional features and the providers that loaded", () => {
    const [record] = announceAt("info", (logger) => {
      announceAnalysisRuntimeReady(logger, {
        transport: "stdio",
        availability: {
          optionalFeatures: {
            packetCaptureEnabled: true,
            signalRecordingEnabled: false,
            wasmArtifactEnabled: true,
          },
        },
        providers: { browserObservation: {} as never },
        providerLoadFailures: {
          browserScenarioCapture: {
            providerId: "browserScenarioCapture",
            reason: "module unavailable",
          },
        },
      });
    });
    // Disabled and absent facts stay out of the record rather than being
    // reported as detected.
    expect(record).toMatchObject({
      msg: "MCP analysis runtime ready",
      transport: "stdio",
      optional_features: ["packetCaptureEnabled", "wasmArtifactEnabled"],
      optional_providers: ["browserObservation"],
      optional_providers_failed: ["browserScenarioCapture"],
    });
  });

  it("reports empty detection lists when the composition observed nothing", () => {
    const [record] = announceAt("info", (logger) => {
      announceAnalysisRuntimeReady(logger, {
        transport: "stdio",
        availability: {},
        providers: {},
        providerLoadFailures: {},
      });
    });
    expect(record).toMatchObject({
      optional_features: [],
      optional_providers: [],
      optional_providers_failed: [],
    });
  });
});
