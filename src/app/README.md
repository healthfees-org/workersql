# WorkerSQL SPA

- Dev: run from repo root with Bun/NPM in this subdir if needed
- Build: `npm --prefix src/app run build` produces `src/app/dist`
- Served by gateway via Workers Static Assets (wrangler [assets])

UI kit:
- TailwindCSS with CSS variables theme compatible with shadcn-svelte tokens
- Minimal ShadUI primitives are included (Button, Textarea) under `src/lib/components/ui/*`
- You can add more components via the generator: `npm --prefix src/app run shadcn add button input textarea`
