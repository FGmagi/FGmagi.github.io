<script lang="ts">
	import { navigateToPage } from "@utils/navigation-utils";
	import { url } from "@utils/url-utils";

	// 26.08.31修改，内容为：搜索栏复用友链搜索栏的高度/阴影/图标样式，去除搜索按钮，Enter 或点击搜索图标触发搜索，右侧显示“Enter”提示文字
	export let keyword = "";
	export let placeholder = "搜索标题、说明、标签、内容…";
	export let className = "";

	let value = keyword;

	function doSearch() {
		const kw = value.trim();
		if (!kw) return;
		navigateToPage(`${url("/archive/")}?q=${encodeURIComponent(kw)}`);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			doSearch();
		}
	}
	// 26.08.31修改，内容为：右键清空搜索栏内容
	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		value = "";
	}
</script>

<div class={className}>
	<div class="relative">
		<svg
			onclick={doSearch}
			class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/40 dark:text-white/40 cursor-pointer"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			></path>
		</svg>
		<input
			type="text"
			bind:value={value}
			{placeholder}
			onkeydown={handleKeydown}
			oncontextmenu={handleContextMenu}
			class="post-search-input w-full px-4 py-2 pl-10 pr-16 rounded-lg bg-[var(--btn-regular-bg)] text-[0.9625rem] text-75 border border-black/10 dark:border-white/10 focus:outline-none transition-colors duration-200 placeholder:text-black/40 dark:placeholder:text-white/40"
		/>
		<span
			class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[0.866rem] text-black/40 dark:text-white/40"
		>
			Enter
		</span>
	</div>
</div>

<style>
	/* 26.08.31修改，内容为：简洁模式主页与“全部”页搜索栏与下方内容卡片左对齐，长度固定为卡片长度 2/3 */
	:global(body.simple-mode) .home-search-bar > div,
	.archive-search-bar > div {
		max-width: 66.666%;
		margin-right: auto;
	}
</style>
