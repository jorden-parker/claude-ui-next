# Plan 009: Link subagent transcripts and persisted tool outputs from the session viewer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b573de5..HEAD -- lib/claude/data.ts components/transcript.tsx 'app/p/[project]/session'`
> Plan 008 is expected to have landed (it adds `tokens`/`turns` to `SessionMetadata` and a
> `seenMessageIds` set inside `readTranscript`). Any OTHER divergence from the "Current state"
> excerpts is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (new routes + one refactor of the parser into a pure function)
- **Depends on**: 008 (both edit `readTranscript`; execute after it)
- **Category**: direction
- **Planned at**: commit `b573de5` (branch `advisor/007-tool-budget-presets`), 2026-09-07

## Why this matters

A session transcript is not the whole story. When Claude Code spawns a subagent, that subagent's
full transcript is written to a sidecar directory next to the session file — 83 such transcripts
exist on this machine across 38 sessions, mostly `general-purpose` (70), plus `claude-code-guide`
(8) and `Explore` (4). Today the viewer renders the `Agent` tool call as a JSON blob and the
subagent's work is invisible. Likewise, when a tool result exceeds the context budget, Claude Code
spills it to `tool-results/<id>.txt` and the transcript keeps only a 2 KB preview (33 such spills
exist). Both are one directory listing away from the transcript the app already parses. Plan 006
explicitly deferred "subagent trees" — this is that work.

## Current state

### Data on disk (verified 2026-09-07)

Each session `~/.claude/projects/<slug>/<sessionId>.jsonl` may have a sibling directory
`~/.claude/projects/<slug>/<sessionId>/` containing:

- `subagents/agent-<17 hex chars>.jsonl` — a transcript in the **same JSONL shape** as the parent
  (entries with `type: 'user' | 'assistant'`, `message.content` arrays, `timestamp`, `message.model`,
  `message.usage`). Extra keys on every line: `isSidechain: true`, `agentId: '<17 hex>'`. The first
  line is the `user` entry holding the prompt the parent passed in. Sample: 49 lines, 24 assistant,
  15 user, 0 `isMeta`.
- `subagents/agent-<id>.meta.json` — sidecar:

  ```json
  {"agentType":"claude-code-guide","description":"Research disabling tools","toolUseId":"toolu_01TEgo4XbC2NBnXsMkvTo5mZ","spawnDepth":1}
  ```

  **82 of 83 subagent transcripts have one; one does not.** Treat a missing sidecar as
  `agentType: null, description: null, toolUseId: null`.
- `meta.toolUseId` equals the `id` of the parent's `tool_use` content block whose `name` is
  `Agent` (verified for 5 of 5 sampled). That is the join key.
- `tool-results/<name>.txt` — full tool output that was too large for the context. Names seen:
  `toolu_<24 chars>.txt` and short ids like `bdjqd8e0h.txt`; largest observed 862 KB. The
  transcript's `tool_result` content for such a call begins:

  ```
  <persisted-output>
  Output too large (842.1KB). Full output saved to: /Users/jorden/.claude/projects/<slug>/<sessionId>/tool-results/bdjqd8e0h.txt

  Preview (first 2KB):
  ...
  ```

  The same JSONL line also carries a top-level `toolUseResult.persistedOutputPath` (absolute path)
  and `persistedOutputSize`. **Use only the basename** of that path; the app must never read an
  arbitrary absolute path from a transcript.

### Code

