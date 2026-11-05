/**
 * Transitional aggregate for new structured imports. The legacy entry
 * (`src/config.ts`) stays in place until content scripts that parse its text
 * have been migrated.
 */
export * from "../config";
export * from "./motion";
export * from "./site";
export * from "./navigation";
export * from "./layout";
export * from "./wallpaper";
export * from "./media";
export * from "./integrations";
export * from "./data";

