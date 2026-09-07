import Link from 'next/link';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { listSkills, type SkillEntry } from '@/lib/claude/data';

export const dynamic = 'force-dynamic';

function groupBySource(skills: SkillEntry[]): [string, SkillEntry[]][] {
  const groups: [string, SkillEntry[]][] = [];
  for (const s of skills) {
    const last = groups.at(-1);
    if (last && last[0] === s.source) last[1].push(s);
    else groups.push([s.source, [s]]);
  }
  return groups;
}

export default async function Page() {
  const skills = await listSkills();
  const groups = groupBySource(skills);

  return (
    <DocsPage>
      <DocsTitle>Skills</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">
        ~/.claude/skills + installed plugins · {skills.length} skills
      </DocsDescription>
      <DocsBody>
        {skills.length === 0 && <p>No skills found.</p>}
        {groups.map(([source, entries]) => (
          <section key={source}>
            <h2>
              {source} ({entries.length})
            </h2>
            <ul>
              {entries.map((s) => (
                <li key={s.id}>
                  <Link href={`/global/skills/${encodeURIComponent(s.id)}`}>{s.name}</Link>
                  {s.description && <span className="text-fd-muted-foreground"> — {s.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DocsBody>
    </DocsPage>
  );
}
