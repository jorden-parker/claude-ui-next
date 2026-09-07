import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getPlan } from '@/lib/claude/data';
import { Markdown } from '@/components/markdown';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const plan = await getPlan(decodeURIComponent(file));
  if (!plan) notFound();

  return (
    <DocsPage>
      <DocsTitle>{plan.title}</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">~/.claude/plans/{plan.file}</DocsDescription>
      <DocsBody>
        <Markdown text={plan.content} />
      </DocsBody>
    </DocsPage>
  );
}
