"use client";

import { useState } from "react";
import { CreateDatabaseDialog } from "@/components/create-database-dialog";
import { Icon } from "@/components/icons";

/** Opens the create-a-database dialog for a workspace, outside any gallery. */
export function CreateDatabaseButton({ workspaceId, className = "btn btn-secondary btn-sm" }: { workspaceId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <Icon name="database" />
        Tạo database mới
      </button>
      {open && <CreateDatabaseDialog workspaceId={workspaceId} onClose={() => setOpen(false)} />}
    </>
  );
}
