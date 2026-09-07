# Plan 007: Tool budget page at /global/tools — usage stats, per-tool on/off switches, and preset bundles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b341f6b..HEAD -- lib/claude/data.ts lib/claude/tree.ts app/global components`
> If any of those paths changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — this is the **first write path** in an app that has been strictly read-only, it writes the user's real `~/.claude/settings.json`, and it is ungated by design. Mitigated by a strict allowlist, a backup, an atomic temp-file write, and a key-preservation assertion.
- **Depends on**: none. (Plan 002, the settings viewer, is already merged at `a48362f`; this plan builds beside it, not on it. Plans 003–006 are unrelated and may be TODO — that is fine.)
- **Category**: direction
- **Planned at**: commit `b341f6b`, 2026-09-07

## Why this matters

Every tool definition Claude Code sends to the model costs context tokens on **every request** of
every session. Claude Code ships ~45 built-in tools plus MCP tools; a user who never touches
Jupyter notebooks, PowerShell, or the cron/task tools pays for those schemas forever. Claude Code
already supports removing a tool from the model's context entirely — but only via hand-edited JSON,
and nothing tells the user *which* tools they never use.

This app already reads every session transcript in `~/.claude/projects/`, so it can compute exactly
which tools this user has and has not used. Adding a page that shows that, and lets the user switch
any individual tool off — or apply a preset bundle — turns a guessing game into a measured decision.
After it lands: open `/global/tools`, see "NotebookEdit: never used in 190 sessions", flip its
switch, and the tool stops being sent.

Two levels of control ship together, and both are required:

- **Per-tool switches** — every tool in the catalog, plus every MCP tool this machine has actually
  used, gets its own on/off switch. This is the primary interface.
- **Presets** — named bundles that flip several related switches at once, for the common cases.

## Background research — the mechanism (verified, do not re-derive)

All of this was verified against the live Claude Code docs on 2026-09-07 and against the installed
CLI (`claude --version` → `2.1.263`). **Do not go looking for a `disabledTools` setting — there
isn't one.** The only supported mechanism that actually removes a tool from the model's context is a
**bare-name deny rule**.

Verbatim from <https://code.claude.com/docs/en/permissions>:

> Deny rules behave differently depending on whether they name a tool or scope a pattern within one.
> A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees
> it. Bare-name removal applies to every tool except `EndConversation`: a deny rule can't remove it
> while any other tool remains, and an ask rule never prompts for it. A scoped rule like `Bash(rm *)`
> leaves the tool available and blocks matching calls when Claude attempts them.

And:

> `Bash(*)` is equivalent to `Bash` and matches all Bash commands. As a deny rule, both forms remove
> the tool from Claude's context.

> Deny and ask rules also accept glob patterns in the tool-name position. The pattern must match the
> full tool name: `"*"` matches every tool, and `"mcp__*"` matches every MCP tool across all servers.
> A tool matched by a bare-name glob deny rule is removed from Claude's context, the same as a bare
> tool name […]

Consequences that shape this plan:

1. **Only bare names save tokens.** `"deny": ["WebFetch"]` removes the schema. `"deny": ["WebFetch(domain:evil.com)"]` does not. The UI must only ever write bare names.
2. **Deny unions across settings scopes.** From the same page: *"if user settings allow a permission and project settings deny it, the deny rule blocks it. The reverse is also true: a user-level deny blocks a project-level allow, because deny rules from any scope are evaluated before allow rules."* So writing to `~/.claude/settings.json` (user scope) disables the tool everywhere, and cannot be undone by a project's settings. Say this in the UI.
3. **`EndConversation` is exempt.** Denying it is a no-op. Never offer it.
4. **`"*"` and `"mcp__*"` are legal but dangerous.** `"*"` would remove every tool from every session — the user would have a Claude Code that cannot do anything. **Never write `"*"`.** `"mcp__*"` is offered as one explicit preset.
5. **Not a settings key**: tool search (deferred tool loading, the `ToolSearch` tool) is controlled only by the `ENABLE_TOOL_SEARCH` environment variable (values `true`, `false`, `auto`, `auto:N` — confirmed by the error string `Invalid ENABLE_TOOL_SEARCH value "…": expected auto:N where N is a number` in the 2.1.263 binary). It is **enabled by default** on first-party hosts and already saves tokens, so this plan does **not** touch it. Do not add a toggle for it.
6. **Measurement**: the user verifies savings by running `/context` inside Claude Code before and after (`/context [all]` — "Visualize current context usage as a colored grid. Shows optimization suggestions for context-heavy tools…"). There is no programmatic token count available to this app. Do **not** invent or display estimated token numbers per tool — show usage counts only.

## Current state

### Repo shape

- Next.js 16.3.0 / React 19 / Fumadocs, **bun** package manager. **No tests, no linter.** The only gate is `bun run types:check`.
- The app is currently **100% read-only** — `grep -rn "use client" app components lib` returns **nothing**, and there are no Server Actions or route handlers that write. This plan introduces the first of each, and by explicit instruction the write path is **not** gated behind any flag — it is live as soon as the page loads. That makes the allowlist in Step 3 the single security boundary; none of its requirements are optional.
- `AGENTS.md` warns that this Next.js version differs from training data and that `next dev` rewrites a block in `AGENTS.md` (commit that file with your work if it shows modified). The Next APIs this plan uses were checked against the bundled docs at `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` and `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`.

### `lib/claude/data.ts` — the only filesystem module

Header (lines 1–7):

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';

