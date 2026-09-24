---
name: DSIM
description: A driver-practice simulator for FIRST Tech Challenge whose menus read as a robot-parts catalog; the match itself keeps its own driver-station HUD.
colors:
  honey: "#f5b400"
  honey-deep: "#d49a00"
  honey-ink: "#14171a"
  accent: "#7a4e00"
  accent-soft: "#ffe49a"
  accent-soft-ink: "#4a3000"
  plate: "#14171a"
  plate-ink: "#eceff1"
  plate-mut: "#a9b2ba"
  paper: "#eceff1"
  bar: "#f1f3f5"
  panel: "#ffffff"
  tile: "#f1f3f5"
  ink: "#14171a"
  ink-dim: "#363d44"
  mut: "#56606a"
  line: "#c3cad0"
  line-soft: "#d8dde1"
  line-strong: "#76828c"
  red-chip: "#d32020"
  blue-chip: "#1f6fe0"
  red-ink: "#b3261e"
  blue-ink: "#175cd3"
  ok: "#2f9e5f"
  ok-ink: "#1f7a46"
  danger: "#ba1a1a"
  warn: "#8f5400"
  gold: "#f5a623"
  hud: "rgba(255, 255, 255, 0.94)"
  hud-line: "#c0c9c4"
  on-field: "#f9faf7"
  on-field-dim: "#b9beb8"
  on-field-accent: "#5fb597"
  hud-accent: "#366758"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(104px, 15vw, 196px)"
    fontWeight: 900
    lineHeight: 0.8
    letterSpacing: "-0.02em"
    fontVariation: "\"wdth\" 62"
  headline:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(34px, 5vw, 52px)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0"
    fontVariation: "\"wdth\" 75"
  title:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "\"wdth\" 75"
  section:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 800
    letterSpacing: "0.06em"
    fontVariation: "\"wdth\" 87.5"
  body:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  body-lg:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
    fontVariation: "\"wdth\" 87.5"
  data:
    fontFamily: "Martian Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 600
    fontFeature: "\"tnum\""
  data-lg:
    fontFamily: "Martian Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "32px"
    fontWeight: 700
    fontFeature: "\"tnum\""
rounded:
  sm: "2px"
  DEFAULT: "3px"
  md: "4px"
  lg: "6px"
  full: "9999px"
spacing:
  s-0: "2px"
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
components:
  masthead:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    padding: "12px 24px"
    height: "63px"
  order-button:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.honey-ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "16px 24px"
  order-button-hover:
    backgroundColor: "{colors.honey-deep}"
  button-primary:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.honey-ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.honey-deep}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "8px 16px"
  button-small:
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  part-row:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "16px 12px"
  part-row-hover:
    backgroundColor: "{colors.panel}"
  part-row-primary:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.honey-ink}"
  rail-tab:
    textColor: "{colors.ink}"
    padding: "12px 16px"
  rail-tab-current:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.honey-ink}"
  spec-value:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "36px"
  spec-value-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  option-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.DEFAULT}"
    padding: "12px 16px"
  option-card-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  setup-code:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.honey}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "12px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.DEFAULT}"
    padding: "16px"
  report-side-red:
    backgroundColor: "{colors.red-chip}"
    textColor: "#ffffff"
    typography: "{typography.data-lg}"
    rounded: "{rounded.DEFAULT}"
    padding: "12px"
  report-side-blue:
    backgroundColor: "{colors.blue-chip}"
    textColor: "#ffffff"
    typography: "{typography.data-lg}"
    rounded: "{rounded.DEFAULT}"
    padding: "12px"
---

# Design System: DSIM

## Overview

**Creative North Star: "The Parts Catalog"**

DSIM's menus are pages from a robot-parts catalog for one game. Every mode is a part you order, every bot setting a spec you tick, and the home page is the catalog's cover: a huge condensed DSIM wordmark over a heavy rule, the season line, one honey-gold order button, an index of the other pages, a small spec table, and the real BIOBUZZ field drawn as a line plate with callouts. Results come back as a printed report. The world is cool white paper, graphite ink, hairline rules and graphite plate bands, with exactly one committed colour: anodized honey-gold, spent on the thing you should press next and on the page you are on.

