# Pocket AI Router

[![test](https://github.com/PocketHomeLab2026/pocket-ai-router/actions/workflows/test.yml/badge.svg)](https://github.com/PocketHomeLab2026/pocket-ai-router/actions/workflows/test.yml)

A small, dependency-free router for keeping multiple AI providers observable while choosing which providers should receive a task. It supports:

- concurrent health checks for every registered provider;
- automatic ranking by capability, quality, privacy, latency, and relative cost;
- explicit `fanout` mode for calling every healthy provider;
- deterministic result quality gates and complete candidate provenance;
- provider adapters supplied by the application, so this package never handles account credentials.

“Online” and “invoked” are separate states. Auto mode keeps every provider visible but invokes only the best candidates; fanout mode invokes all healthy providers. This prevents accidental paid calls while still allowing an operator to choose full parallel comparison.

The package makes no network requests by itself and does not bypass provider authentication, billing, or terms. An adapter must use each provider's supported API or local inference server.

```js
import { MultiAiRouter } from "pocket-ai-router";

const router = new MultiAiRouter({ providers: [localAdapter, cloudAdapter] });
const result = await router.route(
  { prompt: "Review this patch", capabilities: ["code"] },
  { mode: "auto", maxProviders: 2, minimumQuality: 0.7 },
);
```

License: MIT.
