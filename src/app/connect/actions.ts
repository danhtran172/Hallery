"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveWorkspaceName } from "@/lib/notion";

export type ConnectState = { error: string | null };

export async function connectWorkspace(_prevState: ConnectState, formData: FormData): Promise<ConnectState> {
  const token = String(formData.get("token") ?? "").trim();

  if (!token) {
    return { error: "Nhập integration token trước đã." };
  }

  const workspaceName = await resolveWorkspaceName(token);
  if (!workspaceName) {
    return { error: "Token không hợp lệ hoặc không gọi được Notion API. Kiểm tra lại token." };
  }

  const workspace = await db.workspace.create({
    data: { name: workspaceName, accessToken: token },
  });

  redirect(`/workspaces/${workspace.id}/pick`);
}