- `lib/claude/data.ts`
  - `readTranscript(slug, id)` (line 345) validates `id` with `/^[\w-]+$/`, reads
    `path.join(projectDir(slug), `${id}.jsonl`)`, then runs a ~110-line parse loop that ends with
    `return { blocks, meta, totalLines: lines.length, skippedLines, truncated };`. After plan 008
    the loop also holds a `seenMessageIds` set and `turn_duration` handling.
  - `TranscriptBlock` union (lines 37–41):

    ```ts
    export type TranscriptBlock =
      | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string }
      | { kind: 'thinking'; text: string; timestamp?: string }
      | { kind: 'tool-use'; name: string; input: unknown; id: string; timestamp?: string }
      | { kind: 'tool-result'; toolUseId: string; text: string; isError: boolean; timestamp?: string };
    ```

  - The `tool_result` branch inside the loop:

    ```ts
          } else if (item?.type === 'tool_result') {
            blocks.push({
              kind: 'tool-result',
              toolUseId: item.tool_use_id ?? '',
              text: extractText(item.content) ?? JSON.stringify(item.content),
              isError: item.is_error === true,
              timestamp: entry.timestamp,
            });
          }
    ```

  - Path-segment validation precedent: `getMemory` rejects `/`, `\\` and wrong extension;
    `getSkill` uses a strict regex `/^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)?$/`. Match this style.
- `components/transcript.tsx` — server component (no `'use client'`). The `tool-use` case:

  ```tsx
  case 'tool-use':
    return (
      <details className="rounded-lg border bg-fd-card px-4 py-2 text-sm">
        <summary className="cursor-pointer select-none font-mono text-xs">
          <span className="text-fd-primary">{block.name}</span>
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-fd-secondary p-2 text-xs">
          {clamp(JSON.stringify(block.input, null, 2) ?? '')}
        </pre>
      </details>
    );
  ```

  and the `tool-result` case renders `{block.isError ? '✗ result (error)' : '✓ result'}` in the
  summary and `clamp(block.text)` in a `<pre>`. `Transcript({ blocks })` maps blocks to `<Block>`.
- `app/p/[project]/session/[id]/page.tsx` — calls `readTranscript`, renders a metadata header,
  an optional truncation notice, then `<Transcript blocks={transcript.blocks} />`.
- Detail-page exemplar: `app/p/[project]/memory/[file]/page.tsx` — `notFound()` on null, `DocsTitle`,
  optional `DocsDescription`, a pill `<span className="w-fit rounded-full border px-2 py-0.5 text-xs text-fd-muted-foreground">`.

### Conventions to match

- Filesystem access only in `lib/claude/data.ts`; `try/catch` → `null`/`[]`.
- Routes under `app/p/[project]/...` use `export const dynamic = 'force-dynamic'` and
  `params: Promise<{...}>` (await it).
- Links via `next/link`. Fumadocs `fd-*` tokens only.

## Commands you will need

| Purpose    | Command               | Expected on success |
|------------|-----------------------|---------------------|
| Install    | `bun install`         | exit 0              |
| Typecheck  | `bun run types:check` | exit 0              |
| Dev server | `bun dev`             | serves on :3000     |

Test fixtures (exist on this machine):

```bash
SLUG=-Users-jorden-src-claude-ui-next
SID=5495ae40-befb-4779-891d-183b740a6a78
AGENT=a65164da1b69adcdd          # subagents/agent-$AGENT.jsonl + .meta.json
OUT=bdjqd8e0h.txt                # tool-results/$OUT (862 KB)
ls ~/.claude/projects/$SLUG/$SID/subagents ~/.claude/projects/$SLUG/$SID/tool-results
```

## Scope

**In scope** (the only files you should modify):
- `lib/claude/data.ts`
- `components/transcript.tsx`
- `app/p/[project]/session/[id]/page.tsx`
- `app/p/[project]/session/[id]/agent/[agentId]/page.tsx` (create)
- `app/p/[project]/session/[id]/output/[file]/page.tsx` (create)
- `plans/README.md` (status row only)

**Out of scope**:
- `lib/claude/tree.ts` — subagents do not appear in the sidebar (40-session cap already
  crowds it).
- `app/global/tools/*` and `listToolUsage` — subagent tool calls are **not** added to the tool
  usage counts in this plan (that would change the numbers users already saw; decide separately).
- Nested subagents (`spawnDepth` > 1): render what the sidecar dir contains; do not recurse into
  agent-of-agent directories.
- Reading any path from `persistedOutputPath` other than its basename.

## Git workflow

- Branch: `advisor/009-subagent-transcripts`.
- Commit per step; subject short imperative, body explains why (see `git log -3`).
- Do NOT push or open a PR.

