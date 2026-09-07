import type { Root, Node } from 'fumadocs-core/page-tree';
import { getGlobalClaudeMd, getSettings, listAllMemories, listMemories, listPlans, listSessions } from './data';

const SIDEBAR_SESSION_LIMIT = 40;

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function sessionLabel(mtime: Date, firstPrompt: string | null): string {
  const snippet = firstPrompt ? firstPrompt.slice(0, 40) : 'no prompt';
  return `${shortDate(mtime)} · ${snippet}`;
}

export function projectDisplayName(realPath: string | null, slug: string): string {
  return realPath?.split('/').pop() || realPath || slug;
}

export async function buildGlobalTree(): Promise<Root> {
  const [claudeMd, settings, plans, groups] = await Promise.all([
    getGlobalClaudeMd(),
    getSettings(),
    listPlans(),
    listAllMemories(),
  ]);

  const children: Node[] = [{ type: 'page', name: 'Overview', url: '/global' }];
  if (claudeMd !== null) {
    children.push({ type: 'page', name: 'CLAUDE.md', url: '/global/claude-md' });
  }
  if (settings !== null) {
    children.push({ type: 'page', name: 'Settings', url: '/global/settings' });
  }
  if (plans.length > 0) {
    children.push({ type: 'page', name: `Plans (${plans.length})`, url: '/global/plans' });
  }
  for (const g of groups) {
    children.push({ type: 'separator', name: projectDisplayName(g.realPath, g.slug) });
    for (const m of g.memories) {
      children.push({
        type: 'page',
        name: m.title,
        url: `/p/${g.slug}/memory/${encodeURIComponent(m.file)}`,
      });
    }
  }
  return { name: 'Global', children };
}

export async function buildProjectTree(slug: string, displayName: string): Promise<Root> {
  const [memories, sessions] = await Promise.all([listMemories(slug), listSessions(slug)]);
  const base = `/p/${slug}`;

  const children: Node[] = [{ type: 'page', name: 'Overview', url: base }];

  if (memories.length > 0) {
    children.push({ type: 'separator', name: 'Memory' });
    for (const m of memories) {
      children.push({
        type: 'page',
        name: m.title,
        url: `${base}/memory/${encodeURIComponent(m.file)}`,
      });
    }
  }

  if (sessions.length > 0) {
    children.push({ type: 'separator', name: `Sessions (${sessions.length})` });
    for (const s of sessions.slice(0, SIDEBAR_SESSION_LIMIT)) {
      children.push({
        type: 'page',
        name: sessionLabel(s.mtime, s.firstPrompt),
        url: `${base}/session/${s.id}`,
      });
    }
  }

  return { name: displayName, children };
}
