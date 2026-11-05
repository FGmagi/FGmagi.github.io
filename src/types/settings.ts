import type { MotionFeature } from "../config/motion";

export type MotionSettings = {
	enabled: Partial<Record<MotionFeature, boolean>>;
	/** 用户主动选择覆盖系统减少动效时，保留极短反馈。 */
	overrideReducedMotion?: boolean;
};

export type PersistedSettingsV2 = {
	version: 2;
	motion: MotionSettings;
};

export type MotionSettingChange = {
	feature: MotionFeature | "all";
	enabled: boolean;
};

