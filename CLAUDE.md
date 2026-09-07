# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

**Design system: Geist only.** All UI work follows `DESIGN.md` (Vercel's
Geist/brand guidelines) and the "Design system: Geist only" section of
`AGENTS.md`. No other design system, palette, or font family. The single
component kit is shadcn/ui (Base UI primitives in `components/ui/`), whose tokens
are aliased onto Geist in `app/global.css` — read that section of `AGENTS.md`
before touching it.

## Commands

```bash
bun dev          # dev server on localhost:3000
bun run build    # production build
bun run types:check  # typegen + tsc --noEmit
```

No test framework configured. No linter configured.

## What This Is

A Fumadocs-based Next.js 16 app that serves as a viewer for `~/.claude/` data — projects, memories, session transcripts, and global CLAUDE.md. Uses `bun` as package manager.

## Architecture

Two independent content systems share the Fumadocs UI shell:

### 1. MDX docs (`/docs`)
Standard Fumadocs pipeline. Content in `content/docs/`. Source adapter in `lib/source.ts` using `fumadocs-mdx/macro`. LLM-friendly routes at `/llms.txt`, `/llms-full.txt`, `/llms.mdx/docs/...`.

### 2. Claude data viewer (`/global`, `/p/[project]`)
Reads `~/.claude/projects/` at request time (`force-dynamic`). No database.

- `lib/claude/data.ts` — all filesystem access: projects, memories (gray-matter frontmatter), session transcripts (JSONL parsing). `CLAUDE_DIR` env var overrides default `~/.claude`.
- `lib/claude/tree.ts` — builds Fumadocs sidebar trees from project/memory/session data.
- `components/transcript.tsx` — renders session JSONL as collapsible blocks (user messages, assistant text, thinking, tool-use, tool-result).
- `components/markdown.tsx` — runtime markdown via `react-markdown` + `remark-gfm` (used for memory content and assistant messages, NOT for MDX docs).

### Route structure
| Route | Purpose |
|---|---|
| `app/(home)` | Project listing, links to `/p/[slug]` and `/global` |
| `app/global/` | Global overview + `~/.claude/CLAUDE.md` viewer |
| `app/p/[project]/` | Per-project overview, memory viewer, session transcript viewer |
| `app/docs/` | Standard Fumadocs MDX documentation |

### Key conventions
- Path alias `@/*` maps to repo root.
- `proxy.ts` handles content negotiation middleware — rewrites docs requests to markdown when `Accept` header prefers it.
- `lib/shared.ts` has route constants (`docsRoute`, `docsContentRoute`, etc.) and git config.
- Tailwind v4 via `@tailwindcss/postcss`. Fumadocs CSS presets imported in `global.css`. Color tokens use `fd-*` prefix (from fumadocs-ui).
- `cn` utility re-exported from `cnfast` at `lib/cn.ts`.
- Geist tokens in `app/geist.css` drive the whole palette; `--color-fd-*` (fumadocs) and the shadcn tokens in `app/global.css` are both remapped onto them. Vendored foundation for reference: `assets/vercel-brand.css`.
- `components/settings-shell.tsx` holds the layout shared by the Settings and Tools pages: sticky toolbar, collapsible group, ledger row, description trimming.
