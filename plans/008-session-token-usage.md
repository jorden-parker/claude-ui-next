# Plan 008: Show token usage and turn timing for every session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b573de5..HEAD -- lib/claude/data.ts 'app/p/[project]/session/[id]/page.tsx' 'app/p/[project]/page.tsx'`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (read-only feature; the only shared code touched is the transcript parser)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `b573de5` (branch `advisor/007-tool-budget-presets`, 2 commits ahead of `main`), 2026-09-07

## Why this matters

This app exists to make `~/.claude` inspectable, and its newest page (`/global/tools`, plan 007)
is entirely about context-token cost — yet the app never shows a single real token number. Every
assistant entry in every session transcript carries a `message.usage` object with exact input,
cache-write, cache-read and output token counts, and every turn ends with a `system` entry
recording how long the turn took. Today the parser throws both away (`skippedLines++`). Surfacing
them answers "how expensive was this session, and where did the tokens go?" with real data, not
estimates — and gives the project page a way to rank sessions by cost.

## Current state

### Data on disk (verified 2026-09-07 against 192 transcripts, 166 MB)

- **Every** assistant entry has `message.usage` (6083 of 6083 lines). The common shape:

  ```json
  "usage":{"input_tokens":2,"cache_creation_input_tokens":17829,"cache_read_input_tokens":26436,"output_tokens":159,"output_tokens_details":{"thinking_tokens":40}}
  ```

  Rarer variants add `server_tool_use`, `service_tier`, `cache_creation.ephemeral_*`, `iterations`,
  or have `output_tokens_details: null`. Only the four `*_tokens` integers matter here; treat every
  other key as optional and ignore it.
- **Critical**: a streamed assistant message is written as **one JSONL line per content block**,
  and every line repeats the **same** `message.id` and the **same** `usage`. In one session, 6
  assistant lines share 4 distinct `message.id` values; across all projects 6083 lines share 3035
  ids. Summing usage per line double-counts. **Sum once per distinct `message.id`.**
- Turn timing lives in `system` entries:

  ```json
  {"type":"system","subtype":"turn_duration","durationMs":147534,"messageCount":108,"timestamp":"2026-09-03T15:09:47.488Z", ...}
  ```

  396 such entries exist. Other `system` subtypes seen (`stop_hook_summary`, `local_command`,
  `away_summary`, `informational`, `scheduled_task_fire`, `agents_killed`) must stay ignored.

### Code

- `lib/claude/data.ts` — all filesystem access. Relevant parts:
  - `SessionMetadata` (lines 44–54):

    ```ts
    export interface SessionMetadata {
      model: string | null;
      version: string | null;
      gitBranch: string | null;
      /** ISO 8601 strings from the first/last timestamped entries. */
      startedAt: string | null;
      endedAt: string | null;
      userMessages: number;
      assistantMessages: number;
      toolUses: number;
    }
    ```

  - `readTranscript(slug, id)` (line 345 onward) parses the whole file line by line. The
    per-entry dispatch ends with a catch-all that discards `system` entries:

    ```ts
        } else if (entry.type === 'assistant') {
          const content = entry.message?.content;
          if (!Array.isArray(content)) {
            skippedLines++;
            continue;
          }
          for (const item of content) {
            ...
          }
        } else {
          skippedLines++;
        }
      }
    ```

    and the metadata counters are filled after the loop (lines ~454–458):

    ```ts
      for (const b of blocks) {
        if (b.kind === 'text' && b.role === 'user') meta.userMessages++;
        else if (b.kind === 'text' && b.role === 'assistant') meta.assistantMessages++;
        else if (b.kind === 'tool-use') meta.toolUses++;
      }

      return { blocks, meta, totalLines: lines.length, skippedLines, truncated };
    ```

    Note `MAX_BLOCKS = 2000` (line 109): the loop `break`s when the block cap is hit, so anything
    accumulated inside the loop stops at that point. That is acceptable — the page already shows a
    "Long session" notice when `truncated` is true; extend that notice to say totals are partial.
  - `listToolUsage()` (line ~700) is the exemplar for an **mtime-keyed per-file cache** with a cheap
    string prefilter before `JSON.parse`. Copy that pattern for the per-project stats scan:

    ```ts
    const toolUsageCache = new Map<string, { mtimeMs: number; counts: Map<string, number>; lastUsed: Map<string, string> }>();

    function scanToolUses(raw: string) {
      ...
      for (const line of raw.split('\n')) {
        // Cheap pre-filter: only a fraction of transcript lines carry tool calls.
        if (!line.includes('"tool_use"')) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        ...
    ```

  - `sessionFiles(slug)` (private) returns `{ name, mtime, size }[]` newest first — reuse it.
