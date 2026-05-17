# UI & Design System

## Direction

The current UI crams a lot onto each page — totals stripes, lesson lists, generate forms, chat widgets all stacked together. The rewrite goes the opposite way: each page does **one thing well**, with navigation, drawers, and routes carrying the rest. Pages stay focused; secondary actions move to drawers or sub-routes.

**Aesthetic in one line:** clean, near-monochrome, Tailwind/Bootstrap-style — white surfaces with a single blue accent, generous whitespace, one job per page.

**Principles:**

1. **One purpose per page.** If a page is for reading vocabulary, it doesn't also host a generation form, a stats panel, and a Yiayia widget at the bottom. Secondary concerns get drawers or their own route.
2. **Navigation does the heavy lifting.** Breadcrumbs, sub-routes, drawers, bottom sheets — rather than dense layouts.
3. **Content over chrome.** The Greek word, the lesson passage, the widget — those are the heroes. Navigation recedes.
4. **De-emphasize totals.** Don't decorate every page with "5 plans · 12 games · 327 entries". Surface a count only where the user is about to make a decision based on it.
5. **Show state honestly.** When something is generating, show the partial result with a quiet indicator — not a spinner over an empty page. The streaming-AI architecture exists to make this possible.
6. **One primary action per page.** No competing CTAs in the same band.
7. **Near-monochrome base, single accent.** White surfaces, slate text, one blue primary accent (Tailwind / Bootstrap idiom). Green/amber/red used semantically for status only.
8. **Type does the work.** A clean sans (Inter or system) for everything UI. Greek strings use a serif (Crimson Pro / EB Garamond) 1–2pt larger than English so accents and breathings have air. Headings are sans-serif and bold; no display serif.
9. **Touch-first spacing.** Tap targets ≥ 44px. Generous line-height for Greek (1.6+) to give diacritics room.

## Color Palette

Clean, near-monochrome base in the Tailwind/Bootstrap idiom — white surfaces, slate text, a single blue primary accent. No warm/parchment tones, no boutique theming. The aim is "Tailwind UI" / "Linear" calm, not a brand-saturated look.

```
Background:        #FFFFFF
Surface:           #FFFFFF
Surface (muted):   #F8FAFC  (slate-50 — subtle backdrop for chips, code, callouts)
Text primary:      #0F172A  (slate-900)
Text muted:        #64748B  (slate-500)
Border:            #E2E8F0  (slate-200)
Border (strong):   #CBD5E1  (slate-300)

Accent (primary):  #2563EB  (blue-600 — links, primary buttons, focus rings)
Accent (hover):    #1D4ED8  (blue-700)
Success / ready:   #16A34A  (green-600)
Generating:        #F59E0B  (amber-500)
Danger:            #DC2626  (red-600)
```

Greek text is not coloured. It's distinguished by **font** (a serif — Crimson Pro / EB Garamond) and **size** (1–2pt larger than its English counterpart in the same row), not by hue. This keeps the palette quiet and lets Greek read as native content, not as decoration.

Dark mode is a future enhancement; design tokens are arranged so a dark palette swap is a CSS variable change, not a code change. Don't ship dark mode until light mode is right.

## Layout Containers

The visual layout is built from a small number of named containers — chosen so we never end up improvising new "stack four sections on one page" patterns.

| Container | Used for | Behavior |
|-----------|----------|----------|
| **Page** | Default route view | Single column, max-width 720px, generous top padding. Used for focused reading (a plan, a course overview, a flashcard session). |
| **List page** | Browsable indexes (courses, lessons, generations) | Single column, max-width 760px, no decorations. Each item is a row. |
| **Reader** | Long-form content (plan widgets, lesson overview, reading passages) | Single column, max-width 680px, larger type, hides app chrome when scrolling (focus mode). |
| **Drawer** | Secondary actions and contextual panels | Slides from right on desktop, bottom on mobile. Holds Yiayia, "Create new" forms, generation history, settings. Closing returns user to where they were. |
| **Bottom sheet** | Mobile-only modal-ish surfaces | Replaces drawers on small screens. Swipe-to-dismiss. |
| **Modal** | Destructive confirmations only | Reserved for "revert generation" and similar. Not for forms, not for AI generation flows. |
| **Inline indicator** | Streaming status, errors | Lives in the header band of the current page, never overlays content. |