## Steps

### Step 1: Extract a pure `parseTranscript(raw)` from `readTranscript`

In `lib/claude/data.ts`, move everything in `readTranscript` after the `fs.readFile` into a new
exported function:

```ts
/** Parse transcript JSONL text. Pure: no I/O. Used for sessions and subagent sidecars alike. */
export function parseTranscript(raw: string): Transcript {
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  ... // the existing loop, unchanged, including plan 008's seenMessageIds and turn_duration
  return { blocks, meta, totalLines: lines.length, skippedLines, truncated };
}

export async function readTranscript(slug: string, id: string): Promise<Transcript | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  let raw;
  try {
    raw = await fs.readFile(path.join(projectDir(slug), `${id}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  return parseTranscript(raw);
}
```

Behavior must be byte-identical for existing pages.

**Verify**: `bun run types:check` → exit 0; `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/p/$SLUG/session/$SID` → `200`.

### Step 2: Mark persisted tool outputs in the parser

Add an optional field to the `tool-result` member of `TranscriptBlock`:

```ts
  | { kind: 'tool-result'; toolUseId: string; text: string; isError: boolean; timestamp?: string; persistedFile?: string };
```

Add a helper near `extractText`:

```ts
const PERSISTED_FILE = /tool-results\/([A-Za-z0-9_-]+\.txt)\b/;

/** Basename of the spilled output file named in a `<persisted-output>` result, or undefined. */
function persistedFileOf(text: string): string | undefined {
  if (!text.startsWith('<persisted-output>')) return undefined;
  return text.match(PERSISTED_FILE)?.[1];
}
```

In the `tool_result` branch, compute `const text = extractText(item.content) ?? JSON.stringify(item.content);`
once and push `{ ..., text, persistedFile: persistedFileOf(text) }`.

**Verify**: `bun run types:check` → exit 0.

### Step 3: Readers for subagents and persisted outputs

Add to `lib/claude/data.ts`:

```ts
export interface SubagentSummary {
  agentId: string;
  agentType: string | null;
  description: string | null;
  /** `id` of the parent's `Agent` tool_use block, or null if the sidecar .meta.json is missing. */
  toolUseId: string | null;
  mtime: Date;
  size: number;
}

const AGENT_ID = /^[0-9a-f]{8,32}$/;
const OUTPUT_FILE = /^[A-Za-z0-9_-]+\.txt$/;

function sessionSidecarDir(slug: string, id: string): string | null {
  if (!/^[\w-]+$/.test(id)) return null;
  return path.join(projectDir(slug), id);
}

