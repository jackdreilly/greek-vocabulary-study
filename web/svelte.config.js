import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Svelte 5 auto-detects runes mode per-file based on rune usage. Pinning
// `runes: true` globally forces legacy deps (e.g. lucide-svelte's $$props
// icons) into runes mode and breaks the dep optimizer. Our own .svelte files
// all use runes so they're inferred automatically.
export default {
  preprocess: vitePreprocess(),
};
