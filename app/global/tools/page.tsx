import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getDeniedTools, listProjects, listToolUsage } from '@/lib/claude/data';
import { PRESETS, TOOL_CATALOG } from '@/lib/claude/tools';
import { ToolPresets, ToolSwitches, type Row } from '@/components/tool-presets';
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function Page() {
  const [usage, denied, projects] = await Promise.all([listToolUsage(), getDeniedTools(), listProjects()]);
  const sessionCount = projects.reduce((n, p) => n + p.sessionCount, 0);
  const byName = new Map(usage.map((u) => [u.name, u]));

  const rows: Row[] = [
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

  const neverUsed = TOOL_CATALOG.filter((t) => !t.protected && (byName.get(t.name)?.count ?? 0) === 0);
  const builtinUsage = usage.filter((u) => !u.name.startsWith('mcp__'));
  const mcpUsage = usage.filter((u) => u.name.startsWith('mcp__'));

  return (
    <DocsPage>
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

        <h2>Tools</h2>
        <ToolSwitches rows={rows} denied={denied} action={updateDeniedTools} />

        <h2>Presets</h2>
        <p>Bundles that flip several switches at once.</p>
        <ToolPresets presets={PRESETS} denied={denied} action={updateDeniedTools} />

        <h2>Never used</h2>
        <p>
          Never used in the {sessionCount} sessions on this machine. Never used is a hint, not a recommendation —
          some tools are rare by nature (<code>ExitPlanMode</code>, <code>EndConversation</code>) and still needed
          when they fire.
        </p>
        {neverUsed.length === 0 ? (
          <p>Every catalogued tool has been used at least once.</p>
        ) : (
          <ul>
            {neverUsed.map((t) => (
              <li key={t.name}>
                <code>{t.name}</code> — <span className="text-fd-muted-foreground">{t.purpose}</span>
              </li>
            ))}
          </ul>
        )}

        <h2>Usage history</h2>
        {usage.length === 0 && <p>No tool usage found in ~/.claude/projects.</p>}
        {builtinUsage.length > 0 && (
          <>
            <h3>Built-in tools</h3>
            <ul>
              {builtinUsage.map((u) => (
                <li key={u.name}>
                  <code>{u.name}</code> — {u.count} calls
                  {u.lastUsed && <span className="text-fd-muted-foreground"> · last {shortDate(u.lastUsed)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {mcpUsage.length > 0 && (
          <>
            <h3>MCP tools</h3>
            <ul>
              {mcpUsage.map((u) => (
                <li key={u.name}>
                  <code>{u.name}</code> — {u.count} calls
                  {u.lastUsed && <span className="text-fd-muted-foreground"> · last {shortDate(u.lastUsed)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </DocsBody>
    </DocsPage>
  );
}
