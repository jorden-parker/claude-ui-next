import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { listPlans } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function shortSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default async function Page() {
  const plans = await listPlans();

  return (
    <DocsPage>
      <DocsTitle>Plans</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">~/.claude/plans · {plans.length} files</DocsDescription>
      <DocsBody>
        {plans.length === 0 && <p>No plans found.</p>}
        <ul>
          {plans.map((p) => (
            <li key={p.file}>
              <Link href={`/global/plans/${encodeURIComponent(p.file)}`}>{p.title}</Link>{' '}
              <span className="text-fd-muted-foreground">
                — {shortDate(p.mtime)} · {shortSize(p.size)}
              </span>
            </li>
          ))}
        </ul>
      </DocsBody>
    </DocsPage>
  );
}
