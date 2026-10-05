/**
 * Links Hallery builds for things that live in Notion or out on the web. Kept free of
 * server imports so both the server renderer and client components can use them.
 */

/** Notion's web URL for a page or database id, dashed or not. */
export function notionPageUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

/** Where a Notion internal integration is created and its secret is copied from. */
export const NOTION_INTEGRATIONS_URL = "https://www.notion.so/profile/integrations";

/** Notion's own guide to sharing a database with an integration. */
export const NOTION_CONNECTIONS_HELP_URL =
  "https://www.notion.so/help/add-and-manage-connections-with-the-api";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "notion:"]);

/**
 * An href that actually leaves the app, or null when the value cannot be one.
 *
 * A URL property often holds "example.com" with no scheme; used as-is it resolved against
 * Hallery and opened `/galleries/…/example.com`. Script schemes are refused outright, since
 * the value is whatever someone typed into Notion.
 */
export function safeHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (SCHEME.test(value)) {
    try {
      return SAFE_SCHEMES.has(new URL(value).protocol) ? value : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("//")) return `https:${value}`;
  // Something like "example.com/path" — a dot before any slash or space marks a host.
  if (/^[^\s/]+\.[^\s/]{2,}/.test(value)) return `https://${value}`;
  return null;
}

/** A short, readable form of a URL for display: host plus a trimmed path. */
export function displayUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:" || url.protocol === "tel:") return decodeURIComponent(url.pathname);
    const host = url.host.replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return href;
  }
}

/** True when a string is, by itself, a link someone would expect to click. */
export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
