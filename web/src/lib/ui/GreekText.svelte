<script lang="ts">
  type Props = {
    children: import("svelte").Snippet;
    /** Optional larger size for headings / hero placement */
    size?: "default" | "lg";
    class?: string;
  };
  let { children, size = "default", class: className = "" }: Props = $props();

  const sizeClass = $derived(size === "lg" ? "text-2xl" : "text-lg");
</script>

<span class="font-serif {sizeClass} leading-snug {className}">
  {@render children()}
</span>
