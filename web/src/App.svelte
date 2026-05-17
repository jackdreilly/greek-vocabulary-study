<script lang="ts">
  import { onDestroy } from "svelte";
  import { navigate, route } from "./lib/router.svelte";
  import { subscribeCourse } from "./lib/data/courses.svelte";
  import { subscribeLesson } from "./lib/data/lessons.svelte";
  import Home from "./routes/Home.svelte";
  import Course from "./routes/Course.svelte";
  import Lesson from "./routes/Lesson.svelte";
  import Breadcrumb from "./lib/ui/Breadcrumb.svelte";
  import type { Crumb } from "./lib/ui/Breadcrumb.svelte";

  // Route matching — recomputed reactively when route.pathname changes.
  const match = $derived.by(() => {
    const p = route.pathname;
    let m: RegExpMatchArray | null;

    if (p === "/" || p === "") return { kind: "home" as const };

    m = p.match(/^\/c\/([^/]+)$/);
    if (m) return { kind: "course" as const, courseId: m[1] };

    m = p.match(/^\/c\/([^/]+)\/l\/([^/]+)$/);
    if (m) return { kind: "lesson-redirect" as const, courseId: m[1], lessonId: m[2] };

    m = p.match(/^\/c\/([^/]+)\/l\/([^/]+)\/(overview|vocab|cards|games|plans)$/);
    if (m) return { kind: "lesson" as const, courseId: m[1], lessonId: m[2], tab: m[3] };

    return { kind: "notfound" as const };
  });

  // If we land on /c/X/l/Y with no tab segment, default to /overview.
  $effect(() => {
    if (match.kind === "lesson-redirect") {
      navigate(`/c/${match.courseId}/l/${match.lessonId}/overview`, { replace: true });
    }
  });

  // Breadcrumb labels — subscribe based on route, cleaning up when the
  // dependent IDs change. Effect cleanup avoids the "set state inside an
  // effect that reads that state" loop.
  let courseSub = $state<ReturnType<typeof subscribeCourse> | null>(null);
  let lessonSub = $state<ReturnType<typeof subscribeLesson> | null>(null);

  const courseIdForCrumb = $derived(
    match.kind === "course" || match.kind === "lesson" || match.kind === "lesson-redirect"
      ? match.courseId
      : null
  );
  const lessonIdForCrumb = $derived(
    match.kind === "lesson" || match.kind === "lesson-redirect" ? match.lessonId : null
  );

  $effect(() => {
    if (!courseIdForCrumb) {
      courseSub = null;
      return;
    }
    const next = subscribeCourse(courseIdForCrumb);
    courseSub = next;
    return () => next.stop();
  });

  $effect(() => {
    if (!courseIdForCrumb || !lessonIdForCrumb) {
      lessonSub = null;
      return;
    }
    const next = subscribeLesson(courseIdForCrumb, lessonIdForCrumb);
    lessonSub = next;
    return () => next.stop();
  });

  onDestroy(() => {
    courseSub?.stop();
    lessonSub?.stop();
  });

  const crumbs = $derived.by<Crumb[]>(() => {
    const m = match;
    const list: Crumb[] = [{ label: "Courses", href: "/" }];
    if (m.kind === "course" || m.kind === "lesson" || m.kind === "lesson-redirect") {
      list.push({
        label: courseSub?.course?.title ?? m.courseId,
        href: m.kind === "course" ? undefined : `/c/${m.courseId}`,
      });
    }
    if (m.kind === "lesson") {
      list.push({ label: lessonSub?.lesson?.title ?? m.lessonId });
    }
    return list;
  });
</script>

<div class="min-h-screen flex flex-col">
  <header
    class="sticky top-0 z-10 bg-(--color-bg)/85 backdrop-blur border-b border-(--color-border) px-4 sm:px-6 py-3"
  >
    <div class="max-w-3xl mx-auto flex items-center gap-4">
      <a
        href="/"
        onclick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          navigate("/");
        }}
        class="font-semibold tracking-tight text-(--color-text) shrink-0"
      >
        Greekflash
      </a>
      {#if crumbs.length > 1}
        <span class="text-(--color-border) hidden sm:inline">·</span>
        <div class="min-w-0 hidden sm:block">
          <Breadcrumb crumbs={crumbs.slice(1)} />
        </div>
      {/if}
      <span class="grow"></span>
      <button
        type="button"
        class="text-sm text-(--color-muted) hover:text-(--color-text)"
        title="Yiayia (coming soon)"
        disabled
      >
        Yiayia
      </button>
    </div>
  </header>

  <main class="grow">
    {#if match.kind === "home"}
      <Home />
    {:else if match.kind === "course"}
      <Course courseId={match.courseId} />
    {:else if match.kind === "lesson"}
      <Lesson courseId={match.courseId} lessonId={match.lessonId} tab={match.tab} />
    {:else if match.kind === "notfound"}
      <div class="max-w-3xl mx-auto pt-24 px-6">
        <h1 class="text-2xl font-semibold">Not found</h1>
        <p class="mt-2 text-(--color-muted)">No page at <code>{route.pathname}</code>.</p>
        <a
          href="/"
          onclick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          class="inline-block mt-4 text-(--color-accent) hover:underline">Back to home</a
        >
      </div>
    {/if}
  </main>
</div>
