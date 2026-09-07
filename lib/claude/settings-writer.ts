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
function catalogOrder(rules: string[]): string[] {
  const index = new Map(TOOL_CATALOG.map((t, i) => [t.name, i]));
  return [...rules].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const originalKeys = Object.keys(settings);

  if (settings.permissions === undefined) settings.permissions = {};
  if (!isPlainObject(settings.permissions)) {
    return { ok: false, error: 'settings.json permissions is not an object; refusing to write.' };
  }
  const permissions = settings.permissions;
  if (permissions.deny === undefined) permissions.deny = [];
  if (!Array.isArray(permissions.deny)) {
    return { ok: false, error: 'settings.json permissions.deny is not an array; refusing to write.' };
  }

  // Set semantics, order preserved. Entries this app did not add — including scoped
  // rules like `Bash(rm *)` — survive untouched.
  const removeSet = new Set(remove);
  const kept = (permissions.deny as unknown[]).filter(
    (r) => typeof r !== 'string' || !removeSet.has(r),
  );
  const present = new Set(kept.filter((r): r is string => typeof r === 'string'));
  const appended = catalogOrder(add.filter((r) => !present.has(r)));
  const nextDeny = [...kept, ...appended];
  permissions.deny = nextDeny;

  const serialized = `${JSON.stringify(settings, null, 2)}\n`;

  // Round-trip assertion: never let a write drop a key the user had.
  let roundTripped: unknown;
  try {
    roundTripped = JSON.parse(serialized);
  } catch {
    return { ok: false, error: 'Refusing to write: serialization would drop keys.' };
  }
  if (!isPlainObject(roundTripped) || originalKeys.some((k) => !(k in roundTripped))) {
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

  return { ok: true, denied: nextDeny.filter((r): r is string => typeof r === 'string') };
}