const CLAUDE_DIR = process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
```

Convention: **every exported reader wraps filesystem access in try/catch and returns `null` or `[]`
on failure — it never throws.** Exemplar (lines 66–76):

```ts
/** Parsed ~/.claude/settings.json, or null if absent or invalid. */
export async function getSettings(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(path.join(CLAUDE_DIR, 'settings.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

There is an existing private helper for enumerating transcripts, which you will reuse verbatim
(lines ~104–121):

```ts
async function sessionFiles(slug: string): Promise<{ name: string; mtime: Date; size: number }[]> {
  let entries;
  try {
    entries = await fs.readdir(projectDir(slug), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map(async (e) => {
        const stat = await fs.stat(path.join(projectDir(slug), e.name));
        return { name: e.name, mtime: stat.mtime, size: stat.size };
      }),
  );
  return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
```

And an existing mtime-keyed cache pattern to copy (lines ~123–124):

```ts
const realPathCache = new Map<string, { mtimeMs: number; realPath: string | null }>();
```

Transcript JSONL shape you need: assistant lines are `{"type":"assistant","timestamp":"<ISO
string>","message":{"content":[ … ]}}` where a content item may be
`{"type":"tool_use","id":"toolu_…","name":"Bash","input":{…}}`. `readTranscript` already walks
exactly this shape (see its `entry.type === 'assistant'` branch).

### `lib/claude/tree.ts` — sidebar

`buildGlobalTree()` currently reads (lines 19–37):

```ts
export async function buildGlobalTree(): Promise<Root> {
  const [claudeMd, settings, groups] = await Promise.all([
    getGlobalClaudeMd(),
    getSettings(),
    listAllMemories(),
  ]);

  const children: Node[] = [{ type: 'page', name: 'Overview', url: '/global' }];
  if (claudeMd !== null) {
    children.push({ type: 'page', name: 'CLAUDE.md', url: '/global/claude-md' });
  }
  if (settings !== null) {
    children.push({ type: 'page', name: 'Settings', url: '/global/settings' });
  }
  for (const g of groups) {
```

### Page conventions — exemplar `app/global/settings/page.tsx` (excerpt)

```tsx
import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getSettings } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const settings = await getSettings();
  if (settings === null) notFound();
  …
  return (
    <DocsPage>
      <DocsTitle>Settings</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">~/.claude/settings.json</DocsDescription>
      <DocsBody>
        …
        <pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs">
```

Match this: `export const dynamic = 'force-dynamic'`, the `DocsPage`/`DocsTitle`/`DocsDescription`/
`DocsBody` shell, Tailwind with fumadocs `fd-*` color tokens (`bg-fd-secondary`,
`text-fd-muted-foreground`), no custom CSS files.

### Measured facts about the live data (2026-09-07, this machine)

- `~/.claude/projects/` is **159 MB across 190 `.jsonl` files in 17 project directories**.
- A full scan that reads every file and `JSON.parse`s only lines containing `"tool_use"` takes
  **~72 ms** and finds **28 distinct tool names / 3106 calls**. A cold full scan is therefore cheap
  enough for a `force-dynamic` page; the per-file cache in Step 1 exists so it stays cheap as the
  corpus grows.
- Tools **used** on this machine include `Bash` (2182), `WebFetch`, `Edit`, `Read`, `Agent`, `Write`,
  `ToolSearch`, `WebSearch`, `Skill`, `SendMessage`, `AskUserQuestion`, `ScheduleWakeup`,
  `TaskOutput`, `SendUserFile`, and 12 `mcp__*` tools.
- Tools in the catalog with **zero** recorded uses here include `Glob`, `Grep`, `TodoWrite`,
  `NotebookEdit`, `PowerShell`, `LSP`, `Monitor`, `CronCreate/Delete/List`, `TaskCreate/Get/List/
  Update/Stop`, `EnterWorktree`, `ExitWorktree`, `EnterPlanMode`, `ExitPlanMode`, `Workflow`,
  `Artifact`, `PushNotification`, `RemoteTrigger`, `ReportFindings`, `SendFeedback`, `ListAgents`,
  `ShareOnboardingGuide`, `WaitForMcpServers`, `ListMcpResourcesTool`, `ReadMcpResourceTool`.
  Do **not** hardcode any of this — it is computed. It is listed here only so you can sanity-check
  your output.
- The live `~/.claude/settings.json` has **no `permissions` key at all** right now. Your writer must
  create it. Its existing top-level keys include `env`, `model`, `hooks`, `statusLine`,
  `enabledPlugins`, `extraKnownMarketplaces`, `outputStyle`, `effortLevel`, `modelSettings`, `tui`,
  `theme`, `editorMode`, and several booleans. **Every one of them must survive a write untouched.**

## Commands you will need

| Purpose   | Command                 | Expected on success |
|-----------|-------------------------|---------------------|
| Typecheck | `bun run types:check`   | exit 0, no errors   |
| Dev server| `bun dev`               | serves localhost:3000 |
| Install   | *(none needed — this plan adds no dependencies)* | — |

There is no test framework and no linter in this repo. Do not add one.

## Scope

**In scope** (the only files you may modify or create):

- `lib/claude/tools.ts` (create) — static tool catalog + preset definitions.
- `lib/claude/data.ts` (modify) — add `listToolUsage()` and `getDeniedTools()`.
- `lib/claude/settings-writer.ts` (create) — the guarded write path.
- `app/global/tools/page.tsx` (create) — the page.
- `app/global/tools/actions.ts` (create) — the Server Action.
- `components/tool-presets.tsx` (create) — the client component.
- `lib/claude/tree.ts` (modify) — one sidebar entry.
- `plans/README.md` (modify) — status row.

**Out of scope** (do NOT touch, even though they look related):

- `app/global/settings/page.tsx` — the settings viewer stays read-only. Do not add editing there.
- Any write to `~/.claude/settings.json` keys other than `permissions.deny`. Not `env`, not
  `permissions.allow`, not `permissions.ask`, not `deniedMcpServers`. One key, nothing else.
- `ENABLE_TOOL_SEARCH` and every other environment variable (see research note 5).
- Project-scoped settings (`.claude/settings.json` inside any repo). User scope only.
- `components/markdown.tsx`, `components/transcript.tsx`, `lib/source.ts`, `proxy.ts`, anything
  under `content/` or `app/docs/`.
- Adding any npm dependency. Everything here is plain React + Node `fs`.

## Git workflow

- Branch: `advisor/007-tool-budget-presets`.
- Commit per step or per logical unit. Match the repo's log style — short imperative sentences,
  no conventional-commit prefixes (`git log --oneline -5` shows e.g. `Settings viewer: grouped
  ~/.claude/settings.json`, `Syntax highlighting: rehype-highlight in runtime Markdown renderer`).
- Do NOT push and do NOT open a PR.

## Steps

### Step 1: Add the tool catalog and presets — `lib/claude/tools.ts`

Create `lib/claude/tools.ts`. Pure data plus pure functions, no filesystem access, no imports from
`data.ts`.

Export an interface and the catalog. The names below are the canonical permission-rule names from
<https://code.claude.com/docs/en/tools-reference>; copy them **exactly**, they are case-sensitive:

```ts
export interface ToolInfo {
  name: string;
  purpose: string;
  group: 'files' | 'shell' | 'search' | 'web' | 'agents' | 'tasks' | 'planning' | 'notebooks' | 'ui' | 'mcp' | 'system';
  /** Denying this is refused: it is either exempt from deny rules or would break the app itself. */
  protected?: boolean;
  /** Switching this off cripples ordinary use. Allowed, but the UI demands a second confirmation. */
  core?: boolean;
}
```

Catalog entries (all 45, with a one-line `purpose` each — write them from the descriptions below):

`Agent` (spawns a subagent with its own context window), `Artifact` (publishes an HTML/Markdown page),
`AskUserQuestion` (asks multiple-choice questions), `Bash` (runs shell commands), `CronCreate` /
`CronDelete` / `CronList` (scheduled prompts within a session), `Edit` (targeted file edits),
`EndConversation` (ends the session on sustained abuse) **— `protected: true`**, `EnterPlanMode` /
`ExitPlanMode` (plan mode in/out), `EnterWorktree` / `ExitWorktree` (isolated git worktree in/out),
`Glob` (find files by pattern), `Grep` (search file contents), `ListAgents` (lists messageable
agents), `ListMcpResourcesTool` / `ReadMcpResourceTool` (MCP resources), `LSP` (language-server code
intelligence), `Monitor` (runs a command in the background, feeds output back), `NotebookEdit`
(edits Jupyter cells), `PowerShell` (runs PowerShell), `PushNotification` (desktop/phone push),
`Read` (reads files), `RemoteTrigger` (manages Routines on claude.ai), `ReportFindings` (structured
code-review findings), `ScheduleWakeup` (reschedules a self-paced `/loop`), `SendFeedback` (drafts
Claude Code feedback), `SendMessage` (messages another agent or session), `SendUserFile` (sends a
file to the user's device), `ShareOnboardingGuide` (uploads `ONBOARDING.md`, returns a link),
`Skill` (runs a skill in the main conversation), `TaskCreate` / `TaskGet` / `TaskList` /
`TaskOutput` / `TaskStop` / `TaskUpdate` (task list and background tasks), `TodoWrite` (session
checklist), `ToolSearch` (loads deferred tools) **— `protected: true`**, `WaitForMcpServers` (waits
for connecting MCP servers) **— `protected: true`**, `WebFetch` (fetches a URL), `WebSearch` (web
search), `Workflow` (multi-subagent orchestration), `Write` (creates/overwrites files).

Mark exactly these three `protected: true`:

- `EndConversation` — a deny rule on it is a documented no-op (research note 3).
- `ToolSearch` — denying it breaks deferred tool loading, which is on by default and is itself a
  token-saving feature; disabling it makes context usage *worse*.
- `WaitForMcpServers` — the fallback that keeps MCP usable when tool search is off.

Mark exactly these seven `core: true`: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill`.
`core` does **not** block the switch — the user asked to be able to turn any tool off, and these are
switchable. It only makes the UI ask twice (Step 5). Never set both `protected` and `core` on the
same entry.

Then export the presets:

```ts
export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Bare permission-rule names. Never a specifier, never "*". */
  tools: string[];
}

export const PRESETS: Preset[] = [ /* … */ ];
```

Define exactly these six:

| id | label | tools |
|----|-------|-------|
| `notebooks` | No Jupyter notebooks | `NotebookEdit` |
| `windows` | No PowerShell | `PowerShell` |
| `web` | No web access | `WebFetch`, `WebSearch` |
| `scheduling` | No cron & background tasks | `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`, `TaskUpdate` |
| `orchestration` | No multi-agent orchestration | `Workflow`, `ListAgents`, `SendMessage` |
| `mcp-all` | No MCP tools at all | `mcp__*` |

Write each `description` as one plain sentence naming the trade-off, e.g. for `web`: *"Removes
WebFetch and WebSearch. Claude can no longer read URLs or search the web."* For `mcp-all`: *"Removes
every MCP tool, including claude.ai connectors and Chrome control, from every session."* For
`orchestration`: *"Removes Workflow, ListAgents and SendMessage. The Agent tool is left alone — it is
kept separately because subagents are the common case."*

Note `mcp__*` is a glob, which is legal in the tool-name position for deny rules (research note 4).
It is the **only** glob permitted anywhere in this feature.

Finally export the validation helpers. These are the security boundary for the whole feature — the
writer in Step 3 accepts nothing they reject:

```ts
/** Catalog names that may be written as deny rules (everything except `protected` entries). */
export function writableCatalogRules(): Set<string>;

/** Matches a single MCP tool name: mcp__<server>__<tool>, segments of [A-Za-z0-9_-]. */
const MCP_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;

/** True if this exact string is a deny rule the app is permitted to write. */
export function isWritableRule(rule: string): boolean;
```

`isWritableRule(rule)` returns true for exactly three cases, and false for everything else:

1. `writableCatalogRules().has(rule)` — a non-`protected` built-in name.
2. `rule === 'mcp__*'` — the one permitted glob (used by the `mcp-all` preset).
3. `MCP_TOOL.test(rule)` — one specific MCP tool, so the per-tool switches can turn off e.g.
   `mcp__claude-in-chrome__javascript_tool` individually.

It must return **false** for `'*'`, for any string containing `(` or `)` or whitespace, for any other
glob (`Bash*`, `mcp__chrome__*`), for the three `protected` names, and for the empty string. Write it
as an explicit allowlist — test the three cases and return false at the end — never as a blocklist of
bad patterns.

**Verify**: `bun run types:check` → exit 0. Then `grep -c "name: '" lib/claude/tools.ts` → `45`. Then:

```bash
bun -e 'import("./lib/claude/tools.ts").then(m => {
  const yes = ["NotebookEdit","Bash","Read","mcp__*","mcp__claude-in-chrome__navigate"];
  const no  = ["*","EndConversation","ToolSearch","WaitForMcpServers","Bash(rm *)","mcp__chrome__*","Bash*","","Not A Tool","mcp__only_one_seg"];
  console.log("expect all true :", yes.map(m.isWritableRule).join(" "));
  console.log("expect all false:", no.map(m.isWritableRule).join(" "));
})'
```

Expected: the first line is five `true`, the second is ten `false`.

### Step 2: Add the readers — `lib/claude/data.ts`

Append two exported functions at the end of `lib/claude/data.ts`. Follow the file's existing
convention: try/catch everything, return `[]` or a safe default, never throw.

**2a. `listToolUsage()`** — scans every transcript and counts `tool_use` blocks.

```ts
export interface ToolUsage {
  name: string;
  count: number;
  /** ISO timestamp of the most recent call, or null if none had a usable timestamp. */
  lastUsed: string | null;
}

/** Tool-call counts across every session transcript in ~/.claude/projects, most-used first. */
export async function listToolUsage(): Promise<ToolUsage[]>
```

Implementation requirements:

- Enumerate project directories with `fs.readdir(PROJECTS_DIR, { withFileTypes: true })` inside a
  try/catch that returns `[]` on failure (copy the shape from `listProjects`), then use the existing
  private `sessionFiles(slug)` helper for each project's `.jsonl` files.
- For each file, read it with `fs.readFile(…, 'utf8')`, split on `'\n'`, and **skip any line that
  does not `.includes('"tool_use"')` before parsing** — this is the measured fast path (~72 ms for
  the current 159 MB corpus; parsing every line is much slower).
- For lines that pass, `JSON.parse` inside a try/catch that `continue`s on failure. Read
  `entry.message?.content`; if it is an array, for each item where `item?.type === 'tool_use'` and
  `typeof item.name === 'string'`, increment that name's count and keep the maximum
  `entry.timestamp` (a string; compare lexicographically — these are ISO 8601, so string
  comparison is chronological).
- **Cache per file** using the existing `realPathCache` pattern: a module-level
  `const toolUsageCache = new Map<string, { mtimeMs: number; counts: Map<string, number>; lastUsed: Map<string, string> }>();`
  keyed by absolute file path, invalidated when `mtimeMs` differs from the value `sessionFiles`
  already `stat`ed. Merge the per-file maps into the result.
- Sort descending by `count`, then ascending by `name` for stability.

**2b. `getDeniedTools()`** — reads the current deny list.

```ts
/** Bare-name deny rules currently in ~/.claude/settings.json permissions.deny. */
export async function getDeniedTools(): Promise<string[]>
```

Implementation: call the existing `getSettings()`; if it returns `null`, return `[]`. Read
`settings.permissions`; if it is not a non-array object, return `[]`. Read `permissions.deny`; if it
is not an array, return `[]`. Return only the entries that are strings **and contain no `(`** —
scoped rules like `Bash(rm *)` are not tool removals and must not be shown as such.

**Verify**: `bun run types:check` → exit 0. Then run this ad-hoc script from the repo root and
confirm the top row is a real tool name with a plausible count and an ISO date:

```bash
bun -e 'import("./lib/claude/data.ts").then(async m => { const t = Date.now(); const u = await m.listToolUsage(); console.log("ms", Date.now()-t, "tools", u.length); console.log(u.slice(0,5)); console.log("denied", await m.getDeniedTools()); })'
```

Expected: `tools` is ≥ 1, the first entries have `count` > 0 and a `lastUsed` string like
`2026-09-07T…`, and `denied` is `[]` (nothing is denied yet). Second run should print a much smaller
`ms` than the first is not required — the cache is per-process, so a fresh `bun -e` will not hit it.

### Step 3: Add the guarded writer — `lib/claude/settings-writer.ts`

Create `lib/claude/settings-writer.ts`. This is the only file in the app that writes to disk. It
must be paranoid, because a Server Action is a POST endpoint reachable by anything that can reach the
dev server (the bundled Next docs state: *"A Server Action runs as a POST request against the page
that invokes it. […] Treat every action as an untrusted entry point."*).

```ts
export type WriteResult =
  | { ok: true; denied: string[] }
  | { ok: false; error: string };

/** Add or remove bare-name deny rules in ~/.claude/settings.json. */
export function setDeniedTools(add: string[], remove: string[]): Promise<WriteResult>;
```

**Writes are always enabled.** There is no environment-variable gate and no read-only mode — this is
a local single-user tool and the switches must work the moment the page loads. Do not add a flag, a
confirmation env var, or a "dry run" mode. The **allowlist in requirement 2 is the security
boundary**, and it is the only one; make it airtight.

One deployment note to put in a comment at the top of this file, not in the UI: `bun dev` binds
localhost by default. Do not run this app with `-H 0.0.0.0` on an untrusted network, because the
Server Action is a POST endpoint anyone who can reach the port can call.

Requirements, in order — every one is load-bearing:

1. **Allowlist validation.** Reject the whole call if any entry of `add` or `remove` fails
   `isWritableRule()` from `lib/claude/tools.ts`. Error string:
   `` `Refused: ${rule} is not a rule this app may write.` ``. This is what makes `"*"`,
   `"Bash(rm -rf /)"`, `"EndConversation"`, and arbitrary attacker-chosen strings impossible to
   write, regardless of what the client sends. It deliberately **does** accept core tools like
   `"Bash"` and `"Read"` and individual `mcp__server__tool` names — those are switches the user is
   entitled to flip; the second confirmation lives in the UI, not here. Also cap the combined length
   of `add` and `remove` at 100 entries and return
   `{ ok: false, error: 'Refused: too many rules in one request.' }` beyond that.
2. **Read-modify-write, preserving everything.** Read `~/.claude/settings.json` (same
   `CLAUDE_DIR`-derived path as `data.ts` — import nothing; recompute it with the same two lines, or
   export the constant from `data.ts` and import it, your choice, but it must be the same value).
   `JSON.parse` it. If the file is missing, start from `{}`. If it parses to anything that is not a
   plain object, return `{ ok: false, error: 'settings.json is not a JSON object; refusing to write.' }`.
   Mutate **only** `settings.permissions.deny`: create `permissions` as `{}` if absent, create `deny`
   as `[]` if absent, and if either exists but is the wrong type, refuse with a clear error rather
   than overwriting it.
3. **Set semantics, order preserved.** The new deny array is: existing entries minus anything in
   `remove`, then anything in `add` that is not already present, appended in catalog order. Never
   reorder or drop an existing entry that this app did not add — in particular, **preserve scoped
   rules like `Bash(rm *)` untouched**.
4. **Backup before every write.** Copy the current file to `~/.claude/settings.ui-backup.json`
   (`fs.copyFile`) before writing. Ignore a failure to back up **only** when the source file does not
   exist; any other backup failure aborts the write. Do not touch the existing
   `~/.claude/settings.json.bak` — that file is not ours.
5. **Atomic write.** Serialize with `JSON.stringify(settings, null, 2) + '\n'`, write to
   `~/.claude/.settings.json.tmp-<random>` in the same directory, then `fs.rename` it over
   `settings.json`. Never write `settings.json` in place — a crash mid-write would destroy the user's
   configuration.
6. **Verify the round-trip before renaming.** After serializing, `JSON.parse` your own output and
   assert that every top-level key present in the original object is still present. If not, delete
   the temp file and return `{ ok: false, error: 'Refusing to write: serialization would drop keys.' }`.
7. Return `{ ok: true, denied: <the new deny array> }`.

**Verify**: `bun run types:check` → exit 0. Then prove the writer is safe **against a throwaway copy,
never against the real file**:

```bash
mkdir -p /tmp/claude-ui-test && cp ~/.claude/settings.json /tmp/claude-ui-test/settings.json
CLAUDE_DIR=/tmp/claude-ui-test bun -e 'import("./lib/claude/settings-writer.ts").then(async m => {
  console.log(await m.setDeniedTools(["NotebookEdit","PowerShell"], []));
  console.log(await m.setDeniedTools([], ["PowerShell"]));
  console.log("rejected:", await m.setDeniedTools(["*"], []));
  console.log("rejected:", await m.setDeniedTools(["Bash(rm -rf /)"], []));
})'
diff <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"))).sort().join("\n"))') \
     <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync("/tmp/claude-ui-test/settings.json","utf8"))).sort().join("\n"))')
