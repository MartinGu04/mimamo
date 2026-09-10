import Image from "next/image";
import { APP_NAME, APP_SLOGAN } from "@/lib/config/productName";
import { BRAND_SYMBOL } from "@/lib/config/brandAssets";

interface BrandMarkProps {
  size?: "sm" | "md";
  className?: string;
}

const SIZE_CLASSES = {
  sm: { icon: "h-9 w-9", text: "text-base", gap: "gap-2.5" },
  md: { icon: "h-[52px] w-[52px]", text: "text-2xl", gap: "gap-3" },
} as const;

/**
 * Compact product identity -- the המחלבה symbol (the exhausted cow with
 * the satellite dish/satellite, no embedded lettering) next to the
 * wordmark text, reused everywhere the brand needs a small, self-contained
 * mark (desktop Sidebar, mobile header) rather than one of the larger
 * supplied lockups (`brandAssets.ts`'s `BRAND_BANNER`/`BRAND_LOGO_BADGE`),
 * whose baked-in lettering would be unreadable at this scale.
 *
 * The icon is purely decorative here (it repeats what the adjacent text
 * already says), so it's `alt=""`/`aria-hidden` to avoid double
 * announcing the same name to screen readers.
 *
 * `size="md"` (the expanded desktop Sidebar) also shows the slogan on its
 * own smaller lavender line under the name -- `size="sm"` (the compact
 * mobile header) stays name-only; there's no room for a second line there.
 */
export function BrandMark({ size = "md", className = "" }: BrandMarkProps) {
  const sizes = SIZE_CLASSES[size];
  return (
    <span className={`flex items-center ${sizes.gap} ${className}`}>
      <Image
        src={BRAND_SYMBOL.src}
        alt=""
        aria-hidden="true"
        width={BRAND_SYMBOL.width}
        height={BRAND_SYMBOL.height}
        className={`${sizes.icon} shrink-0 rounded-full`}
      />
      <span className="flex min-w-0 flex-col">
        <span className={`font-bold tracking-tight leading-tight ${sizes.text}`}>{APP_NAME}</span>
        {size === "md" ? (
          <span className="mt-0.5 text-xs font-medium text-[#c4b5fd]">{APP_SLOGAN}</span>
        ) : null}
      </span>
    </span>
  );
}
