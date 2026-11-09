import pino, { type LevelWithSilent } from "pino";
import { expect, it } from "vitest";

import { createManagedBinarySession } from "../../../src/composition/binary.js";
import { startMcpTransport } from "../../../src/main/transport.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

const RUNTIME_READY = "MCP analysis runtime ready";

interface StartedTransport {
  readonly records: Record<string, unknown>[];
  readonly factoryCalls: () => number;
  readonly close: () => Promise<void>;
}

/** Start one transport whose SDK creates `servers` discovery instances. */
const startOneTransport = async (
  servers: number,
  options: {
    readonly level: LevelWithSilent;
    readonly transport?: "stdio" | "http";
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
  },
): Promise<StartedTransport> => {
  const lines: string[] = [];
  let factoryCalls = 0;
  const session = createManagedBinarySession();
  const started = await startMcpTransport(
    {
      env: {},
      ...(options.transport === undefined
        ? {}
        : { transport: options.transport }),
      serve: async (factory) => {
        for (let index = 0; index < servers; index += 1) {
          factoryCalls += 1;
          await factory({ era: "modern" });
        }
        return { close: async () => undefined };
      },
      writeStderr: () => undefined,
      setExitCode: () => undefined,
      registerShutdown: () => () => undefined,
    },
    session,
    {
      logger: pino({ level: "silent" }),
      serverLogger: pino(
        { level: options.level },
        {
          write: (line) => lines.push(line),
        },
      ),
      environment: options.environment ?? {},
      delivery: createToolResultDelivery(undefined),
      loadOptionalProviders: async () => ({}),
    },
  );
  if (!started.ok) throw new Error("Expected an admitted transport");
  return {
    records: lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    factoryCalls: () => factoryCalls,
    close: async () => {
      await started.handle.close();
      await started.closeAndroid();
      await started.closeOptionalProviders();
      await session.close();
    },
  };
};

it("announces the analysis runtime once when the SDK creates several servers", async () => {
  const started = await startOneTransport(3, {
    level: "warn",
    // An absolute configuration enables its capability without probing the host.
    environment: { REA_WABT_BIN_DIRECTORY: "/opt/wabt/bin" },
  });
  try {
    expect(started.factoryCalls()).toBe(3);
    expect(started.records).toHaveLength(1);
    const [record] = started.records;
    // Detection comes from the composed capability facts, not a second probe:
    // an absolute configuration makes that capability enabled, an unset one does not.
    const features = record?.optional_features as string[];
    expect(features).toContain("wasmArtifactEnabled");
    expect(features).toEqual(
      expect.not.arrayContaining([
        "signalRecordingEnabled",
        "firmwareInspectionEnabled",
        "javascriptRecoveryEnabled",
        "webModuleResolutionEnabled",
      ]),
    );
    expect(record).toMatchObject({
      msg: RUNTIME_READY,
      transport: "stdio",
      optional_providers: [],
      optional_providers_failed: [],
    });
  } finally {
    await started.close();
  }
});

it("labels the listener transport it was started for", async () => {
  const started = await startOneTransport(1, {
    level: "warn",
    transport: "http",
  });
  try {
    expect(started.records).toEqual([
      expect.objectContaining({
        msg: RUNTIME_READY,
        transport: "streamable-http",
      }),
    ]);
  } finally {
    await started.close();
  }
});

it("writes nothing when the operator selected silent logging", async () => {
  const started = await startOneTransport(1, { level: "silent" });
  try {
    expect(started.records).toEqual([]);
  } finally {
    await started.close();
  }
});

it("reports a provider whose module failed to load alongside the ones that loaded", async () => {
  const lines: string[] = [];
  const session = createManagedBinarySession();
  const started = await startMcpTransport(
    {
      env: {},
      serve: async (factory) => {
        await factory({ era: "modern" });
        return { close: async () => undefined };
      },
      writeStderr: () => undefined,
      setExitCode: () => undefined,
      registerShutdown: () => () => undefined,
    },
    session,
    {
      logger: pino({ level: "silent" }),
      serverLogger: pino(
        { level: "info" },
        {
          write: (line) => lines.push(line),
        },
      ),
      environment: {},
      delivery: createToolResultDelivery(undefined),
      loadOptionalProviders: async () => ({
        optionalProviderLoadFailures: {
          browserScenarioCapture: {
            providerId: "browserScenarioCapture",
            reason: "module unavailable",
          },
        },
      }),
    },
  );
  if (!started.ok) throw new Error("Expected an admitted transport");
  try {
    expect(
      lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) => record.msg === RUNTIME_READY),
    ).toEqual([
      expect.objectContaining({
        optional_providers: [],
        optional_providers_failed: ["browserScenarioCapture"],
      }),
    ]);
  } finally {
    await started.handle.close();
    await started.closeAndroid();
    await started.closeOptionalProviders();
    await session.close();
  }
});
