import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getHistory } from '@/lib/claude/data';
import { HistoryTimeline } from '@/components/history-timeline';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const entries = await getHistory();

  return (
    <DocsPage>
      <DocsTitle>History</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">
        ~/.claude/history.jsonl · {entries.length} prompts
      </DocsDescription>
      <HistoryTimeline entries={entries} />
    </DocsPage>
  );
}
