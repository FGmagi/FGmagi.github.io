<script lang="ts">
    import {
        WALLPAPER_FULLSCREEN,
        WALLPAPER_NONE,
        DARK_MODE,
        LIGHT_MODE,
        DEFAULT_THEME,
    } from "@constants/constants";
    import I18nKey from "@i18n/i18nKey";
    import { i18n } from "@i18n/translation";
    import Icon from "@iconify/svelte";
    import {
        getStoredWallpaperMode,
        setWallpaperMode,
        getStoredTheme,
        setTheme,
    } from "@utils/setting-utils";
    import type { WALLPAPER_MODE, LIGHT_DARK_MODE } from "@/types/config";
    import { panelManager } from "../utils/panel-manager.js";
    import { siteConfig } from "../config";
    import { onMount } from "svelte";

    type LayoutMode = "list" | "grid";

    // 仅保留全屏与隐藏两种壁纸模式（横幅模式已移除）
    const wallpaperOptions: { mode: WALLPAPER_MODE; icon: string; label: I18nKey }[] = [
        { mode: WALLPAPER_FULLSCREEN, icon: "material-symbols:wallpaper", label: I18nKey.wallpaperFullscreen },
        { mode: WALLPAPER_NONE, icon: "material-symbols:hide-image-outline", label: I18nKey.wallpaperNone },
    ];

    let mode: WALLPAPER_MODE = $state(WALLPAPER_FULLSCREEN);
    let theme: LIGHT_DARK_MODE = $state(DEFAULT_THEME);
    let layout: LayoutMode = $state("list");
    // 26.08.31修改，内容为：简洁模式默认改为关闭（常规模式）
    let simpleMode: boolean = $state(false);

    // 26.08.30修改，内容为：onMount 初始化增加主题、布局模式、简洁模式的读取与旧 banner 数据迁移
    onMount(() => {
        mode = getStoredWallpaperMode();
        // 26.08.31修改，内容为：移除旧 banner 数据迁移，尊重缓存模式（默认启动为 fullscreen，有缓存用缓存）
        theme = getStoredTheme();
        const saved = sessionStorage.getItem("postListLayout") as LayoutMode | null;
        layout = saved === "list" || saved === "grid"
            ? saved
            : (siteConfig.postListLayout.defaultMode as LayoutMode) || "list";
        // 26.08.31修改，内容为：读取简洁模式，默认常规模式（仅当存储值为 true 时启用）
        const savedSimple = localStorage.getItem("simpleMode");
        simpleMode = savedSimple === "true";
    });

    let currentIcon = $derived(wallpaperOptions.find(opt => opt.mode === mode)?.icon || wallpaperOptions[0].icon);
    let wallpaperLabel = $derived(wallpaperOptions.find(opt => opt.mode === mode)?.label ?? I18nKey.wallpaperFullscreen);
    const wallpaperSequence = [WALLPAPER_FULLSCREEN, WALLPAPER_NONE];

    function switchWallpaperMode(newMode: WALLPAPER_MODE) {
        mode = newMode;
        setWallpaperMode(newMode);
    }

    // 26.08.30修改，内容为：新增主题切换函数（亮色/暗色，调用 setTheme 持久化）
    function switchTheme(newTheme: LIGHT_DARK_MODE) {
        theme = newTheme;
        setTheme(newTheme);
    }

    // 26.08.30修改，内容为：新增布局切换函数（列表/网格），持久化并广播 layoutChange 事件
    function switchLayout(newLayout: LayoutMode) {
        layout = newLayout;
        sessionStorage.setItem("postListLayout", newLayout);
        localStorage.setItem("postListLayout", newLayout);
        window.dispatchEvent(
            new CustomEvent("layoutChange", { detail: { layout: newLayout } }),
        );
    }

    // 26.08.30修改，内容为：新增壁纸模式循环切换函数（全屏/隐藏），替换原多选项面板
    function cycleWallpaper() {
        const idx = wallpaperSequence.indexOf(mode);
        switchWallpaperMode(wallpaperSequence[(idx + 1) % wallpaperSequence.length]);
    }

    // 26.08.30修改，内容为：新增布局循环切换函数（列表/网格互切）
    function cycleLayout() {
        switchLayout(layout === "list" ? "grid" : "list");
    }

    // 26.08.30修改，内容为：新增白天/夜晚主题循环切换函数（亮色/暗色互切）
    function toggleTheme() {
        switchTheme(theme === LIGHT_MODE ? DARK_MODE : LIGHT_MODE);
    }

    // 26.08.31修改，内容为：简洁模式切换先隐藏主网格，完成布局状态更新后统一淡入，显式清理过渡标记避免残留
    let simpleModeSwitching = false;
    let simpleModeSwitchTimer: number | undefined;
    let simpleModeCleanupTimer: number | undefined;

    // 26.08.31修改，内容为：无论模式状态如何更新，都移除两阶段过渡类并释放切换锁
    function finishSimpleModeTransition() {
        document.body.classList.remove("simple-mode-switching", "simple-mode-switching-in");
        simpleModeSwitching = false;
    }

    function toggleSimpleMode() {
        if (simpleModeSwitching) return;
        simpleModeSwitching = true;
        const body = document.body;
        const transitionRegion = document.getElementById("main-grid");

        window.clearTimeout(simpleModeSwitchTimer);
        window.clearTimeout(simpleModeCleanupTimer);

        if (transitionRegion) {
            transitionRegion
                .querySelectorAll(".onload-animation")
                .forEach((element) => element.classList.remove("onload-animation"));
        }

        body.classList.add("simple-mode-switching");
        simpleModeSwitchTimer = window.setTimeout(() => {
            simpleMode = !simpleMode;
            localStorage.setItem("simpleMode", String(simpleMode));
            window.dispatchEvent(
                new CustomEvent("simple-mode-change", { detail: { simple: simpleMode } }),
            );

            // 在主网格仍不可见时完成布局重排，再开始透明度过渡
            const currentRegion = document.getElementById("main-grid");
            if (currentRegion) void currentRegion.offsetWidth;
            document.body.classList.replace("simple-mode-switching", "simple-mode-switching-in");

            simpleModeCleanupTimer = window.setTimeout(finishSimpleModeTransition, 360);
        }, 250);
    }

    async function togglePanel() {
        await panelManager.closeAllPanelsExcept("wallpaper-mode-panel");
        await panelManager.togglePanel("wallpaper-mode-panel");
    }
