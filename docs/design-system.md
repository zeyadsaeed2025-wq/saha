# Design system

## Visual identity

Saha is a calm, product-like workspace rather than a game: deep ink text on a soft mint-grey canvas, teal primary, warm coral accent, clear status colors. The mark is the Arabic letter `س`. The landing preview is an SVG office; the real office is PixiJS.

- Fonts: **Plus Jakarta Sans** for Latin, **IBM Plex Sans Arabic** for Arabic (loaded in `apps/web/index.html`), with system fallbacks.
- Source of truth: `apps/web/src/styles/tokens.css` (variables), `base.css` (reset/a11y), `components.css` (layout/components/responsive).

## Tokens

| Group | Examples |
| --- | --- |
| Ink / surface | `--ink #10242b`, `--ink-2`, `--ink-3`, `--muted`, `--muted-2`, `--canvas #f4f7f6`, `--surface #ffffff`, `--surface-2` |
| Brand | `--primary #0e7c7b`, `--primary-dark`, `--primary-soft`, `--primary-tint`, `--accent #f0785a`, `--accent-soft` |
| Status | `--success #2e9e6b`, `--warning #d99a2b`, `--danger #d64550`, `--info #3b7dd8` and matching soft variants |
| Lines | `--border`, `--border-strong` |
| Type | `--text-xs` … `--text-3xl` |
| Spacing | `--sp-1` (4px) … `--sp-16` (64px) |
| Shape/elevation | `--radius-sm` … `--radius-pill`, `--shadow-sm/md/lg`, `--shadow-focus` |
| Layout | `--sidebar-w: 250px`, `--topbar-h: 68px` |

`html[dir='rtl']` swaps the sans stack to IBM Plex Sans Arabic. Room colors come from seeded domain data (`workspaces/defaults.ts`) and are intentionally muted pastels.

## Components

Reusable primitives live in `apps/web/src/components/ui.tsx`:

- Actions: `Button` (primary/secondary/ghost/accent/danger, sm/md/lg, loading), `IconButton` (requires `label`).
- Structure: `Card`, `CardHead`, `PageHead`, `Modal` (`role="dialog"`, `aria-modal`, Escape/backdrop close).
- Forms/feedback: `Field` (with hint/error, `role="alert"`), `Input`, `Select`, `Badge`, `StatusBadge` (localized attendance status), `Progress`, `Avatar`, `EmptyState`, `Skeleton`, `Spinner`.
- Hooks: `useAsync` for load/error/reload state; `useToast` for notifications.

Feature screens compose these consistently: Dashboard, VirtualOffice, Schedules (list / local month calendar / sessions tabs), Attendance, Reports, Members, Invitations, Settings, auth/onboarding and invite/access redemption.

## Localization: EN / AR, LTR / RTL

- `lib/i18n.tsx` provides `en` and `ar` dictionaries, `t(key)`, `lang`, `dir` and a language toggle (landing + app shell). Choice is stored in `localStorage` as `saha-lang`.
- `I18nProvider` sets `document.documentElement.lang` and `dir`; English defaults to `ltr`, Arabic to `rtl`.
- Layout uses logical properties where it matters (`inset-inline-start`, `margin-inline-start`) and an explicit RTL sidebar transform at small widths.
- Phone/timezone inputs use `dir="ltr"` where numeric direction matters. Statuses are translated via `status_*` keys.
- Adding UI text means adding both dictionary entries; missing keys fall back to English then to the key itself (visible fallback, not silent blank).

## Responsive rules

| Breakpoint | Behavior |
| --- | --- |
| > 1180px | Full sidebar, 4-up grids, office stage + 240px side rail. |
| ≤ 1180px | `.grid-4` becomes 2 columns; office rail narrows. |
| ≤ 960px | Sidebar becomes off-canvas (toggled by menu button, RTL slides from the other side), single-column grids/office/auth/landing, topbar search and auth aside hidden. |
| ≤ 620px | Single-column grids/forms/calendar, smaller page heading, landing links hidden. |

The PixiJS canvas resizes with its host via `ResizeObserver` and scales the logical workspace (1200×760) to fit with padding.

## Accessibility

- Visible `:focus-visible` outline using the primary color and `shadow-focus`; `.sr-only` utility for screen-reader text.
- `prefers-reduced-motion` disables animations/transitions.
- Icon-only controls provide `aria-label`; modals and nav landmarks have roles/labels; form fields use `<label>` wrappers and `role="alert"` for errors.
- Status is communicated with text and color (badges), not color alone. Loading/error/empty states are explicit.
- Known gap: the PixiJS office is pointer/keyboard navigable for movement, but avatar/room semantics are canvas-drawn and are not exposed as a full accessible scene graph; the adjacent room list provides a textual equivalent.

## Deferred controls policy

- Deferred features are represented by **informational** UI only: `Badge` "Not in MVP", `.deferred-note` blocks, and localized copy such as "Planned for a later release" or "Voice, video and screen sharing are planned for a later release".
- No disabled-looking buttons, fake toggles, or navigation to non-existent integrations. The landing footer lists deferred integrations; Settings shows status cards for audio/video, Drive uploads and SMS.
- The Schedules **Calendar** tab is a real read-only view of generated sessions. It is not an external calendar integration (which is deferred).
- The authoritative list is [deferred-register.md](deferred-register.md); UI copy must stay consistent with it.
