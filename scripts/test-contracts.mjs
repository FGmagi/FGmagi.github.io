import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
	"docs/behavior-contract.md",
	"docs/refactor-regression-matrix.md",
	"src/config/motion.ts",
	"src/utils/card-effects.ts",
	"src/utils/settings-v2.ts",
];
for (const file of required) {
	if (!fs.existsSync(path.join(root, file))) throw new Error(`missing contract file: ${file}`);
}

const removeView = fs.readFileSync(path.join(root, "src/utils/page-transition.ts"), "utf8");
if (!removeView.includes("swup-leaving")) {
	throw new Error("page transition contract changed: swup-leaving is missing");
}

const config = JSON.parse(
	fs.readFileSync(path.join(root, "src/generated/media-manifest.json"), "utf8"),
);
if (config.schema !== 1) throw new Error("invalid media manifest");

const siteConfig = fs.readFileSync(path.join(root, "src/config.ts"), "utf8");
if (!/respectSystemReducedMotion:\s*false/.test(siteConfig)) {
	throw new Error("site motion must ignore the system reduced-motion preference by default");
}
if (!/showMotionControls:\s*false/.test(siteConfig)) {
	throw new Error("theme-color motion switches must stay hidden");
}
if (!/features:\s*\{[\s\S]*?pageTransition:/.test(siteConfig)) {
	throw new Error("motion feature defaults must live in src/config.ts");
}
for (const feature of [
	"pageTransition",
	"hoverFeedback",
	"panelMotion",
	"themeTransition",
	"imageReveal",
	"wallpaperCrossfade",
	"wallpaperKenBurns",
	"bannerAutoPlay",
	"bannerWaves",
	"typewriter",
	"sakura",
]) {
	if (!new RegExp(`\\n\\s*${feature}:\\s*\\{`).test(siteConfig)) {
		throw new Error(`central motion config missing feature: ${feature}`);
	}
}
if (!/sakura:\s*\{\s*enabled:\s*false/.test(siteConfig)) {
	throw new Error("sakura must remain disabled by default");
}
const pageSize = Number(siteConfig.match(/pageSize:\s*(\d+)/)?.[1]);
if (!(pageSize >= 5 && pageSize <= 10)) {
	throw new Error(`postListLayout.pageSize out of range: ${pageSize}`);
}
if (!/enableBannerMode:\s*false/.test(siteConfig)) {
	throw new Error("banner mode must remain hidden behind enableBannerMode=false");
}
const fullscreenConfig = /fullscreenWallpaperConfig:\s*FullscreenWallpaperConfig\s*=\s*\{([\s\S]*?)\n\};/.exec(siteConfig)?.[1] ?? "";
if (!/bannerAutoPlay:\s*\{[\s\S]*?duration:\s*300000\b/.test(siteConfig)) {
	throw new Error("wallpaper autoplay duration must be 300000ms");
}
if (!fullscreenConfig.includes("motionSettingsConfig.features.bannerAutoPlay.duration / 1000")) {
	throw new Error("fullscreen wallpaper must derive its interval from motion settings");
}
if (/localFonts:\s*\["思源黑体\.ttf"\]/.test(siteConfig)) {
	throw new Error("cjkFont references a missing source font");
}
const declaredFonts = [...siteConfig.matchAll(/files:\s*\[([^\]]+)\]/g)]
	.flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
for (const file of declaredFonts) {
	if (!fs.existsSync(path.join(root, "public/assets/font", file))) {
		throw new Error(`font fallback missing: ${file}`);
	}
}

const fullscreenWallpaper = fs.readFileSync(
	path.join(root, "src/components/misc/FullscreenWallpaper.astro"),
	"utf8",
);
for (const contract of [
	'data-wp-slot="a"',
	'data-wp-slot="b"',
	"clearTimer()",
	"visibilitychange",
	"active.style.opacity = \"0\"",
	"buffer.style.opacity = \"1\"",
	"__mizukiSwitchWallpaper = (force = true)",
]) {
	if (!fullscreenWallpaper.includes(contract)) {
		throw new Error(`fullscreen wallpaper contract missing: ${contract}`);
	}
}
if (!fullscreenWallpaper.includes("buffer.src = list[next]")) {
	throw new Error("wallpaper crossfade must preload the buffered image before switching");
}
if (!fullscreenWallpaper.includes('dataset.reducedMotion !== "true"')) {
	throw new Error("wallpaper autoplay must compare reduced-motion as a string");
}

const sakuraManager = fs.readFileSync(path.join(root, "src/utils/sakura-manager.ts"), "utf8");
if (!sakuraManager.includes("if (newConfig.enable)")) {
	throw new Error("sakura must start when updateConfig enables an idle manager");
}
if (!sakuraManager.includes("image.complete && image.naturalWidth > 0")) {
	throw new Error("sakura image loading must handle an already-cached image");
}

const motionCss = fs.readFileSync(path.join(root, "src/styles/motion.css"), "utf8");
if (!motionCss.includes("@keyframes Effect1_show") || !motionCss.includes("@keyframes Effect1_hide")) {
	throw new Error("shared Effect1 card animations are missing");
}
if (!motionCss.includes(".effect2-moving") || !motionCss.includes("--effect2-duration-move")) {
	throw new Error("Effect2 move phase is missing");
}
if (!/export const Effect1 = \{[\s\S]*?FullAlpha:[\s\S]*?SimAlpha:[\s\S]*?ContentAlpha:[\s\S]*?duration_hide:/.test(siteConfig)) {
	throw new Error("Effect1 parameters must live in src/config.ts");
}
if (!/export const Effect2 = \{[\s\S]*?duration_hide:[\s\S]*?duration_move:[\s\S]*?duration_show:/.test(siteConfig)) {
	throw new Error("Effect2 parameters must live in src/config.ts");
}

const pageTransition = fs.readFileSync(path.join(root, "src/utils/page-transition.ts"), "utf8");
for (const contract of [
	"hideCardsForNavigation",
	"startProgress",
	"finishProgress",
	'"content:replace"',
	'"page:view"',
]) {
	if (!pageTransition.includes(contract)) {
		throw new Error(`page transition contract missing: ${contract}`);
	}
}

const layoutCss = fs.readFileSync(path.join(root, "src/styles/layout-responsive.css"), "utf8");
if (!layoutCss.includes("@media (min-width: 1920px)") || !layoutCss.includes("clamp(104rem, 82vw, 132rem)")) {
	throw new Error("wide layout rail is not aligned with the reference breakpoint");
}

const cardEffects = fs.readFileSync(
	path.join(root, "src/utils/card-effects.ts"),
	"utf8",
);
const motionSettings = fs.readFileSync(path.join(root, "src/utils/settings-v2.ts"), "utf8");
if (!motionSettings.includes("motion${suffix}Setting")) {
	throw new Error("motion settings must expose the persisted preference separately");
}
if (!cardEffects.includes("duration_hide") || !cardEffects.includes("duration_move") || !cardEffects.includes("duration_show")) {
	throw new Error("card filter must run all three Effect2 phases");
}
const displaySettings = fs.readFileSync(
	path.join(root, "src/components/widget/DisplaySettings.svelte"),
	"utf8",
);
if (!displaySettings.includes("{#if themeColorPanelConfig.showMotionControls}")) {
	throw new Error("theme-color motion controls must be gated by config");
}
if (!displaySettings.includes('id="colorSlider"')) {
	throw new Error("theme-color hue slider is missing");
}
if (/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(motionCss + fs.readFileSync(path.join(root, "src/styles/transition.css"), "utf8"))) {
	throw new Error("site motion defaults must opt in before reduced-motion CSS applies");
}
console.log("[test] behavior contracts and media manifest valid");
