import type { Client, DataSourceObjectResponse } from "@notionhq/client";
import { CONTENT_IMAGE, PAGE_COVER, PROPERTY_PREFIX } from "@/lib/notion-cover";

/*
 * Changing one item's picture from a form: the reader picks a file, pastes an image or a
 * link, and the picture lands wherever the gallery reads it from — the page cover, a
 * Files or URL property, or the first image in the page body. One item at a time, on the
 * reader's say-so; nothing here runs in bulk.
 */

/** Notion's ceiling for a single-part upload. Anything larger needs the multi-part flow. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Form fields an image picker submits. */
export const IMAGE_FILE_FIELD = "coverImage";
export const IMAGE_URL_FIELD = "coverImageUrl";
export const IMAGE_TARGET_FIELD = "coverTarget";

export type PickedImage = { file: File } | { url: string };

/** What the form submitted, if anything: a file wins over a link. */
export function readPickedImage(formData: FormData): PickedImage | null {
  const file = formData.get(IMAGE_FILE_FIELD);
  if (file instanceof File && file.size > 0) return { file };
  const url = String(formData.get(IMAGE_URL_FIELD) ?? "").trim();
  return /^https?:\/\/\S+$/i.test(url) ? { url } : null;
}

/**
 * Notion's own file links are signed and expire within the hour; stored as an external
 * link they would break by evening. Those are fetched and uploaded as a file instead.
 */
function isNotionHosted(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "file.notion.so" || host.endsWith(".amazonaws.com") || host.endsWith("notion-static.com");
  } catch {
    return false;
  }
}

/** A picture ready to attach: an upload Notion now holds, or a link it will point at. */
export type NotionImage = { kind: "upload"; id: string; name: string } | { kind: "external"; url: string; name: string };

export class ImageError extends Error {}

export async function toNotionImage(notion: Client, picked: PickedImage): Promise<NotionImage> {
  let file: File;
  if ("url" in picked) {
    if (!isNotionHosted(picked.url)) {
      const name = decodeURIComponent(new URL(picked.url).pathname.split("/").pop() || "image").slice(0, 100);
      return { kind: "external", url: picked.url, name };
    }
    const response = await fetch(picked.url).catch(() => null);
    if (!response?.ok) throw new ImageError("Không tải được ảnh từ link này — link Notion có thể đã hết hạn.");
    const blob = await response.blob();
    file = new File([blob], "image", { type: blob.type || "image/png" });
  } else {
    file = picked.file;
  }
  if (!file.type.startsWith("image/")) throw new ImageError("File này không phải ảnh.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageError("Ảnh vượt quá 20MB — Notion không nhận trong một lần tải.");
  try {
    const name = file.name || "image";
    const upload = await notion.fileUploads.create({ mode: "single_part", filename: name, content_type: file.type });
    await notion.fileUploads.send({ file_upload_id: upload.id, file: { filename: name, data: file } });
    return { kind: "upload", id: upload.id, name };
  } catch {
    throw new ImageError("Không tải được ảnh lên Notion. Thử lại, hoặc dán link ảnh thay vì file.");
  }
}

export function coverPayload(image: NotionImage) {
  return image.kind === "upload"
    ? { type: "file_upload" as const, file_upload: { id: image.id } }
    : { type: "external" as const, external: { url: image.url } };
}

export function imageBlock(image: NotionImage) {
  return {
    type: "image" as const,
    image: image.kind === "upload" ? { file_upload: { id: image.id } } : { external: { url: image.url } },
  };
}

/**
 * The value a property takes to hold the picture. A Files property is replaced by this one
 * picture; a URL property can only point, so it takes a link and refuses an upload.
 */
export function propertyPayload(type: string, image: NotionImage): Record<string, unknown> {
  if (type === "url") {
    if (image.kind !== "external") {
      throw new ImageError("Property ảnh này là kiểu URL — chỉ nhận link ảnh, không nhận file tải lên.");
    }
    return { url: image.url };
  }
  if (type === "files") {
    return {
      files: [
        image.kind === "upload"
          ? { type: "file_upload", file_upload: { id: image.id }, name: image.name }
          : { type: "external", external: { url: image.url }, name: image.name },
      ],
    };
  }
  throw new ImageError("Property này không chứa được ảnh.");
}

/** How a target reads to a person. */
export function imageTargetLabel(target: string): string {
  if (target === PAGE_COVER) return "ảnh bìa của page";
  if (target === CONTENT_IMAGE) return "ảnh đầu tiên trong nội dung page";
  return `property “${target.slice(PROPERTY_PREFIX.length)}”`;
}

/**
 * Where an edit form's picture goes: the gallery's cover source, when it names something
 * that can hold a picture. Same shape as the picker's `ImageSlot`.
 */
export function imageSlotFor(
  target: string | undefined,
  dataSource: DataSourceObjectResponse,
): { target: string; acceptsUpload: boolean; targetLabel: string } | null {
  const source = target ?? PAGE_COVER;
  if (!isImageTarget(source, dataSource)) return null;
  const type = source.startsWith(PROPERTY_PREFIX) ? dataSource.properties[source.slice(PROPERTY_PREFIX.length)]?.type : null;
  return { target: source, acceptsUpload: type !== "url", targetLabel: imageTargetLabel(source) };
}

/** Whether a target names somewhere a picture can live in this gallery. */
export function isImageTarget(target: string, dataSource: DataSourceObjectResponse): boolean {
  if (target === PAGE_COVER || target === CONTENT_IMAGE) return true;
  if (!target.startsWith(PROPERTY_PREFIX)) return false;
  const type = dataSource.properties[target.slice(PROPERTY_PREFIX.length)]?.type;
  return type === "files" || type === "url";
}

/**
 * Replaces the first image in a page's body — the one a content-image gallery shows — or,
 * when the body has none, puts the picture at the very top.
 */
export async function replaceContentImage(notion: Client, pageId: string, image: NotionImage): Promise<void> {
  const children = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  const first = children.results.find((block) => "type" in block && block.type === "image");
  const media = image.kind === "upload" ? { file_upload: { id: image.id } } : { external: { url: image.url } };
  if (first) {
    await notion.blocks.update({ block_id: first.id, image: media });
    return;
  }
  await notion.blocks.children.append({ block_id: pageId, children: [imageBlock(image)], position: { type: "start" } });
}
