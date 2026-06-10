import path from "node:path";
import { promises as fs } from "node:fs";
import { logger } from "../../infra/logger.js";
import type { ToolRequest, ToolResult } from "../mcp/types.js";

interface LocalDocMatch {
  file: string;
  score: number;
  snippet: string;
}

export class LocalContextClient {
  constructor(private readonly contextDir = path.resolve(process.cwd(), "context")) {}

  async invoke(request: ToolRequest): Promise<ToolResult> {
    if (request.toolName !== "local_context_search") {
      return { ok: false, error: `Unsupported local tool: ${request.toolName}` };
    }

    const query = String(request.args.query ?? "").trim();
    if (!query) {
      return { ok: false, error: "local_context_search requires a non-empty 'query' argument" };
    }

    const docs = await this.loadDocuments();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    logger.info({ contextDir: this.contextDir, fileCount: docs.length, files: docs.map((doc) => doc.file), query, terms }, "running local context search");

    const matches = docs
      .map((doc) => this.scoreDocument(doc.file, doc.content, terms))
      .filter((match): match is LocalDocMatch => Boolean(match))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    logger.info({ query, matchCount: matches.length }, "completed local context search");

    if (matches.length === 0) {
      const fallback = docs.slice(0, 3).map((doc, index) => {
        const snippet = doc.content.slice(0, 240).replace(/\s+/g, " ").trim();
        return [
          `Fallback ${index + 1}: ${doc.file}`,
          `Snippet: ${snippet}`
        ].join("\n");
      }).join("\n\n");

      return {
        ok: true,
        content: fallback || "No local context matched the query."
      };
    }

    const content = matches
      .map((match, index) => {
        return [
          `Result ${index + 1}: ${match.file}`,
          `Score: ${match.score}`,
          `Snippet: ${match.snippet}`
        ].join("\n");
      })
      .join("\n\n");

    return { ok: true, content };
  }

  private async loadDocuments(): Promise<Array<{ file: string; content: string }>> {
    try {
      const entries = await fs.readdir(this.contextDir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      const docs = await Promise.all(
        files.map(async (file) => ({
          file,
          content: await fs.readFile(path.join(this.contextDir, file), "utf8")
        }))
      );
      return docs;
    } catch {
      return [];
    }
  }

  private scoreDocument(file: string, content: string, terms: string[]): LocalDocMatch | null {
    const lower = content.toLowerCase();
    const fileLower = file.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (fileLower.includes(term)) score += 3;
      const occurrences = lower.split(term).length - 1;
      score += occurrences;
      if (term.length > 4) {
        const partialOccurrences = lower.split(term.slice(0, Math.max(3, Math.floor(term.length * 0.7)))).length - 1;
        score += partialOccurrences;
      }
    }

    if (score <= 0) return null;

    const firstTerm = terms.find((term) => lower.includes(term)) ?? terms[0] ?? "";
    const index = firstTerm ? lower.indexOf(firstTerm) : 0;
    const start = Math.max(0, index - 120);
    const end = Math.min(content.length, index + 240);
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();

    return { file, score, snippet };
  }
}
