const DEFAULT_WEIGHTS = Object.freeze({
  quality: 0.4,
  capability: 0.25,
  privacy: 0.2,
  latency: 0.1,
  cost: 0.05,
});

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`provider_timeout:${timeoutMs}`));
    }, timeoutMs);
  });
  return Promise.race([promiseFactory(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

function validateProvider(provider) {
  if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
    throw new TypeError("provider.id is required");
  }
  if (typeof provider.health !== "function" || typeof provider.complete !== "function") {
    throw new TypeError(`provider ${provider.id} must implement health() and complete()`);
  }
}

function providerScore(provider, request, weights) {
  const profile = provider.profile ?? {};
  const requested = new Set(request.capabilities ?? []);
  const offered = new Set(profile.capabilities ?? []);
  const capability = requested.size === 0
    ? 1
    : [...requested].filter((item) => offered.has(item)).length / requested.size;
  const latency = 1 - clamp((profile.expectedLatencyMs ?? 10_000) / 30_000);
  const cost = 1 - clamp(profile.relativeCost ?? 0.5);
  return (
    clamp(profile.quality ?? 0.5) * weights.quality
    + capability * weights.capability
    + clamp(profile.privacy ?? 0.5) * weights.privacy
    + latency * weights.latency
    + cost * weights.cost
  );
}

function resultQuality(result) {
  if (!result || typeof result.text !== "string" || !result.text.trim()) return 0;
  const selfScore = clamp(result.quality ?? 0.5);
  const provenance = Array.isArray(result.sources) && result.sources.length > 0 ? 1 : 0.4;
  return selfScore * 0.75 + provenance * 0.25;
}

export class MultiAiRouter {
  constructor({ providers, timeoutMs = 15_000, weights = DEFAULT_WEIGHTS } = {}) {
    if (!Array.isArray(providers) || providers.length === 0) throw new TypeError("providers are required");
    providers.forEach(validateProvider);
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
      throw new TypeError("provider ids must be unique");
    }
    this.providers = [...providers];
    this.timeoutMs = timeoutMs;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  async status() {
    return Promise.all(this.providers.map(async (provider) => {
      try {
        const detail = await withTimeout((signal) => provider.health(signal), this.timeoutMs);
        return { id: provider.id, online: detail?.online !== false, detail: detail ?? {} };
      } catch (error) {
        return { id: provider.id, online: false, error: String(error.message ?? error) };
      }
    }));
  }

  async route(request, { mode = "auto", maxProviders = 3, minimumQuality = 0.55 } = {}) {
    if (!request || typeof request.prompt !== "string" || !request.prompt.trim()) {
      throw new TypeError("request.prompt is required");
    }
    const status = await this.status();
    const onlineIds = new Set(status.filter((item) => item.online).map((item) => item.id));
    const ranked = this.providers
      .filter((provider) => onlineIds.has(provider.id))
      .map((provider) => ({ provider, score: providerScore(provider, request, this.weights) }))
      .sort((a, b) => b.score - a.score || a.provider.id.localeCompare(b.provider.id));

    const selected = mode === "fanout" ? ranked : ranked.slice(0, Math.max(1, maxProviders));
    const settled = await Promise.all(selected.map(async ({ provider, score }) => {
      try {
        const result = await withTimeout((signal) => provider.complete(request, signal), this.timeoutMs);
        return { providerId: provider.id, routeScore: score, quality: resultQuality(result), result };
      } catch (error) {
        return { providerId: provider.id, routeScore: score, quality: 0, error: String(error.message ?? error) };
      }
    }));

    const candidates = settled.sort((a, b) => b.quality - a.quality || b.routeScore - a.routeScore);
    const winner = candidates.find((candidate) => candidate.quality >= minimumQuality && candidate.result);
    return {
      mode,
      online: [...onlineIds].sort(),
      attempted: selected.map((item) => item.provider.id),
      selected: winner ?? null,
      candidates,
      accepted: Boolean(winner),
    };
  }
}

