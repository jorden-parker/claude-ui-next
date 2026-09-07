# Plan 010: Plugins & hooks page at /global/plugins

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b573de5..HEAD -- lib/claude/data.ts lib/claude/tree.ts app/global`
> If `installedPlugins()` or `buildGlobalTree()` no longer match the "Current state" excerpts,
> STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (read-only; new page + one sidebar line + one private-function refactor)
- **Depends on**: none (edits `buildGlobalTree()`, so do not run in parallel with another plan that
  edits `lib/claude/tree.ts`)
- **Category**: direction
- **Planned at**: commit `b573de5` (branch `advisor/007-tool-budget-presets`), 2026-09-07

## Why this matters

Four plugins from two marketplaces are installed on this machine, three are enabled in
`settings.json`, one ships hooks that fire on every prompt, and a user-level `SessionStart` hook
injects a whole ruleset into every session. None of that is visible in the app beyond a raw JSON
dump of the `hooks` and `enabledPlugins` keys on `/global/settings`. The skills browser (plan 004)
already reads `installed_plugins.json` through a private `installedPlugins()` and its plan named
"a plugins viewer (installed/available/versions)" as the follow-up that should reuse it. A page
that answers "what is installed, is it on, what version, and what runs automatically?" closes
that gap and makes hooks — the least visible and most surprising part of a Claude Code setup —
inspectable.

## Current state

### Data on disk (verified 2026-09-07)

- `~/.claude/plugins/installed_plugins.json` (format `version: 2`):

  ```json
  {
    "version": 2,
    "plugins": {
      "diagrams@second-brain": [
        {
          "scope": "user",
          "installPath": "/Users/jorden/.claude/plugins/cache/second-brain/diagrams/0.13.3",
          "version": "0.13.3",
          "installedAt": "2026-08-28T09:58:43.248Z",
          "lastUpdated": "2026-08-28T09:58:43.248Z",
          "gitCommitSha": "04d192a5a1f4003418ea3632a3b3808138c45e13"
        }
      ],
      "mattpocock-skills@mattpocock-skills.git": [ ... ]
    }
  }
  ```

  Keys are `<pluginName>@<marketplaceName>`. Four entries: `decisions@second-brain`,
  `diagrams@second-brain`, `plans@second-brain`, `mattpocock-skills@mattpocock-skills.git`.
- `<installPath>/.claude-plugin/plugin.json` — manifest, present for all 4:

  ```json
  {"name":"decisions","version":"0.6.2","description":"Decisions and RFCs become ...","author":{"name":"Jorden Parker"},"keywords":["decision","rfc"]}
  ```

- `<installPath>/hooks/hooks.json` — optional (1 of 4 has it):

  ```json
  {"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/nudge.sh\""}]}],
            "PostToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/plan-artifact-nudge.sh\""}]}]}}
  ```

- `<installPath>/skills/**/SKILL.md` — plan 004's `findSkillDirs(root, 2)` already finds these.
  `agents/` and `commands/` directories: none present on this machine, but the plugin spec allows
  them; count `*.md` files if the directory exists, else 0.
- `~/.claude/plugins/known_marketplaces.json`:

  ```json
  {"claude-plugins-official":{"source":{"source":"github","repo":"anthropics/claude-plugins-official"},"installLocation":"/Users/jorden/.claude/plugins/marketplaces/claude-plugins-official","lastUpdated":"2026-09-07T11:04:26.411Z"},
   "second-brain":{"source":{"source":"directory","path":"/Users/jorden/second-brain"},"installLocation":"/Users/jorden/second-brain","lastUpdated":"2026-08-28T09:58:41.929Z"}}
  ```

  Note: the marketplace `mattpocock-skills.git` referenced by an installed plugin is **not** in
  this file. Render "unknown marketplace" rather than failing.
- `~/.claude/settings.json` keys (read via the existing `getSettings()`):
  - `enabledPlugins`: `{"diagrams@second-brain": true, "plans@second-brain": true, "decisions@second-brain": true}` —
    installed plugins **absent** from this map (here: `mattpocock-skills@…`) have no recorded state;
    show "not listed" rather than guessing enabled/disabled.
  - `hooks`: same shape as a plugin's `hooks.json` **without** the outer `hooks` wrapper:

    ```json
    {"SessionStart":[{"hooks":[{"type":"command","command":"~/.claude/hooks/caveman-activate.py","timeout":5}]}]}
    ```

### Code

- `lib/claude/data.ts`
  - `installedPlugins()` (line 537), private:

    ```ts
    /** Installed plugins as [pluginName, installPath] pairs from installed_plugins.json (v2). */
    async function installedPlugins(): Promise<[string, string][]> {
      let raw;
      try {
        raw = await fs.readFile(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'), 'utf8');
      } catch {
        return [];
      }
      try {
        const parsed = JSON.parse(raw);
        const plugins = parsed?.plugins;
        if (typeof plugins !== 'object' || plugins === null) return [];
        const pairs: [string, string][] = [];
        for (const [key, installs] of Object.entries(plugins)) {
          const installPath = Array.isArray(installs) ? installs[0]?.installPath : undefined;
          if (typeof installPath === 'string') pairs.push([key.split('@')[0], installPath]);
        }
        return pairs;
      } catch {
        return [];
      }
    }
    ```

    Used by `listSkills()` (line 560) and `getSkill()`. Keep its signature; make it a thin wrapper.
  - `findSkillDirs(root, depth)` (private) — reuse for skill counts.
  - `getSettings()` (line 121) returns `Record<string, unknown> | null`.
- `lib/claude/tree.ts` — `buildGlobalTree()` sidebar; the Skills folder block:

  ```ts
  const userSkills = skills.filter((s) => s.source === 'user');
  if (skills.length > 0) {
    children.push({
      type: 'folder',
      name: `Skills (${skills.length})`,
      ...
    });
  }
  for (const g of groups) {
  ```

  Insert the Plugins entry **between** the Skills folder block and the `for (const g of groups)` loop.
- List-page exemplar: `app/global/skills/page.tsx` (sections per group, `<ul>` of links with a muted
  description). Raw-JSON exemplar: `app/global/settings/page.tsx` (`<pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs">`).

### Conventions to match

- Filesystem access only in `lib/claude/data.ts`; `try/catch` → `null`/`[]`.
- Pages: `export const dynamic = 'force-dynamic'`; `DocsPage`/`DocsTitle`/`DocsDescription`/`DocsBody`.
- The `DocsDescription` of every `/global/*` page names the source file in monospace, e.g.
  `~/.claude/plans · 7 files`.

## Commands you will need

| Purpose    | Command               | Expected on success |
|------------|-----------------------|---------------------|
| Install    | `bun install`         | exit 0              |
| Typecheck  | `bun run types:check` | exit 0              |
| Dev server | `bun dev`             | serves on :3000     |

## Scope

**In scope**:
- `lib/claude/data.ts`
- `lib/claude/tree.ts` (one insertion in `buildGlobalTree()` + one import)
- `app/global/plugins/page.tsx` (create)
- `plans/README.md` (status row only)

**Out of scope**:
- Enabling/disabling plugins or editing hooks. This page is read-only. The only write path in the
  app is `lib/claude/settings-writer.ts` and it stays limited to `permissions.deny`.
- `app/global/settings/page.tsx` — leave its raw `hooks`/`enabledPlugins` dump alone.
- `~/.claude/plugins/plugin-catalog-cache.json` and the marketplace catalogs ("available"
  plugins). Installed only.
- Project-scope plugins (`scope !== 'user'`): show the first install entry per key regardless of
  scope, matching `installedPlugins()` today.

## Git workflow

- Branch: `advisor/010-plugins-and-hooks`.
- Commit per step; short imperative subject, explanatory body. No push, no PR.

## Steps

### Step 1: Types and readers in `lib/claude/data.ts`

Add:

```ts
export interface HookCommand {
  event: string;
  matcher: string | null;
  type: string;
  command: string;
  timeout: number | null;
}

export interface PluginEntry {
  /** `<name>@<marketplace>` as keyed in installed_plugins.json. */
  key: string;
  name: string;
  marketplace: string;
  marketplaceSource: string | null;   // e.g. "github:anthropics/claude-plugins-official" or "directory:/Users/…"
  version: string | null;
  description: string | null;
  installPath: string;
  installedAt: string | null;
  enabled: boolean | null;            // null = not listed in settings.enabledPlugins
  skillCount: number;
  agentCount: number;
  commandCount: number;
  hooks: HookCommand[];
}
```

Refactor: rename the body of the current `installedPlugins()` into

```ts
interface InstalledRecord { key: string; installPath: string; version: string | null; installedAt: string | null }
async function readInstalledPlugins(): Promise<InstalledRecord[]> { /* same parsing, keep all four fields */ }

async function installedPlugins(): Promise<[string, string][]> {
  return (await readInstalledPlugins()).map((r) => [r.key.split('@')[0], r.installPath]);
}
```

Add a pure hook flattener (exported, reused for user hooks):

```ts
/** Flatten a Claude Code hooks map ({ Event: [{ matcher?, hooks: [{type, command, timeout?}] }] }). */
export function flattenHooks(map: unknown): HookCommand[] {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return [];
  const out: HookCommand[] = [];
  for (const [event, groups] of Object.entries(map as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const matcher = typeof g?.matcher === 'string' ? g.matcher : null;
      const hooks = Array.isArray(g?.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (typeof h?.command !== 'string') continue;
        out.push({ event, matcher, type: typeof h.type === 'string' ? h.type : 'command', command: h.command, timeout: typeof h.timeout === 'number' ? h.timeout : null });
      }
    }
  }
  return out;
}
```

Then `listPlugins()`:

```ts
async function countMd(dir: string): Promise<number> {
  try { return (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).length; } catch { return 0; }
}

export async function listPlugins(): Promise<PluginEntry[]> {
  const [records, settings, marketplaces] = await Promise.all([readInstalledPlugins(), getSettings(), readKnownMarketplaces()]);
  const enabledMap = isPlainRecord(settings?.enabledPlugins) ? settings!.enabledPlugins as Record<string, unknown> : {};
  return Promise.all(records.map(async (r) => {
    const [name, marketplace = ''] = r.key.split('@');
    let manifest: Record<string, unknown> = {};
    try { manifest = JSON.parse(await fs.readFile(path.join(r.installPath, '.claude-plugin', 'plugin.json'), 'utf8')); } catch {}
    let hooksJson: unknown = null;
    try { hooksJson = JSON.parse(await fs.readFile(path.join(r.installPath, 'hooks', 'hooks.json'), 'utf8')); } catch {}
    const skillDirs = await findSkillDirs(path.join(r.installPath, 'skills'), 2);
    const enabled = enabledMap[r.key];
    return {
      key: r.key, name, marketplace,
      marketplaceSource: marketplaces.get(marketplace) ?? null,
      version: typeof manifest.version === 'string' ? manifest.version : r.version,
      description: typeof manifest.description === 'string' ? manifest.description : null,
      installPath: r.installPath,
      installedAt: r.installedAt,
      enabled: typeof enabled === 'boolean' ? enabled : null,
      skillCount: skillDirs.length,
      agentCount: await countMd(path.join(r.installPath, 'agents')),
      commandCount: await countMd(path.join(r.installPath, 'commands')),
      hooks: flattenHooks((hooksJson as { hooks?: unknown } | null)?.hooks),
    };
  }));
}

/** Marketplace name → human-readable source string. */
async function readKnownMarketplaces(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json'), 'utf8'));
    for (const [name, v] of Object.entries(parsed ?? {})) {
      const src = (v as { source?: { source?: string; repo?: string; path?: string } })?.source;
      if (!src?.source) continue;
      out.set(name, `${src.source}:${src.repo ?? src.path ?? ''}`);
    }
  } catch {}
  return out;
}

/** Hooks configured directly in ~/.claude/settings.json. */
export async function getUserHooks(): Promise<HookCommand[]> {
  const settings = await getSettings();
  return flattenHooks(settings?.hooks);
}
```

Write a small `isPlainRecord(v: unknown): v is Record<string, unknown>` helper if one does not
exist in `data.ts` (there is one named `isPlainObject` in `settings-writer.ts`; do not import from
there — `data.ts` must not depend on the writer).

**Verify**: `bun run types:check` → exit 0, then

```bash
cat > /tmp/check-plugins.ts <<'TS'
import { listPlugins, getUserHooks } from './lib/claude/data';
(async () => {
  const p = await listPlugins();
  console.log(p.map((x) => [x.key, x.version, x.enabled, x.skillCount, x.hooks.length]));
  console.log((await getUserHooks()).map((h) => [h.event, h.command]));
})();
TS
bun run /tmp/check-plugins.ts
```

→ 4 rows; `diagrams@second-brain` has `hooks.length` 3 and `enabled` true; `mattpocock-skills@mattpocock-skills.git`
has `enabled` null; the user hooks line lists `SessionStart` with the caveman-activate command.

### Step 2: The page

Create `app/global/plugins/page.tsx`. Structure:

- `DocsTitle` "Plugins"; `DocsDescription` (mono, xs): `~/.claude/plugins/installed_plugins.json · N installed`.
- **Installed** — one `<section>` per plugin: `<h2>{name} <span muted>{version}</span></h2>`, a pill
  showing `enabled` / `disabled` / `not listed`, the description, then a compact `<ul>`:
  marketplace (+source), installed date (`toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'})`),
  install path in `<code>`, and `N skills · N agents · N commands · N hooks`. If `skillCount > 0`,
  link the word "skills" to `/global/skills`.
- **Hooks** — one table-less list grouped by event name (`<h3>{event}</h3>` then `<ul>`): each row
  `<code>{command}</code>` with a muted suffix `— {source}` where source is `settings.json` or the
  plugin name, plus `matcher {matcher}` and `timeout {n}s` when present. Merge `getUserHooks()`
  (source `settings.json`) with every plugin's `hooks` (source = plugin name). Sort events
  alphabetically; keep insertion order within an event.
- Empty states: "No plugins installed." / "No hooks configured."

**Verify**: `curl -s http://localhost:3000/global/plugins | grep -c 'caveman-activate'` → 1;
`curl -s http://localhost:3000/global/plugins | grep -o 'not listed' | wc -l` → 1.

### Step 3: Sidebar entry

In `lib/claude/tree.ts`, import `listPlugins`, add it to the `Promise.all` in `buildGlobalTree()`,
and insert after the Skills folder block:

```ts
if (plugins.length > 0) {
  children.push({ type: 'page', name: `Plugins (${plugins.length})`, url: '/global/plugins' });
}
```

**Verify**: `curl -s http://localhost:3000/global | grep -o 'Plugins (4)'` → prints it.

## Test plan

No test framework. The Step 1 script is the check; delete `/tmp/check-plugins.ts` afterwards.

## Done criteria

- [ ] `bun run types:check` exits 0
- [ ] `grep -n 'export async function listPlugins\|export function flattenHooks\|export async function getUserHooks' lib/claude/data.ts` → 3 matches
- [ ] `listSkills()` and `getSkill()` still work: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/global/skills/diagrams:diagram-plans` → `200`
- [ ] `/global/plugins` renders 4 plugins and the `SessionStart` user hook
- [ ] Sidebar shows `Plugins (4)`
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `installed_plugins.json` `version` is not `2`, or `plugins` values are not arrays of objects
  with `installPath`.
- `installedPlugins()` no longer exists or has a different signature (a later plan refactored it).
- `buildGlobalTree()` no longer has the Skills folder block followed by `for (const g of groups)`.
- A plugin's `hooks.json` is not `{ "hooks": { ... } }` shaped — report the file; do not special-case it.

## Maintenance notes

- Hook rendering shows commands verbatim; commands can contain `${CLAUDE_PLUGIN_ROOT}` and shell
  quoting. Render as text in `<code>` — never dangerouslySetInnerHTML.
- Reviewer should check: `data.ts` gained no import from `settings-writer.ts`; `installedPlugins()`
  output is unchanged (skills routes still resolve).
- Deferred: available-but-not-installed plugins (catalog cache), enable/disable toggles (would need a
  second allowlisted write path), plugin `agents/`/`commands/` detail pages, project-scope plugins.
