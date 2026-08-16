import { Client } from "@notionhq/client";

export function getNotionClient(accessToken: string) {
  return new Client({ auth: accessToken });
}

/** Validates a token and returns the workspace name behind it, or null if invalid. */
export async function resolveWorkspaceName(accessToken: string): Promise<string | null> {
  try {
    const notion = getNotionClient(accessToken);
    const self = await notion.users.me({});
    if (self.type === "bot" && self.bot && "workspace_name" in self.bot) {
      return (self.bot as { workspace_name: string | null }).workspace_name ?? "Notion workspace";
    }
    return "Notion workspace";
  } catch {
    return null;
  }
}
