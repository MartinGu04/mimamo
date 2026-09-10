import Image from "next/image";
import { APP_NAME } from "@/lib/config/productName";
import { BRAND_SYMBOL } from "@/lib/config/brandAssets";

/**
 * The login route's top identity mark -- the real supplied symbol artwork
 * (never redrawn/approximated) next to the plain product wordmark, both in
 * white for the fixed dark canvas. Deliberately small/compact (unlike the
 * old large plated hero lockup this replaces) -- the visual reference for
 * this redesign shows only this small top mark, with no separate large
 * logo graphic in the hero body.
 */
export function LoginHeaderLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src={BRAND_SYMBOL.src}
        alt=""
        aria-hidden="true"
        width={BRAND_SYMBOL.width}
        height={BRAND_SYMBOL.height}
        priority
        className="h-7 w-7 shrink-0 rounded-full sm:h-8 sm:w-8"
      />
      <span className="text-lg font-bold tracking-tight text-white sm:text-xl">{APP_NAME}</span>
    </div>
  );
}
