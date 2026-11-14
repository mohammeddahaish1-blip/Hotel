"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/** A file download that also refreshes the page a moment later, for downloads that record something (a compliance export). */
export function DownloadLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <a href={href} className={className} onClick={() => window.setTimeout(() => router.refresh(), 2500)}>
      {children}
    </a>
  );
}
