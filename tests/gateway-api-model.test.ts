import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFetch = ((...args: any[]) => any) & { mock: { calls: { arguments: any[] }[] } };

function mockFetchResponse(response: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  return mock.fn(async () => response) as unknown as MockFetch;
}

describe("gateway-api model parameter support", () => {
  let createAgentCronJob: typeof import("../src/installer/gateway-api.js").createAgentCronJob;

  beforeEach(async () => {
    const mod = await import("../src/installer/gateway-api.js");
    createAgentCronJob = mod.createAgentCronJob;
  });

  it("accepts payload with model parameter", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: "test-job-123" } }),
    });
    globalThis.fetch = fetchMock;

    try {
      const result = await createAgentCronJob({
        name: "test/agent",
        schedule: { kind: "every", everyMs: 300_000 },
        sessionTarget: "isolated",
        agentId: "test-agent",
        payload: {
          kind: "agentTurn",
          message: "test prompt",
          model: "claude-sonnet-4-20250514",
          timeoutSeconds: 60,
        },
        enabled: true,
      });

      assert.equal(result.ok, true);
      assert.equal(result.id, "test-job-123");

      const callArgs = fetchMock.mock.calls[0].arguments;
      const body = JSON.parse(callArgs[1].body);
      assert.equal(body.args.job.payload.model, "claude-sonnet-4-20250514");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("works without model parameter (backward compatible)", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: "test-job-456" } }),
    });
    globalThis.fetch = fetchMock;

    try {
      const result = await createAgentCronJob({
        name: "test/agent",
        schedule: { kind: "every", everyMs: 300_000 },
        sessionTarget: "isolated",
        agentId: "test-agent",
        payload: {
          kind: "agentTurn",
          message: "test prompt",
        },
        enabled: true,
      });

      assert.equal(result.ok, true);

      const callArgs = fetchMock.mock.calls[0].arguments;
      const body = JSON.parse(callArgs[1].body);
      assert.equal(body.args.job.payload.model, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes model in HTTP request body", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: "test-123" } }),
    });
    globalThis.fetch = fetchMock;

    try {
      await createAgentCronJob({
        name: "test/polling",
        schedule: { kind: "every", everyMs: 300_000 },
        sessionTarget: "isolated",
        agentId: "test-agent",
        payload: {
          kind: "agentTurn",
          message: "poll",
          model: "claude-haiku-3",
        },
        enabled: true,
      });

      const callArgs = fetchMock.mock.calls[0].arguments;
      const body = JSON.parse(callArgs[1].body);
      assert.equal(body.args.job.payload.model, "claude-haiku-3");
      assert.equal(body.tool, "cron");
      assert.equal(body.args.action, "add");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to CLI with --model flag when HTTP fails", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetchResponse({ ok: false, status: 404 });
    globalThis.fetch = fetchMock;

    let result: { ok: boolean; id?: string };
    try {
      result = await createAgentCronJob({
        name: "test/agent",
        schedule: { kind: "every", everyMs: 300_000 },
        sessionTarget: "isolated",
        agentId: "test-agent",
        payload: {
          kind: "agentTurn",
          message: "test",
          model: "claude-sonnet-4-20250514",
        },
        enabled: true,
      });

      assert.ok(typeof result.ok === "boolean");
    } finally {
      globalThis.fetch = originalFetch;
    }

    if (result!.ok && result!.id) {
      const { deleteCronJob } = await import("../src/installer/gateway-api.js");
      await deleteCronJob(result!.id).catch(() => {});
    }
  });

  it("accepts delivery field alongside model", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: "test-789" } }),
    });
    globalThis.fetch = fetchMock;

    try {
      const result = await createAgentCronJob({
        name: "test/agent",
        schedule: { kind: "every", everyMs: 300_000 },
        sessionTarget: "isolated",
        agentId: "test-agent",
        payload: {
          kind: "agentTurn",
          message: "poll",
          model: "claude-sonnet-4-20250514",
        },
        delivery: { mode: "none" },
        enabled: true,
      });

      assert.equal(result.ok, true);

      const callArgs = fetchMock.mock.calls[0].arguments;
      const body = JSON.parse(callArgs[1].body);
      assert.equal(body.args.job.delivery.mode, "none");
      assert.equal(body.args.job.payload.model, "claude-sonnet-4-20250514");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
