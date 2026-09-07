import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { readTranscript } from '@/lib/claude/data';
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
  const transcript = await readTranscript(project, id);
  if (!transcript) notFound();

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
      </div>
      {transcript.truncated && (
        <p className="rounded border border-fd-primary/50 bg-fd-card px-3 py-2 text-sm">
          Long session — showing the first {transcript.blocks.length} blocks of {transcript.totalLines} lines.
        </p>
      )}
      <Transcript blocks={transcript.blocks} />
    </DocsPage>
  );
}
