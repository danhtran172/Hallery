/**
 * A gallery's tile: its Notion emoji when it has one, otherwise its initial on a soft colour
 * picked from the name — so galleries without icons are still told apart at a glance, and a
 * gallery keeps its colour everywhere it appears.
 */
const TINTS = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-purple-100 text-purple-800",
  "bg-pink-100 text-pink-800",
  "bg-orange-100 text-orange-800",
  "bg-yellow-100 text-yellow-800",
  "bg-blue-100 text-blue-800",
  "bg-red-100 text-red-800",
];

function tintOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

const SIZES = {
  sm: "size-5 rounded-md text-[11px]",
  md: "size-7 rounded-lg text-sm",
  lg: "size-11 rounded-2xl text-xl",
};

export function GalleryGlyph({
  name,
  icon,
  size = "sm",
}: {
  name: string;
  icon: string | null;
  size?: keyof typeof SIZES;
}) {
  if (icon && /^https?:\/\//.test(icon)) {
    return (
      <span
        aria-hidden
        className={`${SIZES[size]} shrink-0 bg-contain bg-center bg-no-repeat`}
        style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${SIZES[size]} flex shrink-0 items-center justify-center font-semibold ${icon ? "" : tintOf(name)}`}
    >
      {icon || name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
