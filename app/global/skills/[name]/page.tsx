import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getSkill } from '@/lib/claude/data';
import { Markdown } from '@/components/markdown';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const skill = await getSkill(decodeURIComponent(name));
  if (!skill) notFound();

  return (
    <DocsPage>
      <DocsTitle>{skill.name}</DocsTitle>
      {skill.description && <DocsDescription className="mb-0">{skill.description}</DocsDescription>}
      <span className="w-fit rounded-full border px-2 py-0.5 text-xs text-fd-muted-foreground">{skill.source}</span>
      <DocsBody>
        <Markdown text={skill.content} />
        {skill.files.length > 0 && (
          <>
            <h2>Files</h2>
            <ul>
              {skill.files.map((f) => (
                <li key={f} className="font-mono text-sm">
                  {f}
                </li>
              ))}
            </ul>
          </>
        )}
      </DocsBody>
    </DocsPage>
  );
}
