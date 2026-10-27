import { Hotel } from "lucide-react";

/** Property photo, or a neutral placeholder when none was uploaded yet. */
export function PropertyPhoto({ url, alt, className = "" }: { url?: string; alt: string; className?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
    <img src={url} alt={alt} className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-center justify-center bg-gradient-to-br from-brand-soft to-surface-2 text-brand/60 ${className}`} aria-hidden><Hotel className="size-14" strokeWidth={1.25} /></div>
  );
}