Anything that doesn't fit one of these containers requires a doc-level decision before adding.

## Global Shell

A thin top bar, no sidebar:

```
┌────────────────────────────────────────────────────────────┐
│  Greekflash    Courses › Everyday › Lesson 3       💬  ⋯  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                 (page content)                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- Left: app name → clickable home.
- Center: breadcrumb. Each crumb is a link. Last crumb is plain text (current location). Collapses to a back arrow on mobile.
- Right: Yiayia toggle (icon-only — opens the right drawer) and a menu (settings, admin links visible only in admin mode).

No sidebar. No tabs at the top level — tab navigation only exists *inside* the lesson page.

## Page Hierarchy

Every concept gets its own route. Sub-concerns get sub-routes; ephemeral actions get drawers.

```
/                                          Home — courses index
/new                                       Create-course form (drawer, but addressable)

/c/{cid}                                   Course landing — lessons list ONLY
/c/{cid}/about                             Course overview — title, subtitle, generated description, source prompt
/c/{cid}/new-lesson                        Add-a-lesson form (drawer, addressable)

/c/{cid}/l/{lid}                           Lesson landing — currently just navigation to a tab
/c/{cid}/l/{lid}/vocab                     Vocab browser
/c/{cid}/l/{lid}/cards                     Flashcards (focus mode)
/c/{cid}/l/{lid}/games                     Games — one game at a time
/c/{cid}/l/{lid}/games/{gid}               Single game view
/c/{cid}/l/{lid}/plans                     Plans index — list of plans for this lesson
/c/{cid}/l/{lid}/plans/{pid}               Single plan view (focus mode, reader container)

