<script lang="ts">
	export let label: string;
	export let checked = false;
	export let description = "";
	export let onchange: (checked: boolean) => void;
</script>

<label class="motion-setting-row">
	<span class="min-w-0">
		<span class="block text-sm font-medium">{label}</span>
		{#if description}
			<span class="block text-[0.7rem] opacity-60">{description}</span>
		{/if}
	</span>
	<input
		type="checkbox"
		role="switch"
		aria-label={label}
		{checked}
		on:change={(event) => onchange(event.currentTarget.checked)}
	/>
</label>

<style>
	.motion-setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 2.5rem;
		padding: 0.35rem 0.45rem;
		border-radius: 0.5rem;
		cursor: pointer;
	}
	.motion-setting-row:hover {
		background: var(--btn-regular-bg);
	}
	input {
		appearance: none;
		width: 2.35rem;
		height: 1.3rem;
		flex: none;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor, transparent 82%);
		position: relative;
		cursor: pointer;
		transition: background-color 0.16s ease;
	}
	input::after {
		content: "";
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: var(--card-bg);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
		transition: transform 0.16s ease;
	}
	input:checked {
		background: var(--primary);
	}
	input:checked::after {
		transform: translateX(1.05rem);
	}
	input:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}
	:global(html[data-motion-panel-motion="off"]) input,
	:global(html[data-motion-panel-motion="off"]) input::after {
		transition: none;
	}
</style>

