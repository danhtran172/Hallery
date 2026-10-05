"use client";

import { openSearch } from "@/components/command-palette";
import { Icon } from "@/components/icons";

/** Opens the Ctrl+K palette — for pages where the sidebar's search box is out of reach. */
export function SearchButton() {
  return (
    <button type="button" onClick={openSearch} className="btn btn-secondary">
      <Icon name="search" />
      Tìm kiếm
      <kbd className="kbd ml-1 hidden sm:inline-flex">Ctrl K</kbd>
    </button>
  );
}
