# Plan 011: "Files changed" per session from file-history snapshots (spike, then viewer)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b573de5..HEAD -- lib/claude/data.ts 'app/p/[project]/session/[id]/page.tsx'`
> Plans 008 and 009 are expected to have landed (session page has a tokens span and a Subagents
> block; `parseTranscript` exists). Any OTHER divergence is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (Step 1 is a half-day spike that can end the plan early)
- **Risk**: MED — the `file-history` format is undocumented and observed, not specified
- **Depends on**: 009 (execute after; both edit the session page)
- **Category**: direction
- **Planned at**: commit `b573de5` (branch `advisor/007-tool-budget-presets`), 2026-09-07

## Why this matters

"What did Claude change in this session?" is the question a transcript answers worst: edits are
scattered across hundreds of collapsed `Edit`/`Write` tool blocks. Claude Code already records the
answer for its own `/rewind` feature: every transcript contains `file-history-snapshot` entries
(416 on this machine) mapping edited file paths to versioned backups under
`~/.claude/file-history/<sessionId>/`, and the backups are full file contents. Listing the touched
files with their version timeline, and letting the user open any version, turns the transcript
into a change log. Diffs between versions are the obvious next step and are deliberately deferred
(see Maintenance notes) until the version semantics are confirmed in Step 1.

## Current state

### Data on disk (verified 2026-09-07 — treat as observations, confirm in Step 1)

- Transcript entries of `type: 'file-history-snapshot'`:

  ```json
  {"type":"file-history-snapshot","messageId":"48fbe065-b5b6-46be-a5bc-613cb63fac35",
   "snapshot":{"messageId":"48fbe065-…","trackedFileBackups":{
      "apps/worker/src/cardtrader-source.ts":{"backupFileName":"3de456a51f4d5a77@v2","version":2,"backupTime":"2026-09-03T17:46:01.222Z","realParentDir":"/Users/jorden/src/window-shopping/apps/worker/src"}
   },"timestamp":"2026-09-03T17:46:01.222Z"},"isSnapshotUpdate":false}
  ```

  - `messageId` matches the `uuid` of another entry in the same transcript (verified 1 of 1).
  - Map keys are sometimes **relative** to the session cwd (above) and sometimes absolute.
    `realParentDir` is always the absolute parent directory of the file, so
    `path.join(realParentDir, path.basename(key))` is the absolute path in both cases.
  - Many snapshots have an empty `trackedFileBackups: {}` — skip those.
  - A file's `version` increases over the session; later snapshots repeat earlier files with their
    latest version (one session: 20 snapshots, 3 distinct files, versions v2…v6 referenced).
- Backups at `~/.claude/file-history/<sessionId>/<backupFileName>` where `backupFileName` is
  `<16 hex>@v<N>`. Full file contents (verified: a TypeScript source, 10–32 KB per version).
  Observed that `…@v1` exists on disk but is **never referenced** by a snapshot, while snapshots
  start at `@v2`. Working hypothesis: `v1` is the pre-edit original captured before the first
  edit. **Step 1 must confirm or refute this.**
- `~/.claude/file-history/` also contains directories for 8 sessions; not every session has one.

### Code

- `lib/claude/data.ts` — after plan 009, `parseTranscript(raw)` handles `user`, `assistant`, and
  `system/turn_duration` entries; everything else (including `file-history-snapshot`) falls into
  the `skippedLines++` catch-all. This plan adds a **separate** scanner rather than extending
  `parseTranscript`, so `Transcript` stays unchanged.
- The mtime-keyed cache pattern to copy: `listToolUsage`/`toolUsageCache` (search for
  `toolUsageCache` in `data.ts`), and plan 008's `listSessionUsage`.
- Path validation precedent: plan 009's `AGENT_ID = /^[0-9a-f]{8,32}$/` and
  `OUTPUT_FILE = /^[A-Za-z0-9_-]+\.txt$/`.
- `app/p/[project]/session/[id]/page.tsx` — after 009 it renders: metadata header, truncation
  notice, `Subagents (N)` details block, then `<Transcript>`. The "Files changed" block goes
  **after** Subagents and **before** `<Transcript>`.
