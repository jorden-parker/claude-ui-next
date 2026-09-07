import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { formatTokens, listSubagents, readSubagentTranscript } from '@/lib/claude/data';
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
  params: Promise<{ project: string; id: string; agentId: string }>;
}) {
  const { project, id, agentId } = await params;
  const [transcript, subagents] = await Promise.all([
    readSubagentTranscript(project, id, agentId),
    listSubagents(project, id),
  ]);
  if (!transcript) notFound();
  const meta = subagents.find((s) => s.agentId === agentId);

  return (
    <DocsPage>
      <DocsTitle>Subagent · {meta?.agentType ?? agentId}</DocsTitle>
      <DocsDescription className="mb-0">{meta?.description ?? 'No description recorded.'}</DocsDescription>
      <p className="text-xs">
        <Link href={`/p/${project}/session/${id}`} className="underline">
          ← back to session
        </Link>
      </p>
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
      <Transcript blocks={transcript.blocks} />
    </DocsPage>
  );
}
