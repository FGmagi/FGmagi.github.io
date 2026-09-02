<script lang="ts">
    // 26.09.02 [14]：新增全屏模式“切换壁纸”按钮——全屏 + 当前设备组可用壁纸 ≥2 + carousel.enable 时显示，
    // 点击调用 __mizukiSwitchWallpaper(true)（force 绕过间隔门控，仍写回 last_switch 重新计时）；
    // 出现时序：按钮位宽先展开（左侧“全部/目录/主题色/模式”平滑左移）→ 按钮内容再淡入；
    // 消失时序：按钮内容先淡出 → 位宽收缩（左侧按钮平滑右移填补）；首次载入直接就位不做动画
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
    import { fullscreenWallpaperConfig, siteConfig } from "../config";
    import { onDestroy, onMount } from "svelte";

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
        // 26.09.02 [14]：初始化“切换壁纸”按钮（首帧直接就位，不播放位移动画）
        initCycleButton();
    });

    // 26.09.02 [14]：清理“切换壁纸”按钮的监听器与计时器，避免热更新/swup 场景重复叠加
    onDestroy(() => {
        cycleFontsCanceled = true;
        window.clearTimeout(cycleHideTimer);
        cycleResizeObserver?.disconnect();
        if (cycleModeHandler) window.removeEventListener("wallpaper-mode-change", cycleModeHandler);
        if (cycleResizeHandler) window.removeEventListener("resize", cycleResizeHandler);
        if (cyclePageViewHandler) document.removeEventListener("swup:page:view", cyclePageViewHandler);
        if (cycleReducedMql && cycleReducedHandler && typeof cycleReducedMql.removeEventListener === "function") {
            cycleReducedMql.removeEventListener("change", cycleReducedHandler);
        }
    });

    // 26.09.02 [14]：“切换壁纸”按钮的可见性（mode=fullscreen + 当前设备组 ≥2 + carousel.enable）与位移动画状态
    type CyclePhase = "hidden" | "shown" | "leaving";
    const CYCLE_MD_QUERY = "(min-width: 768px)";
    let cycleHostEl: HTMLElement | null = $state(null);
    let cycleButtonEl: HTMLButtonElement | null = $state(null);
    let cyclePhase: CyclePhase = $state(cycleButtonVisibleOnInit() ? "shown" : "hidden");
    // 首帧后就位完成前抑制过渡，避免页面以全屏打开时按钮从 0 宽展开
    let cycleAnimReady: boolean = $state(false);
    let cycleSuppressAnim: boolean = $state(true);
    let cycleReducedMotion: boolean = $state(
        typeof window !== "undefined" &&
        !!window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    let cycleHideTimer: number | undefined;
    let cycleReducedMql: MediaQueryList | undefined;
    let cycleModeHandler: ((event: Event) => void) | undefined;
    let cycleResizeHandler: (() => void) | undefined;
    let cyclePageViewHandler: (() => void) | undefined;
    let cycleReducedHandler: (() => void) | undefined;
    let cycleFontsCanceled = false;

    interface WallpaperSwitchApi {
        __mizukiSwitchWallpaper?: (force?: boolean) => void;
    }

    // 读取 [data-fullscreen-wallpaper] 暴露的 SSR 实际组内图数（已含 desktop↔mobile 回退与 imageApi 分支）
    function getWallpaperGroupCounts(): { desktop: number; mobile: number } {
        if (typeof document === "undefined") return { desktop: 0, mobile: 0 };
        const root = document.querySelector("[data-fullscreen-wallpaper]");
        if (!root) return { desktop: 0, mobile: 0 };
        const toCount = (value: string | null): number => {
            const num = Number.parseInt(value ?? "", 10);
            return Number.isFinite(num) && num > 0 ? num : 0;
        };
        return {
            desktop: toCount(root.getAttribute("data-wp-desktop-count")),
            mobile: toCount(root.getAttribute("data-wp-mobile-count")),
        };
    }

    function cycleButtonVisibleOnInit(): boolean {
        if (typeof window === "undefined" || typeof document === "undefined") return false;
        if (getStoredWallpaperMode() !== WALLPAPER_FULLSCREEN) return false;
        if (!fullscreenWallpaperConfig.carousel?.enable) return false;
        const counts = getWallpaperGroupCounts();
        if (counts.desktop <= 0 && counts.mobile <= 0) return false;
        const isDesktop = !!window.matchMedia && window.matchMedia(CYCLE_MD_QUERY).matches;
        return (isDesktop ? counts.desktop : counts.mobile) >= 2;
    }

    function canShowCycleButton(): boolean {
        if (mode !== WALLPAPER_FULLSCREEN) return false;
        if (!fullscreenWallpaperConfig.carousel?.enable) return false;
        const counts = getWallpaperGroupCounts();
        if (counts.desktop <= 0 && counts.mobile <= 0) return false;
        const isDesktop = !!window.matchMedia && window.matchMedia(CYCLE_MD_QUERY).matches;
        return (isDesktop ? counts.desktop : counts.mobile) >= 2;
    }

    // 宽度为 0/展开中均可取内容自然宽度（inner 为 max-content）
    function measureCycleHostWidth(): number {
        if (!cycleHostEl) return 0;
        return cycleHostEl.scrollWidth || 0;
    }

    function applyCycleHostWidth(): void {
        if (!cycleHostEl) return;
        const width = measureCycleHostWidth();
        if (width > 0) {
            cycleHostEl.style.setProperty("--cycle-btn-w", `${width}px`);
        }
    }

    function showCycleButton(animate: boolean): void {
        window.clearTimeout(cycleHideTimer);
        cycleHideTimer = undefined;
        
        // 修复点4：先强制浏览器同步布局，再下一帧测量，避免拿旧值
        if (cycleHostEl) void cycleHostEl.offsetWidth;
        requestAnimationFrame(() => applyCycleHostWidth());
        
        cycleSuppressAnim = !animate || !cycleAnimReady || cycleReducedMotion;
        cyclePhase = "shown";
    }

    function hideCycleButton(animate: boolean): void {
        window.clearTimeout(cycleHideTimer);
        cycleHideTimer = undefined;
        if (!animate || !cycleAnimReady || cycleReducedMotion) {
            cycleSuppressAnim = true;
            cyclePhase = "hidden";
            return;
        }
        cycleSuppressAnim = false;
        if (cyclePhase === "hidden" || cyclePhase === "leaving") return;
        // 阶段1：内容淡出（0.14s）→ 阶段2：位宽收缩（延迟 0.16s 开始，0.22s 完成）
        cyclePhase = "leaving";
        cycleHideTimer = window.setTimeout(() => {
            cycleHideTimer = undefined;
            if (cyclePhase === "leaving") cyclePhase = "hidden";
        }, 400);
    }

    function handleCycleVisibilityChange(animate: boolean): void {
        const visible = canShowCycleButton();
        const currentlyShown = cyclePhase === "shown";
        if (visible === currentlyShown) {
            // 状态未变化：仅同步内容自然宽度（语言/字体/断点文案变化时）
            if (visible) applyCycleHostWidth();
            return;
        }
        if (visible) {
            showCycleButton(animate);
        } else {
            hideCycleButton(animate);
        }
    }

    function handleWallpaperModeChange(event: Event): void {
        const detail = (event as CustomEvent<{ mode?: WALLPAPER_MODE }>).detail;
        if (detail && detail.mode) mode = detail.mode;
        handleCycleVisibilityChange(true);
    }

    function handleCycleResize(): void {
        handleCycleVisibilityChange(true);
    }

    function handleSwupPageView(): void {
        // swup 切页不做位移动画，仅同步状态与宽度
        handleCycleVisibilityChange(false);
    }

    // 2026.9.2 修复“切换壁纸”字体显示不全
    let cycleResizeObserver: ResizeObserver | undefined;
    function initCycleButton(): void {
        cycleReducedMql = window.matchMedia("(prefers-reduced-motion: reduce)");
        cycleReducedMotion = cycleReducedMql.matches;
        cycleSuppressAnim = true;
        cyclePhase = canShowCycleButton() ? "shown" : "hidden";
        if (cyclePhase === "shown") {
            requestAnimationFrame(() => {
                applyCycleHostWidth();
                // 再补一次：等字体 ready 后如果宽度有变化，ResizeObserver 会兜底
            });
        }   

        cycleModeHandler = handleWallpaperModeChange;
        cycleResizeHandler = handleCycleResize;
        cyclePageViewHandler = handleSwupPageView;
        cycleReducedHandler = () => {
            cycleReducedMotion = cycleReducedMql ? cycleReducedMql.matches : false;
            cycleSuppressAnim = cycleReducedMotion;
        };
        window.addEventListener("wallpaper-mode-change", cycleModeHandler);
        window.addEventListener("resize", cycleResizeHandler);
        document.addEventListener("swup:page:view", cyclePageViewHandler);
        if (cycleReducedMql && typeof cycleReducedMql.addEventListener === "function") {
            cycleReducedMql.addEventListener("change", cycleReducedHandler);
        }

        // 字体就绪后修正内容自然宽度，避免本地字体加载前后按钮宽度漂移
        if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
            document.fonts.ready
                .then(() => {
                    if (!cycleFontsCanceled) applyCycleHostWidth();
                })
                .catch(() => { /* 忽略 */ });
        }
        if (typeof ResizeObserver !== "undefined" && cycleHostEl) {
            const inner = cycleHostEl.querySelector(".wallpaper-cycle-inner") as HTMLElement | null;
            if (inner) {
                cycleResizeObserver = new ResizeObserver((entries) => {
                    if (cyclePhase !== "shown") return;
                    for (const entry of entries) {
                        const w = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
                        if (w > 0 && cycleHostEl) {
                            cycleHostEl.style.setProperty("--cycle-btn-w", `${w}px`);
                        }
                    }
                });
                cycleResizeObserver.observe(inner);
            }
        }
        // 首帧布局完成后开放位移动画（仅模式切换引起出现/消失时播放）
        requestAnimationFrame(() => {
            cycleAnimReady = true;
            cycleSuppressAnim = cycleReducedMotion;
        });
    }

    // 26.09.02 [14]：点击“切换壁纸”——force=true 立即换图（不受 interval 最小间隔限制，仍重新计时）
    function cycleWallpaperNow(): void {
        const api = (window as unknown as WallpaperSwitchApi).__mizukiSwitchWallpaper;
        if (typeof api === "function") api(true);
    }

    let currentIcon = $derived(wallpaperOptions.find(opt => opt.mode === mode)?.icon || wallpaperOptions[0].icon);
    let wallpaperLabel = $derived(wallpaperOptions.find(opt => opt.mode === mode)?.label ?? I18nKey.wallpaperFullscreen);
    const wallpaperSequence = [WALLPAPER_FULLSCREEN, WALLPAPER_NONE];

    function switchWallpaperMode(newMode: WALLPAPER_MODE) {
        mode = newMode;
        setWallpaperMode(newMode);
    }

    // 26.09.02修改，内容为：模式切换后自动收回"模式"下拉框（覆盖 全屏/隐藏壁纸、常规/简洁、白天/黑夜 三组开关）
    async function closeWallpaperPanel() {
        try {
            await panelManager.closePanel("wallpaper-mode-panel");
        } catch (error) {
            // panelManager 不可用时兜底：直接加回关闭类
            const panel = document.getElementById("wallpaper-mode-panel");
            if (panel) panel.classList.add("float-panel-closed");
        }
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

    // 26.08.30修改，内容为：新增壁纸模式循环切换函数（全屏/隐藏），替换原多选项面板；26.09.02修改，内容为：切换后自动收回下拉框
    async function cycleWallpaper() {
        const idx = wallpaperSequence.indexOf(mode);
        switchWallpaperMode(wallpaperSequence[(idx + 1) % wallpaperSequence.length]);
        await closeWallpaperPanel();
    }

    // 26.08.30修改，内容为：新增布局循环切换函数（列表/网格互切）
    function cycleLayout() {
        switchLayout(layout === "list" ? "grid" : "list");
    }

    // 26.08.30修改，内容为：新增白天/夜晚主题循环切换函数（亮色/暗色互切）；26.09.02修改，内容为：切换后自动收回下拉框
    async function toggleTheme() {
        switchTheme(theme === LIGHT_MODE ? DARK_MODE : LIGHT_MODE);
        await closeWallpaperPanel();
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

    // 26.09.02修改，内容为：简洁/常规切换后自动收回下拉框（不等待 250ms 布局过渡完成，立即收回）
    async function toggleSimpleMode() {
        if (simpleModeSwitching) return;
        simpleModeSwitching = true;
        void closeWallpaperPanel();
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

    /* 26.09.02 [14]：切换壁纸按钮位移动画——位宽展开/收缩 220ms（使左侧“全部/目录/主题色/模式”平滑左移/右移），
       内容淡入延迟 120ms（展开接近完成时出现）、淡出 140ms 先行（再收缩位宽） */
    .wallpaper-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .wallpaper-cycle-host {
        width: 0;
        overflow: hidden;
        pointer-events: none;
        transition: width 0.22s ease;
    }
    .wallpaper-cycle-host .wallpaper-cycle-inner {
        width: max-content;
        opacity: 0;
        transition: opacity 0.14s ease;
    }
    .wallpaper-cycle-host.cycle-shown {
        width: var(--cycle-btn-w, 0px);
        pointer-events: auto;
    }
    .wallpaper-cycle-host.cycle-shown .wallpaper-cycle-inner {
        opacity: 1;
        transition: opacity 0.16s ease 0.12s;
    }
    .wallpaper-cycle-host.cycle-leaving {
        width: 0;
        transition: width 0.22s ease 0.16s;
    }
    .wallpaper-cycle-host.cycle-leaving .wallpaper-cycle-inner {
        opacity: 0;
        transition: opacity 0.14s ease;
    }
    .wallpaper-cycle-host.no-cycle-anim,
    .wallpaper-cycle-host.no-cycle-anim .wallpaper-cycle-inner {
        transition: none !important;
    }
</style>

<div class="wallpaper-actions relative z-50">
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

    <!-- 26.09.02 [14]：“切换壁纸”按钮宿主——宽度 0↔自然宽展开/收缩，内容淡入淡出；面板锚点保持在左侧“模式”按钮内 -->
    <div
        class="wallpaper-cycle-host"
        class:cycle-shown={cyclePhase === "shown"}
        class:cycle-leaving={cyclePhase === "leaving"}
        class:no-cycle-anim={cycleSuppressAnim}
        bind:this={cycleHostEl}
        aria-hidden={cyclePhase === "hidden"}
    >
        <div class="wallpaper-cycle-inner">
            <button
                id="wallpaper-cycle-btn"
                bind:this={cycleButtonEl}
                type="button"
                aria-label={i18n(I18nKey.wallpaperCycle)}
                tabindex={cyclePhase === "shown" ? 0 : -1}
                class="btn-plain scale-animation rounded-lg h-11 px-3 active:scale-90 theme-switch-btn flex items-center gap-1.5"
                onclick={cycleWallpaperNow}
            >
                <Icon icon="material-symbols:shuffle" class="text-[1.25rem]"></Icon>
                <span class="hidden md:inline text-sm font-bold">{i18n(I18nKey.wallpaperCycle)}</span>
            </button>
        </div>
    </div>
</div>
