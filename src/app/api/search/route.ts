import type { NextRequest } from "next/server";
import { searchEverything } from "@/lib/global-search";

/**
 * Backs the Ctrl+K search. Answers from the local snapshots only, so it is cheap enough to
 * call on every pause in typing. Refuses cross-site callers: titles are Notion data.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  try {
    const results = await searchEverything(query);
    return Response.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Search failed", error);
    return Response.json({ galleries: [], items: [], error: "Search unavailable" }, { status: 503 });
  }
}
