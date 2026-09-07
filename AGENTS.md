<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design system: Geist only

This app uses Vercel's Geist design system, and nothing else. `DESIGN.md` at the
repo root is the authority; read it before changing any UI.

- Tokens live in `app/geist.css`. Colour, type, spacing, and radius values are
  copied from the vendored foundation at `assets/vercel-brand.css`. The Fumadocs
  `--color-fd-*` variables are re-pointed at Geist tokens, so styling with
  `fd-*` classes stays on-system.
- Fonts are Geist Sans and Geist Mono, loaded in `app/layout.tsx`. Geist Mono is
  only for paths, ids, timestamps, and code — never whole sentences or tables.
- Design in monochrome. Colour appears only where it carries state meaning, and
  always with a non-colour cue alongside it.
- Prefer spacing, alignment, and a rule over a border or a box. Do not wrap
  every item in a card.
- Do not add another design system, component kit, icon set, CSS framework,
  colour palette, or font family. Do not invent new `--vbg-*` or
  `--color-geist-*` token names.
