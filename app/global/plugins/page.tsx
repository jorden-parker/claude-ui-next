import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getUserHooks, listPlugins, type HookCommand } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function enabledLabel(enabled: boolean | null): string {
  if (enabled === true) return 'enabled';
  if (enabled === false) return 'disabled';
  return 'not listed';
}

interface HookRow extends HookCommand {
  source: string;
}

export default async function Page() {
  const plugins = await listPlugins();

  const rows: HookRow[] = [
    ...(await getUserHooks()).map((h) => ({ ...h, source: 'settings.json' })),
    ...plugins.flatMap((p) => p.hooks.map((h) => ({ ...h, source: p.name }))),
  ];
  const events = [...new Set(rows.map((r) => r.event))].sort((a, b) => a.localeCompare(b));

  return (
    <DocsPage>
      <DocsTitle>Plugins</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">
        ~/.claude/plugins/installed_plugins.json · {plugins.length} installed
      </DocsDescription>
      <DocsBody>
        <h2>Installed</h2>
        {plugins.length === 0 && <p>No plugins installed.</p>}
        {plugins.map((p) => (
          <section key={p.key}>
            <h3>
              {p.name} <span className="text-fd-muted-foreground">{p.version ?? 'unknown version'}</span>{' '}
              <span className="rounded bg-fd-secondary px-1.5 py-0.5 text-xs">{enabledLabel(p.enabled)}</span>
            </h3>
            {p.description && <p>{p.description}</p>}
            <ul>
              <li>
                marketplace: {p.marketplace || 'unknown'}
                {p.marketplaceSource ? ` (${p.marketplaceSource})` : ' (unknown marketplace)'}
              </li>
              {p.installedAt && <li>installed: {formatDate(p.installedAt)}</li>}
              <li>
                path: <code>{p.installPath}</code>
              </li>
              <li>
                {p.skillCount > 0 ? (
                  <Link href="/global/skills">{p.skillCount} skills</Link>
                ) : (
                  <span>{p.skillCount} skills</span>
                )}{' '}
                · {p.agentCount} agents · {p.commandCount} commands · {p.hooks.length} hooks
              </li>
            </ul>
          </section>
        ))}

        <h2>Hooks</h2>
        {rows.length === 0 && <p>No hooks configured.</p>}
        {events.map((event) => (
          <div key={event}>
            <h3>{event}</h3>
            <ul>
              {rows
                .filter((r) => r.event === event)
                .map((r, i) => (
                  <li key={`${event}-${i}`}>
                    <code>{r.command}</code>
                    <span className="text-fd-muted-foreground">
                      {' '}
                      — {r.source}
                      {r.matcher && <> · matcher {r.matcher}</>}
                      {r.timeout !== null && <> · timeout {r.timeout}s</>}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </DocsBody>
    </DocsPage>
  );
}
