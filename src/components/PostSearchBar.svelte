<script lang="ts">
	import { navigateToPage } from "@utils/navigation-utils";
	import { url } from "@utils/url-utils";
	import { onMount } from "svelte";

	export let keyword = "";
	export let placeholder = "搜索标题、说明、标签、内容…";
	export let className = "";

	let value = keyword;
	let composing = false;
	let frame = 0;

	function applyLiveSearch(restoreOnly = false) {
		const normalized = value.trim().toLowerCase();
		document
			.querySelectorAll<HTMLElement>("#post-list-container [data-search-text]")
			.forEach((card) => {
				const matches =
					restoreOnly ||
					!normalized ||
					(card.dataset.searchText || "").includes(normalized);
				card.dataset.searchMatch = matches ? "true" : "false";
			});
	}

	function scheduleLiveSearch() {
		if (frame) cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			frame = 0;
			applyLiveSearch();
			window.dispatchEvent(
				new CustomEvent("fgmagi:search-input", { detail: { q: value } }),
			);
			if (location.pathname.startsWith("/archive/")) {
				const next = new URL(location.href);
				const query = value.trim();
				if (query) next.searchParams.set("q", query);
				else next.searchParams.delete("q");
				history.replaceState(history.state, "", next);
			}
		});
	}

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
	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		value = "";
		applyLiveSearch(true);
	}

	onMount(() => {
		applyLiveSearch();
		const refresh = () => applyLiveSearch();
		document.addEventListener("astro:page-load", refresh);
		document.addEventListener("swup:page:view", refresh);
		return () => {
			document.removeEventListener("astro:page-load", refresh);
			document.removeEventListener("swup:page:view", refresh);
			if (frame) cancelAnimationFrame(frame);
		};
	});
</script>

<div class={className}>
	<div class="relative">
		<svg
			onclick={doSearch}
			aria-hidden="true"
			focusable="false"
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
			aria-label={placeholder}
			onkeydown={handleKeydown}
			oncontextmenu={handleContextMenu}
			oninput={() => {
				if (!composing) scheduleLiveSearch();
			}}
			oncompositionstart={() => {
				composing = true;
			}}
			oncompositionend={() => {
				composing = false;
				scheduleLiveSearch();
			}}
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
	:global(body.simple-mode) .home-search-bar > div,
	.archive-search-bar > div {
		max-width: 66.666%;
		margin-right: auto;
	}
</style>
