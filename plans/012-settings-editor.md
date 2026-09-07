# Plan 012: Editable settings page — every Claude Code setting and env var, driven by the official JSON schema

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b573de5..HEAD -- lib/claude/settings-writer.ts lib/claude/tools.ts lib/claude/data.ts lib/claude/tree.ts app/global/settings app/global/tools components/tool-presets.tsx`
> If any of those paths changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (five new/rewritten files, one refactor of the only write path, ~480 configurable keys — but almost all of it is derived from a schema file, not hand-written)
- **Risk**: MED — this widens the app's single write path from one key (`permissions.deny`) to every key in `~/.claude/settings.json`, including `env` where API keys can live. Mitigated by: schema-driven allowlist of paths, per-kind value validation, secret masking (secret values never leave the server), and the existing backup + atomic write + key-preservation assertion.
- **Depends on**: none at the code level. Plan 007 (tool budget page) is DONE on this same branch and this plan refactors its writer; plan 007's `permissions.deny` behaviour must remain identical afterwards. Plan 010 (plugins/hooks viewer) is independent; if it lands first it only adds a sidebar entry.
- **Category**: direction
- **Planned at**: commit `b573de5`, 2026-09-07

## Why this matters

Today `/global/settings` is a read-only JSON dump of five hand-picked sections, and `/global/tools`
can write exactly one key (`permissions.deny`). Everything else in Claude Code — roughly 140
top-level settings keys, a dozen nested objects, and 340 documented environment variables — can only
be changed by hand-editing `~/.claude/settings.json` and remembering the allowed values.

The repo owner's request, verbatim: *"have all settings be toggle-able, settings with valid options
should come with dropdowns, include env vars, etc. basically every single claude code setting should
be made available and configurable."*

After this plan lands, `/global/settings` shows every documented setting grouped by area, with a
switch for every boolean, a dropdown for every enum, a number input with the documented bounds for
every number, a one-per-line list editor for string arrays, a validated JSON editor for the handful
of complex shapes (hooks, marketplaces, MCP server lists), and an environment-variable editor with
dropdowns for the 164 env vars that have fixed values and masking for the 16 whose names mark them as credentials. Every
control shows the documented default when the key is unset, and every control has a "clear" action
that removes the key so Claude Code falls back to its default.

## Background research — the source of truth (verified 2026-09-07, do not re-derive)

**Do not hand-write a catalog of settings.** There is an official, maintained JSON Schema for
`settings.json` on SchemaStore, and it already contains everything the UI needs:

- URL: `https://json.schemastore.org/claude-code-settings.json` (draft-07, ~230 KB)
- 142 top-level keys (plus `$schema`, which the UI must ignore)
- `env.properties`: 340 documented environment variables, each with a `description`, and 164 of them
  with an `enum` of legal values (e.g. `DISABLE_AUTOUPDATER` → `["0","1"]`, `CLAUDE_CODE_EFFORT_LEVEL`
  → `["low","medium","high","xhigh","max","auto"]`, `OTEL_EXPORTER_OTLP_PROTOCOL` →
  `["grpc","http/json","http/protobuf"]`). `env.additionalProperties` is `{"type":"string"}`, so
  undocumented variables are legal too.
- `enum` on 26 non-env keys (`effortLevel`, `editorMode`, `tui`, `viewMode`, `theme` via `anyOf`,
  `permissions.defaultMode`, `preferredNotifChannel`, `teammateMode`, `workflowSizeGuideline`,
  `askUserQuestionTimeout`, `forceLoginMethod`, `autoUpdatesChannel`, `diffTool`, `defaultShell`, …)
- `default` on ~40 keys (`theme: "dark"`, `editorMode: "normal"`, `cleanupPeriodDays: 30`,
  `skillListingBudgetFraction: 0.01`, …)
- `minimum` / `maximum` on numeric keys (`cleanupPeriodDays ≥ 1`, `feedbackSurveyRate 0–1`,
  `sandbox.network.httpProxyPort 1–65535`, …)
- Nested objects with their own `properties`: `attribution(3)`, `permissions(7)`, `hooks(31)`,
  `statusLine(5)`, `fileSuggestion(2)`, `sandbox(16, nested further)`, `spinnerVerbs(2)`,
  `spinnerTipsOverride(2)`, `worktree(4)`, `autoMode(5)`, `subagentStatusLine(2)`, `voice(3)`,
  `policyHelper(3)`.
- Free-form objects (no `properties`, only `additionalProperties`): `modelOverrides`,
  `enabledPlugins`, `extraKnownMarketplaces`, `skillOverrides`, `pluginConfigs`, `vimInsertModeRemaps`.
- `$defs`: `permissionRule` (a string), `hookCommand`, `hookMatcher`. `permissions.allow/deny/ask`
  and every `hooks.<Event>` array use `$ref` into these.
- `anyOf`/`oneOf` on four keys: `theme` (enum **or** `^custom:.+`), `forceLoginOrgUUID` (string or
  string[]), `strictPluginOnlyCustomization` (boolean or enum[]), `policyHelper.refreshIntervalMs`
  (0 or ≥ 60000).
- Deprecated (marked `deprecated: true` or "deprecated" in the description): `includeCoAuthoredBy`,
  `fastMode`, `env.ANTHROPIC_SMALL_FAST_MODEL`, `env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`.
- Keys the docs say only take effect in **managed** (enterprise) settings — writing them to the user
  file is legal but does nothing. Detected by the description matching
  `/managed settings only|only in managed|only takes effect in managed|managed-only|enterprise/i`;
  that regex matches 31 keys today (`allowedMcpServers`, `deniedMcpServers`, `strictKnownMarketplaces`,
  `blockedMarketplaces`, `channelsEnabled`, `requiredMinimumVersion`, `claudeMd`, `sshHostAllowlist`,
  `parentSettingsBehavior`, `policyHelper.*`-adjacent keys, …). Show them, but badge them.
- Top-level `additionalProperties: true` — unknown keys are legal. The live file on this machine has
  one such key, `modelSettings` (per-model effort levels), which the schema does not know. The UI
  must still show and allow editing it (as JSON).
- `statusLine.type` is `const: "command"` — treat `const` as a one-option enum.

Other verified facts that shape the design:

- Claude Code **hot-reloads** `settings.json` for almost every key. Exceptions worth a footnote in
  the UI: `outputStyle`, `forceLoginMethod`, `forceLoginGatewayUrl`, `forceLoginOrgUUID`,
  `autoUpdatesChannel` (next start), and `model` (next session). Do not build per-key restart flags.
