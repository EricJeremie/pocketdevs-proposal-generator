# PocketDevs Proposal Generator

Upload a PDF brief → Gemini drafts a fully branded PocketDevs proposal with all 10 sections →
edit inline → download as PDF. Static front end, with secret AI keys kept in Vercel env vars.

## Run locally
```bash
cd ~/proposal-generator
vercel dev
```
Open the local Vercel URL that it prints.

## Use it
1. **Configure Vercel env vars** → add `GEMINI_API_KEY` in the Vercel dashboard or with `vercel env add`.
2. **Step 1** → drop a source PDF (client brief / notes / scope).
3. **Step 2** → fill in the confirmed details (client, project, cost in ₱, dates…). Blanks render
   as `[TBD]` — the AI never invents numbers.
4. **Generate** → review the live preview, click any text to edit, then **Download PDF**
   (choose "Save as PDF" in the print dialog).

Click **Load sample data** anytime to preview the template without using the API.

## The 10 sections
Executive Summary · Solutions Outline · Objectives · Full Scope of Work · Project Timeline ·
Project Cost · Milestones and Payment Terms · Payment Options · Post Launch Support · Terms and Services

## Branding
The PocketDevs wordmark lives at `assets/logo.svg` (an SVG recreation). To use the official asset,
replace that file — keep the name `logo.svg`, or update the `src` references in `index.html`/`app.js`.

Brand red, fonts, and spacing are CSS variables at the top of `styles.css`.

## Deploy to Vercel
Source repo: **https://github.com/EricJeremie/pocketdevs-proposal-generator** (public).

It's a static site — no build step. To go live (one-time import):
1. Go to https://vercel.com/new → **PocketDevs' projects** team.
2. **Import** `pocketdevs-proposal-generator` from GitHub.
3. Framework preset: **Other**. Build command: *none*. Output directory: `.` (leave default — root).
4. **Deploy**. You'll get a `*.vercel.app` URL.

After that, every `git push` to `main` auto-deploys (same as the marketplace).

## Vercel secret setup

These are the server-side values the app now expects:

- `GEMINI_API_KEY` for both proposal generation and staff requirements drafting
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` only if you want to override the default Supabase project values used for session checks

Recommended setup:

```bash
vercel link --yes --project <project-name-or-id> --scope <team>
echo "your-gemini-key" | vercel env add GEMINI_API_KEY production preview development
vercel env pull .env.local --yes
```

Quick deployment check:

```bash
curl https://<your-project>.vercel.app/api/health
```

You should see a small JSON response with `ok: true`.

## AI requirements chat staff access

The requirements AI is protected twice: the browser only shows it to staff, and the
`generate-requirements` Vercel Function rejects every account whose protected Supabase
`app_metadata.role` is not `staff`.

To approve another PocketDevs staff account, open **Supabase → SQL Editor** and run the
following after replacing the email address. Never put a service-role key in this project.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"staff"}'::jsonb
where email = 'staff@pocketdevs.ph';
```

The staff member must sign out and back in once so their browser receives a fresh token
containing the protected role. Public sign-ups do not receive this role automatically.

The Gemini API key lives only in Vercel environment variables, so it is not embedded in the page
or committed to the repo.

## Notes
- Proposal generation and staff requirements drafting now go through `/api/generate-proposal`
  and `/api/generate-requirements` respectively.
- Both routes use `GEMINI_API_KEY` from Vercel env vars.

## MCP server

This repo now includes a local Model Context Protocol server at `mcp/server.py`.
You can run it directly with `python3 mcp/server.py`.
It exposes:

- `project_overview` for a quick map of the app and its key files
- `workspace_list`, `workspace_search`, and `workspace_read` for repository inspection
- `documents_list`, `documents_search`, `documents_get`, `save_proposal`, and `save_questionnaire` for Supabase-backed document access

Claude Code can load the project-scoped server from `.mcp.json`. Codex can load the same server
from `.codex/config.toml`.

Document tools are optional. To use them, set one of these local environment variables before
starting the MCP server:

- `SUPABASE_SERVICE_ROLE_KEY` for full local admin access
- `SUPABASE_ACCESS_TOKEN` if you want to act as a signed-in Supabase user

If neither secret is present, the repo/file tools still work.
