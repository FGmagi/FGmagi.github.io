import type { MotionFeature } from "./motion";

export function motionEnabledOnClient(feature: MotionFeature): boolean {
	if (typeof document === "undefined") return true;
	const key = `motion${feature.charAt(0).toUpperCase()}${feature.slice(1)}`;
	return document.documentElement.dataset[key] !== "off";
}

