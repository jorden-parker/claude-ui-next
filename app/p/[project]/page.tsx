import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { formatTokens, getProject, listMemories, listSessionUsage, listSessions } from '@/lib/claude/data';
import { projectDisplayPath } from '@/lib/claude/tree';

export const dynamic = 'force-dynamic';

function sessionDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sessionTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default async function Page({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const summary = await getProject(project);
  if (!summary) notFound();

  const [memories, sessions, usage] = await Promise.all([
    listMemories(project),
    listSessions(project),
    listSessionUsage(project),
  ]);

  return (
    <DocsPage>
      <DocsTitle className="font-mono text-3xl/[40px] break-all">
          {projectDisplayPath(summary.realPath, project)}
        </DocsTitle>
      <DocsBody>
        <h2>Memory ({memories.length})</h2>
        {memories.length === 0 ? (
          <p className="text-fd-muted-foreground">
            No memory files yet. Anything Claude saves for this project lands here.
          </p>
        ) : (
          <div className="geist-ledger not-prose">
            {memories.map((m) => (
              <Link
                key={m.file}
                href={`/p/${project}/memory/${encodeURIComponent(m.file)}`}
                className="geist-row grid-cols-1"
              >
                <span className="text-sm font-medium">{m.title}</span>
                {m.description && (
                  <span className="max-w-[68ch] text-sm text-fd-muted-foreground">{m.description}</span>
                )}
              </Link>
            ))}
          </div>
        )}

        <h2>Sessions ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <p className="text-fd-muted-foreground">No transcripts recorded for this project.</p>
        ) : (
          <div className="geist-ledger not-prose">
            {sessions.map((s) => {
              const u = usage.get(s.id);
              return (
                <Link
                  key={s.id}
                  href={`/p/${project}/session/${s.id}`}
                  className="geist-row grid-cols-[minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)_6rem]"
                >
                  <span className="geist-numeric font-mono text-xs text-fd-muted-foreground">
                    {sessionDate(s.mtime)} {sessionTime(s.mtime)}
                  </span>
                  <span className="truncate text-sm">
                    {s.firstPrompt?.slice(0, 100) ?? <span className="font-mono">{s.id}</span>}
                  </span>
                  <span className="geist-numeric text-xs text-fd-muted-foreground sm:text-right">
                    {u ? `${formatTokens(u.output)} out` : ''}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </DocsBody>
    </DocsPage>
  );
}
