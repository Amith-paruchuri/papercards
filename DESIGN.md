# PaperCards Design System: "Washi & Ai"

How PaperCards should look and feel. `CLAUDE.md` says how to build; this file says how it should look. Read both before UI work.
Format follows the DESIGN.md convention (visual theme, color, type, components, layout, depth, do's and don'ts, responsive, agent guide).

## 1. Visual theme and atmosphere

A researcher's desk in Japanese paper. Calm washi surfaces, sumi-ink text, one indigo (ai-iro) accent, and a small vermilion (shu) seal on the mark. It should feel like a well-kept card catalogue: quiet, precise, made for long reading sessions. The content (paper titles, notes, PDFs) is the hero; chrome stays out of the way.

**Signature element:** the paper card. Every paper is an index card whose top-right corner is folded; the underside of the fold shows reading status. A thin strip along the bottom shows which note sections have content, in each section's colour. Spend boldness here and keep everything else disciplined.

## 2. Color palette and roles

Defined as CSS variables in `src/app/globals.css` (light and dark).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f3f4f1` | `#101318` | Washi page background |
| `--surface` | `#fbfbf9` | `#171b22` | Cards, panels, inputs |
| `--surface-2` | `#ebede8` | `#13161c` | Sidebar, wells, subtle hovers |
| `--ink` | `#1d2128` | `#e6e9ee` | Primary text (sumi) |
| `--ink-2` | `#4c5361` | `#a9b0bc` | Secondary text |
| `--ink-3` | `#737a87` | `#7e8592` | Tertiary: counts, placeholders |
| `--line` / `--line-strong` | `#dadcd5` / `#c3c7be` | `#262b34` / `#353c48` | Borders |
| `--accent` | `#2d4f8f` | `#93acea` | Ai-iro indigo: the only accent. Primary buttons, focus, active nav |
| `--accent-wash` | `#e3e9f4` | `#1b2437` | Selected/active backgrounds |
| `--seal` | `#c9472f` | `#e3694f` | Vermilion: logo seal and destructive actions only |

Reading status (fold colour, swatches): to read `--st-to_read` grey, reading ochre, read indigo, annotated matcha green.
Note sections (functional, user-changeable): Introduction `#5ec4ee`, Methods `#7ed67e`, Results `#f0c463`, Discussion `#f0879b`, extras `#b59cf0 #f5a25d #9aa3ad`.

Rules: one accent. Never introduce a second brand colour, gradients, or glows. Shadows are tinted toward indigo, never pure black.

## 3. Typography

| Family | Package | Use |
|---|---|---|
| Geist (variable) | `@fontsource-variable/geist` | All interface text |
| Newsreader (variable, optical size) | `@fontsource-variable/newsreader` | Paper titles, page titles, journal names in *italic*, empty-state headlines. Scholarly works are set like scholarship |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | DOIs and code (BibTeX) only |

Scale (px): 12, 13, 13.5, 14 (base), 15, 17.5 (card title), 22, 30 (paper title), 34 (page title), 40 to 68 (hero).
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.
- Journal names are italic Newsreader, as in a reference list.
- Numbers in counts and tables use tabular figures (`.tnum`).
- Use `…` not `...`, curly quotes, and no em or en dashes in UI copy.

## 4. Component styling

- **Buttons:** 36px (30px small), radius 8px. Primary = indigo fill. Ghost = 1px `--line-strong`. Quiet = text only. Press feedback: 1px down, 0.99 scale.
- **Inline controls** (chips, tags, segmented toggles, toolbar buttons, search): pill shaped.
- **Inputs:** radius 8px, 1px `--line-strong`, focus = indigo border + 3px indigo ring at 20%.
- **Cards:** radius 10px, 1px `--line`, `--shadow-sm`; hover lifts 2px, deepens shadow, enlarges the fold.
- **Sidebar rows:** 32px, icon + label + tabular count; active row is a raised `--surface` chip with an indigo icon.
- **Section notes:** 3px left rule in the section colour; editable title in 15px semibold; toolbar fades in on hover/focus.
- **Menus and dialogs:** `--surface`, radius 10px (dialogs 14px), `--shadow-lg`, 140 to 180ms pop-in.
- **Toasts:** dark pill at the bottom centre; errors in vermilion.
- **Icons:** Phosphor (`@phosphor-icons/react`) only, regular weight, 14 to 18px. Never hand-draw icons.

## 5. Layout principles

- Library: sticky 60px top bar (brand, pill search, command key hint, export, theme, primary Add), 248px sidebar, content max 1480px with 36px gutters. Cards in an auto-fill grid (min 268px).
- Paper page: header (title, byline, controls) then a two-pane body: notes left (0.82fr), PDF right (1.3fr) on a darker stage.
- Left-align everything except first-run and empty states.
- Structure carries meaning: rules and colours encode status and sections, never decoration.

## 6. Depth and elevation

Three shadow levels, all indigo-tinted: `--shadow-sm` (cards at rest, active nav), `--shadow-md` (card hover, focused editor), `--shadow-lg` (menus, dialogs, selection bar, toasts). PDF pages sit on the stage with their own paper shadow.

## 7. Do's and don'ts

Do:
- Keep the fold-and-strip card as the one memorable element.
- Write copy from the researcher's side: "Add papers", "Cite and export", "Waiting to be read".
- Make every error say what to do next.
- Give motion a reason: menus pop, a new highlight bullet inks in, the jumped-to highlight flashes. Nothing loops.

Don't:
- Cream-and-clay palettes, purple gradients, glassmorphism, neon.
- ALL-CAPS mono labels, middle-dot meta strings, em dashes, emoji in UI.
- Cards inside cards, identical feature tiles, fake dashboards.
- New accent colours or a second icon family.

## 8. Responsive behaviour

- Under 1100px: sign-in becomes one column; decorative card stacks hide.
- Under 980px: paper page stacks notes above the PDF (PDF 86dvh).
- Under 760px: sidebar becomes a full-screen drawer behind the menu button; search takes the full top bar; cards go single column (`minmax(0, 1fr)`); brand wordmark hides.
- Respect `prefers-reduced-motion` (all animation off) and both colour schemes; never `user-scalable=no`.

## 9. Agent prompt guide

When building UI for PaperCards:
1. Use the tokens above; never hard-code new colours.
2. Pick from existing classes in `globals.css` (`btn`, `chip`, `tag`, `paper-card`, `menu`, `modal`, `notice`, `field-label`) before adding new ones.
3. Paper titles in Newsreader; everything else Geist.
4. Check against Vercel's Web Interface Guidelines (labels, focus-visible, aria-live, `…`, tabular numbers) and the taste-skill bans.
5. Verify with screenshots in light, dark and 390px mobile before calling it done (`tests/e2e/` has a mock backend for this).
