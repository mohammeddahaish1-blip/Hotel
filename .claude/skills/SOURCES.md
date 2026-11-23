# Skills copied from GitHub (unchanged)

| Skill | Source | Commit | License |
|---|---|---|---|
| supabase | github.com/supabase/agent-skills | c9be0e9 | MIT |
| supabase-postgres-best-practices | github.com/supabase/agent-skills | c9be0e9 | MIT |
| frontend-design | github.com/anthropics/skills | 2c5958e | Apache-2.0 |
| webapp-testing | github.com/anthropics/skills | 2c5958e | Apache-2.0 |
| vercel-react-best-practices | github.com/vercel-labs/agent-skills | 5a37a63 | MIT |
| vercel-composition-patterns | github.com/vercel-labs/agent-skills | 5a37a63 | MIT |
| web-design-guidelines | github.com/vercel-labs/agent-skills | 5a37a63 | MIT |
| find-skills | github.com/vercel-labs/skills | 57217cf | MIT |
| vercel-optimize | github.com/vercel-labs/agent-skills | 5a37a63 | MIT |
| accessibility | github.com/addyosmani/web-quality-skills | afa8da9 | MIT |
| seo | github.com/addyosmani/web-quality-skills | afa8da9 | MIT |
| sentry-security-review | github.com/getsentry/skills (`skills/security-review`) | a582c51 | Apache-2.0 |

`sentry-security-review` is Sentry's `security-review` with one change: its `name` line, so it does not take the place of Claude Code's built-in `/security-review` (which reviews the branch's pending changes). Its LICENSE file is kept in the folder. It is not in `skills-lock.json`; update it by copying the folder again.

`vercel-optimize` needs the Vercel CLI signed in to this project, and its route-level findings need the paid Observability Plus add-on.

To update one, copy its folder again from the same repository and update the commit here. The Vercel skills are also recorded in `skills-lock.json`; `npx skills update` refreshes them.
