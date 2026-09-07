import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getPersistedOutput } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ project: string; id: string; file: string }>;
}) {
  const { project, id, file } = await params;
  const output = await getPersistedOutput(project, id, file);
  if (!output) notFound();

  return (
    <DocsPage>
      <DocsTitle>{file}</DocsTitle>
      <DocsDescription className="mb-0">
        {output.size.toLocaleString()} bytes{output.truncated && ' · showing first 2 MB'}
      </DocsDescription>
      <p className="text-xs">
        <Link href={`/p/${project}/session/${id}`} className="underline">
          ← back to session
        </Link>
      </p>
      <pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs whitespace-pre-wrap break-words">
        {output.text}
      </pre>
    </DocsPage>
  );
}