- `permissions.defaultMode` legal values today are
  `["acceptEdits","bypassPermissions","default","delegate","dontAsk","plan","auto","manual"]`.
  `bypassPermissions` "cannot be set in project or local settings; user or managed only" and skips
  every prompt — it is the one value that warrants a confirmation dialog.
- The `~/.claude.json` file is **app state**, not settings (OAuth account, per-project trust, caches,
  onboarding flags). It is **out of scope**; do not read or write it. `keybindings.json`,
  `.mcp.json`, and CLAUDE.md are also separate mechanisms and out of scope.
- `permissions.deny` bare tool names are the domain of `/global/tools` (plan 007). This page must
  **not** offer a second writer for that array — it shows the array read-only with a link to
  `/global/tools`. Every other key under `permissions` is editable here.
- Secret env vars: the schema does not flag secrets. Detect by name with
  `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/` **and exclude** the four false positives that match that
  regex but are token *counts*, not credentials: `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`,
  `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `MAX_MCP_OUTPUT_TOKENS`, `MAX_THINKING_TOKENS`. That leaves
  16 secret names today (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_AWS_API_KEY`,
  `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`,
  `CLAUDE_CODE_CLIENT_KEY`, `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `MCP_CLIENT_SECRET`,
  `OTEL_EXPORTER_OTLP_CLIENT_KEY`, `OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY`,
  `OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY`, `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY`). Custom
  (undocumented) variable names go through the same regex.
- Every documented env var name matches `^[A-Z][A-Z0-9_]*$` (verified across all 340). Accept
  custom names matching `^[A-Z_][A-Z0-9_]*$` only.

## Current state

### Repo shape

- Next.js 16 app router, Fumadocs UI shell, Tailwind v4, `bun` as package manager. No tests, no
  linter. `bun run types:check` is the only automated gate.
- `lib/claude/data.ts` — all read-side filesystem access. `getSettings()` (lines 121–131) returns the
  parsed user settings or `null`. `CLAUDE_DIR = process.env.CLAUDE_DIR ?? ~/.claude`.
- `lib/claude/settings-writer.ts` — **the only file that writes to disk** (plan 007). One export,
  `setDeniedTools(add, remove)`. Reproduced in full below because Step 2 refactors it.
- `lib/claude/tools.ts` — tool catalog + `isWritableRule()`. Untouched by this plan.
- `app/global/tools/{page,actions}.tsx` — the existing write UI. Pattern to copy for Server Actions.
- `components/tool-presets.tsx` — client component with the `Switch`, `ErrorBox`, confirm-before-write
  and `useTransition` patterns this plan reuses.
- `app/global/settings/page.tsx` — the read-only dump this plan replaces.
- `lib/claude/tree.ts` — sidebar; line 32–34 only adds the Settings entry when the file exists.

### `lib/claude/settings-writer.ts` as of `b573de5` (entire file — the refactor target)

```ts
// The only file in this app that writes to disk.
//
// Deployment note: `bun dev` binds localhost by default. Do NOT run this app with
// `-H 0.0.0.0` on an untrusted network — the Server Action that calls into here is a
// POST endpoint, reachable by anything that can reach the port. The allowlist below
// is the only security boundary this feature has.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isWritableRule, TOOL_CATALOG } from './tools';

const CLAUDE_DIR = process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const BACKUP_PATH = path.join(CLAUDE_DIR, 'settings.ui-backup.json');

const MAX_RULES_PER_REQUEST = 100;

export type WriteResult = { ok: true; denied: string[] } | { ok: false; error: string };

/** Catalog order first, then anything else (e.g. mcp__ names) in the order given. */
function catalogOrder(rules: string[]): string[] { /* … */ }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Add or remove bare-name deny rules in ~/.claude/settings.json. */
export async function setDeniedTools(add: string[], remove: string[]): Promise<WriteResult> {
  // (1) argument validation against isWritableRule …
  // (2) read + parse SETTINGS_PATH; null if missing; refuse if not a plain object
  //     const originalKeys = Object.keys(settings);
  // (3) ensure settings.permissions is an object and permissions.deny an array
  // (4) set-semantics mutate permissions.deny
  // (5) const serialized = `${JSON.stringify(settings, null, 2)}\n`;
  //     round-trip parse; refuse if any originalKey missing
  // (6) if raw !== null: fs.copyFile(SETTINGS_PATH, BACKUP_PATH), refuse on failure
  // (7) write to `${CLAUDE_DIR}/.settings.json.tmp-<random>` then fs.rename over SETTINGS_PATH
  // (8) return { ok: true, denied: nextDeny }
}
```

Steps (2), (5), (6), (7) are generic. Steps (1), (3), (4), (8) are deny-specific. Step 2 of this plan
splits them.

### `app/global/tools/actions.ts` as of `b573de5` (the Server Action pattern to copy)

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { setDeniedTools, type WriteResult } from '@/lib/claude/settings-writer';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export async function updateDeniedTools(add: string[], remove: string[]): Promise<WriteResult> {
  // Every export here is a public POST endpoint — guard at the boundary too.
  if (!isStringArray(add) || !isStringArray(remove)) return { ok: false, error: 'Invalid request.' };
  const result = await setDeniedTools(add, remove);
  if (result.ok) revalidatePath('/global/tools');
  return result;
}
```

### `components/tool-presets.tsx` — the UI primitives to copy (excerpt, lines 31–75)

```tsx
function ErrorBox({ result }: { result: WriteResult | null }) {
  if (result === null || result.ok) return null;
  return (
    <p className="rounded border border-fd-primary/50 bg-fd-card px-3 py-2 text-sm text-fd-foreground">
      {result.error}
    </p>
  );
}

function Switch({ on, disabled, label, onClick }: { on: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded border px-2 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary disabled:opacity-50">
      <span aria-hidden className={`h-2 w-2 rounded-full ${on ? 'bg-fd-primary' : 'bg-fd-muted-foreground'}`} />
      <span className="w-8 text-left font-mono">{on ? 'on' : 'off'}</span>
    </button>
  );
}
```

The write-then-refresh pattern in the same file (lines 104–113):

```tsx
const [isPending, startTransition] = useTransition();
function apply(add: string[], remove: string[], name: string) {
  setPendingName(name);
  startTransition(async () => {
    const r = await action(add, remove);
    setResult(r);
    setPendingName(null);
    setConfirming(null);
  });
}
```

