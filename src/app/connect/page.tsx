"use client";

import { useActionState } from "react";
import { connectWorkspace, type ConnectState } from "./actions";

export default function ConnectPage() {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(connectWorkspace, {
    error: null,
  });

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-6 py-16">
      <p className="mb-1 text-sm font-medium uppercase tracking-wide text-emerald-700">Kết nối Notion</p>
      <h1 className="mb-3 text-2xl font-semibold text-stone-900">Dán integration token</h1>
      <p className="mb-6 text-sm text-stone-600">
        Tạo integration tại{" "}
        <a
          href="https://www.notion.so/my-integrations"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          notion.so/my-integrations
        </a>
        , copy &quot;Internal Integration Secret&quot;, rồi vào database muốn dùng trong Notion → &quot;Connections&quot; → thêm
        integration đó. Hallery chỉ đọc dữ liệu và ghi giá trị — không tạo, sửa hay xoá property nào trong Notion.
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        <input
          type="password"
          name="token"
          placeholder="secret_xxx hoặc ntn_xxx"
          required
          className="rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Đang kiểm tra…" : "Kết nối"}
        </button>
      </form>
    </div>
  );
}
