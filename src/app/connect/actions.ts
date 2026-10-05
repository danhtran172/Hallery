"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inspectToken, looksLikeIntegrationToken } from "@/lib/notion";

export type ConnectState = { error: string | null };

const PROBLEM_MESSAGES = {
  unauthorized: "Notion không nhận token này — có thể đã copy thiếu, đã bị thu hồi, hoặc đã được tạo lại. Copy lại từ trang integration rồi dán vào.",
  not_shared: "Notion không nhận token này. Copy lại Internal Integration Secret rồi dán vào.",
  rate_limited: "Notion đang giới hạn tốc độ. Đợi vài giây rồi thử lại.",
  unavailable: "Không gọi được tới Notion — kiểm tra kết nối mạng rồi thử lại.",
} as const;

/**
 * Connects a Notion integration, or reconnects one Hallery already knows.
 *
 * An integration is recognised by its bot id, so pasting the same integration again — even
 * with a regenerated secret — refreshes the stored token instead of creating a second, empty
 * workspace beside the first (which is how three "Second Brain"s once came about).
 */
export async function connectWorkspace(_prevState: ConnectState, formData: FormData): Promise<ConnectState> {
  const token = String(formData.get("token") ?? "").trim();
  const reconnectId = String(formData.get("workspaceId") ?? "").trim() || null;

  if (!token) return { error: "Dán Internal Integration Secret vào ô trên trước đã." };

  // Notion is the judge of a token; the shape check only sharpens the message when it fails.
  const inspection = await inspectToken(token);
  if (!inspection.ok) {
    if (inspection.problem === "unauthorized" && !looksLikeIntegrationToken(token)) {
      return {
        error:
          "Đây không giống Internal Integration Secret — chuỗi đúng bắt đầu bằng “ntn_” (hoặc “secret_” với integration cũ) và không có khoảng trắng.",
      };
    }
    return { error: PROBLEM_MESSAGES[inspection.problem] };
  }

  let workspaceId: string;
  if (reconnectId) {
    const target = await db.workspace.findUnique({ where: { id: reconnectId } });
    if (!target) return { error: "Workspace cần kết nối lại không còn tồn tại trong Hallery." };
    await db.workspace.update({
      where: { id: target.id },
      data: { accessToken: token, notionBotId: inspection.botId, name: inspection.workspaceName },
    });
    workspaceId = target.id;
  } else {
    const known =
      (await db.workspace.findFirst({ where: { notionBotId: inspection.botId }, orderBy: { createdAt: "asc" } })) ??
      (await db.workspace.findFirst({ where: { accessToken: token }, orderBy: { createdAt: "asc" } })) ??
      (await findByStoredToken(inspection.botId));
    if (known) {
      await db.workspace.update({
        where: { id: known.id },
        data: { accessToken: token, notionBotId: inspection.botId, name: inspection.workspaceName },
      });
      workspaceId = known.id;
    } else {
      const created = await db.workspace.create({
        data: { name: inspection.workspaceName, accessToken: token, notionBotId: inspection.botId },
      });
      workspaceId = created.id;
    }
  }

  revalidatePath("/", "layout");
  // A reconnect started from a broken gallery goes back to that gallery — the reader came
  // to fix it, not to pick another database. Only same-app paths are honoured.
  const returnTo = String(formData.get("returnTo") ?? "");
  if (reconnectId && returnTo.startsWith("/") && !returnTo.startsWith("//")) redirect(returnTo);
  redirect(`/workspaces/${workspaceId}/pick${reconnectId ? "?reconnected=1" : ""}`);
}

/**
 * Workspaces connected before Hallery recorded bot ids are matched by asking Notion who
 * their stored token belongs to — once, since the answer is saved for next time.
 */
async function findByStoredToken(botId: string) {
  const unknown = await db.workspace.findMany({ where: { notionBotId: null }, orderBy: { createdAt: "asc" }, take: 10 });
  let match: (typeof unknown)[number] | null = null;
  for (const workspace of unknown) {
    const inspection = await inspectToken(workspace.accessToken);
    if (!inspection.ok) continue;
    await db.workspace.update({ where: { id: workspace.id }, data: { notionBotId: inspection.botId } });
    if (!match && inspection.botId === botId) match = workspace;
  }
  return match;
}

/**
 * Removes a workspace from Hallery — its galleries and every Hallery-only setting with it.
 * Nothing in Notion is touched; reconnecting later starts that workspace afresh.
 */
export async function removeWorkspace(workspaceId: string): Promise<void> {
  const galleries = await db.gallery.findMany({ where: { workspaceId }, select: { id: true } });
  const galleryIds = galleries.map((gallery) => gallery.id);
  // Spelled out rather than left to ON DELETE CASCADE, which SQLite only honours when the
  // connection has foreign keys switched on.
  await db.$transaction([
    db.propertyConfig.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.categoryAxis.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.galleryView.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.galleryNotionCache.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.coverPosition.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.gallery.updateMany({ where: { id: { in: galleryIds } }, data: { parentGalleryId: null } }),
    db.gallery.deleteMany({ where: { id: { in: galleryIds } } }),
    db.workspace.deleteMany({ where: { id: workspaceId } }),
  ]);
  revalidatePath("/", "layout");
  redirect("/");
}