Because the Server Action calls `revalidatePath`, the server component re-renders with the new file
contents after the transition; the client component receives fresh props. There is no client-side
copy of settings state to keep in sync.

### `app/global/settings/page.tsx` as of `b573de5` (to be replaced entirely)

A server component with `export const dynamic = 'force-dynamic'`, a hard-coded `SECTIONS` list of
five groups, `notFound()` when `getSettings()` is `null`, and one `<pre>{JSON.stringify(v)}</pre>`
per present key. Nothing in it survives except the `DocsPage`/`DocsTitle`/`DocsDescription`/
`DocsBody` wrapper and the `dynamic` export.

### `lib/claude/tree.ts:32-35`

```ts
  if (settings !== null) {
    children.push({ type: 'page', name: 'Settings', url: '/global/settings' });
  }
  children.push({ type: 'page', name: 'Tools', url: '/global/tools' });
```

### Live data on this machine (2026-09-07)

- `~/.claude/settings.json` has 22 top-level keys, including `env` with 4 variables
  (`CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`,
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, `DISABLE_AUTOUPDATER`), `hooks`, `statusLine`,
  `enabledPlugins`, `extraKnownMarketplaces`, `modelSettings` (not in schema), and scalar keys such as
  `model`, `effortLevel`, `theme`, `tui`, `editorMode`, `outputStyle`, `workflowSizeGuideline`.
  None of the 4 env vars is a secret. No `permissions` key exists yet.
- `~/.claude/settings.ui-backup.json` does not exist yet (no UI write has happened on the real dir).
- Installed CLI: `claude --version` → `2.1.263`.

### Conventions to match

- Pages: server components, `export const dynamic = 'force-dynamic'`, Fumadocs `DocsPage` wrapper,
  `DocsDescription className="mb-0 font-mono text-xs"` holding the file path — see
  `app/global/tools/page.tsx`.
- Client components: `'use client'`, plain Tailwind with `fd-*` tokens, `not-prose` on the root of
  any form so Fumadocs typography does not style inputs — see `components/tool-presets.tsx`.
