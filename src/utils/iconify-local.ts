import {
	addCollection,
	setCustomIconsLoader,
} from "@iconify/svelte/dist/functions.js";
import subset from "../generated/iconify-subset.json";

type LocalIconSet = {
	prefix: string;
	info?: unknown;
	metadata?: unknown;
	icons: Record<string, unknown>;
};

let installed = false;

export function installLocalIcons(): void {
	if (installed) return;
	installed = true;
	const sets = (subset as { sets?: Record<string, LocalIconSet> }).sets ?? {};
	for (const set of Object.values(sets)) {
		if (!set?.prefix || !set.icons) continue;
		addCollection(set as never);
		setCustomIconsLoader(() => null, set.prefix);
	}
}

installLocalIcons();