- Content-page exemplar for a raw file view: plan 009's persisted-output page
  (`app/p/[project]/session/[id]/output/[file]/page.tsx`) — `<pre>` with
  `overflow-x-auto rounded bg-fd-secondary p-2 text-xs whitespace-pre-wrap break-words`.

## Commands you will need

| Purpose    | Command               | Expected on success |
|------------|-----------------------|---------------------|
| Install    | `bun install`         | exit 0              |
| Typecheck  | `bun run types:check` | exit 0              |
| Dev server | `bun dev`             | serves on :3000     |

Fixture (exists on this machine):

```bash
SLUG=-Users-jorden-src-window-shopping
SID=15f9778f-d87f-40a7-bdda-b559d811a55a
ls -la ~/.claude/file-history/$SID          # 10 files, 3de456a51f4d5a77@v1 … @v6 among them
grep -c '"file-history-snapshot"' ~/.claude/projects/$SLUG/$SID.jsonl   # 20
```

## Scope

**In scope**:
- `lib/claude/data.ts`
- `app/p/[project]/session/[id]/page.tsx`
- `app/p/[project]/session/[id]/file/[backup]/page.tsx` (create)
- `plans/README.md` (status row + a "Step 1 findings" note under Dependency notes)

**Out of scope**:
- Any write to `~/.claude/file-history/` or restoring files (that is `/rewind`'s job).
- Diff rendering and any new dependency (`diff`, `diff2html`, …). See Maintenance notes.
- `components/transcript.tsx` — do not annotate `Edit`/`Write` tool blocks in this plan.
- Reading backups from any directory other than `~/.claude/file-history/<sessionId>/`.

## Git workflow

- Branch: `advisor/011-session-file-changes`. Commit per step. No push, no PR.

## Steps

### Step 1: Spike — confirm the version semantics (no app code yet)

Run, against the fixture:

```bash
J=~/.claude/projects/$SLUG/$SID.jsonl
# 1. Which versions do snapshots reference, in order?
grep '"file-history-snapshot"' $J | grep -o '3de456a51f4d5a77@v[0-9]*' | uniq
# 2. Do the Edit/Write tool calls on that file line up with backups?
grep -c '"name":"Edit"' $J; grep -o '"file_path":"[^"]*cardtrader-source.ts"' $J | wc -l
# 3. Is v1 identical to the file's state before the first edit? Compare v1 against the first
#    `Read` tool result of that file in the transcript (search the transcript for the file path
#    and inspect the first Read result), or against `git show` of the commit that was checked out
#    (gitBranch/commit are in the transcript's first lines).
head -c 300 ~/.claude/file-history/$SID/3de456a51f4d5a77@v1
# 4. Does each backup's mtime precede or follow the snapshot's backupTime?
stat -f '%Sm %N' ~/.claude/file-history/$SID/3de456a51f4d5a77@v*
```

Record the answers in `plans/README.md` under "Dependency notes → 011 Step 1 findings", in
2–4 lines. Decide:

- If `v1` is the pre-edit original and `vN` is the content **after** the N-th tracked edit, proceed
  with the labels "original" for v1 and "after edit N-1" for vN.
- If versions mean something else but are still monotonic snapshots of the same file, proceed but
  label them only as `v1 … vN` with their timestamps (no "original"/"after" wording).
- If `backupFileName` collides across files, or the same version number maps to different content
  across snapshots, **STOP** and report.

**Verify**: `plans/README.md` contains a "011 Step 1 findings" note.

### Step 2: Scanner in `lib/claude/data.ts`

```ts
export interface FileVersion {
  version: number;
  backupFileName: string;      // "<16 hex>@v<N>"
  backupTime: string | null;   // ISO
  /** True if the backup file exists under ~/.claude/file-history/<sessionId>/. */
  exists: boolean;
  size: number | null;
}

export interface FileChange {
  /** Absolute path: path.join(realParentDir, basename(key)). */
  path: string;
  versions: FileVersion[];     // ascending by version
}

const FILE_HISTORY_DIR = path.join(CLAUDE_DIR, 'file-history');
const BACKUP_NAME = /^[0-9a-f]{16}@v\d+$/;

function scanFileChanges(raw: string): Map<string, Map<number, { backupFileName: string; backupTime: string | null }>> {
  const files = new Map<string, Map<number, { backupFileName: string; backupTime: string | null }>>();
  for (const line of raw.split('\n')) {
    if (!line.includes('"file-history-snapshot"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const tracked = entry?.snapshot?.trackedFileBackups;
    if (typeof tracked !== 'object' || tracked === null) continue;
    for (const [key, v] of Object.entries(tracked as Record<string, any>)) {
      if (typeof v?.backupFileName !== 'string' || !BACKUP_NAME.test(v.backupFileName)) continue;
      const parent = typeof v.realParentDir === 'string' ? v.realParentDir : path.dirname(key);
      const abs = path.join(parent, path.basename(key));
      const version = typeof v.version === 'number' ? v.version : Number(v.backupFileName.split('@v')[1]);
      let versions = files.get(abs);
      if (!versions) { versions = new Map(); files.set(abs, versions); }
      if (!versions.has(version)) versions.set(version, { backupFileName: v.backupFileName, backupTime: typeof v.backupTime === 'string' ? v.backupTime : null });
    }
  }
  return files;
}
```

Then the reader (mtime-cached like `listToolUsage`), which also stats the backup directory once
and — **only if Step 1 confirmed v1 is the original** — adds an unreferenced `@v1` file for each
tracked hash as version 1 with `backupTime: null`:

```ts
export async function listFileChanges(slug: string, id: string): Promise<FileChange[]> {
  if (!/^[\w-]+$/.test(id)) return [];
  const full = path.join(projectDir(slug), `${id}.jsonl`);
  let raw, stat;
  try { [raw, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]); } catch { return []; }
  // (cache by full path + stat.mtimeMs exactly like sessionUsageCache; omitted here for brevity — do add it)
  const scanned = scanFileChanges(raw);
  let onDisk = new Map<string, number>();
  try {
    const dir = path.join(FILE_HISTORY_DIR, id);
    const names = await fs.readdir(dir);
    const stats = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).then((s) => [n, s.size] as const).catch(() => null)));
    onDisk = new Map(stats.filter((x): x is readonly [string, number] => x !== null));
  } catch {}
  const out: FileChange[] = [];
  for (const [p, versions] of scanned) {
    const hash = [...versions.values()][0].backupFileName.split('@v')[0];
    if (/* Step 1 confirmed */ true && !versions.has(1) && onDisk.has(`${hash}@v1`)) {
      versions.set(1, { backupFileName: `${hash}@v1`, backupTime: null });
    }
    out.push({
      path: p,
      versions: [...versions.entries()].sort((a, b) => a[0] - b[0]).map(([version, v]) => ({
        version, backupFileName: v.backupFileName, backupTime: v.backupTime,
        exists: onDisk.has(v.backupFileName), size: onDisk.get(v.backupFileName) ?? null,
      })),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

export async function getFileVersion(id: string, backup: string): Promise<{ text: string; size: number; truncated: boolean } | null> {
  if (!/^[\w-]+$/.test(id) || !BACKUP_NAME.test(backup)) return null;
  // read with the same fd/clamp approach as getPersistedOutput (plan 009); return null on any error
}
```

Replace the `/* Step 1 confirmed */ true` placeholder with a module constant
`const V1_IS_ORIGINAL = true|false` set from the Step 1 finding, with a one-line comment citing
`plans/README.md`.

**Verify**: `bun run types:check` → exit 0 and

```bash
cat > /tmp/check-fh.ts <<'TS'
import { listFileChanges, getFileVersion } from './lib/claude/data';
const [slug, id] = process.argv.slice(2);
(async () => {
  const c = await listFileChanges(slug, id);
  console.log(c.map((f) => [f.path, f.versions.map((v) => `${v.version}${v.exists ? '' : '?'}`).join(',')]));
  console.log((await getFileVersion(id, '3de456a51f4d5a77@v2'))?.size, await getFileVersion(id, '../settings.json'));
})();
TS
bun run /tmp/check-fh.ts $SLUG $SID
```

→ 3 files; `cardtrader-source.ts` lists versions `2,3,4,5,6` (plus `1` if `V1_IS_ORIGINAL`),
none suffixed `?`; second line prints `20328 null`.

### Step 3: "Files changed" block on the session page

Fetch `listFileChanges(project, id)` in the page's `Promise.all`. After the Subagents block, when
`changes.length > 0`:

```tsx
<details className="rounded-lg border bg-fd-card px-4 py-2 text-sm" open>
  <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
    Files changed ({changes.length})
  </summary>
  <ul className="mt-2 flex flex-col gap-1">
    {changes.map((f) => (
      <li key={f.path} className="flex flex-wrap items-baseline gap-x-2">
        <code className="text-xs">{f.path.replace(/^\/Users\/[^/]+/, '~')}</code>
        <span className="text-xs text-fd-muted-foreground">
          {f.versions.map((v) => v.exists
            ? <Link key={v.version} href={`${base}/file/${v.backupFileName}`} className="mr-1 underline">v{v.version}</Link>
            : <span key={v.version} className="mr-1 line-through">v{v.version}</span>)}
        </span>
      </li>
    ))}
  </ul>
</details>
```

**Verify**: `curl -s http://localhost:3000/p/$SLUG/session/$SID | grep -o 'file/3de456a51f4d5a77@v[0-9]' | sort -u | wc -l` → `5` (or `6` with v1).

### Step 4: Version page

Create `app/p/[project]/session/[id]/file/[backup]/page.tsx` modeled on plan 009's output page:
`getFileVersion(id, backup)` → `notFound()` on null; title = the backup name; description = size,
the version label decided in Step 1, and the file path if you can recover it cheaply (call
`listFileChanges` and find the entry whose `versions` include this backup — acceptable cost);
body = the `<pre>` block; a back link to the session.

**Verify**: `curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/p/$SLUG/session/$SID/file/3de456a51f4d5a77@v2"` → `200`;
`.../file/..%2F..%2Fsettings.json` → `404`.

## Test plan

No test framework. Step 2's script plus curl checks. Delete `/tmp/check-fh.ts` afterwards.

## Done criteria

- [ ] `plans/README.md` has the "011 Step 1 findings" note
- [ ] `bun run types:check` exits 0
- [ ] `grep -n 'V1_IS_ORIGINAL' lib/claude/data.ts` → ≥ 2 matches (declaration + use)
- [ ] Session page for the fixture lists 3 files with linked versions
- [ ] Version page returns 200 for a real backup and 404 for the traversal input
- [ ] No new dependencies in `package.json`
- [ ] No files outside the in-scope list are modified

## STOP conditions

- Step 1 reveals `backupFileName` collisions across files, or non-monotonic versions for one file.
- `~/.claude/file-history/$SID` does not exist for the fixture (data was cleaned up — pick another
  session from `ls ~/.claude/file-history` that has a matching transcript; if none, STOP).
- Plan 009's `getPersistedOutput` pattern is absent (009 has not landed).
- A step's verification fails twice.

## Maintenance notes

- This is the first feature reading outside `~/.claude/projects`, `plans`, `skills`, `plugins`,
  and `settings.json`. `FILE_HISTORY_DIR` must honor `CLAUDE_DIR` like the others — it does via
  `path.join(CLAUDE_DIR, …)`.
- Reviewer should check: no backup path is built from transcript content except the validated
  `backupFileName` basename; the clamp is applied at read time.
- Deferred, in this order: (1) unified diff between adjacent versions — recommend the `diff`
  package (`createTwoFilesPatch`) rendered in a `<pre>` with `+`/`-` line coloring, ~S effort once
  this plan lands; (2) linking each `Edit`/`Write` tool block in the transcript to the version it
  produced via `messageId` → entry `uuid` → nearest following snapshot; (3) a cross-session
  "files Claude touched in this project" view.
