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
import { ENV_NAME, resolveNode, validate } from './settings-schema';

const CLAUDE_DIR = process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const BACKUP_PATH = path.join(CLAUDE_DIR, 'settings.ui-backup.json');

const MAX_RULES_PER_REQUEST = 100;
const MAX_VALUE_LENGTH = 65536;

export type WriteResult = { ok: true; denied: string[] } | { ok: false; error: string };
export type SetResult = { ok: true } | { ok: false; error: string };

/** Catalog order first, then anything else (e.g. mcp__ names) in the order given. */
function catalogOrder(rules: string[]): string[] {
  const index = new Map(TOOL_CATALOG.map((t, i) => [t.name, i]));
  return [...rules].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A mutator inspects/edits `settings` in place and returns an error to abort, or null to proceed. */
type Mutator = (settings: Record<string, unknown>) => string | null;

/**
 * Generic read → mutate → assert → back up → atomic-write sequence shared by every
 * write path in this app. `mutate` is called with the parsed settings object (or `{}`
 * if the file does not exist yet) and may edit it in place; returning a non-null string
 * aborts before any file is touched.
 */
async function mutateSettings(
  mutate: Mutator,
): Promise<{ ok: true; settings: Record<string, unknown> } | { ok: false; error: string }> {
  let raw: string | null;
  try {
    raw = await fs.readFile(SETTINGS_PATH, 'utf8');
  } catch {
    raw = null;
  }

  let settings: Record<string, unknown>;
  if (raw === null) {
    settings = {};
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'settings.json is not a JSON object; refusing to write.' };
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, error: 'settings.json is not a JSON object; refusing to write.' };
    }
    settings = parsed;
  }
  const mutateError = mutate(settings);
  if (mutateError !== null) {
    return { ok: false, error: mutateError };
  }

  // Round-trip assertion: never let *serialization* silently drop a key the mutator
  // left in place (e.g. a value JSON.stringify skips, like `undefined`). Keys the
  // mutator itself deleted on purpose (a `setSettingValue` clear, or a pruned-empty
  // intermediate) are intentionally absent by this point, so this checks the
  // post-mutation keys, not the pre-mutation ones.
  const keysAfterMutate = Object.keys(settings);
  const serialized = `${JSON.stringify(settings, null, 2)}\n`;
  let roundTripped: unknown;
  try {
    roundTripped = JSON.parse(serialized);
  } catch {
    return { ok: false, error: 'Refusing to write: serialization would drop keys.' };
  }
  if (!isPlainObject(roundTripped) || keysAfterMutate.some((k) => !(k in roundTripped))) {
    return { ok: false, error: 'Refusing to write: serialization would drop keys.' };
  }

  // Back up the current file. A missing source is fine; any other failure aborts.
  if (raw !== null) {
    try {
      await fs.copyFile(SETTINGS_PATH, BACKUP_PATH);
    } catch {
      return { ok: false, error: 'Refusing to write: could not back up settings.json.' };
    }
  }

  // Atomic write: temp file in the same directory, then rename over the target.
  const tmp = path.join(CLAUDE_DIR, `.settings.json.tmp-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, serialized, 'utf8');
    await fs.rename(tmp, SETTINGS_PATH);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
    return { ok: false, error: 'Could not write settings.json.' };
  }

  return { ok: true, settings };
}

/** Add or remove bare-name deny rules in ~/.claude/settings.json. */
export async function setDeniedTools(add: string[], remove: string[]): Promise<WriteResult> {
  if (!Array.isArray(add) || !Array.isArray(remove)) return { ok: false, error: 'Invalid request.' };
  if (add.length + remove.length > MAX_RULES_PER_REQUEST) {
    return { ok: false, error: 'Refused: too many rules in one request.' };
  }
  for (const rule of [...add, ...remove]) {
    if (typeof rule !== 'string' || !isWritableRule(rule)) {
      return { ok: false, error: `Refused: ${rule} is not a rule this app may write.` };
    }
  }

  let nextDeny: unknown[] = [];

  const result = await mutateSettings((settings) => {
    if (settings.permissions === undefined) settings.permissions = {};
    if (!isPlainObject(settings.permissions)) {
      return 'settings.json permissions is not an object; refusing to write.';
    }
    const permissions = settings.permissions;
    if (permissions.deny === undefined) permissions.deny = [];
    if (!Array.isArray(permissions.deny)) {
      return 'settings.json permissions.deny is not an array; refusing to write.';
    }

    // Set semantics, order preserved. Entries this app did not add — including scoped
    // rules like `Bash(rm *)` — survive untouched.
    const removeSet = new Set(remove);
    const kept = (permissions.deny as unknown[]).filter(
      (r) => typeof r !== 'string' || !removeSet.has(r),
    );
    const present = new Set(kept.filter((r): r is string => typeof r === 'string'));
    const appended = catalogOrder(add.filter((r) => !present.has(r)));
    nextDeny = [...kept, ...appended];
    permissions.deny = nextDeny;
    return null;
  });

  if (!result.ok) return result;
  return { ok: true, denied: nextDeny.filter((r): r is string => typeof r === 'string') };
}

const PATH_SEGMENT_RE = /^[A-Za-z0-9_$.:@-]+$/;
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Set (or with `value === undefined`, delete) one setting at `path`.
 * Refuses paths the schema does not know, `$schema`, and `permissions.deny`.
 */
export async function setSettingValue(path: string[], value: unknown): Promise<SetResult> {
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((p) => typeof p !== 'string' || p.length === 0 || !PATH_SEGMENT_RE.test(p))
  ) {
    return { ok: false, error: 'Invalid request.' };
  }
  // Never walk a path segment that could reach an object's prototype chain instead of
  // a plain data key (`cursor[seg] = …` on `__proto__`/`constructor`/`prototype`).
  if (path.some((p) => UNSAFE_SEGMENTS.has(p))) {
    return { ok: false, error: 'Invalid request.' };
  }

  const key = path.join('.');

  if (path[0] === '$schema') {
    return { ok: false, error: `Refused: ${key} is not a setting this app may write.` };
  }
  if (key === 'permissions.deny') {
    return { ok: false, error: 'Refused: permissions.deny is edited on the Tools page.' };
  }
  // Env vars are flat strings: `env.<NAME>` only, never a deeper path. The schema
  // module's synthetic fallback already enforces this, but the writer checks it
  // independently rather than relying solely on that module.
  if (path[0] === 'env' && path.length !== 2) {
    return { ok: false, error: `Refused: ${key} is not a setting this app may write.` };
  }

  const node = resolveNode(path);
  if (node === null) {
    return { ok: false, error: `Refused: ${key} is not a setting this app may write.` };
  }
  if (path[0] === 'env' && path.length === 2 && !ENV_NAME.test(path[1])) {
    return { ok: false, error: `Refused: ${key} is not a setting this app may write.` };
  }

  const reason = validate(node, value);
  if (reason !== null) {
    return { ok: false, error: `Refused: ${key}: ${reason}` };
  }

  if (value !== undefined) {
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      return { ok: false, error: 'Refused: value is not JSON-serialisable.' };
    }
    if (json === undefined || json.length > MAX_VALUE_LENGTH) {
      return { ok: false, error: 'Refused: value too large.' };
    }
  }

  // Unknown top-level keys (the synthetic `any` node) are only writable when the key
  // already exists in the file — the UI can edit e.g. `modelSettings` but cannot invent
  // new top-level keys the schema does not know.
  const isUnknownTopLevel = node.type === 'any';

  const result = await mutateSettings((settings) => {
    if (isUnknownTopLevel && !Object.prototype.hasOwnProperty.call(settings, path[0])) {
      return `Refused: ${key} is not a setting this app may write.`;
    }

    // Walk to the leaf's parent, creating plain objects as needed (for a set). For a
    // delete, a missing intermediate means the leaf can't exist either — no-op, and in
    // particular a pre-existing empty `permissions`/`env` (nothing to delete inside it)
    // is left untouched rather than pruned.
    const ancestors: Record<string, unknown>[] = [settings];
    let cursor: Record<string, unknown> = settings;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (cursor[seg] === undefined) {
        if (value === undefined) return null;
        cursor[seg] = {};
      } else if (!isPlainObject(cursor[seg])) {
        return `Refused: ${path.slice(0, i + 1).join('.')} is not an object; refusing to write.`;
      }
      cursor = cursor[seg] as Record<string, unknown>;
      ancestors.push(cursor);
    }

    const leaf = path[path.length - 1];
    if (value === undefined) {
      if (!(leaf in cursor)) return null; // nothing to delete
      delete cursor[leaf];
      // Prune intermediate objects that became empty as a direct result of this
      // delete, deepest first, stopping at the first one that is still non-empty.
      for (let i = path.length - 2; i >= 0; i--) {
        const child = ancestors[i + 1];
        if (Object.keys(child).length === 0) {
          delete ancestors[i][path[i]];
        } else {
          break;
        }
      }
    } else {
      cursor[leaf] = value;
    }
    return null;
  });

  if (!result.ok) return result;
  return { ok: true };
}
