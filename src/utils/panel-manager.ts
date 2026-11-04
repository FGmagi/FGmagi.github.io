/**
 * 统一的浮窗管理器
 * 确保同一时间只有一个浮窗处于打开状态，并提供统一的动画效果
 *
 * 26.11.03（动效整体修缮 · 批 3）：
 * 旧实现在这里用内联 `transition: all 100ms ease-out` + `panel.offsetHeight` 强制重排
 * 自己播动画，与 src/styles/panel-animations.css 的关闭态声明互相覆盖，观感只有 100ms
 * 且会过渡无关属性。现在：
 *   · 表现全部交给 CSS（opacity/transform/visibility，时长与曲线取 motion.css 令牌）；
 *   · 本类只负责「切类 + 等这一次过渡结束」，返回值/await 语义保持不变；
 *   · 主题切换期间（.is-theme-transitioning 会全站禁过渡）直接切类，不做等待。
 */

type PanelId =
	| "mobile-toc-panel"
	| "display-setting"
	| "nav-menu-panel"
	| "search-panel"
	| "wallpaper-mode-panel";

const CLASS_CLOSED = "float-panel-closed";
/** 与 motion.css 的 --mo-base 对齐；transitionend 正常会先到，这里只是兜底 */
const FALLBACK_MS = 300;

class PanelManager {
	private activePanels: Set<PanelId> = new Set();
	private panelStack: PanelId[] = [];

	private isThemeTransitioning(): boolean {
		return document.documentElement.classList.contains(
			"is-theme-transitioning",
		);
	}

	/** 等这次过渡结束（transitionend 优先，超时兜底），不读也不写任何几何属性 */
	private waitForTransition(panel: HTMLElement): Promise<void> {
		return new Promise((resolve) => {
			let settled = false;
			let timer = 0;
			const finish = () => {
				if (settled) return;
				settled = true;
				panel.removeEventListener("transitionend", onEnd);
				window.clearTimeout(timer);
				resolve();
			};
			const onEnd = (event: TransitionEvent) => {
				// 只认面板自身的过渡，忽略子元素冒泡上来的
				if (event.target === panel) finish();
			};
			panel.addEventListener("transitionend", onEnd);
			timer = window.setTimeout(finish, FALLBACK_MS);
		});
	}

	/** 应用动画打开浮窗 */
	private async animateIn(panel: HTMLElement): Promise<void> {
		panel.classList.remove(CLASS_CLOSED);
		if (this.isThemeTransitioning()) return;
		await this.waitForTransition(panel);
	}

	/** 应用动画关闭浮窗 */
	private async animateOut(panel: HTMLElement): Promise<void> {
		panel.classList.add(CLASS_CLOSED);
		if (this.isThemeTransitioning()) return;
		await this.waitForTransition(panel);
	}

	/**
	 * 切换指定浮窗的开关状态
	 * @param panelId 浮窗ID
	 * @param forceState 强制设置状态 (可选)
	 * @returns 浮窗最终状态 (true: 打开, false: 关闭)
	 */
	async togglePanel(
		panelId: PanelId,
		forceState?: boolean,
	): Promise<boolean> {
		const panel = document.getElementById(panelId);
		if (!panel) {
			console.warn(`Panel ${panelId} not found`);
			return false;
		}

		const isClosed = panel.classList.contains(CLASS_CLOSED);
		const shouldOpen = forceState !== undefined ? forceState : isClosed;

		if (shouldOpen) {
			await this.closeAllPanelsExcept(panelId);
			await this.animateIn(panel);
			this.activePanels.add(panelId);
			this.panelStack = this.panelStack.filter((id) => id !== panelId);
			this.panelStack.push(panelId);
			return true;
		}
		await this.closePanel(panelId);
		return false;
	}

	/**
	 * 关闭指定浮窗
	 * @param panelId 浮窗ID
	 */
	async closePanel(panelId: PanelId): Promise<void> {
		const panel = document.getElementById(panelId);
		if (panel && !panel.classList.contains(CLASS_CLOSED)) {
			await this.animateOut(panel);
			this.activePanels.delete(panelId);
			this.panelStack = this.panelStack.filter((id) => id !== panelId);
		}
	}

	/**
	 * 关闭指定浮窗外的所有浮窗
	 * @param exceptPanelId 要保持打开的浮窗ID
	 */
	async closeAllPanelsExcept(exceptPanelId?: PanelId): Promise<void> {
		const closingPromises = Array.from(this.activePanels)
			.filter((panelId) => panelId !== exceptPanelId)
			.map((panelId) => this.closePanel(panelId));

		await Promise.all(closingPromises);
	}
}

// 创建全局浮窗管理器实例
export const panelManager = new PanelManager();

// 将浮窗管理器暴露到全局，方便在其他地方使用
if (typeof window !== "undefined") {
	(window as any).panelManager = panelManager;
}

export default panelManager;
