import test from "node:test";
import assert from "node:assert/strict";
import { MultiAiRouter } from "../src/router.js";

function provider(id, overrides = {}) {
  return {
    id,
    profile: { quality: 0.8, privacy: 0.8, relativeCost: 0.2, expectedLatencyMs: 100, capabilities: ["code"] },
    async health() { return { online: true }; },
    async complete() { return { text: `${id} answer`, quality: 0.8, sources: [`local://${id}`] }; },
    ...overrides,
  };
}

test("fanout keeps every healthy provider online and calls all of them", async () => {
  const calls = [];
  const providers = ["local", "cloud-a", "cloud-b"].map((id) => provider(id, {
    async complete() { calls.push(id); return { text: id, quality: 0.8, sources: [id] }; },
  }));
  const result = await new MultiAiRouter({ providers }).route({ prompt: "review", capabilities: ["code"] }, { mode: "fanout" });
  assert.deepEqual(calls.sort(), ["cloud-a", "cloud-b", "local"]);
  assert.equal(result.accepted, true);
  assert.equal(result.attempted.length, 3);
});

test("offline and low-quality providers cannot become the winner", async () => {
  const router = new MultiAiRouter({ providers: [
    provider("offline", { async health() { return { online: false }; } }),
    provider("weak", { async complete() { return { text: "guess", quality: 0.1 }; } }),
    provider("strong", { async complete() { return { text: "supported", quality: 0.95, sources: ["evidence"] }; } }),
  ] });
  const result = await router.route({ prompt: "test" }, { mode: "fanout", minimumQuality: 0.7 });
  assert.equal(result.selected.providerId, "strong");
  assert.equal(result.attempted.includes("offline"), false);
});

