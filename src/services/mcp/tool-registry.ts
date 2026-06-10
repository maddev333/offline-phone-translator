export class ToolRegistry {
  private readonly allowedTools = new Set<string>(["microsoft_docs_search", "microsoft_docs_fetch", "local_context_search"]);

  isAllowed(toolName: string): boolean {
    return this.allowedTools.has(toolName);
  }
}