```

Expected: the first two calls return `ok: true` with `denied` of `["NotebookEdit","PowerShell"]` then
`["NotebookEdit"]`; both rejections return `ok: false` with a `Refused:` message; and the `diff`
shows exactly one extra line — `permissions` — in the test copy, proving no original key was lost.

Also confirm the writer accepts what the per-tool switches need, and still refuses the rest:

```bash
CLAUDE_DIR=/tmp/claude-ui-test bun -e 'import("./lib/claude/settings-writer.ts").then(async m => {
  console.log(await m.setDeniedTools(["Bash","mcp__claude-in-chrome__navigate"], []));
  console.log("rejected:", await m.setDeniedTools(["ToolSearch"], []));
  console.log("rejected:", await m.setDeniedTools(["mcp__chrome__*"], []));
})'
```

Expected: the first call returns `ok: true` — core tools and single MCP tools are legitimate
switches — and both rejections return `ok: false` with a `Refused:` message.

Then `rm -rf /tmp/claude-ui-test`.

### Step 4: Add the Server Action — `app/global/tools/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { setDeniedTools, type WriteResult } from '@/lib/claude/settings-writer';

export async function updateDeniedTools(add: string[], remove: string[]): Promise<WriteResult> {
  const result = await setDeniedTools(add, remove);
  if (result.ok) revalidatePath('/global/tools');
  return result;
}
```

Guard the inputs at the boundary too, before calling the writer: if either argument is not an array
of strings, return `{ ok: false, error: 'Invalid request.' }`. The writer's allowlist is the real
defence, but do not rely on a single layer.

Do not add any other exported function to this file — every export in a `'use server'` file becomes a
publicly reachable POST endpoint.

**Verify**: `bun run types:check` → exit 0.

### Step 5: Add the client component — `components/tool-presets.tsx`

First line must be `'use client';` — this is the repo's first client component. One file exports two
components: `ToolPresets` (the bundles) and `ToolSwitches` (the per-tool grid). They share the same
action, the same pending state hook, and the same error box, which is why they live together.

Shared props type:

```tsx
type Row = {
  name: string;          // the exact deny-rule string
  purpose: string;       // '' for discovered MCP tools
  group: string;
  protected?: boolean;
  core?: boolean;
  count: number;         // 0 when never used
  lastUsed: string | null;
};

