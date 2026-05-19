<script lang="ts">
  import { onDestroy } from "svelte";
  import { navigate, route } from "./lib/router.svelte";
  import { subscribeCourse } from "./lib/data/courses.svelte";
  import { subscribeLesson } from "./lib/data/lessons.svelte";
  import Home from "./routes/Home.svelte";
  import Course from "./routes/Course.svelte";
  import Lesson from "./routes/Lesson.svelte";
  import Plan from "./routes/Plan.svelte";
  import AdminAI from "./routes/AdminAI.svelte";
  import AdminHome from "./routes/AdminHome.svelte";
  import AdminGenerations from "./routes/AdminGenerations.svelte";
  import AdminGenerationDetail from "./routes/AdminGenerationDetail.svelte";
  import Breadcrumb from "./lib/ui/Breadcrumb.svelte";
  import YiayiaPanel from "./lib/YiayiaPanel.svelte";
  import YiayiaAdminPanel from "./lib/YiayiaAdminPanel.svelte";
  import { yiayiaFocus } from "./lib/data/yiayiaFocus.svelte";
  import type { Crumb } from "./lib/ui/Breadcrumb.svelte";
  import { BotMessageSquare, ShieldCheck, Wand2 } from "lucide-svelte";

  // Route matching — recomputed reactively when route.pathname changes.
  const match = $derived.by(() => {
    const p = route.pathname;
    let m: RegExpMatchArray | null;

    if (p === "/" || p === "") return { kind: "home" as const };
    if (p === "/admin" || p === "/admin/") return { kind: "admin-home" as const };
    if (p === "/admin/ai") return { kind: "admin-ai" as const };
    if (p === "/admin/generations") return { kind: "admin-generations" as const };

    m = p.match(/^\/admin\/generations\/([^/]+)$/);
    if (m) return { kind: "admin-generation-detail" as const, generationId: m[1] };

    m = p.match(/^\/c\/([^/]+)$/);
    if (m) return { kind: "course" as const, courseId: m[1] };

    m = p.match(/^\/c\/([^/]+)\/l\/([^/]+)$/);
    if (m) return { kind: "lesson-redirect" as const, courseId: m[1], lessonId: m[2] };

    m = p.match(/^\/c\/([^/]+)\/l\/([^/]+)\/plans\/([^/]+)$/);
    if (m)
      return {
        kind: "plan" as const,
        courseId: m[1],
        lessonId: m[2],
        planId: m[3],
      };

    m = p.match(/^\/c\/([^/]+)\/l\/([^/]+)\/(overview|vocab|cards|games|plans)$/);
    if (m) return { kind: "lesson" as const, courseId: m[1], lessonId: m[2], tab: m[3] };

    return { kind: "notfound" as const };
  });

  // Breadcrumb labels — subscribe based on route, cleaning up when the
  // dependent IDs change. Effect cleanup avoids the "set state inside an
  // effect that reads that state" loop.
  let courseSub = $state<ReturnType<typeof subscribeCourse> | null>(null);
  let lessonSub = $state<ReturnType<typeof subscribeLesson> | null>(null);

  const courseIdForCrumb = $derived(
    match.kind === "course" ||
      match.kind === "lesson" ||
      match.kind === "lesson-redirect" ||
      match.kind === "plan"
      ? match.courseId
      : null
  );
  const lessonIdForCrumb = $derived(
    match.kind === "lesson" || match.kind === "lesson-redirect" || match.kind === "plan"
      ? match.lessonId
      : null
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

  // If we land on /c/X/l/Y with no tab segment, pick the useful default
  // after the lesson snapshot arrives.
  $effect(() => {
    if (match.kind !== "lesson-redirect" || !lessonSub?.lesson) return;
    const targetTab = (lessonSub.lesson.counts?.entries ?? 0) > 0 ? "vocab" : "overview";
    navigate(`/c/${match.courseId}/l/${match.lessonId}/${targetTab}`, { replace: true });
  });

  onDestroy(() => {
    courseSub?.stop();
    lessonSub?.stop();
  });

  const crumbs = $derived.by<Crumb[]>(() => {
    const m = match;
    const list: Crumb[] = [{ label: "Courses", href: "/" }];
    if (m.kind === "admin-home") {
      return [{ label: "Admin" }];
    }
    if (m.kind === "admin-ai") {
      return [{ label: "Admin", href: "/admin" }, { label: "AI" }];
    }
    if (m.kind === "admin-generations") {
      return [{ label: "Admin", href: "/admin" }, { label: "Generations" }];
    }
    if (m.kind === "admin-generation-detail") {
      return [
        { label: "Admin", href: "/admin" },
        { label: "Generations", href: "/admin/generations" },
        { label: "Detail" },
      ];
    }
    if (
      m.kind === "course" ||
      m.kind === "lesson" ||
      m.kind === "lesson-redirect" ||
      m.kind === "plan"
    ) {
      list.push({
        label: courseSub?.course?.title ?? m.courseId,
        href: m.kind === "course" ? undefined : `/c/${m.courseId}`,
      });
    }
    if (m.kind === "lesson") {
      list.push({ label: lessonSub?.lesson?.title ?? m.lessonId });
    }
    if (m.kind === "plan") {
      list.push({
        label: lessonSub?.lesson?.title ?? m.lessonId,
        href: `/c/${m.courseId}/l/${m.lessonId}/plans`,
      });
      list.push({ label: "Plan" });
    }
    return list;
  });

  let yiayiaOpen = $state(false);
  let adminChatOpen = $state(false);
  function isTypingTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  $effect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "y" || event.key === "Y") {
        yiayiaOpen = true;
      } else if (event.key === "a" || event.key === "A") {
        adminChatOpen = true;
        yiayiaOpen = false;
      } else if (event.key === "Escape") {
        yiayiaOpen = false;
        adminChatOpen = false;
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  const yiayiaContext = $derived.by(() => {
    const m = match;
    if (m.kind === "lesson") {
      return { courseId: m.courseId, lessonId: m.lessonId, tab: m.tab };
    }
    if (m.kind === "plan") {
      return { courseId: m.courseId, lessonId: m.lessonId, planId: m.planId, tab: "plans" };
    }
    if (m.kind === "course") {
      return { courseId: m.courseId };
    }
    return {};
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
        class="inline-flex items-center gap-2 font-semibold tracking-tight text-(--color-text) shrink-0"
      >
        <img
          src="/favicon.png"
          alt=""
          class="size-7 rounded-sm"
          width="28"
          height="28"
          aria-hidden="true"
        />
        Fanari Go
      </a>
      {#if crumbs.length > 1}
        <span class="text-(--color-border) hidden sm:inline">·</span>
        <div class="min-w-0 hidden sm:block">
          <Breadcrumb crumbs={crumbs.slice(1)} />
        </div>
      {/if}
      <span class="grow"></span>
      <a
        href="/admin"
        onclick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          navigate("/admin");
        }}
        class="inline-flex items-center gap-1.5 text-sm text-(--color-muted) hover:text-(--color-text)"
      >
        <ShieldCheck size={14} aria-hidden="true" />
        Admin
      </a>
    </div>
  </header>

  <main class="grow">
    {#if match.kind === "home"}
      <Home />
    {:else if match.kind === "course"}
      <Course courseId={match.courseId} />
    {:else if match.kind === "lesson"}
      <Lesson courseId={match.courseId} lessonId={match.lessonId} tab={match.tab} />
    {:else if match.kind === "plan"}
      <Plan courseId={match.courseId} lessonId={match.lessonId} planId={match.planId} />
    {:else if match.kind === "admin-home"}
      <AdminHome />
    {:else if match.kind === "admin-ai"}
      <AdminAI />
    {:else if match.kind === "admin-generations"}
      <AdminGenerations />
    {:else if match.kind === "admin-generation-detail"}
      <AdminGenerationDetail generationId={match.generationId} />
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
  {#if !yiayiaOpen && !adminChatOpen}
    <div class="fixed bottom-4 right-4 z-40 flex flex-col gap-2 sm:bottom-6 sm:right-6">
      <button
        type="button"
        class="grid size-10 place-items-center rounded-full border border-(--color-border) bg-(--color-bg) text-amber-600 shadow-lg transition hover:border-amber-500 hover:bg-(--color-surface-muted) focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-(--color-bg)"
        title="Admin chat (A)"
        aria-label="Open admin chat"
        onclick={() => (adminChatOpen = true)}
      >
        <Wand2 size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="grid size-10 place-items-center rounded-full border border-(--color-border) bg-(--color-bg) text-(--color-accent) shadow-lg transition hover:border-(--color-accent) hover:bg-(--color-surface-muted) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-2 focus:ring-offset-(--color-bg)"
        title="Yiayia (Y)"
        aria-label="Open Yiayia"
        onclick={() => (yiayiaOpen = true)}
      >
        <BotMessageSquare size={18} aria-hidden="true" />
      </button>
    </div>
  {/if}
  <YiayiaPanel
    open={yiayiaOpen}
    courseId={yiayiaContext.courseId}
    lessonId={yiayiaContext.lessonId}
    planId={yiayiaContext.planId}
    tab={yiayiaContext.tab}
    pathname={route.pathname}
    onClose={() => (yiayiaOpen = false)}
  />
  <YiayiaAdminPanel
    open={adminChatOpen}
    context={{
      pathname: route.pathname,
      courseId: yiayiaContext.courseId,
      lessonId: yiayiaContext.lessonId,
      planId: yiayiaContext.planId,
      tab: yiayiaContext.tab,
      focus: yiayiaFocus.item,
    }}
    onClose={() => (adminChatOpen = false)}
  />
</div>