- `app/p/[project]/session/[id]/page.tsx` — session page. The metadata header (lines 31–41):

  ```tsx
  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border bg-fd-card px-3 py-2 font-mono text-xs text-fd-muted-foreground">
    {transcript.meta.model && <span>{transcript.meta.model}</span>}
    {transcript.meta.version && <span>v{transcript.meta.version}</span>}
    {transcript.meta.gitBranch && <span>⎇ {transcript.meta.gitBranch}</span>}
    {formatDuration(transcript.meta.startedAt, transcript.meta.endedAt) && (
      <span>{formatDuration(transcript.meta.startedAt, transcript.meta.endedAt)}</span>
    )}
    <span>
      {transcript.meta.userMessages} user · {transcript.meta.assistantMessages} assistant ·{' '}
      {transcript.meta.toolUses} tools
    </span>
  </div>
  ```

- `app/p/[project]/page.tsx` — project overview; lists sessions as plain `<li>` links:

  ```tsx
  <h2>Sessions ({sessions.length})</h2>
  <ul>
    {sessions.map((s) => (
      <li key={s.id}>
        <Link href={`/p/${project}/session/${s.id}`}>
          {s.mtime.toLocaleString()} · {s.firstPrompt?.slice(0, 80) ?? s.id}
        </Link>
      </li>
    ))}
  </ul>
  ```

### Conventions to match

- All filesystem reads live in `lib/claude/data.ts`; pages never import `node:fs`.
- Every reader wraps I/O in `try/catch` and returns `null` / `[]` on failure; never throws to a page.
- Pages are async server components with `export const dynamic = 'force-dynamic'`, built from
  `DocsPage`, `DocsTitle`, `DocsDescription`, `DocsBody` (`fumadocs-ui/layouts/docs/page`).
- Styling: Tailwind v4 with Fumadocs `fd-*` tokens (`text-fd-muted-foreground`, `bg-fd-card`,
  `bg-fd-secondary`). No new CSS files.
- No test framework and no linter exist. `bun run types:check` is the only gate.

## Commands you will need

| Purpose   | Command                                      | Expected on success |
|-----------|----------------------------------------------|---------------------|
| Install   | `bun install`                                | exit 0              |
| Typecheck | `bun run types:check`                        | exit 0, no errors   |
| Dev server| `bun dev` (background), then `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` | `200` |

Pick a real session to test against:

```bash
S=$(ls -S ~/.claude/projects/-Users-jorden-src-claude-ui-next/*.jsonl | head -1); echo $S
```

## Scope

**In scope** (the only files you should modify):
- `lib/claude/data.ts`
- `app/p/[project]/session/[id]/page.tsx`
- `app/p/[project]/page.tsx`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `components/transcript.tsx` — block rendering is unchanged by this plan.
- `lib/claude/tools.ts`, `lib/claude/settings-writer.ts`, `app/global/tools/*` — the tool-budget
  feature shows call counts, not tokens; do not merge the two.
- Any dollar-cost estimate. There is no pricing table in this repo and model prices change;
  show tokens only.
- Subagent transcripts under `<session-id>/subagents/` — plan 009 covers those.

## Git workflow

- Branch: `advisor/008-session-token-usage` from the current branch.
- One commit per step or logical unit. Subject line: short imperative, no prefix, e.g.
  `Transcript: timestamps, user markdown, session metadata header`; body explains what and why.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `TokenUsage` and turn timing to `SessionMetadata`

In `lib/claude/data.ts`, directly above `SessionMetadata`, add:

```ts
export interface TokenUsage {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  /** Distinct assistant messages (by message.id) that contributed to the totals. */
  messages: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, messages: 0 };
}
```

Extend `SessionMetadata` with:

```ts
  /** Summed once per distinct assistant message.id. */
  tokens: TokenUsage;
  /** Count and total of `system`/`turn_duration` entries. */
  turns: number;
  turnDurationMs: number;
```

Initialize them in `readTranscript`'s `meta` literal (`tokens: emptyUsage(), turns: 0, turnDurationMs: 0`).

Add a private helper next to `extractText`:

```ts
function readUsage(usage: unknown): TokenUsage | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    input: n(u.input_tokens),
    cacheCreation: n(u.cache_creation_input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    output: n(u.output_tokens),
    messages: 1,
  };
}

function addUsage(into: TokenUsage, u: TokenUsage): void {
  into.input += u.input;
  into.cacheCreation += u.cacheCreation;
  into.cacheRead += u.cacheRead;
  into.output += u.output;
  into.messages += u.messages;
}
```

**Verify**: `bun run types:check` → errors only about `meta` missing the new fields until Step 2 finishes; proceed.

### Step 2: Accumulate usage (deduplicated) and turn durations inside `readTranscript`

Declare `const seenMessageIds = new Set<string>();` before the `for (const line of lines)` loop.

In the `entry.type === 'assistant'` branch, **before** the `if (!Array.isArray(content))` check, add:

```ts
      const messageId = typeof entry.message?.id === 'string' ? entry.message.id : null;
      if (messageId !== null && !seenMessageIds.has(messageId)) {
        seenMessageIds.add(messageId);
        const usage = readUsage(entry.message?.usage);
        if (usage) addUsage(meta.tokens, usage);
      }
```

Replace the final catch-all:

```ts
    } else {
      skippedLines++;
    }
```

with:

```ts
    } else if (entry.type === 'system' && entry.subtype === 'turn_duration') {
      meta.turns++;
      if (typeof entry.durationMs === 'number') meta.turnDurationMs += entry.durationMs;
    } else {
      skippedLines++;
    }
```

Do not change the truncation logic. Do not touch the `for (const b of blocks)` counters.

**Verify**:
- `bun run types:check` → exit 0.
- Cross-check the dedup against the raw file (`$S` from "Commands"):

  ```bash
  echo "distinct ids: $(grep '"type":"assistant"' $S | grep -o '"id":"msg_[^"]*"' | sort -u | wc -l)"
  echo "turns: $(grep -c '"subtype":"turn_duration"' $S)"
  ```

  Then, in a throwaway script (do not commit it):

  ```bash
  cat > /tmp/check-usage.ts <<'TS'
  import { readTranscript } from './lib/claude/data';
  const [slug, id] = process.argv.slice(2);
  readTranscript(slug, id).then((t) => console.log(t?.meta.tokens, t?.meta.turns, t?.meta.turnDurationMs));
  TS
  bun run /tmp/check-usage.ts -Users-jorden-src-claude-ui-next $(basename $S .jsonl)
  ```

  → `messages` equals "distinct ids" and `turns` equals the grep count (for a session under 2000
  blocks; if `truncated` is true the numbers may be lower — pick a smaller file then).

### Step 3: Show tokens and turns in the session header

In `app/p/[project]/session/[id]/page.tsx`, add a formatter next to `formatDuration`:

```ts
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
```

Inside the header `<div>`, after the `user · assistant · tools` span, add two spans:

```tsx
{transcript.meta.tokens.messages > 0 && (
  <span title="input · cache write · cache read · output">
    tokens {formatTokens(transcript.meta.tokens.input)} in ·{' '}
    {formatTokens(transcript.meta.tokens.cacheCreation)} cache-w ·{' '}
    {formatTokens(transcript.meta.tokens.cacheRead)} cache-r ·{' '}
    {formatTokens(transcript.meta.tokens.output)} out
  </span>
)}
{transcript.meta.turns > 0 && (
  <span>
    {transcript.meta.turns} turns · avg{' '}
    {Math.round(transcript.meta.turnDurationMs / transcript.meta.turns / 1000)}s
  </span>
)}
```

Extend the truncation notice text to end with `Token and turn totals cover only the blocks shown.`