type Apply = (add: string[], remove: string[]) => Promise<WriteResult>;
```

#### `ToolSwitches` — the per-tool grid (the primary interface)

```tsx
export function ToolSwitches({
  rows,        // Row[] — catalog entries merged with usage, plus discovered mcp__ tools
  denied,      // string[] — current bare-name deny rules
  action,      // Apply
}: { … })
```

Behaviour:

- Render one row per tool, grouped by `group` under a small `<h3>` per group, in the catalog order.
  Discovered MCP tools go in a final `mcp` group.
- Each row shows, left to right: the switch, the tool name in `font-mono text-sm`, its `purpose` in
  `text-fd-muted-foreground text-xs`, and a usage chip — `12 uses · Sep 5` when `count > 0`, or
  `never used` in `text-fd-muted-foreground` when `count === 0`.
- **Switch semantics: on = tool enabled = NOT in `denied`.** Off = denied. Say this in a one-line
  legend above the grid, because the underlying file stores the inverse and the mismatch is the
  easiest thing to get wrong here.
- Flipping a switch off calls `action([name], [])`. Flipping it on calls `action([], [name])`.
- **`protected` rows render the switch as `disabled`, always on**, with the reason as the row's
  `title` attribute and a short inline note: for `EndConversation` *"exempt from deny rules"*, for
  `ToolSearch` and `WaitForMcpServers` *"disabling this costs more context, not less"*.
- **`core` rows require a second click.** First click on a core row's switch does not call the
  action: it swaps the row into a confirm state showing *"Turn off `Bash`? Claude Code cannot run
  shell commands in any session until you turn it back on."* with **Confirm** and **Cancel**
  buttons. Only **Confirm** calls the action. Turning a core tool back **on** is a single click — no
  confirmation for making Claude Code more capable.
- A plain text `<input>` filter above the grid that substring-matches on `name`. Client state only,
  no debounce needed, no `useEffect`.
- A summary line at the top: `N of M tools enabled · K disabled`.

#### `ToolPresets` — the bundles

```tsx
export function ToolPresets({ presets, denied, action }: { … })
```

- A preset is **on** when every one of its `tools` appears in `denied`, **partial** when some do, and
  **off** when none do.
- Render each preset as a row: label, a state badge (`On` / `Partial` / `Off`) styled with `fd-*`
  tokens, the description in `text-fd-muted-foreground`, and the rule names in a `font-mono text-xs`
  line so the user sees exactly what will be written.
- Clicking a row's button calls `action(preset.tools, [])` when off or partial, and
  `action([], preset.tools)` when on.

#### Rules both components follow

- Wrap every action call in `useTransition()`; disable the control that was clicked while
  `isPending`. Do not disable the whole grid — one slow write should not freeze the page.
- Keep the returned `WriteResult` in state. On `ok: false`, render `result.error` verbatim in a
  bordered error box above the affected section. Do not swallow it and do not `throw`.
- **Do not keep a local copy of `denied`.** The action calls `revalidatePath`, so the server re-renders
  with the new `denied` prop; render straight from props. Keeping local state here is how the UI and
  the file drift apart.
- There is **no** read-only mode. Every switch is live as soon as the page renders; the only
  `disabled` controls are the three `protected` rows and whatever is mid-flight in a transition.
- Above everything, a short warning line: *"Writes `permissions.deny` in `~/.claude/settings.json`. A
  user-scope deny cannot be overridden by any project's settings. Restart Claude Code sessions to
  pick up changes."*
- Build the switch from a plain `<button role="switch" aria-checked={…}>` with Tailwind `fd-*`
  tokens. **Do not add a UI dependency** for this — no Radix, no Headless UI. Give it a visible
  focus ring and a text label so it is usable without color.
- No `localStorage`, no `useEffect`, no data fetching in the client. The server passes everything in.

**Verify**: `bun run types:check` → exit 0, and `head -1 components/tool-presets.tsx` → `'use client';`.
Then `grep -c "role=\"switch\"" components/tool-presets.tsx` → at least 1.

### Step 6: Add the page — `app/global/tools/page.tsx`

Server component, `export const dynamic = 'force-dynamic'`, matching `app/global/settings/page.tsx`.

Load in parallel: `listToolUsage()` and `getDeniedTools()`.

Render, inside the `DocsPage`/`DocsTitle`/`DocsDescription`/`DocsBody` shell:

- Title `Tool budget`; description `~/.claude/settings.json → permissions.deny` in
  `font-mono text-xs` (matching the settings page).
- One short intro paragraph stating the mechanism in the user's terms: a bare tool name in
  `permissions.deny` removes that tool's definition from Claude's context entirely, so it stops
  costing tokens on every request; a scoped rule like `Bash(git:*)` does not. Tell them to run
  `/context` in Claude Code before and after to see the difference. Do **not** display estimated
  token savings — you have no way to compute them.
- `<h2>Tools</h2>` then `<ToolSwitches rows={rows} … />`. This section comes **first** — it is the
  primary interface.
- `<h2>Presets</h2>` then `<ToolPresets … />`, below the grid, introduced as *"Bundles that flip
  several switches at once."*
- Build `rows` on the server, in this order:
  1. Every `TOOL_CATALOG` entry, merged with its `ToolUsage` record if one exists (`count: 0`,
     `lastUsed: null` when it does not).
  2. Every `listToolUsage()` entry whose `name.startsWith('mcp__')`, appended as
     `{ purpose: '', group: 'mcp' }`. These are discovered, not catalogued — an MCP tool the user
     has never called cannot be discovered this way, and that is an accepted limitation. State it in
     one line under the `mcp` group heading: *"Only MCP tools this machine has actually called can be
     listed here. Use the 'No MCP tools at all' preset to remove the rest."*
  3. Drop any usage entry that is neither in the catalog nor `mcp__`-prefixed — a renamed or removed
     built-in — but keep it visible in the history section below.
- `<h2>Never used</h2>` — catalog tools with `count === 0` and not `protected`, as a plain list with
  each tool's purpose. This is a reading aid; the switches are in the grid above, so do not repeat
  them here. Precede the list with one sentence: *"Never used in the N sessions on this machine.
  Never used is a hint, not a recommendation — some tools are rare by nature (`ExitPlanMode`,
  `EndConversation`) and still needed when they fire."* Compute N as the total number of `.jsonl`
  files scanned; add a `sessionCount` to the return of `listToolUsage` only if that is cheap,
  otherwise derive it in the page from `listProjects()` and say so.
- `<h2>Usage history</h2>` — every entry from `listToolUsage()`, showing name, count, and last-used
  date formatted with `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` (matching
  `shortDate` in `lib/claude/tree.ts`). Group `mcp__` names under a sub-heading so the built-ins stay
  readable.
- Do not call `notFound()` — the page is useful even with zero transcripts, because the catalog and
  its switches are static. Render an empty-state line in the usage sections instead: *"No tool usage
  found in ~/.claude/projects."*

**Verify**: `bun dev`, open <http://localhost:3000/global/tools>. Expect: the page renders; the grid
lists 45 built-in switches plus the discovered `mcp__` ones; every switch is **on** (nothing is
denied yet); `EndConversation`, `ToolSearch` and `WaitForMcpServers` are on and `disabled`; the
"Usage history" top entry matches the top entry from the Step 2 script; and presets show `Off`.
**Do not flip a switch against the real settings file yet** — Step 8 covers the live test safely.

### Step 7: Add the sidebar entry — `lib/claude/tree.ts`

In `buildGlobalTree()`, immediately after the existing `if (settings !== null)` block, add:

```ts
  children.push({ type: 'page', name: 'Tools', url: '/global/tools' });
