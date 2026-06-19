# Proposal Generator MCP

Use the `proposal-generator` MCP server for this repo when you need app context, codebase search, or live document access.

Prefer the MCP tools in this order:

1. `project_overview` for a fast app summary.
2. `workspace_search` before `workspace_read`.
3. `documents_search` before `documents_get`.
4. `save_proposal` or `save_questionnaire` only when you are updating saved Supabase data.

Document tools need either `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ACCESS_TOKEN` in the local environment. If neither is set, the repo/file tools still work.