Density is print-catalog, not dashboard: rows separated by 1px hairlines, heads sitting on heavy ink rules, corners of 2-3px, and no shadows at all. Depth comes from the plate band (the graphite masthead and the setup-code strip) and from rules, never from elevation. The system refuses two worlds by name: the neon esports launcher and the keycap toy box (the "Driver Station" world this replaced, with its offset block shadows and pressable keycaps).

**The game part keeps its own look.** The in-match HUD was out of scope for this redesign and is pinned, inside `.game-root`, to the tokens it was designed and contrast-audited with: the green accent (`hud-accent`), 4-24px corners, hard offset block and edge shadows, and Plus Jakarta Sans / Space Grotesk. The overlays that sit inside the game root (results, pause, reconnect) are part of the menu flow, so `.game-root .overlay` switches them back to the catalog set. This split is deliberate; neither world should borrow from the other.

The system is dual-theme (light/dark, user-toggled, stamped on `<html>` as `data-theme`) and three-zone (see Colors). Both themes are audited by `npm run contrast` (225 pairs, all AA).

**Key Characteristics:**

- One colour, honey-gold, used as a FILL with graphite ink; as type it becomes the themed `accent`.
- A chosen value is filled graphite, like a ticked box in an option grid.
- Condensed Archivo caps for every head; Martian Mono only for data.
- Heavy rules under heads, 1px hairlines between rows, 2-3px corners, no shadows.
- The masthead and code strip are graphite plate bands in both themes.
- The HUD is a separate, older world, pinned by `.game-root`.

## Colors

Cool paper and graphite carry almost every pixel; honey is the one voice, and alliance red and blue appear only where an alliance owns something.

### Primary