**Verify**: with `bun dev` running,
`curl -s http://localhost:3000/p/-Users-jorden-src-claude-ui-next/session/$(basename $S .jsonl) | grep -o 'tokens [0-9.kM]* in'`
→ prints one match.

### Step 4: Per-session token totals on the project page

In `lib/claude/data.ts`, add a cached scanner modeled on `listToolUsage`/`scanToolUses`:

```ts
const sessionUsageCache = new Map<string, { mtimeMs: number; usage: TokenUsage }>();

function scanUsage(raw: string): TokenUsage {
  const total = emptyUsage();
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const id = entry.message?.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const u = readUsage(entry.message?.usage);
    if (u) addUsage(total, u);
  }
  return total;
}

/** Token totals per session id for one project, from an mtime-keyed cache. */
export async function listSessionUsage(slug: string): Promise<Map<string, TokenUsage>> {
  const out = new Map<string, TokenUsage>();
  for (const f of await sessionFiles(slug)) {
    const full = path.join(projectDir(slug), f.name);
    let cached = sessionUsageCache.get(full);
    if (!cached || cached.mtimeMs !== f.mtime.getTime()) {
      let raw;
      try { raw = await fs.readFile(full, 'utf8'); } catch { continue; }
      cached = { mtimeMs: f.mtime.getTime(), usage: scanUsage(raw) };
      sessionUsageCache.set(full, cached);
    }
    out.set(f.name.replace(/\.jsonl$/, ''), cached.usage);
  }
  return out;
}
```

This scanner reads whole files and is **not** subject to `MAX_BLOCKS`, so its totals can exceed the
session page's on truncated sessions. That is expected; do not "fix" it.

In `app/p/[project]/page.tsx`, fetch `listSessionUsage(project)` in the existing `Promise.all`, and
after each session link append a muted span:

```tsx
{usage.get(s.id) && (
  <span className="text-fd-muted-foreground">
    {' '}· {formatTokens(usage.get(s.id)!.output)} out · {formatTokens(usage.get(s.id)!.cacheRead)} cache-r
  </span>
)}
```

Move `formatTokens` into `lib/claude/tree.ts`? No — `tree.ts` is for sidebar building. Put
`formatTokens` in `lib/claude/data.ts` as an exported pure function and import it in both pages.

**Verify**:
- `bun run types:check` → exit 0.
- `curl -s http://localhost:3000/p/-Users-jorden-src-claude-ui-next | grep -c 'cache-r'` → ≥ 1.
- Reload the same page twice; the second load should be noticeably faster (cache hit). Not
  machine-checkable — just confirm it does not time out.

## Test plan

No test framework exists. Verification is the throwaway script in Step 2 plus the curl checks.
Do not add a test framework in this plan.

## Done criteria

- [ ] `bun run types:check` exits 0
- [ ] `grep -n 'seenMessageIds' lib/claude/data.ts` → at least 2 matches (declaration + use)
- [ ] `grep -n "turn_duration" lib/claude/data.ts` → 1 match
- [ ] Session page shows a `tokens … in · … cache-w · … cache-r · … out` span for a session with assistant messages
- [ ] Project page shows per-session `out`/`cache-r` totals
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `/tmp/check-usage.ts` is **not** committed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `readTranscript` no longer has the `} else { skippedLines++; }` catch-all shown above.
- `message.usage` is absent on the assistant entries of the test session (run
  `grep -c '"usage"' $S` — must be > 0).
- Distinct `message.id` count from the grep does not equal `meta.tokens.messages` for a
  non-truncated session after two fix attempts.
- The project page takes more than ~10 s to render for the largest project after the cache
  is warm (run it twice). Report the timing; do not add pagination or background jobs.

## Maintenance notes

- Plan 009 (subagent transcripts) extracts the parsing loop into a pure `parseTranscript(raw)`
  function. If 009 lands first, put the Step 2 accumulation inside that function instead; if 008
  lands first, 009 must carry the `seenMessageIds` logic into the extracted function.
- Reviewer should check: dedup by `message.id` is present in **both** `readTranscript` and
  `scanUsage`; no `usage` key other than the four `*_tokens` integers is read.
- Deferred on purpose: dollar cost (needs a pricing table), per-model breakdown, global totals on
  the home page (would read all 166 MB on every home render — needs the cache to be shared first).
