import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';

const CLAUDE_DIR = process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PLANS_DIR = path.join(CLAUDE_DIR, 'plans');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');

export interface ProjectSummary {
  slug: string;
  /** Real filesystem path, recovered from a session's `cwd` field (the slug encoding is lossy). */
  realPath: string | null;
  sessionCount: number;
  memoryCount: number;
  lastActive: Date | null;
}

export interface MemoryEntry {
  file: string;
  title: string;
  description: string | null;
  type: string | null;
}

export interface Memory extends MemoryEntry {
  content: string;
}

export interface SessionSummary {
  id: string;
  mtime: Date;
  size: number;
  firstPrompt: string | null;
}

export type TranscriptBlock =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string }
  | { kind: 'thinking'; text: string; timestamp?: string }
  | { kind: 'tool-use'; name: string; input: unknown; id: string; timestamp?: string }
  | { kind: 'tool-result'; toolUseId: string; text: string; isError: boolean; timestamp?: string };

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

export interface Transcript {
  blocks: TranscriptBlock[];
  meta: SessionMetadata;
  totalLines: number;
  skippedLines: number;
  truncated: boolean;
}

export interface PlanEntry {
  file: string;
  title: string;
  mtime: Date;
  size: number;
}

export interface Plan extends PlanEntry {
  content: string;
}

export interface SkillEntry {
  /** Route id: 'caveman' for user skills, 'plugin-name:skill' for plugin skills. */
  id: string;
  name: string;
  /** 'user' or the plugin name providing it. */
  source: string;
  description: string | null;
}

export interface Skill extends SkillEntry {
  content: string;
  /** Sibling files/dirs in the skill directory (excluding SKILL.md). */
  files: string[];
}

export interface HistoryEntry {
  display: string;
  /** Absolute project path as recorded by Claude Code. */
  project: string;
  /** Matching directory under ~/.claude/projects, or null if it no longer exists. */
  slug: string | null;
  sessionId: string | null;
  /** True only when the session transcript file exists (safe to link). */
  hasSession: boolean;
  /** Epoch milliseconds. */
  timestamp: number;
}

export interface ProjectMemories {
  slug: string;
  realPath: string | null;
  memories: MemoryEntry[];
}

const MAX_BLOCKS = 2000;

/** The user's global instructions at ~/.claude/CLAUDE.md, or null if absent. */
export async function getGlobalClaudeMd(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(CLAUDE_DIR, 'CLAUDE.md'), 'utf8');
  } catch {
    return null;
  }
}

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

/** Memories from every project that has any, newest project first. */
export async function listAllMemories(): Promise<ProjectMemories[]> {
  let entries;
  try {
    entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const groups = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const memories = await listMemories(e.name);
        if (memories.length === 0) return null;
        const sessions = await sessionFiles(e.name);
        return { slug: e.name, realPath: await detectRealPath(e.name, sessions[0]), memories };
      }),
  );
  return groups.filter((g): g is ProjectMemories => g !== null);
}

function projectDir(slug: string): string {
  // Slugs are directory names under ~/.claude/projects — reject anything path-like.
  if (slug.includes('/') || slug.includes('\\') || slug.startsWith('.')) {
    throw new Error(`invalid project slug: ${slug}`);
  }
  return path.join(PROJECTS_DIR, slug);
}

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

const realPathCache = new Map<string, { mtimeMs: number; realPath: string | null }>();