- **Anodized Honey** (honey): the order button, the primary part row, primary buttons, the thumb-index tab of the current page, the honey rule under the masthead, the hive cells on the field plate, and the setup code's value. Always a fill, always with **Graphite** ink (honey-ink), identical in both themes. Pressed or hovered, it deepens to **Honey Deep** (honey-deep), which also draws its 1px border.
- **Honey Type** (accent): honey as TEXT. Honey itself is 1.6:1 on paper (graphite on honey is 9.8:1), so light mode uses a burnt honey-brown (#7a4e00) and dark mode uses the pure honey (#f5b400). Links, focus rings, highlighted numbers inside chips. The soft sibling (accent-soft with accent-soft-ink) is a pale honey wash for selected rows that need a tint rather than a fill; dark mode re-values it to #3b2d06 with #ffd35c ink.

### Neutral

- **Catalog Paper** (paper): the page ground. Dark: #0f1215.
- **Sheet White** (panel): cards, the field plate, index-row hover, and the INK of every selected (graphite-filled) control. Dark: #171b1f.
- **Bar / Tile** (bar, tile): the footer band and recessed wells. Dark: #171b1f / #0b0e10.
- **Graphite** (ink): body text, heavy rules, the field drawing's walls, and the FILL of a selected spec. Dark: #eceff1.
- **Graphite Dim / Muted** (ink-dim, mut): lead copy and secondary text (descriptions, sub-labels, callout leaders). Dark mut: #8f99a2.
- **Hairline** (line): the 1px rules between rows and around panels. Dark: #2f373e. **Soft Hairline** (line-soft) for the lightest table rules.
- **Control Edge** (line-strong): the border of an UNSELECTED interactive control, where the border is the whole visible boundary (3.06:1 on panel, WCAG 1.4.11). Dark: #6d7882.
- **Graphite Plate** (plate, plate-ink, plate-mut): the masthead and the setup-code strip. Graphite in light mode; lifted to #23282d in dark mode so it still reads as a band above the near-black page.

### Fixed-ink fills (do not invert)

- **Alliance Red / Alliance Blue** (red-chip, blue-chip): the red and blue sides of the results report, alliance chips, and the tinted zones on the field plate (a 14% wash with a full-strength stroke). White ink on the fill. As text, use the `-ink` siblings (red-ink, blue-ink), which invert.
- **Medal Gold** (gold): leaderboard placement only. Not the catalog honey.
- **OK / Danger / Warn** (ok with ok-ink, danger, warn): status. `warn` is burnt amber in light and #e0a437 in dark.

### Canvas-only and HUD

- **On-Field** (on-field, on-field-dim, on-field-accent): text painted straight onto the game canvas, which is hardcoded dark in both themes. Deliberately absent from the dark block.
- **HUD card** (hud, hud-line): themed cards floating over the field. The card is only ~1.4:1 on the field by fill, so `hud-line` is the separator.
- **HUD Green** (hud-accent): the in-match accent, pinned by `.game-root`; #5fb597 in dark. Never used in menus.

### Named Rules

**The One Honey Rule.** Honey is spent on what you should press next and where you are, nothing else: the order button, the one primary part row per list, the current rail tab. A page with two honey calls to action has lost its order button.

**The Ticked-Box Rule.** A chosen value is filled graphite with sheet-white ink (option cards, spec values, segments, the current sub-nav tab). Selection is never honey; honey marks location and the next action, graphite marks a choice.

**The Three-Zone Rule.** Every colour token belongs to exactly one zone: *inverting* (readable against a themed surface: ink, mut, accent, warn, danger, the lines, the `-ink` siblings), *fixed-ink* (a fill whose meaning cannot change with theme: honey, alliance chips, gold, the plate), or *canvas-only* (`on-field*`, because the field never themes). Name the zone when you add a token.

**The Fill-Is-Not-Text Rule.** A colour that works as a fill and one that works as type are separate tokens. Honey is a fill and `accent` is its type; `ok` is a fill and `ok-ink` its type; `red-chip` is a fill and `red-ink` its type.

## Typography

**Display / UI Font:** Archivo Variable, width axis loaded (with system-ui, -apple-system, Segoe UI, Roboto)
**Data Font:** Martian Mono Variable, width axis loaded (with ui-monospace, SF Mono, Menlo, Consolas)

**Character:** Archivo does both jobs of a catalog: squeezed into condensed, heavy uppercase for the part names and page heads, and at normal width for the copy. Martian Mono is the spec sheet's figure face, reserved for readings.

### Hierarchy

- **Display** (900, clamp(104px, 15vw, 196px), line-height 0.8, width 62%, uppercase): the cover wordmark only. The order button's label is the same cut at 40px (32px under 480px).
- **Headline** (800, clamp(34px, 5vw, 52px), line-height 0.95, width 75%, uppercase): the page head, over a 3px graphite rule. The report head in the results overlay is the same treatment at 28px.
- **Title** (800, 24px, line-height 1, width 75%, uppercase): part-row names. Index-row names are 20px; rail tab names 17px (15px on phones); sub-nav names 15px.
- **Section** (800, 16px, width 87.5%, 0.06em tracking, uppercase): section heads, over a 2px graphite rule.
- **Body** (400, 13px, line-height 1.4; 15px at 1.5 for the cover lead, capped at 40ch): descriptions and prose. Sub-page intros cap at 64ch.
- **Label** (700, 11-12px, width 87.5%, 0.06-0.08em tracking, uppercase, muted): spec-table terms, spec-row names, the setup code's key, stat labels.
- **Data** (Martian Mono, 600-700, 13px up to 32px for final scores, tabular numerals): scores, spec values, the setup code, stat readings.

Weights in use are exactly seven: 400, 500, 600, 700, 750, 800, 900. Font sizes are whole pixels on a six-step token scale (11, 12, 13, 15, 20, 28) plus the display sizes above. `npm run uiaudit` enforces both.

### Named Rules

**The Condensed-Caps Head Rule.** Every head is Archivo uppercase at 800-900 with the width axis pulled in (62% display, 75% heads and part names, 87.5% section heads and labels). Width, not letter-spacing, is what makes them read as catalog type.

**The Mono-Is-A-Reading Rule.** Martian Mono sets numbers and codes a driver reads as a value, always with tabular numerals. Words, labels and prose are Archivo.

## Layout

A catalog spread. The graphite masthead is sticky at a contract height of 63px with a 3px honey rule beneath it. Below it, sub-pages hang a 220px thumb-index rail on the left (a sheet-white column of hairline-separated tabs; the current tab is honey and runs 8px past the rail's edge into the page, like a printed thumb tab), and the page body is centred at up to 1080px. The home cover widens to 1240px and splits 0.9fr / 1.1fr with a 48px gap: copy column left, field plate right, a hairline-topped footer across both.

Lists are ruled rows, not card grids: part rows are a three-column grid (up to 200px name, description, arrow or reason), index rows 128px / 1fr / arrow. The bot spec selector is a 96px label column against a 3- or 4-up value grid; inside the Play page's config box above 900px its three specs sit side by side, the way a catalog lays an option grid across a page.

Spacing is a 4px grid on tokens (2, 4, 8, 12, 16, 24, 32, 48); 2px is reserved for chip internals and the gap between a label and its sub-line. Breakpoints: 900px (cover and config grids collapse to one column), 640px (the rail becomes a strip of four equal tabs and loses its Home link and thumb tab; part rows stack name over description), 480px (order button and index rows tighten). The layout must hold at 390px with no horizontal scroll.

## Elevation & Depth

None. The catalog is flat: the shadow tokens (`--ds-block`, `--ds-block-sm`, `--ds-edge`, `--ds-edge-soft`) resolve to transparent outside the game root, so any legacy rule that still names them paints nothing. Depth is carried by the plate band (graphite masthead and code strip above paper), by the sheet-white panel against catalog paper, and by rule weight (3px under a page head, 2px under a section head, 1px between rows).

The one exception is the game: `.game-root` restores the HUD's hard offset shadows (`4px 4px 0` / `2px 2px 0` block, `0 3px 0` edge), none blurred. The results overlay switches them back off.

### Named Rules

**The No-Shadow Rule.** Menu surfaces carry no `box-shadow` of any kind. If something needs to stand forward, give it a plate band, a heavier rule, or honey.

**The Transform-Only Press Rule.** A pressable moves by `transform` only (a 1px `translateY` on press, a 4px `translateX` on its arrow on hover). Hover changes border colour or background, never border width or margin, so nothing around it reflows. Enforced by `npm run shiftaudit`.

## Shapes

Machined, barely-softened corners: 3px on buttons, cards, part panels, options and the order button; 2px on the small parts (chips, spec values, the code strip, small buttons, the edition tag); 4-6px only on the results report card. Round shapes are reserved for true circles (status dots, avatar). Borders are 1px; heads carry a solid rule under them rather than a box around them. The field plate is a line drawing: 1.4-unit graphite walls, hairline tile seams, dotted pivot lines, dot-and-leader callouts outside the field.

## Components

### Masthead

A graphite plate band, 63px, 12px 24px padding, a 3px honey rule underneath, in both themes. It re-points the inverting tokens for everything inside it (profile menu, presence, server picker) so those components need no masthead-specific rules. The DSIM mark (honey square badge, graphite top-down robot) sits left of a 24px, 900-weight, 75%-width wordmark, followed by a 1px honey-outlined edition tag (hidden on phones).

### Buttons

- **Shape:** 3px corners, 1px border (2px corners on the small size).
- **Primary:** honey fill, graphite ink, honey-deep border; hover deepens to honey-deep.
- **Secondary:** sheet-white fill, graphite ink, control-edge border; hover sharpens the border to graphite.
- **Ghost:** no fill, transparent border, never presses.
- **Press / Focus / Disabled:** 1px `translateY` on press; 2px `accent` outline at 2px offset on focus; 50% opacity and no press when disabled.

### The Order Button (signature)

The cover's one honey field: full width to 480px, a 40px 900-weight condensed label with a one-line description beneath and a 32px square-capped arrow on the right that slides 4px on hover. Below it, the index of other pages as ruled rows, then a three-cell spec table of labelled monospace readings.

### Part Rows

Modes are catalog part rows: no box, a 1px hairline below, 24px condensed name, muted description, arrow at the right. Hover lays sheet white behind the row. The recommended part is filled honey. A part that cannot be ordered keeps its row, mutes its name, and replaces the arrow with its reason ("Needs the game server").

### Spec Selector and Setup Code

Each spec is a muted label over a grid of 36px value buttons with 2px corners. Unselected: sheet white, control-edge border. Selected: filled graphite (the Ticked-Box Rule). Unavailable: dashed border, muted text. Beneath the specs, the whole configuration reads back as one line on a graphite code strip: a muted uppercase key and the value in Martian Mono, honey on graphite.

### Option Cards and Segments

Option cards (robot presets, toggles) are 3px sheet-white cards with a control-edge border and 12px 16px padding; selected fills graphite. A real team's robot carries an 8px honey corner tick. Segmented controls are borderless 12px/700 labels whose selected state is a graphite fill; weight never changes between states.

### Navigation

The rail's tabs are 12px 16px rows separated by hairlines: condensed uppercase name over a muted one-line hint. Hover lays the tile tint; the current page is honey with its thumb tab running past the rail edge. The sub-nav inside a page uses the same row shape, but its current tab is filled graphite, because it is a choice within the page rather than where you are in the catalog.

### Chips

2px corners, Martian Mono 11px, sheet white with a control-edge border; a highlighted number inside takes `accent`. Alliance chips are filled red-chip / blue-chip with white ink; `on` status uses ok-ink text with an ok-tinted border; `off` recedes to the tile fill and muted text at full opacity.

### Panels and Stats

Panels are sheet white, 1px hairline, 3px corners, 16px padding, 12px internal gap, no shadow. Stat tiles are the same at 8px 12px: a 16px/700 monospace reading over an 11px condensed uppercase label.

### The Report (results overlay)

A sheet-white card on the game's dark scrim, edged with `hud-line` because the scrim is dark in both themes. A 28px condensed head over a 3px graphite rule; the two alliance sides as filled red and blue blocks with a 32px monospace score, the winner ringed by a 3px honey outline (the losing side is never faded); a centred score table with small condensed section heads, category names in muted Archivo and both alliances' figures in monospace. The action row is honey buttons (800 weight, condensed, 0.08em tracking) with a secondary white one, pinned to the bottom of the card while the figures scroll beneath.

## Do's and Don'ts

### Do:

- **Do** keep honey (#f5b400) a fill with graphite ink, and use `accent` when honey has to be text.
- **Do** mark a selection with a graphite fill and sheet-white ink.
- **Do** set heads in Archivo uppercase with the width axis at 62%, 75% or 87.5%, sitting on a 3px (page) or 2px (section) graphite rule.
- **Do** separate list items with 1px hairlines instead of boxing each one.
- **Do** keep every gap and padding on the 4px grid, every weight in 400/500/600/700/750/800/900, and every font size a whole pixel; `npm run uiaudit` ratchets all three and fails on any undefined token or duplicated selector.
- **Do** run `npm run contrast` (225 pairs, light and dark) after any token edit, and name the zone (inverting, fixed-ink, canvas-only) of every new colour.
- **Do** move pressables by `transform` only and run `npm run shiftaudit` after touching a hover or active state.
- **Do** use `hud-line`, not `line`, for the edge of any card floating over the field or the game scrim.
- **Do** leave `.game-root` pinned to the HUD's own accent, corners, shadows and fonts, and let `.game-root .overlay` switch the menu-flow overlays back to the catalog set.

### Don't:

- **Don't** add a `box-shadow`, blurred or offset, to any menu surface.
- **Don't** round a menu component past 3px (6px for the report card).
- **Don't** put a second honey call to action on a page, or use honey to show a selection.
- **Don't** set words, labels or prose in Martian Mono.
- **Don't** reach for `ink`, `mut` or `accent` when drawing straight onto the game canvas; use the `on-field` family.
- **Don't** carry the HUD's green, keycap shadows or Plus Jakarta Sans / Space Grotesk into the menus, or catalog honey and hairlines into the HUD.
- **Don't** fade the losing side of a result; mark the winner additively.
- **Don't** extend `--ds-blush`, `--ds-sage`, `--ds-lavender` or `--ds-sky`; they are vestigial from the pastel world.