/** Subagent transcripts recorded under <session>/subagents, newest first. */
export async function listSubagents(slug: string, id: string): Promise<SubagentSummary[]> {
  const dir = sessionSidecarDir(slug, id);
  if (dir === null) return [];
  let entries;
  try {
    entries = await fs.readdir(path.join(dir, 'subagents'));
  } catch {
    return [];
  }
  const out = await Promise.all(
    entries
      .filter((f) => /^agent-[0-9a-f]+\.jsonl$/.test(f))
      .map(async (f) => {
        const agentId = f.slice('agent-'.length, -'.jsonl'.length);
        const full = path.join(dir, 'subagents', f);
        let stat;
        try { stat = await fs.stat(full); } catch { return null; }
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(await fs.readFile(full.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        } catch {
          // sidecar missing or invalid — fields stay null
        }
        const str = (v: unknown) => (typeof v === 'string' ? v : null);
        return {
          agentId,
          agentType: str(meta.agentType),
          description: str(meta.description),
          toolUseId: str(meta.toolUseId),
          mtime: stat.mtime,
          size: stat.size,
        };
      }),
  );
  return out
    .filter((s): s is SubagentSummary => s !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export async function readSubagentTranscript(slug: string, id: string, agentId: string): Promise<Transcript | null> {
  const dir = sessionSidecarDir(slug, id);
  if (dir === null || !AGENT_ID.test(agentId)) return null;
  let raw;
  try {
    raw = await fs.readFile(path.join(dir, 'subagents', `agent-${agentId}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  return parseTranscript(raw);
}

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** A spilled tool output from <session>/tool-results, clamped to 2 MB. */
export async function getPersistedOutput(
  slug: string,
  id: string,
  file: string,
): Promise<{ text: string; size: number; truncated: boolean } | null> {
  const dir = sessionSidecarDir(slug, id);
  if (dir === null || !OUTPUT_FILE.test(file)) return null;
  try {
    const full = path.join(dir, 'tool-results', file);
    const stat = await fs.stat(full);
    const fd = await fs.open(full);
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_OUTPUT_BYTES));
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      return { text: buf.toString('utf8', 0, bytesRead), size: stat.size, truncated: stat.size > MAX_OUTPUT_BYTES };
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}
```

**Verify**: `bun run types:check` → exit 0, and:

```bash
cat > /tmp/check-sub.ts <<'TS'
import { listSubagents, readSubagentTranscript, getPersistedOutput } from './lib/claude/data';
const [slug, id, agent, out] = process.argv.slice(2);
(async () => {
  console.log((await listSubagents(slug, id)).map((s) => [s.agentId, s.agentType, s.toolUseId]));
  console.log((await readSubagentTranscript(slug, id, agent))?.meta);
  console.log((await getPersistedOutput(slug, id, out))?.size);
  console.log(await readSubagentTranscript(slug, id, '../x'), await getPersistedOutput(slug, id, '../settings.json'));
})();
TS
bun run /tmp/check-sub.ts $SLUG $SID $AGENT $OUT
```

→ first line lists `a65164da1b69adcdd`, `claude-code-guide`, `toolu_01TEgo4XbC2NBnXsMkvTo5mZ`;
second shows a `model` of `claude-haiku-4-5-20251001`; third prints `862287`; fourth prints `null null`.

### Step 4: Transcript component — links on `Agent` calls and persisted results

In `components/transcript.tsx`:

- Add `import Link from 'next/link';`.
- Change the props: `Transcript({ blocks, links }: { blocks: TranscriptBlock[]; links?: TranscriptLinks })` with

  ```ts
  export interface TranscriptLinks {
    /** Parent tool_use id → href of the subagent transcript page. */
    subagents: Map<string, { href: string; label: string }>;
    /** Base href for persisted outputs; `${outputBase}/${file}` is the page. */
    outputBase: string;
  }
  ```

  Pass `links` down to `Block`.
- In the `tool-use` case, when `links?.subagents.get(block.id)` exists, render after the name span:

  ```tsx
  <Link href={sub.href} className="ml-2 text-fd-muted-foreground underline">open subagent · {sub.label}</Link>
  ```

- In the `tool-result` case, when `block.persistedFile && links` render after the summary label:

  ```tsx
  <Link href={`${links.outputBase}/${encodeURIComponent(block.persistedFile)}`} className="ml-2 underline">full output</Link>
  ```

**Verify**: `bun run types:check` → exit 0 (the session page still compiles because `links` is optional).

### Step 5: Session page — subagent list and link wiring

In `app/p/[project]/session/[id]/page.tsx`:

- Fetch `listSubagents(project, id)` alongside `readTranscript` in a `Promise.all`.
- Build `links`:

  ```ts
  const base = `/p/${project}/session/${id}`;
  const links = {
    subagents: new Map(
      subagents
        .filter((s) => s.toolUseId !== null)
        .map((s) => [s.toolUseId!, { href: `${base}/agent/${s.agentId}`, label: s.agentType ?? s.agentId }]),
    ),
    outputBase: `${base}/output`,
  };
  ```

- Before `<Transcript>`, when `subagents.length > 0`, render a section:

  ```tsx
  <details className="rounded-lg border bg-fd-card px-4 py-2 text-sm" open>
    <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
      Subagents ({subagents.length})
    </summary>
    <ul className="mt-2 flex flex-col gap-1">
      {subagents.map((s) => (
        <li key={s.agentId} className="flex items-baseline gap-2">
          <Link href={`${base}/agent/${s.agentId}`} className="font-mono text-xs underline">{s.agentType ?? 'agent'}</Link>
          <span className="min-w-0 flex-1 truncate">{s.description ?? s.agentId}</span>
        </li>
      ))}
    </ul>
  </details>
  ```

- Pass `links={links}` to `<Transcript>`.

**Verify**: `curl -s http://localhost:3000/p/$SLUG/session/$SID | grep -o "agent/$AGENT" | head -1` → prints the path;
`curl -s http://localhost:3000/p/$SLUG/session/$SID | grep -c 'full output'` → ≥ 1.

### Step 6: Subagent transcript page

Create `app/p/[project]/session/[id]/agent/[agentId]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { listSubagents, readSubagentTranscript } from '@/lib/claude/data';
import { Transcript } from '@/components/transcript';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ project: string; id: string; agentId: string }> }) {
  const { project, id, agentId } = await params;
  const [transcript, subagents] = await Promise.all([readSubagentTranscript(project, id, agentId), listSubagents(project, id)]);
  if (!transcript) notFound();
  const meta = subagents.find((s) => s.agentId === agentId);

  return (
    <DocsPage>
      <DocsTitle>Subagent · {meta?.agentType ?? agentId}</DocsTitle>
      <DocsDescription className="mb-0">{meta?.description ?? 'No description recorded.'}</DocsDescription>
      <p className="text-xs">
        <Link href={`/p/${project}/session/${id}`} className="underline">← back to session</Link>
      </p>
      {/* Reuse the same metadata header markup as the session page; copy it verbatim. */}
      <Transcript blocks={transcript.blocks} />
    </DocsPage>
  );
}
```

Copy the metadata header `<div>` from the session page (model, version, duration, counts, and
plan 008's tokens span) so the two pages look alike. Do not extract a shared component in this plan.

**Verify**: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/p/$SLUG/session/$SID/agent/$AGENT` → `200`;
`.../agent/zzz` → `404`.

### Step 7: Persisted output page

Create `app/p/[project]/session/[id]/output/[file]/page.tsx`: `notFound()` when
`getPersistedOutput` returns null; `DocsTitle` = the file name; `DocsDescription` shows the byte
size and a "showing first 2 MB" note when `truncated`; body is
`<pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs whitespace-pre-wrap break-words">{text}</pre>`
plus a back link like Step 6.

**Verify**: `curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/p/$SLUG/session/$SID/output/$OUT"` → `200`;
`.../output/..%2Fsettings.json` → `404`.

## Test plan

No test framework. The throwaway script in Step 3 covers: listing, parsing, output read, and two
path-traversal rejections. Delete `/tmp/check-sub.ts` when done; do not commit it.

## Done criteria

- [ ] `bun run types:check` exits 0
- [ ] `grep -n 'export function parseTranscript' lib/claude/data.ts` → 1 match
- [ ] `grep -n 'persistedFile' lib/claude/data.ts components/transcript.tsx` → matches in both files
- [ ] Session page for `$SID` contains a link to `agent/$AGENT` and at least one `full output` link
- [ ] Subagent page and output page return 200 for the fixtures and 404 for the traversal inputs above
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `readTranscript` in the live code does not end with the `return { blocks, meta, ... }` line shown
  above, or plan 008's `seenMessageIds` is absent (008 has not landed — stop, do not merge the two).
- The fixture `subagents/agent-$AGENT.meta.json` has no `toolUseId` key, or the parent transcript
  has no `tool_use` block with that `id` (join key assumption broken).
- Any subagent JSONL fails to parse with `parseTranscript` (assumption "same shape as parent"
  broken) — report the file and the first offending line number.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `parseTranscript` is now the single parser for both file kinds; any new block type goes there.
- Reviewer should check: no absolute path from a transcript is ever passed to `fs`; both new readers
  reject `/`, `\\`, `..` via their regexes; `MAX_OUTPUT_BYTES` clamp is applied at read time, not
  after reading the whole file.
- Deferred: counting subagent tool calls in `listToolUsage`; rendering nested agents as a tree;
  sidebar entries for subagents; the `spawnDepth` field is read but unused.
