import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getGlobalClaudeMd, listAllMemories } from '@/lib/claude/data';
import { projectDisplayName } from '@/lib/claude/tree';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [claudeMd, groups] = await Promise.all([getGlobalClaudeMd(), listAllMemories()]);
  const total = groups.reduce((n, g) => n + g.memories.length, 0);

  return (
    <DocsPage>
      <DocsTitle>Global</DocsTitle>
      <DocsDescription className="mb-0">
        Instructions and memories that live in ~/.claude, across all projects.
      </DocsDescription>
      <DocsBody>
        <h2>Instructions</h2>
        {claudeMd !== null ? (
          <p>
            <Link href="/global/claude-md">CLAUDE.md</Link> applies to every project.
          </p>
        ) : (
          <p className="text-fd-muted-foreground">
            No <code>~/.claude/CLAUDE.md</code> yet. Create one to give Claude instructions that apply
            everywhere.
          </p>
        )}

        <h2>
          Memories ({total} across {groups.length} projects)
        </h2>
        {groups.map((g) => (
          <section key={g.slug} className="not-prose mb-10">
            <h3 className="mb-2 text-sm">
              <Link href={`/p/${g.slug}`} className="font-mono text-fd-foreground hover:underline">
                {projectDisplayName(g.realPath, g.slug)}
              </Link>
            </h3>
            <div className="geist-ledger">
              {g.memories.map((m) => (
                <Link
                  key={m.file}
                  href={`/p/${g.slug}/memory/${encodeURIComponent(m.file)}`}
                  className="geist-row grid-cols-1"
                >
                  <span className="text-sm font-medium">{m.title}</span>
                  {m.description && (
                    <span className="max-w-[68ch] text-sm text-fd-muted-foreground">{m.description}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </DocsBody>
    </DocsPage>
  );
}