```

Unconditional — unlike Settings, this page works with no `settings.json` at all.

**Verify**: `bun run types:check` → exit 0, and with the dev server running, the global sidebar shows
`Overview → CLAUDE.md → Settings → Tools` before the per-project separators.

### Step 8: End-to-end test against a copy, then one live toggle

1. Point the app at a throwaway `CLAUDE_DIR` so the first real click cannot damage anything:

   ```bash
   mkdir -p /tmp/claude-ui-e2e && cp ~/.claude/settings.json /tmp/claude-ui-e2e/settings.json
   cp -R ~/.claude/projects /tmp/claude-ui-e2e/projects
   CLAUDE_DIR=/tmp/claude-ui-e2e bun dev
   ```

2. Open `/global/tools` and switch **`NotebookEdit`** off in the grid. Expect the switch to flip
   without a full page reload, and:

   ```bash
   bun -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/claude-ui-e2e/settings.json","utf8")).permissions)'
   ```

   → `{ deny: [ "NotebookEdit" ] }`.

2b. Exercise the three grid behaviours that only the UI enforces:

   - Click the **`Bash`** switch once. Expect a confirm prompt, **no write** — re-run the command
     above and confirm `deny` is still `["NotebookEdit"]`. Click **Cancel**.
   - Click **`Bash`** again, then **Confirm**. Expect `deny` to become `["NotebookEdit","Bash"]`.
     Then switch `Bash` back on in one click and confirm `deny` returns to `["NotebookEdit"]`.
   - Confirm the `ToolSearch` switch is not clickable (it is `disabled`).
   - Switch off one discovered MCP tool, e.g. `mcp__claude-in-chrome__javascript_tool`, and confirm
     it lands in `deny` verbatim. Switch it back on.

3. Turn `NotebookEdit` back on. Expect `{ deny: [] }` and every other top-level key still present:

   ```bash
   diff <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"))).sort().join("\n"))') \
        <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync("/tmp/claude-ui-e2e/settings.json","utf8"))).sort().join("\n"))')
   ```

   → exactly one extra line, `permissions`.

4. Confirm the backup exists: `ls -la /tmp/claude-ui-e2e/settings.ui-backup.json` → present.

5. `rm -rf /tmp/claude-ui-e2e`.

6. Only now, run once against the real directory and switch **`NotebookEdit`** off:
   `bun dev`, click, then
   `bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8")).permissions)'`
   → `{ deny: [ "NotebookEdit" ] }`. **Leave it on** — it is a genuinely unused tool here and it is
   the feature working. Report the before/after `~/.claude/settings.json` key list in your handoff so
   the reviewer can confirm nothing was lost.