/** Recover the project's real path by reading `cwd` from its newest transcript. */
async function detectRealPath(slug: string, newest?: { name: string; mtime: Date }): Promise<string | null> {
  if (!newest) return null;
  const cached = realPathCache.get(slug);
  if (cached && cached.mtimeMs === newest.mtime.getTime()) return cached.realPath;

  let realPath: string | null = null;
  try {
    const fd = await fs.open(path.join(projectDir(slug), newest.name));
    try {
      const buf = Buffer.alloc(16384);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      const match = buf.toString('utf8', 0, bytesRead).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (match) realPath = JSON.parse(`"${match[1]}"`);
    } finally {
      await fd.close();
    }
  } catch {
    // unreadable transcript — leave null
  }
  realPathCache.set(slug, { mtimeMs: newest.mtime.getTime(), realPath });
  return realPath;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries;
  try {
    entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const [sessions, memories] = await Promise.all([sessionFiles(e.name), listMemories(e.name)]);
        return {
          slug: e.name,
          realPath: await detectRealPath(e.name, sessions[0]),
          sessionCount: sessions.length,
          memoryCount: memories.length,
          lastActive: sessions[0]?.mtime ?? null,
        };
      }),
  );
  return projects.sort((a, b) => (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0));
}

export async function getProject(slug: string): Promise<ProjectSummary | null> {
  try {
    await fs.access(projectDir(slug));
  } catch {
    return null;
  }
  const [sessions, memories] = await Promise.all([sessionFiles(slug), listMemories(slug)]);
  return {
    slug,
    realPath: await detectRealPath(slug, sessions[0]),
    sessionCount: sessions.length,
    memoryCount: memories.length,
    lastActive: sessions[0]?.mtime ?? null,
  };
}

export async function listMemories(slug: string): Promise<MemoryEntry[]> {
  const dir = path.join(projectDir(slug), 'memory');
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const memories = await Promise.all(
    files
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map(async (file) => {
        const raw = await fs.readFile(path.join(dir, file), 'utf8');
        const { data } = matter(raw);
        return {
          file,
          title: typeof data.name === 'string' ? data.name : file.replace(/\.md$/, ''),
          description: typeof data.description === 'string' ? data.description : null,
          type: typeof data.metadata?.type === 'string' ? data.metadata.type : null,
        };
      }),
  );
  // MEMORY.md is the index — always first.
  return memories.sort((a, b) => Number(b.file === 'MEMORY.md') - Number(a.file === 'MEMORY.md'));
}

