# Project Notes
My name is Nick.

This voice agent supports Microsoft Entra ID authentication, Azure OpenAI realtime sessions, and Microsoft Learn MCP integration.

Use `local_context_search` for repository-specific notes and internal context.
Use Microsoft Learn MCP tools for public Microsoft documentation.

Current backend features:
- realtime connect route at `/api/realtime/connect`
- Entra bearer token validation
- local tool event streaming to the frontend UI
- MCP tool orchestration for Microsoft Learn docs
