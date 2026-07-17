# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GanttForge is a local-first Gantt chart / project-planning tool that ships as **one self-contained `.html` file**. No backend, no build-time framework, no external network requests at runtime — all data lives in the browser's IndexedDB. The shipped artifact is `dist/index.html`, produced by concatenating the files under `src/`.

The full functional spec and confirmed design decisions live in `~/.claude/plans/glimmering-scribbling-candy.md` (the approved implementation plan). Read it before making architectural changes — it documents *why* things are structured this way (single-file constraint, IndexedDB-only persistence, the 3 independent data domains, lock semantics, etc.), not just what to build.

## Commands

```bash
python3 build.py                      # concatenates src/ into dist/index.html
python3 -m http.server 8000           # from dist/, serves the built app
```

Serve via HTTP, not `file://` — IndexedDB behaves unreliably under the `file://` origin in some browsers. There is no npm/Node toolchain in this project (Node isn't assumed to be installed); `build.py` uses only the Python 3 standard library (`pathlib`), by design, so no dependency installation step exists.

There is no lint or test suite configured yet.

**Dev loop:** edit files under `src/`, then re-run `python3 build.py`, then refresh the browser tab pointed at `dist/index.html`. `build.py` is a dumb string-concatenation script — it has no watch mode and does no bundling/transpilation; there's nothing to configure.

## Architecture

### Build: multiple source files → one shipped file

`src/index.html` contains three placeholder comments that `build.py` replaces in order:
- `<!-- BUILD:STYLES -->` → inlines `src/styles.css` into a `<style>` block
- `<!-- BUILD:VENDOR -->` → inlines each file in `VENDOR_FILES` (in `build.py`), one `<script>` tag per vendored library (empty for now — third-party libraries like `marked`/`jsPDF`/SheetJS get vendored into `src/vendor/` and added to this list in later phases, never loaded from a CDN)
- `<!-- BUILD:APP -->` → concatenates all of `APP_FILES` (in `build.py`) into a single `<script>` block

**File load order is an explicit array in `build.py` (`APP_FILES`), not directory/glob order.** When adding a new `src/app/*.js` module, you must add it to that array in dependency order (state/db before the modules that use them; `main.js` last, since it wires everything up on `DOMContentLoaded`).

### State: one shared mutable store, tag-scoped pub/sub

`src/app/state.js` defines two global objects:
- `state` — domain data for the *currently selected* project (schedules, milestones, etc.), fully reloaded from IndexedDB on every project switch. Not partitioned/paginated — the app assumes personal-project-scale record counts.
- `uiState` — transient UI-only state (which side panel is open, lock flag, Gantt/mindmap pan-zoom-scroll, schedule-list expand/collapse, visible schedule-list columns). Kept separate from `state` specifically so re-rendering domain data never resets scroll/pan/zoom.

`Store.setState(patch, tags)` / `Store.setUiState(patch, tags)` merge the patch and then call only the render functions subscribed to the given `tags` (via `Store.subscribe(tags, fn)`, wired once in `main.js#init`). **When you add a mutation that affects the UI, you must pass the correct tags** — a call with the wrong (or empty) tag list will silently update the DB/in-memory state without the screen refreshing. This has already been the source of real bugs during development (e.g. forgetting to tag `'lockBanner'` when switching projects meant the lock banner didn't update) — when touching `uiState.locked` or adding new state, double check every write site notifies every render function that depends on it.

### Persistence: IndexedDB, one DB, adjacency-list schedule tree

`src/app/db.js` opens a single `ganttforge` database with one object store per domain (`projects`, `schedules`, `milestones`, `tasks`, `mindmapNodes`, `comments`, `notes`, `quickNotes`, `snapshots`, `historyLog`), all indexed by `projectId`. All mutations should go through `DB.put(store, record, historyMeta?)` / `DB.remove(store, id, historyMeta?)` rather than opening raw transactions elsewhere — these two helpers are also where change-history logging happens (see below), and bypassing them means a mutation silently won't be logged.

The schedule hierarchy (schedule → sub-schedule → sub-sub-schedule, max 3 levels) is modeled as an **adjacency list** (`parentId` + a sibling `order` integer), not a materialized path string. Display numbering ("1.2.3") is *never stored* — `Schedules.computeNumbering()` / `Schedules.flattenForDisplay()` (in `src/app/schedules.js`) compute it fresh from `parentId`/`order` on every render, so deleting/reordering a schedule doesn't require any renumbering of siblings elsewhere.

### Change history logging

Only three domains are history-tracked: `schedules`, `milestones`, `comments` (see `HISTORY_DOMAINS` in `db.js`). Task Management, Mind Map, Notes, and Quick Notes are intentionally excluded — this was a confirmed product decision, not an oversight. `DB.put`/`DB.remove` only write a `historyLog` entry when a `historyMeta` object is passed *and* the store is in `HISTORY_DOMAINS`; omit `historyMeta` for domains that shouldn't log.

### The three independent data domains

Schedules (Gantt), Task Management (kanban), and Mind Map are deliberately **unlinked** — no cross-references between them in the schema. Comments are the one exception: they belong to a specific `scheduleId`. Don't introduce cross-domain foreign keys between schedules/tasks/mindmap without re-confirming with the user; this separation was an explicit design decision made during planning, not an accident.

### Rendering pattern

No framework, no virtual DOM. Most panels are `container.innerHTML = templateString(...)` full replaces (`src/app/schedules.js#renderScheduleList`, `src/app/gantt.js#renderGantt` are the reference examples) — this is intentionally simple given the personal-project data scale. The one deliberate exception, if/when the Mind Map lands, is to keep an outer SVG `<g transform>` alive across re-renders so pan/zoom state isn't wiped by an innerHTML replace of the whole chart.

Click handling uses **event delegation on a persistent container**, wired once in `main.js` (`wireScheduleListEvents`, `wireGanttEvents`, etc.) — never attach a listener inside a function that runs on every render/every modal-open, since the container it's attached to won't be recreated and the listener will accumulate on repeated calls (this exact bug — a listener re-attached to `#modalHost` every time a modal opened — was caught and fixed in `src/app/milestones.js`; when adding new modals/panels, delegate onto an element that *is* recreated by the innerHTML replace, or wire the listener exactly once).

### Gantt date-scale math

`src/app/gantt.js` centralizes all date↔pixel conversion (`computeDateScale`, `dateToX`) so the planned PDF export (a later phase) can reuse the exact same layout math rather than re-deriving bar positions. Gridline granularity (day/week/month/quarter, via the header's granularity selector) only changes *which* gridlines are drawn/labeled — `pxPerDay` itself does not change with granularity.

### Modals

`src/app/ui.js#openModal(html, {onSubmit})` is the shared modal host — it fully replaces `#modalHost`'s contents on every call, which is what makes it safe to attach listeners to elements *inside* the modal body. `onSubmit` returning `false` keeps the modal open (used for inline validation errors); anything else closes it immediately, before any async DB write actually resolves.

## Implementation phases

The project is being built in the phased order documented in the plan file referenced above (foundation → hierarchy → lock/today/milestones → task management → mind map → comments/history → notes → snapshots → import/export/PDF/Excel). Check that plan file's phase list for what's implemented vs. still pending before assuming a feature exists.
