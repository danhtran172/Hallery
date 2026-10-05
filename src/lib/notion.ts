import { Client } from "@notionhq/client";
import { classifyNotionError, type NotionProblem } from "@/lib/notion-errors";

export function getNotionClient(accessToken: string) {
  return new Client({ auth: accessToken });
}

export type TokenInspection =
  | { ok: true; botId: string; workspaceName: string; integrationName: string | null }
  | { ok: false; problem: NotionProblem };

/**
 * Asks Notion who a token belongs to. The bot id identifies the integration across
 * reconnects (a regenerated secret keeps it), which is what stops a second paste of the
 * same integration from creating a second, empty copy of the workspace.
 */
export async function inspectToken(accessToken: string): Promise<TokenInspection> {
  try {
    const self = await getNotionClient(accessToken).users.me({});
    const bot = self.type === "bot" ? (self.bot as { workspace_name?: string | null } | undefined) : undefined;
    return {
      ok: true,
      botId: self.id,
      workspaceName: bot?.workspace_name || "Notion workspace",
      integrationName: self.name ?? null,
    };
  } catch (error) {
    return { ok: false, problem: classifyNotionError(error) };
  }
}

/** Validates a token and returns the workspace name behind it, or null if invalid. */
export async function resolveWorkspaceName(accessToken: string): Promise<string | null> {
  const inspection = await inspectToken(accessToken);
  return inspection.ok ? inspection.workspaceName : null;
}

/** Notion internal integration secrets start with `ntn_` (current) or `secret_` (older). */
export function looksLikeIntegrationToken(token: string): boolean {
  return /^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(token.trim());
}
