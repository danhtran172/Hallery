"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { ACCENTS, THEME_CHOICES, appearanceStore, type ThemeChoice } from "@/lib/appearance";
import { useDismiss } from "@/lib/use-dismiss";
import { Icon, type IconName } from "@/components/icons";

const THEME_ICON: Record<ThemeChoice, IconName> = { light: "sun", dark: "moon", system: "monitor" };

function useAppearance() {
  const theme = useSyncExternalStore(appearanceStore.subscribe, appearanceStore.theme, () => "system" as ThemeChoice);
  const accent = useSyncExternalStore(appearanceStore.subscribe, appearanceStore.accent, () => "green" as const);
  return { theme, accent };
}

/** Light/dark and the accent colour, from one small popover at the foot of the sidebar. */
export function AppearanceControl({ compact }: { compact?: boolean }) {
  const { theme, accent } = useAppearance();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Giao diện"
        className={compact ? "btn btn-ghost btn-sm btn-icon" : "btn btn-ghost btn-sm w-full justify-start"}
      >
        <Icon name={THEME_ICON[theme]} />
        {!compact && <span>Giao diện</span>}
        {!compact && (
          <span
            aria-hidden
            className="ml-auto size-3 rounded-full ring-2 ring-surface"
            style={{ background: ACCENTS.find((entry) => entry.id === accent)?.color }}
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Giao diện"
          className="popover absolute bottom-full left-0 z-40 mb-2 w-64 p-3"
        >
          <p className="mb-2 text-xs font-medium text-muted">Chế độ</p>
          <div className="segmented w-full">
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                aria-pressed={theme === choice.id}
                onClick={() => appearanceStore.setTheme(choice.id)}
                className="flex-1 justify-center"
              >
                <Icon name={THEME_ICON[choice.id]} className="size-3.5" />
                {choice.label}
              </button>
            ))}
          </div>

          <p className="mt-4 mb-2 text-xs font-medium text-muted">Màu nhấn</p>
          <div className="flex items-center gap-2">
            {ACCENTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => appearanceStore.setAccent(entry.id)}
                aria-pressed={accent === entry.id}
                aria-label={entry.label}
                title={entry.label}
                className={`flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110 ${
                  accent === entry.id ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""
                }`}
                style={{ background: entry.color }}
              >
                {accent === entry.id && <Icon name="check" className="size-4 text-white drop-shadow" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
