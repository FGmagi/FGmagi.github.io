<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import "@utils/iconify-local";
import { getDefaultHue, getHue, setHue } from "@utils/setting-utils";
import { themeColorPanelConfig } from "../../config";
import { onMount } from "svelte";
import SettingToggle from "../settings/SettingToggle.svelte";
import {
	MOTION_FEATURES,
	getDefaultMotionSettings,
	motionConfig,
	type MotionFeature,
} from "../../config/motion";
import {
	getMotionSettings,
	getOverrideReducedMotion,
	resetMotionSettings,
	setAllMotion,
	setMotionEnabled,
	setOverrideReducedMotion,
} from "../../utils/settings-v2";

let hue = 250;
let defaultHue = 250;
let isMounted = false;
let motionEnabled: Record<MotionFeature, boolean> = getDefaultMotionSettings();
let overrideReducedMotion = false;

function resetHue() {
	hue = defaultHue;
}

onMount(() => {
	isMounted = true;
	defaultHue = getDefaultHue();
	hue = getHue();
	const settings = getMotionSettings();
	motionEnabled = Object.fromEntries(
		MOTION_FEATURES.map((feature) => [
			feature,
			settings.enabled[feature] !== false,
		]),
	) as Record<MotionFeature, boolean>;
	overrideReducedMotion = getOverrideReducedMotion();
});

function toggleMotion(feature: MotionFeature, enabled: boolean) {
	motionEnabled = { ...motionEnabled, [feature]: enabled };
	setMotionEnabled(feature, enabled);
}

function resetAllMotion() {
	resetMotionSettings();
	motionEnabled = getDefaultMotionSettings();
	overrideReducedMotion = false;
}

function reduceAllMotion() {
	setAllMotion(false);
	motionEnabled = Object.fromEntries(
		MOTION_FEATURES.map((feature) => [feature, false]),
	) as Record<MotionFeature, boolean>;
	overrideReducedMotion = false;
	setOverrideReducedMotion(false);
}

function toggleReducedMotionOverride(enabled: boolean) {
	overrideReducedMotion = enabled;
	setOverrideReducedMotion(enabled);
}

$: if (isMounted && (hue || hue === 0)) {
	setHue(hue);
}
</script>

<div id="display-setting" class="float-panel float-panel-closed absolute transition-all w-[21rem] max-w-[calc(100vw-2rem)] right-4 px-4 py-4">
    <div class="flex flex-row gap-2 mb-3 items-center justify-between">
        <div class="flex gap-2 font-bold text-lg text-neutral-900 dark:text-neutral-100 transition relative ml-3
            before:w-1 before:h-4 before:rounded-md before:bg-[var(--primary)]
            before:absolute before:-left-3 before:top-[0.33rem]"
        >
            {i18n(I18nKey.themeColor)}
            {#if themeColorPanelConfig.showResetButton}
                <button aria-label="Reset to Default" class="btn-regular w-7 h-7 rounded-md  active:scale-90"
                        class:opacity-0={hue === defaultHue} class:pointer-events-none={hue === defaultHue} onclick={resetHue}>
                    <div class="text-[var(--btn-content)]">
                        <Icon icon="fa6-solid:arrow-rotate-left" class="text-[0.875rem]"></Icon>
                    </div>
                </button>
            {/if}
        </div>
        {#if themeColorPanelConfig.showHueValue}
            <div class="flex gap-1">
                <div id="hueValue" class="transition bg-[var(--btn-regular-bg)] w-10 h-7 rounded-md flex justify-center
                font-bold text-sm items-center text-[var(--btn-content)]">
                    {hue}
                </div>
            </div>
        {/if}
    </div>
    {#if themeColorPanelConfig.showHueSlider}
        <div class="w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded select-none">
            <input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue}
                   class="slider" id="colorSlider" step="5" style="width: 100%">
        </div>
    {/if}

    {#if themeColorPanelConfig.showMotionControls}
        <div class="mt-5 pt-4 border-t border-black/10 dark:border-white/10">
            <div class="flex items-center justify-between mb-2">
                <span class="font-bold text-sm">动态效果</span>
                {#if themeColorPanelConfig.showBulkMotionActions}
                    <div class="flex items-center gap-1">
                        <button
                            type="button"
                            class="btn-regular h-7 px-2 rounded-md text-xs"
                            onclick={reduceAllMotion}
                            aria-label="关闭全部装饰动效">全部关闭</button>
                        <button
                            type="button"
                            class="btn-regular h-7 px-2 rounded-md text-xs"
                            onclick={resetAllMotion}
                            aria-label="恢复默认动态效果">恢复默认</button>
                    </div>
                {/if}
            </div>
            <div class="max-h-[42vh] overflow-y-auto pr-1">
                {#each MOTION_FEATURES as feature (feature)}
                    <SettingToggle
                        label={motionConfig[feature].label}
                        checked={motionEnabled[feature]}
                        onchange={(checked) => toggleMotion(feature, checked)}
                    />
                {/each}
                {#if themeColorPanelConfig.showReducedMotionOverride}
                    <SettingToggle
                        label="偏好看动态"
                        description="覆盖系统“减少动效”设置，保留完整动效"
                        checked={overrideReducedMotion}
                        onchange={toggleReducedMotionOverride}
                    />
                {/if}
            </div>
        </div>
    {/if}
</div>


<style lang="stylus">
    #display-setting
      input[type="range"]
        -webkit-appearance none
        height 1.5rem
        background-image var(--color-selection-bar)
        transition background-image 0.15s ease-in-out

        /* Input Thumb */
        &::-webkit-slider-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-moz-range-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          border-width 0
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-ms-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

</style>
