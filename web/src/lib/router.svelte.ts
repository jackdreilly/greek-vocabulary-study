/**
 * Tiny path-based router for Svelte 5.
 *
 * Routes are defined as regex patterns matched against the current pathname.
 * The matched groups are exposed as `params`. No external dependencies.
 *
 * Usage:
 *   import { route, navigate } from "./router.svelte";
 *   ...
 *   {#if route.matches(/^\/c\/([^/]+)$/)}
 *     <Course id={route.param(1)} />
 *   {/if}
 *
 *   <a href="/" onclick={(e) => { e.preventDefault(); navigate('/'); }}>Home</a>
 */

let _pathname = $state<string>(typeof window !== "undefined" ? window.location.pathname : "/");
let _search = $state<string>(typeof window !== "undefined" ? window.location.search : "");

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    _pathname = window.location.pathname;
    _search = window.location.search;
  });
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = new URL(to, window.location.origin);
  const method = opts.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
  _pathname = url.pathname;
  _search = url.search;
  window.scrollTo(0, 0);
}

export const route = {
  get pathname() {
    return _pathname;
  },
  get search() {
    return _search;
  },
  matches(pattern: RegExp): RegExpMatchArray | null {
    return _pathname.match(pattern);
  },
  query(key: string): string | null {
    return new URLSearchParams(_search).get(key);
  },
};

/** Convenience wrapper for `<a>` clicks — preventDefault + navigate. */
export function linkClick(href: string) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
}
