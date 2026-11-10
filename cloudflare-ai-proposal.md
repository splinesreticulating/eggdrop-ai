# Explore Cloudflare AI backend for persistent personality and channel memory

## Goal

Give the bot a consistent personality, persistent conversation memory, awareness of running jokes, and enough context to respond naturally while knowing when to stay quiet. Target $0/month under normal personal use through a reusable TypeScript service on Cloudflare.

This is a research proposal. Implementation and deployment require separate review.

## Scope

- Respond when explicitly addressed, with bounded recent channel context.
- Preserve configurable personality instructions and existing commands, summaries, haiku, and schedules.
- Persist conversation history and selectively retain attributed long-term memories, with correction and deletion controls.
- Consider reminders and restrained proactive participation only after the basic experience works well; proactive replies remain disabled by default.
- Keep station metadata and music tools outside the initial scope.
- Keep deployment-specific nicknames, channels, host details, and private personality instructions out of public code and documentation.

## Existing architecture

Eggdrop Tcl -> localhost TypeScript/Express gateway -> OpenRouter. The Tcl adapter already uses asynchronous `http::geturl -command` callbacks. The gateway returns plain text, maintains SQLite/vector memory using local embeddings, and loads configurable personality instructions.

The safest integration point is a configurable Cloudflare provider behind the existing gateway. This preserves the plain-text Eggdrop interface, local memory, and non-AI commands. Direct Tcl access would add TLS, authentication, and JSON parsing work unnecessarily.

The native SQLite/vector implementation is not a drop-in Worker dependency. Start cloud persistence with indexed SQL history, summaries, and curated facts; defer vector infrastructure. Use explicit event IDs rather than relying on ordering between existing `/store` and `/chat` requests.

## Proposed service

- TypeScript Worker with a Workers AI binding.
- `POST /v1/chat`: stateless inference with a profile, bounded message history, request ID, and clamped output limit.
- `POST /v1/agents/chat`: persistent conversations with a profile, conversation ID, event ID, and actor/message data.
- JSON responses containing reply, request ID, model, and available usage data; the gateway preserves its existing plain-text interface to Eggdrop.
- SQLite-backed Durable Objects for history, ordering, idempotency, and strict application budgets.
- Application-specific authentication and conversation namespaces; backend-controlled model selection, instructions, and permissions.

These are custom routes, not built-in Cloudflare APIs. Passive context can initially be a bounded snapshot. Full cloud channel ingestion would require an authenticated batch event endpoint that stores messages without inference.

Example stateless request:

```json
{"request_id":"unique-id","profile":"channel-companion","messages":[{"role":"user","content":"Remember that joke?"}],"max_output_tokens":120}
```

Example stateful request:

```json
{"request_id":"unique-id","profile":"channel-companion","conversation_id":"channel-identifier","message":{"event_id":"unique-event-id","actor_id":"adapter-issued-id","display_name":"listener","text":"Remember that joke?"}}
```

Example response:

```json
{"request_id":"unique-id","reply":"...","model":"@cf/qwen/qwen3-30b-a3b-fp8","usage":{"input_tokens":1800,"output_tokens":45,"inference_calls":1}}
```

Use stable error codes for invalid input, authentication, authorization, conversation conflicts, rate/budget limits, and upstream failures. Quota exhaustion should produce a short, generic user-facing response.

## Agents SDK decision

The Agents SDK is unnecessary for the stateless proof of concept. A plain Durable Object can also implement basic persistent conversations. Evaluate the SDK when scheduling, agent lifecycle, or richer tools justify it; keep the public API independent of that choice. Avoid experimental memory APIs initially.

Existing Eggdrop scheduling can remain in place. Cloud scheduling would need a delivery mechanism, such as a durable outbox polled and acknowledged by the gateway, with expiry and deduplication.

## Model and cost research

Documentation checked October 22, 2026. Revalidate before implementation. Catalog features and pricing have been checked; authenticated access, latency, conversational quality, reasoning-token behavior, and actual usage remain unbenchmarked.

| Model | USD per million input/output tokens | Role |
| --- | --- | --- |
| `@cf/qwen/qwen3-30b-a3b-fp8` | $0.0509 / $0.335 | Proposed primary |
| `@cf/zai-org/glm-4.7-flash` | $0.0605 / $0.40 | Optional fallback/comparison |
| `@cf/openai/gpt-oss-20b` | $0.20 / $0.30 | Alternative with more expensive history |
| `@cf/openai/gpt-oss-120b` | $0.35 / $0.75 | Available, but poor default budget fit |

