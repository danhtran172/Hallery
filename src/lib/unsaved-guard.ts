"use client";

/**
 * One app-wide "there are unsaved edits" flag. The item editor raises it while its form has
 * changes; whatever is about to throw those changes away — closing the popup, stepping to the
 * next item — asks first.
 */
let unsaved = false;

export function setUnsaved(value: boolean) {
  unsaved = value;
}

/** True when it is fine to leave: nothing unsaved, or the reader agreed to drop it. */
export function confirmLeave(): boolean {
  if (!unsaved) return true;
  const leave = window.confirm("Bạn đang sửa dở item này. Bỏ các thay đổi chưa lưu?");
  if (leave) unsaved = false;
  return leave;
}
