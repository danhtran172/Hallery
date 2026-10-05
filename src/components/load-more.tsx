"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Reveals the next batch of cards. It loads by itself as the reader nears the end of the
 * grid, and stays a plain button for keyboards and for browsers that never report the
 * intersection. Replacing rather than pushing the URL keeps Back meaning "leave the
 * Gallery", not "show fifty fewer cards".
 */
export function LoadMore({ href, remaining }: { href: string; remaining: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || requested.current === href) return;
        requested.current = href;
        startTransition(() => router.replace(href, { scroll: false }));
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [href, router]);

  return (
    <div ref={sentinel} className="mt-8 flex justify-center">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          requested.current = href;
          startTransition(() => router.replace(href, { scroll: false }));
        }}
        className="btn btn-secondary"
      >
        {pending ? "Đang tải…" : `Xem thêm ${remaining} item`}
      </button>
    </div>
  );
}
