import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { formatTokens, listFileChanges, listSubagents, readTranscript } from '@/lib/claude/data';
import { Transcript } from '@/components/transcript';

export const dynamic = 'force-dynamic';

function formatDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function Page({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}) {
  const { project, id } = await params;
  const [transcript, subagents, changes] = await Promise.all([
    readTranscript(project, id),
    listSubagents(project, id),
    listFileChanges(project, id),
  ]);
  if (!transcript) notFound();

  const base = `/p/${project}/session/${id}`;
  const links = {
    subagents: new Map(
      subagents
        .filter((s) => s.toolUseId !== null)
        .map((s) => [s.toolUseId!, { href: `${base}/agent/${s.agentId}`, label: s.agentType ?? s.agentId }]),
    ),
    outputBase: `${base}/output`,
  };

  return (
    <DocsPage>
      <DocsTitle>Session</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">{id}</DocsDescription>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border bg-fd-card px-3 py-2 font-mono text-xs text-fd-muted-foreground">
        {transcript.meta.model && <span>{transcript.meta.model}</span>}
        {transcript.meta.version && <span>v{transcript.meta.version}</span>}
        {transcript.meta.gitBranch && <span>⎇ {transcript.meta.gitBranch}</span>}
        {formatDuration(transcript.meta.startedAt, transcript.meta.endedAt) && (
          <span>{formatDuration(transcript.meta.startedAt, transcript.meta.endedAt)}</span>
        )}
        <span>
          {transcript.meta.userMessages} user · {transcript.meta.assistantMessages} assistant ·{' '}
          {transcript.meta.toolUses} tools
        </span>
        {transcript.meta.tokens.messages > 0 && (
          <span title="input · cache write · cache read · output">
            tokens {formatTokens(transcript.meta.tokens.input)} in ·{' '}
            {formatTokens(transcript.meta.tokens.cacheCreation)} cache-w ·{' '}
            {formatTokens(transcript.meta.tokens.cacheRead)} cache-r ·{' '}
            {formatTokens(transcript.meta.tokens.output)} out
          </span>
        )}
        {transcript.meta.turns > 0 && (
          <span>
            {transcript.meta.turns} turns · avg{' '}
            {Math.round(transcript.meta.turnDurationMs / transcript.meta.turns / 1000)}s
          </span>
        )}
      </div>
      {transcript.truncated && (
        <p className="rounded border border-fd-primary/50 bg-fd-card px-3 py-2 text-sm">
          Long session — showing the first {transcript.blocks.length} blocks of {transcript.totalLines} lines. Token
          and turn totals cover only the blocks shown.
        </p>
      )}
      {subagents.length > 0 && (
        <details className="rounded-lg border bg-fd-card px-4 py-2 text-sm" open>
          <summary className="cursor-pointer select-none text-sm font-medium text-fd-muted-foreground">
            Subagents ({subagents.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {subagents.map((s) => (
              <li key={s.agentId} className="flex items-baseline gap-2">
                <Link href={`${base}/agent/${s.agentId}`} className="font-mono text-xs underline">
                  {s.agentType ?? 'agent'}
                </Link>
                <span className="min-w-0 flex-1 truncate">{s.description ?? s.agentId}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {changes.length > 0 && (
        <details className="rounded-lg border bg-fd-card px-4 py-2 text-sm" open>
          <summary className="cursor-pointer select-none text-sm font-medium text-fd-muted-foreground">
            Files changed ({changes.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {changes.map((f) => (
              <li key={f.path} className="flex flex-wrap items-baseline gap-x-2">
                <code className="text-xs">{f.path.replace(/^\/Users\/[^/]+/, '~')}</code>
                <span className="text-xs text-fd-muted-foreground">
                  {f.versions.map((v) =>
                    v.exists ? (
                      <Link key={v.version} href={`${base}/file/${v.backupFileName}`} className="mr-1 underline">
                        v{v.version}
                      </Link>
                    ) : (
                      <span key={v.version} className="mr-1 line-through">
                        v{v.version}
                      </span>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Transcript blocks={transcript.blocks} links={links} />
    </DocsPage>
  );
}