## Test plan

There is no test framework in this repo and this plan does not add one — adding a runner is a
separate decision the repo owner has not made. The verification gates in Steps 2, 3, and 8 are the
test plan, and they are all machine-checkable. The three that matter most, and must not be skipped:

- **Step 3's `diff` of top-level keys** — proves the writer never drops user configuration.
- **Step 3's rejection cases** (`"*"`, `"Bash(rm -rf /)"`, `"ToolSearch"`, `"mcp__chrome__*"`) —
  prove the allowlist holds. It is the only security boundary, so these are the critical tests.
- **Step 8's core-tool confirm case** — proves a single stray click cannot switch off `Bash`.

If the repo later grows a test runner, these become the first three unit tests of
`lib/claude/settings-writer.ts`.

## Done criteria

ALL must hold:

- [ ] `bun run types:check` exits 0.
- [ ] `/global/tools` renders a per-tool switch grid (45 built-ins + discovered `mcp__` tools), a
      "Never used" list, a "Usage history" list, and 6 presets.
- [ ] Every switch reflects the file: on = absent from `permissions.deny`, off = present.
- [ ] `EndConversation`, `ToolSearch`, `WaitForMcpServers` render `disabled` and always on.
- [ ] A single click on a `core` switch (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill`)
      writes nothing; only the confirm click does. Turning one back on takes one click.
- [ ] `isWritableRule` returns true for `mcp__server__tool` and false for `mcp__server__*`, `*`,
      `Bash(rm *)`, and the three protected names (the Step 1 script).
- [ ] `grep -rn "CLAUDE_UI_ALLOW_WRITES\|writesEnabled\|readOnly" lib components app` → **no
      matches**. Writes are always on; no gate was reintroduced.
- [ ] `setDeniedTools(["*"], [])` returns `ok: false`; so does `setDeniedTools(["Bash(rm -rf /)"], [])`
      and `setDeniedTools(["EndConversation"], [])`.
- [ ] Toggling a preset on and off leaves every pre-existing top-level key in `settings.json`
      present (the Step 8 `diff` shows only `permissions` added).
- [ ] `~/.claude/settings.ui-backup.json` exists after a write, and `~/.claude/settings.json.bak` is
      unmodified (`git`-untracked, so check its mtime is older than the run).
- [ ] `grep -rn "use client" app components lib` matches exactly one file: `components/tool-presets.tsx`.
- [ ] No files outside the in-scope list are modified (`git status`). `AGENTS.md` may show modified
      after running `bun dev` — commit it, that is expected and documented in `AGENTS.md` itself.
- [ ] `plans/README.md` status row for 007 updated.

## STOP conditions

Stop and report back — do not improvise — if:

- The drift check shows `lib/claude/data.ts` or `lib/claude/tree.ts` changed since `b341f6b` in a way
  that contradicts the "Current state" excerpts.
- `~/.claude/settings.json` does not parse as a JSON object, or already contains a `permissions.deny`
  that is not an array. **Do not repair it.** Report what you found.
- Any verification in Step 3 or Step 8 shows a top-level key missing from the written file. Restore
  from the backup and stop.
- You find yourself wanting to write any settings key other than `permissions.deny` — including
  `env.ENABLE_TOOL_SEARCH`, `deniedMcpServers`, or `permissions.allow`. That is out of scope by
  design (see research notes 5 and the Scope section).
- The Server Action fails at runtime with `Failed to find Server Action` — that is a stale client
  bundle. Restart `bun dev` once; if it recurs, stop and report, because it may mean this Next
  version needs `experimental.serverActions` configuration this plan did not anticipate.
- You conclude a dependency is needed (a form library, a switch component, a JSON-with-comments
  parser). None is. Stop and report instead of installing.

## Maintenance notes

- **The catalog will drift.** Claude Code adds and renames tools between releases; the plan pins the
  45 names as of CLI 2.1.263 / 2026-09-07. A tool present in the user's context but absent from
  `lib/claude/tools.ts` will simply not be offered as a preset — it still shows up in the "Used" list
  because that is computed from transcripts. When refreshing the catalog, re-read
  <https://code.claude.com/docs/en/tools-reference>, and keep the three `protected: true` entries.
- **Reviewer, scrutinize `lib/claude/settings-writer.ts` and nothing else first.** Everything in this
  feature is safe if that file is safe, and since the writes are ungated it is the *only* boundary.
  Specifically check: the allowlist rejects before the read; `isWritableRule` is written as an
  allowlist rather than a blocklist; the write is temp-file-plus-rename; and the key-preservation
  assertion happens before the rename.
- **`core` is a UI-only guard.** `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep` and `Skill` are
  switchable by design — the confirm step is the whole protection. If someone later adds a
  keyboard shortcut or a bulk "disable all unused" button, it must route through the same confirm,
  or a stray click starts disabling the tools the user depends on.
- **Deliberately deferred**: MCP-server-level disabling via `deniedMcpServers`; project-scoped
  settings; listing MCP tools the user has never called (they cannot be discovered from
  transcripts); and any display of estimated token cost. A future plan could add a `/context`-style
  estimate, but only with a real measurement source, not a guess.
- **`mcp__*` is a blunt instrument.** It removes every MCP tool including the ones this user actively
  uses (12 distinct `mcp__*` tools recorded). It ships because it is the single biggest lever, but if
  the UI ever grows per-server control, that preset should be demoted.
