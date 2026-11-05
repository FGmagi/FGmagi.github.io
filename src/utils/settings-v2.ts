import {
	MOTION_FEATURES,
	motionSettingsConfig,
	type MotionFeature,
} from "../config";
import type {
	MotionSettingChange,
	MotionSettings,
	PersistedSettingsV2,
} from "../types/settings";

export const SETTINGS_V2_KEY = motionSettingsConfig.storageKey;
export const SETTINGS_V2_EVENT = "fgmagi:settings-change";

const defaults = Object.fromEntries(
	MOTION_FEATURES.map((feature) => [
		feature,
		motionSettingsConfig.features[feature].enabled,
	]),
) as Record<MotionFeature, boolean>;

function emptyState(): PersistedSettingsV2 {
	return {
		version: 2,
		motion: { enabled: {} },
	};
}

function readState(): PersistedSettingsV2 {
	if (typeof localStorage === "undefined") return emptyState();
	try {
		const raw = localStorage.getItem(SETTINGS_V2_KEY);
		if (!raw) return emptyState();
		const parsed = JSON.parse(raw) as Partial<PersistedSettingsV2>;
		if (parsed?.version !== 2 || !parsed.motion || typeof parsed.motion !== "object") {
			return emptyState();
		}
		return {
			version: 2,
			motion: {
				enabled:
					parsed.motion.enabled && typeof parsed.motion.enabled === "object"
						? parsed.motion.enabled
						: {},
				overrideReducedMotion:
					parsed.motion.overrideReducedMotion === true,
			},
		};
	} catch {
		return emptyState();
	}
}

function writeState(state: PersistedSettingsV2): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(SETTINGS_V2_KEY, JSON.stringify(state));
	} catch {
		// Storage may be unavailable in private contexts.
	}
}

function systemReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function configuredMotion(feature: MotionFeature): boolean {
	const state = readState();
	const explicit = state.motion.enabled[feature];
	return motionSettingsConfig.allowUserOverrides && typeof explicit === "boolean"
		? explicit
		: defaults[feature];
}

function respectsSystemReducedMotion(): boolean {
	if (!motionSettingsConfig.respectSystemReducedMotion) return false;
	if (!motionSettingsConfig.allowUserOverrides) return true;
	return readState().motion.overrideReducedMotion !== true;
}

export function isMotionEnabled(feature: MotionFeature): boolean {
	if (!configuredMotion(feature)) return false;
	return !(respectsSystemReducedMotion() && systemReducedMotion());
}

export function getMotionSettings(): MotionSettings {
	return {
		enabled: Object.fromEntries(
			MOTION_FEATURES.map((feature) => [
				feature,
				isMotionEnabled(feature),
			]),
		) as Partial<Record<MotionFeature, boolean>>,
		overrideReducedMotion: !respectsSystemReducedMotion(),
	};
}

export function setMotionEnabled(
	feature: MotionFeature,
	enabled: boolean,
): void {
	const state = readState();
	state.motion.enabled[feature] = enabled;
	writeState(state);
	applyMotionSettings();
	dispatchChange({ feature, enabled });
}

export function setAllMotion(enabled: boolean): void {
	const state = readState();
	for (const feature of MOTION_FEATURES) state.motion.enabled[feature] = enabled;
	writeState(state);
	applyMotionSettings();
	dispatchChange({ feature: "all", enabled });
}

export function resetMotionSettings(): void {
	writeState(emptyState());
	applyMotionSettings();
	dispatchChange({
		feature: "all",
		enabled: motionSettingsConfig.features.pageTransition.enabled,
	});
}

export function setOverrideReducedMotion(enabled: boolean): void {
	const state = readState();
	state.motion.overrideReducedMotion = enabled;
	writeState(state);
	applyMotionSettings();
	dispatchChange({ feature: "all", enabled: true });
}

export function getOverrideReducedMotion(): boolean {
	return !respectsSystemReducedMotion();
}

export function applyMotionSettings(root: HTMLElement | null = null): void {
	if (typeof document === "undefined") return;
	const target = root ?? document.documentElement;
	const settings = getMotionSettings();
	const reduced = respectsSystemReducedMotion() && systemReducedMotion();
	const profile = motionSettingsConfig.levelProfiles[motionSettingsConfig.level];
	const tokens = reduced
		? {
				fast: 90,
				base: 120,
				slow: 120,
				hero: 120,
				stagger: 0,
				staggerMax: 0,
				shift: 0,
				lift: 0,
			}
		: {
				fast: Math.round(motionSettingsConfig.tokens.fast * profile.durationScale),
				base: Math.round(motionSettingsConfig.tokens.base * profile.durationScale),
				slow: Math.round(motionSettingsConfig.tokens.slow * profile.durationScale),
				hero: Math.round(motionSettingsConfig.tokens.hero * profile.durationScale),
				stagger: Math.round(
					motionSettingsConfig.tokens.stagger * profile.durationScale,
				),
				staggerMax: Math.round(
					motionSettingsConfig.tokens.staggerMax * profile.durationScale,
				),
				shift: Math.round(
					motionSettingsConfig.tokens.shift * profile.distanceScale,
				),
				lift: Math.round(
					motionSettingsConfig.tokens.lift * profile.distanceScale,
				),
			};

	for (const feature of MOTION_FEATURES) {
		const suffix = `${feature.charAt(0).toUpperCase()}${feature.slice(1)}`;
		const preference = configuredMotion(feature);
		target.dataset[`motion${suffix}`] =
			settings.enabled[feature] ? "on" : "off";
		target.dataset[`motion${suffix}Setting`] = preference ? "on" : "off";
	}

	target.dataset.reducedMotion = reduced ? "true" : "false";
	target.dataset.motionLevel = motionSettingsConfig.level;
	target.style.setProperty("--mo-fast", `${tokens.fast}ms`);
	target.style.setProperty("--mo-base", `${tokens.base}ms`);
	target.style.setProperty("--mo-slow", `${tokens.slow}ms`);
	target.style.setProperty("--mo-hero", `${tokens.hero}ms`);
	target.style.setProperty("--mo-stagger", `${tokens.stagger}ms`);
	target.style.setProperty("--mo-stagger-max", `${tokens.staggerMax}ms`);
	target.style.setProperty("--mo-shift", `${tokens.shift}px`);
	target.style.setProperty("--mo-lift", `${tokens.lift}px`);
	target.style.setProperty(
		"--mo-page-duration",
		settings.enabled.pageTransition
			? `${Math.round(
					motionSettingsConfig.features.pageTransition.duration *
						profile.durationScale,
				)}ms`
			: "0.01ms",
	);
}

function dispatchChange(detail: MotionSettingChange): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(SETTINGS_V2_EVENT, { detail }));
}

export function initializeSettingsV2(): void {
	if (typeof window === "undefined") return;
	applyMotionSettings();
	if ((window as any).__fgmagiSettingsV2Ready) return;
	(window as any).__fgmagiSettingsV2Ready = true;
	window.addEventListener(
		"storage",
		(event) => {
			if (event.key === SETTINGS_V2_KEY) applyMotionSettings();
		},
		{ passive: true },
	);
	const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
	media?.addEventListener?.("change", () => applyMotionSettings());
}
