/**
 * Stable site-level facade. `src/config.ts` remains the compatibility source
 * during the staged split, so existing imports keep their behavior.
 */
export {
	siteConfig,
	navbarLogoFallback,
	navbarIconFallback,
} from "../config";

