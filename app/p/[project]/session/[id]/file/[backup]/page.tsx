import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getFileVersion, listFileChanges } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ project: string; id: string; backup: string }>;
}) {
  const { project, id, backup: rawBackup } = await params;
  // Next.js does not decode `@` (and similar reserved-but-unescaped characters) in dynamic
  // segments before populating params, so backup names like "<hash>@v2" arrive as "<hash>%40v2".
  let backup: string;
  try {
    backup = decodeURIComponent(rawBackup);
  } catch {
    notFound();
  }
  const version = await getFileVersion(id, backup);
  if (!version) notFound();

  const changes = await listFileChanges(project, id);
  const entry = changes.find((f) => f.versions.some((v) => v.backupFileName === backup));
  const label = entry?.versions.find((v) => v.backupFileName === backup);

  return (
    <DocsPage>
      <DocsTitle>{backup}</DocsTitle>
      <DocsDescription className="mb-0">
        {version.size.toLocaleString()} bytes{version.truncated && ' · showing first 2 MB'}
        {label && ` · v${label.version}`}
        {entry && ` · ${entry.path.replace(/^\/Users\/[^/]+/, '~')}`}
      </DocsDescription>
      <p className="text-xs">
        <Link href={`/p/${project}/session/${id}`} className="underline">
          ← back to session
        </Link>
      </p>
      <pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs whitespace-pre-wrap break-words">
        {version.text}
      </pre>
    </DocsPage>
  );
}
