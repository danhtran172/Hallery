"use client";

import { useActionState, useState } from "react";
import { connectWorkspace, type ConnectState } from "./actions";

const TOKEN_SHAPE = /^(ntn_|secret_)[A-Za-z0-9]{20,}$/;

export function ConnectForm({ workspaceId }: { workspaceId: string | null }) {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(connectWorkspace, { error: null });
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const trimmed = token.trim();
  const shapeOk = TOKEN_SHAPE.test(trimmed);
  const hint =
    trimmed === ""
      ? null
      : /\s/.test(token.trim())
        ? "Có khoảng trắng trong chuỗi — có thể đã copy dư."
        : shapeOk
          ? null
          : "Chuỗi đúng bắt đầu bằng “ntn_” (hoặc “secret_” với integration cũ).";

  async function paste() {
    setPasteError(null);
    try {
      const text = await navigator.clipboard.readText();
      setToken(text.trim());
    } catch {
      setPasteError("Trình duyệt không cho đọc clipboard — dán bằng Ctrl+V.");
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {workspaceId && <input type="hidden" name="workspaceId" value={workspaceId} />}
      <label htmlFor="token" className="field-label mb-0">
        Internal Integration Secret
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id="token"
            type={visible ? "text" : "password"}
            name="token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ntn_…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-describedby="token-hint"
            className={`input h-10 pr-16 font-mono ${hint ? "border-amber-400" : shapeOk ? "border-brand" : ""}`}
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            className="btn btn-ghost btn-sm absolute top-1/2 right-1 -translate-y-1/2"
          >
            {visible ? "Ẩn" : "Hiện"}
          </button>
        </div>
        <button type="button" onClick={paste} className="btn btn-secondary h-10">
          Dán
        </button>
      </div>
      <p id="token-hint" className={`text-xs ${hint ? "text-amber-700" : "text-faint"}`}>
        {pasteError ?? hint ?? "Token chỉ lưu trên máy này, dùng để Hallery gọi Notion API thay bạn."}
      </p>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending || trimmed === ""} className="btn btn-primary h-10">
        {pending ? "Đang kiểm tra với Notion…" : workspaceId ? "Kết nối lại" : "Kết nối"}
      </button>
    </form>
  );
}
