import type { PageObjectResponse } from "@notionhq/client";

/**
 * Formula and rollup properties are containers — what matters for display is what they
 * evaluate to. Notion's schema never says: `FormulaDatabasePropertyConfigResponse` carries
 * only `{ expression }`, and the output type appears solely on a page's property *value*.
 * So the type has to be read off a sampled page, then remembered.
 */

/** Property types whose display options are driven by a resolved type rather than their own. */
export const DERIVED_TYPES = new Set(["formula", "rollup"]);

/** The type whose display options apply to a property. */
export function configTypeOf(notionPropertyType: string, resolvedType: string | null): string {
  if (!DERIVED_TYPES.has(notionPropertyType)) return notionPropertyType;
  if (!resolvedType) return "unknown";
  // A rollup returning a list has no meaningful single-value formatting.
  if (resolvedType === "array") return "unsupported";
  // Notion calls it "string"; the rest of Hallery calls text properties "rich_text".
  if (resolvedType === "string") return "rich_text";
  if (resolvedType === "boolean") return "checkbox";
  return resolvedType;
}

/** Human label for the settings screen, e.g. "formula → number". */
export function describePropertyType(notionPropertyType: string, resolvedType: string | null): string {
  if (!DERIVED_TYPES.has(notionPropertyType)) return notionPropertyType;
  return resolvedType ? `${notionPropertyType} → ${resolvedType}` : `${notionPropertyType} → ?`;
}

/**
 * Reads the output type of every formula/rollup property on a page.
 * Returns a map keyed by Notion property id.
 */
export function detectResolvedTypes(page: PageObjectResponse): Map<string, string> {
  const detected = new Map<string, string>();

  for (const value of Object.values(page.properties)) {
    if (value.type === "formula") {
      detected.set(value.id, value.formula.type);
    } else if (value.type === "rollup") {
      detected.set(value.id, value.rollup.type);
    }
  }

  return detected;
}

/** Display-config `kind` values that make sense for each config type. */
const VALID_KINDS: Record<string, string[]> = {
  number: ["plain", "rate", "duration", "with_text"],
  url: ["link", "button"],
  date: ["full", "month_only", "year_only"],
  select: ["pill", "text"],
  status: ["pill", "text"],
  multi_select: ["pill", "text"],
  rich_text: ["plain"],
};

/**
 * True when a saved config can no longer apply — e.g. a formula that used to return a
 * number is now returning text, leaving a star-rating config stranded.
 */
export function isConfigStranded(configType: string, displayConfig: string): boolean {
  let kind: unknown;
  try {
    kind = (JSON.parse(displayConfig) as { kind?: unknown }).kind;
  } catch {
    return false;
  }
  if (typeof kind !== "string" || kind === "") return false;

  const valid = VALID_KINDS[configType];
  if (!valid) return true;
  return !valid.includes(kind);
}
