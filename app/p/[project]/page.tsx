import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { formatTokens, getProject, listMemories, listSessionUsage, listSessions } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

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
      <DocsTitle>{summary.realPath ?? project}</DocsTitle>
      <DocsBody>
        <h2>Memory ({memories.length})</h2>
        {memories.length === 0 && <p>No memory files.</p>}
        <ul>
          {memories.map((m) => (
            <li key={m.file}>
              <Link href={`/p/${project}/memory/${encodeURIComponent(m.file)}`}>{m.title}</Link>
              {m.description && <span className="text-fd-muted-foreground"> — {m.description}</span>}
            </li>
          ))}
        </ul>

        <h2>Sessions ({sessions.length})</h2>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/p/${project}/session/${s.id}`}>
                {s.mtime.toLocaleString()} · {s.firstPrompt?.slice(0, 80) ?? s.id}
              </Link>
              {usage.get(s.id) && (
                <span className="text-fd-muted-foreground">
                  {' '}
                  · {formatTokens(usage.get(s.id)!.output)} out · {formatTokens(usage.get(s.id)!.cacheRead)} cache-r
                </span>
              )}
            </li>
          ))}
        </ul>
      </DocsBody>
    </DocsPage>
  );
}