</script>

<style>
    button[data-active="true"] {
        background-color: var(--primary) !important;
        color: white !important;
    }

    button[data-active="true"]:hover {
        background-color: var(--primary) !important;
        color: white !important;
    }

    :global(button[data-active="true"])::before {
        display: none !important;
    }

    :global(.theme-switch-btn)::before {
        transition: transform 75ms ease-out, background-color 0ms !important;
    }
</style>

<div class="relative z-50" role="menu" tabindex="-1">
    <button
        aria-label="Wallpaper Mode"
        role="menuitem"
        class="relative btn-plain scale-animation rounded-lg h-11 px-3 active:scale-90 theme-switch-btn flex items-center gap-1.5"
        id="wallpaper-mode-switch"
        onclick={togglePanel}
    >
        <Icon icon={currentIcon} class="text-[1.25rem]"></Icon>
        <span class="hidden md:inline text-sm font-bold">模式</span>
    </button>

    <div id="wallpaper-mode-panel" class="absolute transition float-panel-closed top-11 -right-2 pt-5">
        <div class="card-base float-panel p-2">
            <!-- 壁纸模式：单按钮循环切换（全屏/隐藏） -->
            <button
                class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain rounded-lg h-11 px-3 font-medium active:scale-95 theme-switch-btn mb-0.5"
                onclick={cycleWallpaper}
            >
                <Icon icon={currentIcon} class="text-[1.25rem] mr-3"></Icon>
                {i18n(wallpaperLabel)}
            </button>

            <div class="my-1 border-t border-black/10 dark:border-white/10"></div>

            <!-- 简洁模式：单按钮循环切换（简洁/常规） -->
            <button
                class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain rounded-lg h-11 px-3 font-medium active:scale-95 theme-switch-btn mb-0.5"
                onclick={toggleSimpleMode}
            >
                <Icon icon={simpleMode ? "material-symbols:view-quilt-outline" : "material-symbols:view-quilt"} class="text-[1.25rem] mr-3"></Icon>
                {simpleMode ? i18n(I18nKey.simpleMode) : i18n(I18nKey.normalMode)}
            </button>

            <div class="my-1 border-t border-black/10 dark:border-white/10"></div>

            <!-- 白天/夜晚：单击切换 -->
            <button
                class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain rounded-lg h-11 px-3 font-medium active:scale-95 theme-switch-btn"
                onclick={toggleTheme}
            >
                <Icon icon={theme === LIGHT_MODE ? "material-symbols:wb-sunny-outline-rounded" : "material-symbols:dark-mode-outline-rounded"} class="text-[1.25rem] mr-3"></Icon>
                {theme === LIGHT_MODE ? i18n(I18nKey.dayMode) : i18n(I18nKey.nightMode)}
            </button>
        </div>
    </div>
</div>
