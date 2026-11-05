// Compatibility entry point. All motion defaults and metadata live in src/config.ts.
export {
	MOTION_FEATURES,
	motionSettingsConfig,
	motionSettingsConfig as motionConfig,
	type MotionFeature,
	type MotionFeatureDefinition,
	type MotionLevel,
} from "../config";

import {
	MOTION_FEATURES,
	motionSettingsConfig,
	type MotionFeature,
} from "../config";

export function getDefaultMotionSettings(): Record<MotionFeature, boolean> {
	return Object.fromEntries(
		MOTION_FEATURES.map((feature) => [
			feature,
			motionSettingsConfig.features[feature].enabled,
		]),
	) as Record<MotionFeature, boolean>;
}