export async function getMemory(slug: string, file: string): Promise<Memory | null> {
  if (file.includes('/') || file.includes('\\') || !file.endsWith('.md')) return null;
  let raw;
  try {
    raw = await fs.readFile(path.join(projectDir(slug), 'memory', file), 'utf8');
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  return {
    file,
    title: typeof data.name === 'string' ? data.name : file.replace(/\.md$/, ''),
    description: typeof data.description === 'string' ? data.description : null,
    type: typeof data.metadata?.type === 'string' ? data.metadata.type : null,
    content,
  };
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type: string; text: string } => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

function isNoisePrompt(text: string): boolean {
  return text.startsWith('<') || text.startsWith('Caveat:');
}

export async function listSessions(slug: string): Promise<SessionSummary[]> {
  const files = await sessionFiles(slug);
  return Promise.all(
    files.map(async (f) => ({
      id: f.name.replace(/\.jsonl$/, ''),
      mtime: f.mtime,
      size: f.size,
      firstPrompt: await readFirstPrompt(slug, f.name),
    })),
  );
}

async function readFirstPrompt(slug: string, file: string): Promise<string | null> {
  let head: string;
  try {
    const fd = await fs.open(path.join(projectDir(slug), file));
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      head = buf.toString('utf8', 0, bytesRead);
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
  for (const line of head.split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'user' || entry.isMeta) continue;
    const text = extractText(entry.message?.content);
    if (text && !isNoisePrompt(text)) return text.trim().slice(0, 200);
  }
  return null;
}

export async function readTranscript(slug: string, id: string): Promise<Transcript | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  let raw;
  try {
    raw = await fs.readFile(path.join(projectDir(slug), `${id}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const blocks: TranscriptBlock[] = [];
  const meta: SessionMetadata = {
    model: null,
    version: null,
    gitBranch: null,
    startedAt: null,
    endedAt: null,
    userMessages: 0,
    assistantMessages: 0,
    toolUses: 0,
  };
  let skippedLines = 0;
  let truncated = false;

  for (const line of lines) {
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true;
      break;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }

    if (typeof entry.timestamp === 'string') {
      meta.startedAt ??= entry.timestamp;
      meta.endedAt = entry.timestamp;
    }
    if (meta.version === null && typeof entry.version === 'string') meta.version = entry.version;
    if (meta.gitBranch === null && typeof entry.gitBranch === 'string') meta.gitBranch = entry.gitBranch;
    if (meta.model === null && entry.type === 'assistant' && typeof entry.message?.model === 'string') {
      meta.model = entry.message.model;
    }

    if (entry.type === 'user' && !entry.isMeta) {
      const content = entry.message?.content;
      if (typeof content === 'string') {
        blocks.push({ kind: 'text', role: 'user', text: content, timestamp: entry.timestamp });
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === 'text' && typeof item.text === 'string') {
            blocks.push({ kind: 'text', role: 'user', text: item.text, timestamp: entry.timestamp });
          } else if (item?.type === 'tool_result') {
            blocks.push({
              kind: 'tool-result',
              toolUseId: item.tool_use_id ?? '',
              text: extractText(item.content) ?? JSON.stringify(item.content),
              isError: item.is_error === true,
              timestamp: entry.timestamp,
            });
          }
        }
      } else {
        skippedLines++;
      }
    } else if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (!Array.isArray(content)) {
        skippedLines++;
        continue;
      }
      for (const item of content) {
        if (item?.type === 'text' && typeof item.text === 'string') {
          blocks.push({ kind: 'text', role: 'assistant', text: item.text, timestamp: entry.timestamp });
        } else if (item?.type === 'thinking' && typeof item.thinking === 'string') {
          blocks.push({ kind: 'thinking', text: item.thinking, timestamp: entry.timestamp });
        } else if (item?.type === 'tool_use') {
          blocks.push({
            kind: 'tool-use',
            name: item.name ?? 'unknown',
            input: item.input,
            id: item.id ?? '',
            timestamp: entry.timestamp,
          });
        }
      }
    } else {
      skippedLines++;
    }
  }

  // A truncated read stops early, so the last entry seen is not the session's end.
  if (truncated) {
    for (const line of lines.slice(-20).reverse()) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof entry?.timestamp === 'string') {
        meta.endedAt = entry.timestamp;
        break;
      }
    }
  }

  for (const b of blocks) {
    if (b.kind === 'text' && b.role === 'user') meta.userMessages++;
    else if (b.kind === 'text' && b.role === 'assistant') meta.assistantMessages++;
    else if (b.kind === 'tool-use') meta.toolUses++;
  }

  return { blocks, meta, totalLines: lines.length, skippedLines, truncated };
}

/** All markdown plans in ~/.claude/plans, newest first. */
export async function listPlans(): Promise<PlanEntry[]> {
  let files;
  try {
    files = await fs.readdir(PLANS_DIR);
  } catch {
    return [];
  }
  const plans = await Promise.all(
    files
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map(async (file) => {
        const full = path.join(PLANS_DIR, file);
        const [stat, raw] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')]);
        const heading = raw.match(/^#\s+(.+)$/m);
        return {
          file,
          title: heading ? heading[1].trim() : file.replace(/\.md$/, ''),
          mtime: stat.mtime,
          size: stat.size,
        };
      }),
  );
  return plans.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export async function getPlan(file: string): Promise<Plan | null> {
  if (file.includes('/') || file.includes('\\') || file.startsWith('.') || !file.endsWith('.md')) return null;
  let raw, stat;
  try {
    const full = path.join(PLANS_DIR, file);
    [raw, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
  } catch {
    return null;
  }
  const heading = raw.match(/^#\s+(.+)$/m);
  return {
    file,
    title: heading ? heading[1].trim() : file.replace(/\.md$/, ''),
    mtime: stat.mtime,
    size: stat.size,
    content: raw,
  };
}

function parseSkillFrontmatter(raw: string, fallbackName: string): { name: string; description: string | null } {
  const { data } = matter(raw);
  return {
    name: typeof data.name === 'string' ? data.name : fallbackName,
    description: typeof data.description === 'string' ? data.description.trim() : null,
  };
}

/** Directories under root (recursing at most `depth` levels) that contain a SKILL.md. */
async function findSkillDirs(root: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) results.push(root);
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        results.push(...(await findSkillDirs(path.join(root, e.name), depth - 1)));
      }
    }
  }
  return results;
}

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

/** User skills from ~/.claude/skills plus skills of installed plugins. */
export async function listSkills(): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  const userDirs = await findSkillDirs(SKILLS_DIR, 1);
  for (const dir of userDirs) {
    if (dir === SKILLS_DIR) continue;
    try {
      const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
      const base = path.basename(dir);
      const fm = parseSkillFrontmatter(raw, base);
      skills.push({ id: base, name: fm.name, source: 'user', description: fm.description });
    } catch {
      // unreadable skill — skip
    }
  }

  for (const [plugin, installPath] of await installedPlugins()) {
    const dirs = await findSkillDirs(path.join(installPath, 'skills'), 2);
    for (const dir of dirs) {
      try {
        const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
        const base = path.basename(dir);
        const fm = parseSkillFrontmatter(raw, base);
        skills.push({ id: `${plugin}:${base}`, name: fm.name, source: plugin, description: fm.description });
      } catch {
        // skip
      }
    }
  }

  return skills.sort((a, b) => Number(a.source !== 'user') - Number(b.source !== 'user') || a.id.localeCompare(b.id));
}

export async function getSkill(id: string): Promise<Skill | null> {
  if (!/^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)?$/.test(id)) return null;
  const [first, second] = id.split(':');

  let dir: string | null = null;
  if (second === undefined) {
    dir = path.join(SKILLS_DIR, first);
  } else {
    const plugin = (await installedPlugins()).find(([name]) => name === first);
    if (plugin) {
      const dirs = await findSkillDirs(path.join(plugin[1], 'skills'), 2);
      dir = dirs.find((d) => path.basename(d) === second) ?? null;
    }
  }
  if (dir === null) return null;

  let raw, entries;
  try {
    [raw, entries] = await Promise.all([
      fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'),
      fs.readdir(dir),
    ]);
  } catch {
    return null;
  }
  const fm = parseSkillFrontmatter(raw, path.basename(dir));
  const { content } = matter(raw);
  return {
    id,
    name: fm.name,
    source: second === undefined ? 'user' : first,
    description: fm.description,
    content,
    files: entries.filter((f) => f !== 'SKILL.md').sort(),
  };
}

/** All prompts from ~/.claude/history.jsonl, newest first. */
export async function getHistory(): Promise<HistoryEntry[]> {
  let raw;
  try {
    raw = await fs.readFile(path.join(CLAUDE_DIR, 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  let projectDirs: Set<string>;
  try {
    projectDirs = new Set(await fs.readdir(PROJECTS_DIR));
  } catch {
    projectDirs = new Set();
  }

  // One readdir per referenced project, cached — not one stat per history line.
  const sessionCache = new Map<string, Set<string>>();
  async function sessionIds(slug: string): Promise<Set<string>> {
    let ids = sessionCache.get(slug);
    if (!ids) {
      try {
        const files = await fs.readdir(path.join(PROJECTS_DIR, slug));
        ids = new Set(files.filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')));
      } catch {
        ids = new Set();
      }
      sessionCache.set(slug, ids);
    }
    return ids;
  }

  const entries: HistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed?.display !== 'string' || typeof parsed?.timestamp !== 'number') continue;
    const project = typeof parsed.project === 'string' ? parsed.project : '';
    const candidate = project.replace(/[^a-zA-Z0-9]/g, '-');
    const slug = projectDirs.has(candidate) ? candidate : null;
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
    const hasSession = slug !== null && sessionId !== null && (await sessionIds(slug)).has(sessionId);
    entries.push({ display: parsed.display, project, slug, sessionId, hasSession, timestamp: parsed.timestamp });
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