/admin                                     Admin home — links to sub-pages
/admin/ai                                  AI config
/admin/generations                         Generations index
/admin/generations/{gid}                   Single generation detail
/admin/components                          Design system showcase
```

Two notable changes from current:

- **The four lesson tabs become four routes**, not query params. `/c/.../l/.../plans` is a real URL you can link to. The route-as-tab pattern means each tab is independently lazy-loaded and the back button works naturally.
- **Plans get their own page per plan.** Currently plans are picked from a sidebar and rendered alongside. New: clicking a plan navigates to `/plans/{pid}` — a focus-mode reader. The plans index page (`/plans`) just lists.

## Drawer Catalog

A small fixed set:

| Drawer | Triggered by | Contents |
|--------|--------------|----------|
| **Yiayia** | Top-bar 💬 icon, keyboard `Y` | Chat panel. Holds conversation, knows the current page's context (course/lesson/plan). Always available, never page-specific UI. |
| **Create** | "Generate a course" / "Add a lesson" / "Add a plan" buttons | The relevant generation form. Submit creates a stub doc and *navigates* to it (closing the drawer). |
| **Status** | Click on an inline streaming indicator | Detail panel showing the full statusLog, model used, tokens so far, and a "Cancel" button. |
| **Generation history** (mini) | Click "Created by AI" badge on any doc | Quick lineage view for that doc — generation, model, "Revert" button. Equivalent to a focused subset of the admin generations page. |

Drawers never stack — opening one closes the others. The Yiayia drawer is an exception only insofar as it can stay open while reading; opening any other drawer auto-closes Yiayia.

## Pages — Restructured

### Home (`/`)

**One job:** browse and pick a course.

```
[breadcrumb hidden — we're at root]

                  Greek vocabulary, with help.

                  [ Search courses... ]

                  ╔═══════╗  ╔═══════╗  ╔═══════╗
                  ║Course ║  ║Course ║  ║Course ║
                  ║  A    ║  ║  B    ║  ║  C    ║
                  ╚═══════╝  ╚═══════╝  ╚═══════╝

                                              + New course
```

- Top: a single tagline and a single search field.
- Middle: course cards in a quiet grid.
- Bottom-right: a single floating "+ New course" button that opens the **Create drawer** (or navigates to `/new` on a direct link).

No course count. No featured-course carousel. No generate-form inline. No newsletter. No stats stripe.

### Create-course (`/new` or Create drawer)

A focused form: one textarea ("What do you want to learn?"), one primary button ("Generate"). Below: optional sliders for "lesson count" and "difficulty," collapsed by default. Submitting closes the drawer and navigates to the new course's landing page.

### Course landing (`/c/{cid}`)

**One job:** see lessons and pick one.

```
[breadcrumb: Courses › Everyday Greek]      [+ Add lesson]

Everyday Greek
                                                  About →

1.  Greetings & introductions               ready
2.  Ordering at a taverna                   ready
3.  At the doctor's office                  generating
4.  Asking for directions                   initializing
...
```

- Title only — no subtitle, no description, no overview paragraph. Those live on `/c/{cid}/about`, which is a small link in the header band.
- A list of lessons, rendered from `lessonSummaries` (one doc read).
- Single primary action: "Add lesson" (top-right) — opens the Create drawer.
- No counts in the page chrome. The status pill on a row is enough.

### Course about (`/c/{cid}/about`)

A small focused page (Reader container) showing the generated course description, the original source prompt, and a "Created by AI" lineage badge. Nothing else. Back button returns to the lesson list.

### Lesson landing (`/c/{cid}/l/{lid}`)

Redirect-only — chooses a default tab based on the lesson's state:

- If `entries` count > 0: redirect to `/vocab`.
- Else if still streaming: redirect to `/about` (the lesson overview lives there).

No content of its own. This route exists so we can give a stable "this lesson" URL while picking a tab on the user's behalf.

### Lesson tab strip

Each tab is a route. The strip is a quiet horizontal underline:

```
Vocabulary    Flashcards    Games    Plans
─────────                                              ← active underline
```

No badge counts. The active tab is underlined. The active tab is also the only thing rendered below — no peek of other tabs' content.

### Vocab tab (`/c/{cid}/l/{lid}/vocab`)

**One job:** browse the lesson's words.

A calm two-column list — Greek left (deep-teal serif), English right — with subtle group dividers. A small search field at the top. No filter sidebar — search and the implicit groups are enough. Clicking a word doesn't navigate; it opens a small inline disclosure with examples and senses (no drawer, no page change — this is the one place inline expansion makes sense because the word IS the content).

### Flashcards tab (`/c/{cid}/l/{lid}/cards`)

**Focus mode.** When this tab is active, the top bar fades to a thin breadcrumb-only strip (Yiayia icon stays accessible). The card is full-bleed. Keyboard-first: space to flip, ←/→ for prev/next, Esc to leave focus mode. No SRS UI in this phase — pure browsing.

### Games tab (`/c/{cid}/l/{lid}/games`)

The games tab is a **list of games** (one row per game, type + first line of prompt). Click a game → navigate to `/games/{gid}` — a single-game page. "Next game" button on that page navigates to the next game's URL. No 5×5 grid.

### Plans tab (`/c/{cid}/l/{lid}/plans`)

The plans index is a list of plan cards: title, subtitle, estimatedMinutes, status pill. Click a plan → navigate to `/plans/{pid}` — a single-plan focus-mode reader. Adding a new plan: a "+ New plan" button at the top opens the Create drawer (with custom-focus textarea).

### Single plan (`/c/{cid}/l/{lid}/plans/{pid}`)

**Focus mode.** Reader container. Plan widgets render top-to-bottom. The top bar fades to a thin breadcrumb. A small status indicator at the top if the plan is still streaming. No sidebar of other plans — to switch plans you go back to the plans index (a single click). The benefit: the reading experience is uncompromised.

### Yiayia drawer (any page)

Right-side drawer on desktop, bottom sheet on mobile. Holds the full chat. When opened, it captures the current page's context (course/lesson/plan IDs) automatically — Yiayia knows where you are. Closes via the X or Esc. The drawer overlays content; the underlying page stays interactive when the drawer is closed.

In admin mode, Yiayia gets an "Admin" toggle inside the drawer — turning it on grants access to the admin tools (revert generation, etc.). Off by default each session.

### Admin pages

`/admin` is a small home page with cards: AI Config, Generations, Components. Each navigates to its own page. The admin section never tries to show "everything admin" on one screen.

`/admin/ai` is a single form — the AI config doc rendered as fields, with a save button at the bottom. No other concerns.

`/admin/generations` is a paginated table — click a row → `/admin/generations/{gid}` for detail and revert. Filters live in a small drawer (left) — *not* inline above the table.

`/admin/components` renders every component in every variant for visual review. Internal-only.

## Streaming State

How "streaming" feels:

- The page loads with whatever is already in Firestore — even if just a title and an empty body, that's what shows.
- A small **StreamingIndicator** lives in the page header (or in the focus-mode breadcrumb): a pulsing amber dot + the latest status log message ("Composing the lesson overview…").
- As content streams in (widgets appended, entries appearing), items fade in with a 200ms opacity transition. New items append to the end of the list — never inserted in the middle, never causing layout thrash.
- When `status` flips to `ready`, the indicator fades out. No banner, no toast — the content speaks for itself.
- Clicking the indicator opens the **Status drawer** with full statusLog, model info, and a Cancel button.

How "error" feels:

- The indicator turns red, label becomes the error message.
- A "Try again" button appears next to the indicator — clicking it resets `status` to `'initializing'` and the trigger re-fires.

## Mobile

The whole design is responsive from the start. Specific mobile considerations:

- Breadcrumb collapses to a back-arrow + current page title.
- The lesson tab strip becomes a horizontally-scrollable bar — same underline aesthetic.
- All drawers become bottom sheets — full-width, swipe-to-dismiss.
- Focus mode goes truly full-screen (no breadcrumb visible until you scroll up).
- The "+ New course/lesson/plan" buttons become a FAB in the bottom-right.

## Components — canonical set

| Component | Purpose | Notes |
|-----------|---------|-------|
| `Button` | primary / ghost / danger variants | One look per variant. No third variant added without a doc decision. |
| `Link` | persistent underline only for primary nav; underline-on-hover elsewhere | |
| `Card` | content container | Flat, single border, no shadow. Shadow only on drawers/modals. |
| `StatusPill` | tiny rounded label for `initializing` / `streaming` / `ready` / `error` | Color-coded. |
| `StreamingIndicator` | pulsing dot + label | Inline in page header; never a spinner overlay. |
| `Breadcrumb` | global header element | Collapses to back-arrow on mobile. |
| `Tabs` | route-driven underlined strip | The lesson tabs; admin section nav. |
| `Field` | label + input + helper text + error | One consistent shape across every form. |
| `Drawer` | right-side panel on desktop, bottom sheet on mobile | The container for Yiayia, Create forms, Status detail, generation mini-view. |
| `Modal` | destructive confirmation only | Revert, delete. Never for forms or AI flows. |
| `Toast` | save confirmations | Auto-dismiss, never blocking. |
| `GreekText` | wrapper for Greek strings | Applies Greek font + line-height. Optional hover for pronunciation. |
| `Reader` | container for long-form content | Sets focus-mode behavior and max-width. |

## What Goes Away

Concrete deletions vs the current UI:

- Total-count stat stripes on home, course, and lesson page headers.
- "Generate" modals (replaced by drawers + immediate navigation to streaming content).
- Sidebar navigation.
- Per-tab badge counts.
- Per-card score celebrations (replaced by a quiet inline check/x).
- The 5×5 game grid (one game per route).
- The standalone "Lesson overview" tab/section (folded into `/about` for lessons).
- Inline forms on content pages (forms live in drawers or `/new` routes).
- "All your generations" sidebar (moved to `/admin/generations`).

## Implementation Notes

- Build the design system as `web/src/lib/ui/` — one file per component, plus `tokens.css` for color/spacing/type variables.
- Tailwind v4 (matches fanariotes) with a small set of custom tokens layered on top.
- `/admin/components` is the only "Storybook" we need — a single page showing every component variant. Build it as we add components; never let the page drift out of date.
- Drawer behavior: when opening a drawer via a URL (e.g. `/new` deep-link), render the page underneath as the most-recent course list (or whichever page makes sense as a backdrop), so back-button returns there. Use SvelteKit's nested routing if we adopt it, or a simple `?drawer=new` query-param backed by reactive state otherwise.
