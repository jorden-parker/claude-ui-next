import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getDeniedTools, listProjects, listToolUsage } from '@/lib/claude/data';
import { PRESETS, TOOL_CATALOG } from '@/lib/claude/tools';
import { ToolPresets, ToolSwitches, type ToolRow } from '@/components/tool-presets';
import { updateDeniedTools } from './actions';

export const dynamic = 'force-dynamic';

/** Catalog groups in display order; discovered MCP tools land in the final `mcp` group. */
const GROUP_ORDER = [
  'files',
  'shell',
  'search',
  'web',
  'agents',
  'tasks',
  'planning',
  'notebooks',
  'ui',
  'system',
  'mcp',
];

export default async function Page() {
  const [usage, denied, projects] = await Promise.all([listToolUsage(), getDeniedTools(), listProjects()]);
  const sessionCount = projects.reduce((n, p) => n + p.sessionCount, 0);
  const byName = new Map(usage.map((u) => [u.name, u]));

  const rows: ToolRow[] = [
    ...TOOL_CATALOG.map((t) => ({
      name: t.name,
      purpose: t.purpose,
      group: t.group,
      protected: t.protected,
      core: t.core,
      count: byName.get(t.name)?.count ?? 0,
      lastUsed: byName.get(t.name)?.lastUsed ?? null,
    })),
    // Discovered MCP tools: an MCP tool never called cannot be found this way.
    ...usage
      .filter((u) => u.name.startsWith('mcp__'))
      .map((u) => ({ name: u.name, purpose: '', group: 'mcp', count: u.count, lastUsed: u.lastUsed })),
  ].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

  return (
    <DocsPage full>
      <DocsTitle>Tool budget</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">
        ~/.claude/settings.json → permissions.deny
      </DocsDescription>
      <DocsBody>
        <p>
          Every tool definition Claude Code sends costs context tokens on every request. A bare tool name in{' '}
          <code>permissions.deny</code> removes that tool&apos;s definition from Claude&apos;s context entirely, so
          it stops costing tokens. A scoped rule like <code>Bash(git:*)</code> does not — it only blocks calls. Run{' '}
          <code>/context</code> in Claude Code before and after to see the difference.
        </p>
        <p className="text-sm text-fd-muted-foreground">
          <strong>On</strong> means the tool is available. <strong>Off</strong> writes its name to{' '}
          <code>permissions.deny</code> in <code>~/.claude/settings.json</code>, which no project&apos;s
          settings can override; restart your sessions to pick the change up. Usage counts come from the{' '}
          {sessionCount} sessions on this machine, and never used is a hint rather than a recommendation —
          some tools are rare by nature and still needed when they fire.
        </p>

        <h2>Tools</h2>
        <ToolSwitches rows={rows} denied={denied} action={updateDeniedTools} />

        <h2>Presets</h2>
        <p>Bundles that flip several switches at once.</p>
        <ToolPresets presets={PRESETS} denied={denied} action={updateDeniedTools} />
      </DocsBody>
    </DocsPage>
  );
}