- No new npm dependencies. React 19 + Node `fs` only.
- Commit messages: short imperative subject, no prefix (`Tool budget page at /global/tools`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 (already installed; run only if `node_modules` is missing) |
| Typecheck | `bun run types:check` | exit 0, no errors |
| Dev server | `bun dev` | `Local: http://localhost:3000` |
| Dev server against a throwaway dir | `CLAUDE_DIR=/tmp/claude-ui-e2e bun dev` | same |
| Run a TS module ad hoc | `bun -e '…'` or `bun run file.ts` | prints |
| Build | `bun run build` | exit 0 (optional, slow) |

## Scope

**In scope** (the only files you may modify or create):

- `lib/claude/settings-schema.json` (create) — vendored copy of the SchemaStore schema.
- `lib/claude/settings-schema.ts` (create) — schema loader, field derivation, grouping, validation.
- `lib/claude/settings-writer.ts` (modify) — extract the generic write path; add `setSettingValue`.
- `app/global/settings/actions.ts` (create) — Server Actions.
- `app/global/settings/page.tsx` (rewrite).
- `components/settings-form.tsx` (create) — client components.
- `lib/claude/tree.ts` (modify) — make the Settings sidebar entry unconditional (3 lines).
- `plans/README.md` (modify) — status row.

**Out of scope** (do NOT touch, even though they look related):

- `lib/claude/tools.ts`, `app/global/tools/*`, `components/tool-presets.tsx` — plan 007's UI. Its
  `updateDeniedTools` action must keep working unchanged after the writer refactor. Do not export
  `Switch` from `tool-presets.tsx` and import it; copy the 15 lines instead (two copies of a tiny
  component are cheaper than coupling two done features).
- `lib/claude/data.ts` — `getSettings()` is already what this page needs. Do not add readers.
- `~/.claude.json`, `~/.claude/keybindings.json`, `.mcp.json`, `CLAUDE.md`, `output-styles/`,
  `themes/` — different mechanisms. Not settings.
- Project-scope settings (`<repo>/.claude/settings.json`, `settings.local.json`) and managed
  settings. **User scope only**, same as plan 007. A scope switcher is a follow-up.
- Editing `permissions.deny` from this page (read-only + link to `/global/tools`).
- Any "restart required" or "effective value across scopes" computation. One footnote, no logic.
- Adding any npm dependency (no JSON-schema validator library — the subset of validation needed is
  ~60 lines and is specified below).

## Git workflow

- Branch: `advisor/012-settings-editor`, branched from `advisor/007-tool-budget-presets` (which
  contains the writer this plan refactors). If the repo owner has merged 007 to `main` by the time
  you start, branch from `main` instead and confirm `lib/claude/settings-writer.ts` is present.
- Commit per step. Subject style: `Settings schema: vendor SchemaStore JSON and field derivation`,
  `Settings writer: generic guarded setSettingValue`, `Settings page: editable form for every key`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Vendor the schema and write the derivation module — `lib/claude/settings-schema.json`, `lib/claude/settings-schema.ts`

1a. Download the schema (read-only network call, one time):

```bash
curl -sL -o lib/claude/settings-schema.json https://json.schemastore.org/claude-code-settings.json
bun -e 'const s=require("./lib/claude/settings-schema.json");console.log(s.$id, Object.keys(s.properties).length, Object.keys(s.properties.env.properties).length)'
```

**Verify**: prints `https://json.schemastore.org/claude-code-settings.json 143 340` (143 counts the
`$schema` property; 142 real keys). Counts may be slightly higher if SchemaStore updated the file
since 2026-09-07 — that is fine. If the download fails or the file is not JSON with a top-level
`properties.env.properties` object, STOP.

Add a comment header nowhere in the JSON (JSON has no comments); instead document the source and
refresh command at the top of `settings-schema.ts`:

```ts
// Vendored from https://json.schemastore.org/claude-code-settings.json on 2026-09-07.
// Refresh: curl -sL -o lib/claude/settings-schema.json https://json.schemastore.org/claude-code-settings.json
```

1b. Write `lib/claude/settings-schema.ts`. It is server-only (imports a 230 KB JSON); never import
it from a `'use client'` file. Exports:

```ts
import schema from './settings-schema.json';

export type Kind =
  | 'boolean' | 'enum' | 'enumOrCustom' | 'integer' | 'number'
  | 'string' | 'stringList' | 'enumList' | 'json';

export interface Field {
  /** Dot-joined path, e.g. "permissions.defaultMode". */
  key: string;
  path: string[];
  kind: Kind;
  /** For enum / enumOrCustom / enumList. */
  options?: string[];
  /** For enumOrCustom: the regex the custom value must match (source string). */
  customPattern?: string;
  default?: unknown;
  min?: number;
  max?: number;
  description: string;
  /** First https://… URL found in the description, if any. */
  docsUrl?: string;
  deprecated: boolean;
  managedOnly: boolean;
  /** Read-only on this page; the description says where it is edited. */
  readOnly?: string;
  group: string;
}

export interface EnvSpec {
  name: string;
  description: string;
  options?: string[];
  secret: boolean;
  deprecated: boolean;
  group: string;
}

/** Every editable field, flattened, in schema order. Excludes `$schema` and `env`. */
export function listFields(): Field[];
/** Documented env vars in schema order. */
export function listEnvSpecs(): EnvSpec[];
/** True for names that must be masked. Applies to custom names too. */
export function isSecretEnvName(name: string): boolean;
/** Valid custom env var name. */
export const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
/** Resolve a path to its schema node, following $ref; null if the path is not in the schema. */
export function resolveNode(path: string[]): SchemaNode | null;
/** Validate a value against a node. Returns null when valid, else a human-readable reason. */
export function validate(node: SchemaNode, value: unknown): string | null;
/** Group display order. */
export const GROUP_ORDER: string[];
```

Derivation rules for `kindOf(node)` — apply in this order, first match wins:

1. `node.$ref` → replace the node with `schema.$defs[<name>]` and re-run (only `#/$defs/<name>` refs
   exist; anything else → `json`).
2. `node.type === 'boolean'` → `boolean`.
3. `node.const !== undefined` → `enum` with `options = [String(node.const)]`.
4. `node.enum` → `enum`.
5. `node.anyOf` where one branch has `enum` and another has `pattern` (this is `theme`) →
   `enumOrCustom`, `options` from the enum branch, `customPattern` from the pattern branch.
6. `node.type === 'integer'` → `integer`; `'number'` → `number`. Carry `minimum`/`maximum` to
   `min`/`max`. (`exclusiveMinimum` → `min = value + 1` for integers; ignore for numbers.)
7. `node.type === 'string'` → `string`.
8. `node.type === 'array'`: resolve `items.$ref` first. If items is `{type:'string'}` without
   `enum` → `stringList`. If items has `enum` → `enumList`. Anything else → `json`.
9. Everything else (`object` without `properties`, remaining `anyOf`/`oneOf`, `type: [..]` arrays,
   `hooks`) → `json`.

Flattening rules for `listFields()`:

- Iterate `schema.properties` in object order. Skip `$schema` and `env`.
- Special-case `hooks`: one field, `kind: 'json'` (do not flatten its 31 event arrays).
- For a node with `type: 'object'` **and** `properties`, recurse with the path extended. Do not emit
  a field for the object itself.
- Otherwise emit one field. `deprecated = node.deprecated === true || /deprecated/i.test(description)`.
  `managedOnly = /managed settings only|only in managed|only takes effect in managed|managed-only|enterprise/i.test(description)`.
  `docsUrl = description.match(/https?:\/\/\S+/)?.[0]` with a trailing `.` or `)` trimmed.
- `permissions.deny` gets `readOnly: 'Edited on the Tools page.'`.
- `group` from `groupOf(key)` below.

`groupOf(key)`: first matching rule wins; unmatched → `'Other'`. Implement as an array of
`[groupName, RegExp]` tested against the dot-joined key:

```
Model & reasoning     ^(model|fallbackModel|availableModels|enforceAvailableModels|modelPicker|modelOverrides|advisorModel|teammateDefaultModel|effortLevel|alwaysThinkingEnabled|showThinkingSummaries|fastMode|fastModePerSessionOptIn|promptCacheTtl|subagentPromptCacheTtl|agent|autoCompactEnabled|autoCompactWindow)$
Permissions           ^(permissions\.|autoMode\.|disableAutoMode|useAutoModeDuringPlan|skipAutoPermissionPrompt|skipDangerousModePermissionPrompt|skipWebFetchPreflight)
Sandbox               ^sandbox\.
Hooks                 ^(hooks|disableAllHooks|allowedHttpHookUrls|httpHookAllowedEnvVars)$
Plugins & marketplaces ^(enabledPlugins|extraKnownMarketplaces|strictKnownMarketplaces|blockedMarketplaces|skippedMarketplaces|skippedPlugins|pluginConfigs|skipDangerousPluginsCheck|pluginSuggestionMarketplaces|pluginTrustMessage|disableCommandPluginSources|disableSideloadFlags|allowedChannelPlugins|channelsEnabled)$
MCP                   ^(enableAllProjectMcpServers|enabledMcpjsonServers|disabledMcpjsonServers|allowedMcpServers|deniedMcpServers|managedMcpServers|allowManagedMcpServersOnly|allowAllClaudeAiMcps|disableClaudeAiConnectors)$
Skills & workflows    ^(skillOverrides|skillListing|disableBundledSkills|disableSkillShellExecution|syncClaudeAiSkills|disableWorkflows|enableWorkflows|workflow|plansDirectory|useWorktreesForRoutines|worktree\.)
Memory & sessions     ^(autoMemory|cleanupPeriodDays|desktopSessionCleanupPeriodDays|fileCheckpointingEnabled|claudeMdExcludes|includeGitInstructions|attribution\.|includeCoAuthoredBy|prUrlTemplate|footerLinksRegexes)
Interface             ^(theme|tui|viewMode|editorMode|vimInsertModeRemaps|statusLine\.|subagentStatusLine\.|spinner|terminalProgressBarEnabled|showTurnDuration|prefersReducedMotion|autoScrollEnabled|emojiCompletionEnabled|promptSuggestionEnabled|respectGitignore|fileSuggestion\.|defaultShell|respondToBashCommands|bashOutputMaxChars|language|outputStyle|showClearContextOnPlanAccept|awaySummaryEnabled|diffTool|externalEditorContext|autoConnectIde|autoInstallIdeExtension|axScreenReader|verbose|spellcheck|enableArtifact|disableArtifact)
Notifications & voice ^(preferredNotifChannel|inputNeededNotifEnabled|agentPushNotifEnabled|voice\.|askUserQuestionTimeout|dialogExpiry)
Remote & agents       ^(remoteControlAtStartup|disableRemoteControl|remote\.|crossSessionInbound|isolatePeerMachines|teammate|disableAgentView|sshConfigs|sshHostAllowlist)
Auth & providers      ^(apiKeyHelper|forceLogin|awsAuthRefresh|awsCredentialExport|gcpAuthRefresh|otelHeadersHelper)
Updates & telemetry   ^(autoUpdatesChannel|minimumVersion|requiredMinimumVersion|requiredMaximumVersion|feedbackSurveyRate|feedbackDrafts|companyAnnouncements|disableDeepLinkRegistration)
Managed / enterprise  ^(policyHelper\.|parentSettingsBehavior|managedSourcesBehavior|allowManaged|forceRemoteSettingsRefresh|claudeMd$|strictPluginOnlyCustomization|modelPricing|browserExternalPageTools|disableBrowserExternalNavigation|disableMobileSimulatorTools|disableDesktopLocalSessions|requireCoworkFullVmSandbox|wslInheritsWindowsSettings|processWrapper)
```

`GROUP_ORDER` is that list in that order, then `'Other'`, then `'Deprecated'` (the page moves
deprecated fields into a trailing group regardless of their rule match). Keys landing in `Other` are
acceptable; report how many in your handoff.

`listEnvSpecs()`: iterate `schema.properties.env.properties`; `options = node.enum`;
`secret = isSecretEnvName(name)`; `group` by prefix: `ANTHROPIC_` → `'Anthropic & providers'`,
`CLAUDE_CODE_` or `CLAUDE_` → `'Claude Code'`, `DISABLE_|ENABLE_|FORCE_` → `'Feature switches'`,
`OTEL_` → `'Telemetry (OTel)'`, `MCP_` → `'MCP'`, `BASH_|API_|HTTP|HTTPS|NO_PROXY|USE_` → `'Runtime'`,
else `'Other'`.

`isSecretEnvName(name)`:
```ts
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/;
const NOT_SECRET = new Set([
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS', 'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'MAX_MCP_OUTPUT_TOKENS', 'MAX_THINKING_TOKENS',
]);
export function isSecretEnvName(name: string): boolean {
  return SECRET.test(name) && !NOT_SECRET.has(name);
}
```

`resolveNode(path)`: walk from `schema` following `properties[segment]`; if a segment is missing and
the current node is `env` (path `['env', NAME]`), return the synthetic node `{type:'string'}` when
`ENV_NAME.test(NAME)`; if the root has `additionalProperties: true` and `path.length === 1` return
the synthetic node `{ type: 'any' }` (used for unknown top-level keys like `modelSettings`); otherwise
`null`. Follow `$ref` at each hop.

`validate(node, value)` — the only validation this app does; return the first failing reason:

- `undefined` is always valid (it means "delete").
- `$ref` → resolve, recurse.
- `type: 'any'` (synthetic) → valid if `value` is JSON-serialisable (`JSON.stringify` does not throw
  and returns a string).
- `const` → `value === const`.
- `enum` → `enum.includes(value)`.
- `anyOf` / `oneOf` → valid if **any** branch validates (do not enforce oneOf exclusivity).
- `type: 'boolean'` → `typeof value === 'boolean'`.
- `type: 'integer'` → `Number.isInteger(value)`; `'number'` → `typeof value === 'number' && Number.isFinite(value)`;
  both check `minimum`, `maximum`, `exclusiveMinimum`.
- `type: 'string'` → `typeof value === 'string'`, then `pattern` (as `new RegExp(pattern)`), `minLength`.
- `type: 'array'` → `Array.isArray`, then each item against `items`, `minItems`, and `uniqueItems`
  (compare with `JSON.stringify`).
- `type: 'object'` → plain object; each key that appears in `properties` validates against it;
  keys not in `properties` are valid if `additionalProperties` is `true`/absent or validate against
  it when it is a schema; invalid if `additionalProperties === false`; every `required` key present.
- `type` given as an array (e.g. `["string","null"]`) → valid if any listed type matches.
- No `type`, no `enum`, no `anyOf` → valid.

**Verify** (run all four):

```bash
bun -e 'import("./lib/claude/settings-schema.ts").then(m=>{const f=m.listFields();const c={};for(const x of f)c[x.kind]=(c[x.kind]||0)+1;console.log(f.length,c);console.log("other:",f.filter(x=>x.group==="Other").map(x=>x.key).join(","));console.log("deny readOnly:",f.find(x=>x.key==="permissions.deny")?.readOnly)})'
```
→ first line between `195` and `215` fields; `boolean` ≈ 77, `enum` ≈ 26, `stringList` ≈ 33
(the two `permissions.allow`/`ask` arrays resolve through `$ref` to strings), `json` ≈ 23; `deny
readOnly: Edited on the Tools page.`

```bash
bun -e 'import("./lib/claude/settings-schema.ts").then(m=>{const e=m.listEnvSpecs();console.log(e.length,e.filter(x=>x.secret).length,e.filter(x=>x.options).length,e.filter(x=>x.deprecated).length)})'
```
→ `340 16 164 2`

```bash
bun -e 'import("./lib/claude/settings-schema.ts").then(m=>{const n=(p)=>m.resolveNode(p.split("."));console.log(m.validate(n("editorMode"),"vim"),m.validate(n("editorMode"),"emacs"),m.validate(n("cleanupPeriodDays"),0),m.validate(n("theme"),"custom:foo"),m.validate(n("theme"),"neon"),m.validate(n("permissions.allow"),["Bash(git:*)"]),m.validate(n("permissions.allow"),["a","a"]),m.validate(n("env.MY_VAR"),"x"),m.validate(n("modelSettings"),{a:1}),m.resolveNode(["env","lower"]),m.resolveNode(["nope","x"]))})'
```
→ `null <reason> <reason> null <reason> null <reason> null null null null` — i.e. positions 1, 4,
6, 8, 9 print `null` (valid), positions 2, 3, 5, 7 print a non-empty string, the last two print
`null` because the paths do not resolve.

```bash
bun run types:check
```
→ exit 0.

### Step 2: Generalise the writer — `lib/claude/settings-writer.ts`

Refactor without changing `setDeniedTools`'s observable behaviour:

2a. Extract the generic read → mutate → assert → back up → atomic-write sequence into

```ts
type Mutator = (settings: Record<string, unknown>) => string | null; // return an error to abort

async function mutateSettings(mutate: Mutator): Promise<{ ok: true; settings: Record<string, unknown> } | { ok: false; error: string }>
```

containing verbatim the current steps (2), (5), (6), (7) and calling `mutate(settings)` in between.
The `originalKeys` round-trip assertion stays. A mutator returning a string aborts before any file is
touched.

2b. Re-implement `setDeniedTools` on top of it: argument validation stays first; the body of the old
steps (3)+(4) becomes the mutator; on success return `{ ok: true, denied: … }` computed from the
returned settings. `WriteResult` keeps its shape so `app/global/tools/actions.ts` compiles untouched.

2c. Add:

```ts
export type SetResult = { ok: true } | { ok: false; error: string };

/**
 * Set (or with `value === undefined`, delete) one setting at `path`.
 * Refuses paths the schema does not know, `$schema`, and `permissions.deny`.
 */
export async function setSettingValue(path: string[], value: unknown): Promise<SetResult>
```

Rules, in order:

1. `path` must be a non-empty array of non-empty strings, each matching `/^[A-Za-z0-9_$.:@-]+$/`
   (env var names and plugin ids like `diagrams@second-brain` contain `@`; keep `.` allowed because
   `extraKnownMarketplaces` keys can contain it — but note that this app only writes leaf paths
   derived from the schema, never user-typed paths except `env.<NAME>`).
2. Refuse `path[0] === '$schema'` and `path.join('.') === 'permissions.deny'` with
   `Refused: permissions.deny is edited on the Tools page.`.
3. `node = resolveNode(path)`; `null` → `Refused: <key> is not a setting this app may write.`.
   For `['env', NAME]`, additionally require `ENV_NAME.test(NAME)`.
4. Unknown top-level keys (the synthetic `any` node) are only writable when the key **already exists**
   in the file (checked inside the mutator) — the UI can edit `modelSettings` but cannot invent new
   top-level keys the schema does not know.
5. `validate(node, value)` → non-null → `Refused: <key>: <reason>`.
6. `JSON.stringify(value).length > 65536` → refuse (`Refused: value too large.`).
7. Mutator: walk `path[0..-1]`, creating plain objects as needed (refuse if an intermediate exists
   and is not a plain object). If `value === undefined`, `delete` the leaf, then prune every
   intermediate object that became empty **and** was not present in the original file (compute the
   set of pre-existing intermediate paths before mutating; never prune `permissions` or `env` if they
   pre-existed even when empty). Otherwise assign.

**Verify** — against a throwaway directory, never the real one:

```bash
mkdir -p /tmp/claude-ui-e2e && cp ~/.claude/settings.json /tmp/claude-ui-e2e/settings.json
CLAUDE_DIR=/tmp/claude-ui-e2e bun -e '
const w = await import("./lib/claude/settings-writer.ts");
const read = () => JSON.parse(require("fs").readFileSync("/tmp/claude-ui-e2e/settings.json","utf8"));
const before = Object.keys(read()).sort().join(",");
console.log(await w.setSettingValue(["editorMode"], "vim"), read().editorMode);
console.log(await w.setSettingValue(["editorMode"], "emacs"));
console.log(await w.setSettingValue(["permissions","defaultMode"], "plan"), read().permissions);
console.log(await w.setSettingValue(["permissions","defaultMode"], undefined), read().permissions);
console.log(await w.setSettingValue(["permissions","deny"], ["Bash"]));
console.log(await w.setSettingValue(["env","MY_FLAG"], "1"), read().env.MY_FLAG);
console.log(await w.setSettingValue(["env","MY_FLAG"], undefined), read().env.MY_FLAG);
console.log(await w.setSettingValue(["env","bad name"], "1"));
console.log(await w.setSettingValue(["notAKey"], 1));
console.log(await w.setSettingValue(["modelSettings"], {"claude-opus-5":{effortLevel:"high"}}), read().modelSettings);
console.log(await w.setDeniedTools(["NotebookEdit"], []), read().permissions);
console.log(await w.setDeniedTools([], ["NotebookEdit"]), read().permissions);
console.log("keys unchanged:", before === Object.keys(read()).filter(k=>k!=="permissions").sort().join(","));
'
```

Expected, line by line:

1. `{ ok: true } vim`
2. `{ ok: false, error: "Refused: editorMode: …" }`
3. `{ ok: true } { defaultMode: "plan" }`
4. `{ ok: true } undefined` — `permissions` was pruned because it did not pre-exist.
5. `{ ok: false, error: "Refused: permissions.deny is edited on the Tools page." }`
6. `{ ok: true } 1`
7. `{ ok: true } undefined` — `env` itself still exists (it pre-existed).
8. `{ ok: false, … }`
9. `{ ok: false, … }`
10. `{ ok: true } { "claude-opus-5": { effortLevel: "high" } }`
11. `{ ok: true, denied: [ "NotebookEdit" ] } { deny: [ "NotebookEdit" ] }`
12. `{ ok: true, denied: [] } { deny: [] }`
13. `keys unchanged: true`

Then restore the throwaway file's `editorMode` (or just re-copy) and confirm the backup exists:
`ls /tmp/claude-ui-e2e/settings.ui-backup.json`. Run `bun run types:check` → exit 0.

### Step 3: Server Actions — `app/global/settings/actions.ts`

Copy the shape of `app/global/tools/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { setSettingValue, type SetResult } from '@/lib/claude/settings-writer';

function isPath(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0);
}

/** `value === null` on the wire means "delete" (undefined does not survive serialisation). */
export async function updateSetting(path: string[], value: unknown): Promise<SetResult> {
  if (!isPath(path)) return { ok: false, error: 'Invalid request.' };
  const result = await setSettingValue(path, value === null ? undefined : value);
  if (result.ok) revalidatePath('/global/settings');
  return result;
}
```

`null` as the delete sentinel is safe because exactly one schema key accepts `null` as a value:
`teammateDefaultModel` (`type: ["string","null"]`, where `null` means "no default"). Deleting the
key has the same effect, so the sentinel is harmless there. Document this in a comment next to the
sentinel.

**Verify**: `bun run types:check` → exit 0.

### Step 4: Client components — `components/settings-form.tsx`

`'use client'`. Import types only from `lib/claude/settings-schema.ts`
(`import type { Field, EnvSpec }`) — never a value import, or the 230 KB JSON ships to the browser.

Props are plain data computed by the server component:

```ts
export interface FieldRow extends Field { value: unknown; isSet: boolean }
export interface EnvRow { name: string; value: string | null; isSet: boolean; secret: boolean; options?: string[]; description: string; deprecated: boolean; group: string }
type Update = (path: string[], value: unknown) => Promise<SetResult>;

export function SettingsForm({ rows, action }: { rows: FieldRow[]; action: Update })
export function EnvForm({ rows, specs, action }: { rows: EnvRow[]; specs: EnvSpec[]; action: Update })
```

`SettingsForm` behaviour:

- Root `div.not-prose`. A filter `<input type="search">` matching `key` and `description` (case
  insensitive), a "show only set keys" checkbox, and a count line `N of M keys set`.
- Rows grouped by `group` in `GROUP_ORDER` (pass the order as a prop or hard-code the same list; the
  page passes it). Deprecated rows render in a trailing "Deprecated" group and are hidden unless set.
  Each group is a `<section>` with an `<h3>`; empty groups (after filtering) are not rendered.
- Each row: monospace `key`, a badge column (`default` when `!isSet`, `managed-only` when
  `managedOnly`, `deprecated`), the control, a **Clear** button (only when `isSet` and not
  `readOnly`), then the description as `text-xs text-fd-muted-foreground` with the `docsUrl` as a
  trailing "docs ↗" link (`target="_blank" rel="noreferrer"`).
- Control by `kind`:
  - `boolean` → the copied `Switch`. Displays `isSet ? value : (default ?? false)`. Click writes the
    negation of the displayed value. (An unset boolean showing `off` becomes an explicit `true`.)
  - `enum` → `<select>` with a first option `— default${default !== undefined ? ` (${default})` : ''} —`
    whose value is the empty string, then one `<option>` per `options` entry. Selecting the empty
    option writes `null` (delete); anything else writes the string. Style:
    `rounded border bg-fd-secondary px-2 py-1 text-sm`.
  - `enumOrCustom` → the `enum` select plus a text input that appears when the select's current
    value is not in `options` (or the user picks a final option `custom…`); the input writes on Enter
    or on a Save button.
  - `integer` / `number` → `<input type="number">` with `min`/`max`/`step` (`step=1` for integer,
    `any` for number); Save button; writes `Number(input.value)`; empty input + Save writes `null`.
  - `string` → `<input type="text">` + Save; empty string is a legal value for some keys
    (`attribution.commit: ""` hides attribution), so Save with an empty box writes `""` and only the
    Clear button deletes.
  - `stringList` → `<textarea rows=3>` one entry per line + Save; writes the trimmed, non-empty,
    deduplicated lines; an empty textarea + Save writes `[]`.
  - `enumList` → one checkbox per option; each change writes the full array.
  - `json` → `<textarea rows=6 class="font-mono">` pre-filled with `JSON.stringify(value, null, 2)`
    (or empty), Save parses with `JSON.parse` client-side and shows the parse error inline without
    calling the action; on success writes the parsed value. Empty textarea + Save writes `null`.
  - Any row with `readOnly` renders the value as a `<pre>` plus the `readOnly` text with
    `permissions.deny` linking to `/global/tools`.
- Confirmation before write, reusing the inline confirm pattern from `tool-presets.tsx`, for exactly
  these cases: `permissions.defaultMode` → `bypassPermissions`; `disableAllHooks` → `true`;
  `permissions.disableBypassPermissionsMode` → any change; any Clear on a `json` row. Message:
  `Write <key> = <value>? Claude Code reads this file for every session.`
- Write plumbing: one `useTransition` for the whole form, a `pendingKey` so only the row being
  written is disabled, `ErrorBox` (copied) at the top showing the last error, and a small
  `Saved <key>` line that clears after the next interaction. No client-side settings state: after
  `revalidatePath` the page re-renders with fresh `rows`.
- Local draft state for text/number/textarea inputs lives in a `Map<string, string>` keyed by row
  key, reset when `rows` changes (compare `JSON.stringify(row.value)` in a `useEffect` keyed on it,
  or simpler: key each input's `defaultValue` by `${row.key}:${JSON.stringify(row.value)}` so React
  remounts it on change). Either is acceptable; say which in the handoff.

`EnvForm` behaviour:

- Section "Set variables": one row per `EnvRow` with `isSet`. Control: `<select>` when `options`
  exist (same default-option convention, where "default" means delete); otherwise a text input +
  Save. Secret rows: `<input type="password">` with placeholder `•••••••• (set)` and the real value
  never present in props (`value === null`); Save writes the typed value; an empty password box +
  Save is ignored (never write an empty secret by accident). Clear button on every row.
- Section "Add a variable": a text input with a `<datalist>` of every `specs[].name` (340 options
  render fine), validated client-side against `ENV_NAME` (copy the regex literal), a value control
  that switches to a `<select>` when the typed name matches a spec with `options`, and a Save that
  writes `['env', NAME]`. The spec's description shows under the box once the name matches.
- A grouped, collapsed "All documented variables" list (`<details>` per group) showing name +
  description + options, each with a "set…" button that pre-fills the add form. This is how the user
  discovers the 340 names without scrolling 340 rows.

**Verify**: `bun run types:check` → exit 0. (Rendering is verified in Step 6.)

### Step 5: The page — `app/global/settings/page.tsx`

Rewrite. Server component, `export const dynamic = 'force-dynamic'`.

```ts
const settings = (await getSettings()) ?? {};   // no notFound(): an empty file is now a valid start
const fields = listFields();
const at = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
const rows: FieldRow[] = fields.map((f) => { const value = at(settings, f.path); return { ...f, value, isSet: value !== undefined }; });
// Unknown top-level keys (schema additionalProperties: true), e.g. modelSettings:
const known = new Set(fields.map((f) => f.path[0]));
for (const k of Object.keys(settings)) if (!known.has(k) && k !== 'env' && k !== '$schema') rows.push({ key: k, path: [k], kind: 'json', description: 'Not in the settings schema; edited as raw JSON.', deprecated: false, managedOnly: false, group: 'Other', value: settings[k], isSet: true });
```

Env rows: `Object.entries(settings.env ?? {})` (if `env` is not a plain object, show a one-line
warning and an empty list) merged with `listEnvSpecs()` so documented-but-unset vars are only in
`specs`, and set vars carry `value: secret ? null : String(value)`.

Layout, top to bottom:

1. `DocsTitle` "Settings", `DocsDescription` `~/.claude/settings.json` (font-mono, as today).
2. One paragraph: what the page writes, the backup file name, that Claude Code hot-reloads this file
   except for `outputStyle`, `forceLogin*`, `autoUpdatesChannel`, and `model` (next session), and
   that deny rules live on the Tools page.
3. `<h2>Settings</h2>` + `<SettingsForm rows={rows} action={updateSetting} />`.
4. `<h2>Environment variables</h2>` + one line explaining these go into `env` and apply to every
   Claude Code session, then `<EnvForm rows={envRows} specs={listEnvSpecs()} action={updateSetting} />`.
5. `<h2>Raw file</h2>` + `<details>` containing `<pre>` of the whole file **with every secret env
   value replaced by `"••••"`** (build a redacted copy before stringifying; never print secrets).

**Verify**: `bun run types:check` → exit 0; then `CLAUDE_DIR=/tmp/claude-ui-e2e bun dev`, open
`http://localhost:3000/global/settings`, and confirm: no runtime error; groups render in
`GROUP_ORDER`; `editorMode` shows a dropdown with `normal`/`vim`; `theme` shows the 7 options plus a
custom box; `cleanupPeriodDays` shows a number input with `min=1` and placeholder/default 30;
`permissions.deny` is read-only with a link; `hooks` is a JSON textarea; the env section lists the 4
set variables with `DISABLE_AUTOUPDATER` as a dropdown (`0`/`1`).

### Step 6: Sidebar — `lib/claude/tree.ts`

Replace

```ts
  if (settings !== null) {
    children.push({ type: 'page', name: 'Settings', url: '/global/settings' });
  }
```

with an unconditional `children.push({ type: 'page', name: 'Settings', url: '/global/settings' });`.
If `settings` is then unused in `buildGlobalTree()`, remove it from the `Promise.all` and the import;
if plan 010 or another plan has since added other uses, leave those alone.

**Verify**: `bun run types:check` → exit 0; the sidebar still shows Settings.

### Step 7: End-to-end against the copy, then two live writes

Run every click against `/tmp/claude-ui-e2e` first (same recipe as plan 007 Step 8).

1. `CLAUDE_DIR=/tmp/claude-ui-e2e bun dev`. Open `/global/settings`.
2. Flip `spinnerTipsEnabled` off → `bun -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/claude-ui-e2e/settings.json","utf8")).spinnerTipsEnabled)'` → `false`. Click Clear → `undefined`.
3. Set `permissions.defaultMode` to `plan` via the dropdown → file shows `permissions: { defaultMode: 'plan' }`. Set it to `bypassPermissions` → a confirm appears; Cancel → file unchanged. Clear → `permissions` key gone.
4. Set `cleanupPeriodDays` to `0` → the browser blocks it (`min=1`); force the request with the devtools console if you like — the server refuses with `Refused: cleanupPeriodDays: …`.
5. `hooks`: paste invalid JSON → inline parse error, no request. Paste the existing value back unchanged → save succeeds; `diff` of the file before/after shows nothing but key order.
6. Env: change `DISABLE_AUTOUPDATER` to `0` via dropdown → file reflects; add `ANTHROPIC_API_KEY` with the value `not-a-real-key-e2e` → the page shows the row masked, the raw-file section shows `"••••"`, and view-source of the HTML response contains **no** occurrence of `not-a-real-key-e2e`:
   `curl -s http://localhost:3000/global/settings | grep -c not-a-real-key-e2e` → `0`. Clear it.
7. Confirm every original top-level key is still present:
   `diff <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"))).sort().join("\n"))') <(bun -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync("/tmp/claude-ui-e2e/settings.json","utf8"))).sort().join("\n"))')` → empty.
8. Open `/global/tools` and toggle `NotebookEdit` off and on — plan 007 still works after the writer refactor.
9. `rm -rf /tmp/claude-ui-e2e`.
10. Only now, against the real directory (`bun dev`): set `showTurnDuration` to `true` and then Clear it. Report the before/after top-level key list of `~/.claude/settings.json` in your handoff. Do not leave any change behind.

## Test plan

No test framework exists (see `CLAUDE.md`). The verification blocks in Steps 1, 2 and 7 are the test
plan; the `bun -e` scripts in Steps 1 and 2 are deterministic and should be pasted into the handoff
with their output. If a later plan adds a test runner, the Step 1 and Step 2 scripts convert directly
into unit tests for `settings-schema.ts` and `settings-writer.ts`.

## Done criteria

- [ ] `bun run types:check` exits 0.
- [ ] Step 1 verification: `listFields().length` in 195–215, `listEnvSpecs()` → `340 16 164 2`, the 11-value `validate` line matches.
- [ ] Step 2 verification: all 13 expected lines match; `keys unchanged: true`.
- [ ] `grep -n "permissions.deny" lib/claude/settings-writer.ts` shows the refusal in `setSettingValue`.
- [ ] `grep -rn "settings-schema" components/` shows only `import type` lines.
- [ ] `curl -s http://localhost:3000/global/settings | grep -c not-a-real-key-e2e` → `0` while the secret is set (Step 7.6).
- [ ] `/global/tools` toggles still work (Step 7.8).
- [ ] `git status` shows changes only in the in-scope files.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The SchemaStore download fails, or the schema has no `properties.env.properties`, or its top-level
  key count is below 120 (a broken or restructured schema — do not fall back to hand-writing a catalog).
- `lib/claude/settings-writer.ts` does not match the "Current state" excerpt (plan 007 changed).
- `setDeniedTools` behaviour changes in Step 2's lines 11–12 in any way.
- Any verification in Step 1 or 2 fails twice.
- You find a schema node shape the derivation rules do not cover and that affects more than five
  fields (a handful landing in `json` is expected; a whole subtree is not).
- A second key besides `teammateDefaultModel` accepts `null` (`type` array containing `"null"`) —
  re-check the `null`-means-delete sentinel before continuing.
- The secret-leak grep in Step 7.6 returns anything other than `0`.

## Maintenance notes

- **Refreshing the schema** is one `curl` (command in the header of `settings-schema.ts`). New keys
  appear automatically; new enum values appear automatically. Only `groupOf()` rules and the
  `NOT_SECRET` list are hand-maintained — a new key lands in "Other" until a rule is added, which is
  harmless.
- **Reviewer focus**: `setSettingValue` in `settings-writer.ts` (path allowlist, validation, prune
  logic) and the secret redaction in `page.tsx`. Everything else is presentation.
- **Interaction with plan 010** (plugins & hooks viewer): 010 edits `buildGlobalTree()`; if both land,
  the merge is one adjacent line. 010 is read-only and does not touch the writer.
- **Deferred, on purpose**: a scope switcher (project `.claude/settings.json` and
  `settings.local.json`), effective-value resolution across scopes, `~/.claude.json` state,
  `keybindings.json`, structured editors for hooks/marketplaces (the JSON textarea is the v1),
  and validating `permissions.allow`/`ask` rule syntax beyond "is a string".