All four currently list function calling and are not identified as paid-only in the checked restrictions. Recheck eligibility before implementation. Other inexpensive catalog options may merit a short-response benchmark after establishing the baseline.

Workers AI currently includes 10,000 neurons/day shared across models, resetting at midnight UTC. Workers Free rejects inference after exhaustion. Qwen uses 4,625 neurons/million input tokens and 30,475/million output tokens.

Illustrative daily budget: 200 replies totaling 400,000 input tokens, including repeated history, and 20,000 output tokens use about 2,460 neurons. Twenty extra tool-follow-up calls at 3,000 input/200 output tokens each and one 10,000-input/500-output summary bring this to roughly 2,920 neurons. Tools are optional; this allowance illustrates agent overhead. These are calculations, not measured traffic. Reasoning, retries, and compaction must also be counted.

Start with bounded context, short output, at most two inference calls per turn, and a conservative application budget below the platform limit. Model fallback cannot bypass a shared exhausted quota.

Workers Free currently allows 100,000 Worker requests/day and 10 ms CPU/request, excluding network waiting. SQLite Durable Objects have separate free allowances: 100,000 requests/day, 13,000 GB-seconds/day, 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage. Measure actual CPU, duration, and storage; avoid permanent timers and unbounded scans.

Remain on Workers Free for a hard $0 Cloudflare objective. Avoid paid-only models, prepaid billing, and automatic paid-provider fallback. An account already on Workers Paid needs separate consideration because included usage is not a spending ceiling. Existing bot hosting costs remain separate.

## Security, reliability, and behavior

- Authenticate before inference or memory access; keep credentials out of the repository, IRC, and logs.
- Scope profiles and conversations to authenticated applications.
- Treat nicknames as spoofable; privileged operations require adapter-verified identity.
- Apply per-user, per-channel, and global limits. Use Durable Object counters for strict budgets; Cloudflare's rate-limiting binding is approximate.
- Serialize turns explicitly, deduplicate request/event IDs, bound retries, and discard stale replies.
- Separate raw history from curated long-term facts; record provenance, restrict writes, and support correction, deletion, and retention.
- Treat channel text and tool results as untrusted data, never permission to change instructions or configuration.
- Keep proactive participation off initially; later require quiet hours, recent human activity, long cooldowns, daily caps, and bot-loop suppression.
- Sanitize controls and enforce byte-aware IRC line limits, preserving current ASCII behavior.
- Disclose cloud processing and retention; avoid full-prompt logging by default.
- Keep tools allowlisted and bounded; do not expose arbitrary URL fetching or shell execution.

## Phased plan

- [ ] Review and approve scope before implementation.
- [ ] Confirm intended Cloudflare account plan and shared quota usage.
- [ ] Build an authenticated stateless Worker proof of concept; compare Qwen and GLM for short replies, latency, reasoning usage, and CPU.
- [ ] Add a configurable gateway provider; verify existing commands, memory, and asynchronous IRC behavior.
- [ ] Add SQLite persistent conversations with ordering, idempotency, retention, deletion, and budget enforcement.
- [ ] Add curated memory and evaluate selective migration of existing history.
- [ ] Decide whether Agents SDK provides enough benefit for scheduling and richer behavior.
- [ ] Trial optional reminders and proactive replies only after channel behavior and quota consumption are satisfactory.

Rough engineering estimate: 2-4 days for proof of concept and gateway integration, 2-4 additional days for persistence, plus a separate optional autonomy phase. Channel trials and migration may extend this. Dependencies: TypeScript, Wrangler, Cloudflare bindings, and optionally Agents/AI SDK packages. No n8n, extra VM, or unnecessary database/vector services.

## Acceptance criteria

- Contextual replies and consistent personality with memory surviving restarts.
- Existing Eggdrop functionality preserved; no blocking network work in Eggdrop.
- Reusable authenticated API without IRC-specific backend assumptions.
- Bounded context/inference and graceful quota exhaustion, verified on Workers Free.
- Production configuration parity checked before rollout.
- No deployment until implementation review.

## References

- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Qwen3 model](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)
- [GLM model](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [GPT-OSS 20B](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)
- [GPT-OSS 120B](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
- [Agents memory](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/)
- [Agents HTTP](https://developers.cloudflare.com/agents/runtime/communication/http-sse/)
- [Agents scheduling](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/)
- [Rate-limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
