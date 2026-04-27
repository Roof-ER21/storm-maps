# PDF Redesign — Concrete Layout Spec

**Reference:** `~/Downloads/E2E_Fresh_Test.pdf` (Letter, 612×792 pt, PDFKit-generated)
**Target file:** `server/storm/reportPdf.ts`
**All values in PDF points (1 pt = 1/72 in).** PDFKit origin is top-left when `doc.translate` not used; `y` increases downward.
**Colors hex.** Fonts assume PDFKit built-ins (`Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`).

---

## 0. Color Palette (sample-extracted from rendered page)

| Token | Hex | RGB | Usage |
|---|---|---|---|
| `BANNER_BG` | `#D9D9D9` | (217,217,217) | Section banner fill, table header fill |
| `BANNER_TEXT` | `#4A4A4A` | (74,74,74) | Banner title text (medium gray, not pure black) |
| `BODY_TEXT` | `#1A1A1A` | (26,26,26) | Default body text |
| `LABEL_GRAY` | `#666666` | (102,102,102) | Table label/header text, sub-captions |
| `MUTED_GRAY` | `#8C8C8C` | (140,140,140) | Footnotes, "NEXRAD Radar Image from..." caption |
| `BORDER_GRAY` | `#BFBFBF` | (191,191,191) | Table cell borders, hairlines |
| `STRIP_BG` | `#E8E8E8` | (232,232,232) | Top thin strip (`Hail Impact Report #:`), verification line bg, copyright strip |
| `BRAND_RED` | `#C8102E` | (200,16,46) | Roof-ER logo wordmark, "ROOFER" text in left logo, seal/badge fill |
| `LINK_RED` | `#C8102E` | (200,16,46) | Email link (underlined), "Customer Info:" label, warning labels (Effective/Expires/etc.) |
| `ROW_STRIPE` | `#F7F7F7` | (247,247,247) | Optional alternating row fill in tables (very subtle) |
| `WHITE` | `#FFFFFF` | (255,255,255) | Page bg, table body cells |
| `LOGO_BORDER` | `#C8102E` | (200,16,46) | Outer rectangle of left wordmark logo |

Note: target PDF does **not** use a true black for body text — use `#1A1A1A` for slightly softer rendering at 9 pt.

---

## 1. Page Geometry

| Property | Value |
|---|---|
| Page size | Letter, 612 × 792 pt |
| `MARGIN_LEFT` | **50 pt** |
| `MARGIN_RIGHT` | **50 pt** |
| `MARGIN_TOP` | **8 pt** (top strip starts here) |
| `MARGIN_BOTTOM` | **40 pt** |
| `CONTENT_WIDTH` | **512 pt** (612 − 50 − 50) |
| Bottom safe area | y ≤ **752** for body, last visual element (copyright strip) bottom ≤ 770 |

**IMPORTANT:** Current code uses 54 margins. Target uses **50 pt** left/right margins (verified: verification line block xMin=50, xMax=512.77; banner blocks span 50→562 with the gray fill). Banner fills are full content width with no L/R inset.

PDFKit setup:
```
const doc = new PDFDocument({ size: 'LETTER', margins: { top: 8, bottom: 40, left: 50, right: 50 } });
```

---

## 2. Header Block (page 1, y = 0 to ~125)

### 2a. Top thin strip — "Hail Impact Report #: <id>"

| Property | Value |
|---|---|
| Strip rect | x=0, y=0, w=612, h=22 (full-bleed, edge-to-edge) |
| Fill | `STRIP_BG` `#E8E8E8` |
| Text content | `Hail Impact Report #: <reportId>` |
| Font | `Helvetica`, **9.5 pt** |
| Text color | `LABEL_GRAY` `#666666` |
| Text alignment | Centered horizontally on page (centerX = 306) |
| Text baseline y | ~14 (vertical-centered in 22 pt strip) |

Verified bbox: `xMin=189.33 yMin=8.0 xMax=422.67 yMax=19.10` → strip background must extend full-width 0→612, but text is centered.

### 2b. Three-column header row + logos (y = 35 to 95)

Total content from y=35 to y=95 (60 pt tall block).

#### Left logo box — Roof-ER wordmark (vector)
| Property | Value |
|---|---|
| Bounding box | x=50, y=35, w=140, h=60 |
| Outer red border | rectangle stroke 1.5 pt, color `BRAND_RED` `#C8102E`, rounded corners r=2 |
| Inner padding | 6 pt all sides |
| Top text "ROOFER" | Centered, `Helvetica-Bold`, **22 pt**, color `BRAND_RED` `#C8102E`, baseline y≈58 |
| Spacer dot/icon | Small triangular roof icon (vector path) above the text or as the dot of the "O" — see SVG path below; ~10×6 pt |
| Bottom text "THE ROOF DOCS" | Centered, `Helvetica-Bold`, **8 pt**, color `BRAND_RED`, letter-spacing 1 pt, baseline y≈86 |
| Hairline divider between top/bottom text | 0.5 pt stroke `BRAND_RED`, x=58 to x=182, y=72 |

**Vector roof icon SVG path** (place above "ROOFER" text or as embellishment, scale to fit ~12×8 pt):
```
M 0 8 L 6 0 L 12 8 L 10 8 L 10 5 L 2 5 L 2 8 Z
```
Fill `BRAND_RED`. In PDFKit:
```
doc.save();
doc.translate(110, 40); // anchor inside logo box
doc.path('M 0 8 L 6 0 L 12 8 L 10 8 L 10 5 L 2 5 L 2 8 Z').fill('#C8102E');
doc.restore();
```

#### Center-left rep contact (y=47 to y=75)
| Property | Value |
|---|---|
| x-anchor | **220** (left-aligned) |
| Width | 100 pt (220 → 320) |
| Line 1 — Name | `Helvetica-Bold`, **9 pt**, `BODY_TEXT`, baseline y≈54 |
| Line 2 — Phone | `Helvetica`, **8.5 pt**, `BODY_TEXT`, baseline y≈63 |
| Line 3 — Email | `Helvetica`, **8.5 pt**, `LINK_RED` `#C8102E`, **underlined**, baseline y≈73 |
| Line spacing | ~10 pt |

Verified bbox: name `xMin=220 yMin=47 xMax=287`, email `xMin=220 yMin=66.65 xMax=317.32`.

#### Center-right report metadata (y=42 to y=82)
| Property | Value |
|---|---|
| x-anchor | **331.6** (left-aligned) |
| Width | 130 pt (331.6 → 462) |
| Line 1 — "Hail Impact Report" | `Helvetica-Bold`, **11 pt**, `BODY_TEXT`, baseline y≈50 |
| Line 2 — "Report #: <id>" | `Helvetica`, **8.5 pt**, `BODY_TEXT`, baseline y≈61 |
| Line 3 — "Date: <ts ET>" | `Helvetica`, **8.5 pt**, `BODY_TEXT`, baseline y≈71 |
| Line 4 — "Roof-ER Storm Intelligence" | `Helvetica`, **8.5 pt**, `BODY_TEXT`, baseline y≈81 |
| Line spacing | ~10 pt |

Verified bbox: title `xMin=331.6 yMin=42 xMax=429`, date `xMin=331.6 yMin=64.92 xMax=452.13`.

#### Right-side seal/badge (vector)
| Property | Value |
|---|---|
| Bounding box | x=510, y=38, w=52, h=52 |
| Shape | Filled red rounded square (radius 6), stroke none, fill `BRAND_RED` `#C8102E` |
| Inner roof icon | White vector triangle/house silhouette, centered, ~22×18 pt |
| Label below seal | None on target (badge is purely visual) |

**Roof icon vector path** (centered inside seal, white fill):
```
M -10 4 L 0 -8 L 10 4 L 7 4 L 7 9 L 3 9 L 3 5 L -3 5 L -3 9 L -7 9 L -7 4 Z
```
PDFKit:
```
doc.save();
doc.translate(536, 64); // seal center
doc.roundedRect(-26, -26, 52, 52, 6).fill('#C8102E');
doc.path('M -10 4 L 0 -8 L 10 4 L 7 4 L 7 9 L 3 9 L 3 5 L -3 5 L -3 9 L -7 9 L -7 4 Z').fill('#FFFFFF');
doc.restore();
```

### 2c. Verification line strip (y = 102 to y = 120)

| Property | Value |
|---|---|
| Strip rect | x=0, y=102, w=612, h=18 (full-bleed) |
| Fill | `STRIP_BG` `#E8E8E8` |
| Text | `You can verify the authenticity of this report using report number <reportId> and the following Verification Code: <code>` |
| Font | `Helvetica`, **8.5 pt** |
| Text color | `BODY_TEXT` `#1A1A1A` |
| Code styling | `Helvetica-Bold`, color `LINK_RED` `#C8102E`, **underlined** |
| Alignment | Centered horizontally; text spans roughly x=50 to x=513 |
| Baseline y | ~113 |

Verified bbox: text spans `xMin=50 yMin=107 xMax=512.77 yMax=114.4`.

---

## 3. Banner Style (universal — every section uses this)

| Property | Value |
|---|---|
| Banner rect | x=50, y=Y, w=512, h=22 |
| Fill | `BANNER_BG` `#D9D9D9` |
| Border | None |
| Title font | `Helvetica`, **13 pt** (NOT bold — verified: target uses regular weight) |
| Title color | `BANNER_TEXT` `#4A4A4A` |
| Title alignment | Centered horizontally on page (centerX = 306) |
| Title baseline y offset | banner.y + 15 (vertically centered in 22 pt strip) |
| Top spacing before banner | 14 pt of whitespace |
| Bottom spacing after banner | 8 pt before content |

Verified anchors:
- "Property Information" banner: text bbox `yMin=132.09 yMax=144.11` → banner box ~y=128 to y=150
- "Hail Impact Details": text `yMin=305.02 yMax=317.05` → banner ~y=301 to y=323
- "Hail Impact Narrative": text `yMin=424.81 yMax=436.83`
- "Disclaimer" (page 4): text `yMin=153.71 yMax=165.74`

PDFKit:
```
doc.rect(50, y, 512, 22).fill('#D9D9D9');
doc.fillColor('#4A4A4A').font('Helvetica').fontSize(13)
   .text(title, 50, y + 6, { width: 512, align: 'center' });
```

---

## 4. Property Information Layout

Banner at y, content from y+30.

| Property | Value |
|---|---|
| Map (left) box | x=70, y=banner.y+30, w=160, h=120 |
| Map source | Google Static Maps API, `maptype=roadmap` (verified in target — shows street labels) |
| Map zoom | **16** (single property; shows ~3-block radius) |
| Map params | `size=320x240&scale=2&zoom=16&maptype=roadmap&markers=color:red%7C<lat>,<lng>` |
| Map cache | LRU 4 MB, key by lat/lng rounded to 4 decimals |
| Gap between map and text | 15 pt |
| Text block (right) x | **245** (anchored 175 pt right of page-left, leaving room for map+gap) |
| Text block width | 317 (245 → 562) |
| Text block top alignment | Top-aligned with map (both start at banner.y+30) |
| "Property Address:" label | `Helvetica-Bold`, **9.5 pt**, `BODY_TEXT`, line height 11 |
| Address line 1 | `Helvetica`, **9.5 pt**, `BODY_TEXT` |
| Address line 2 | `Helvetica`, **9.5 pt**, `BODY_TEXT` |
| Spacer | 8 pt blank |
| "Customer Info:" label | `Helvetica-Bold`, **9.5 pt**, `LINK_RED` `#C8102E` |
| Customer name | `Helvetica`, **9.5 pt**, `BODY_TEXT` |

Verified bbox: address block `xMin=245 yMin=161.09 xMax=415.56 yMax=193.80`. "Customer Info:" `xMin=245 yMin=200.73`. Note the gap (~7 pt) between address block and customer block.

Total section height: ~125 pt (map height 120 plus 5 pt internal padding).

---

## 5. Hail Impact Details — 4×2 Label/Value Table

No header row. 4 rows, 4 columns (label-value pairs, paired left-and-right).

| Property | Value |
|---|---|
| Total table x | 50 |
| Total table width | 512 |
| Table y | banner.y + 30 |
| Row height | **18 pt** (verified: rows at y=337, 355, 373, 391 → 18 pt apart) |
| Number of rows | 4 |
| Total table height | 72 pt |
| Label col 1 x | 58 (label inset 8 pt from page margin) |
| Label col 1 width | 140 |
| Value col 1 x | 200 |
| Value col 1 width | 110 |
| Label col 2 x | 314 |
| Label col 2 width | 140 |
| Value col 2 x | 456 |
| Value col 2 width | 100 |
| Vertical text baseline within row | row.y + 11 |
| Label font | `Helvetica`, **9 pt**, `LABEL_GRAY` `#666666` |
| Value font | `Helvetica-Bold`, **9 pt**, `BODY_TEXT` `#1A1A1A` |
| Borders | **None visible** in target (no row separators, no column separators in this table) |
| Cell padding | n/a (no borders); just 8 pt left inset for labels, values left-aligned at fixed x |

Verified: row 1 baseline y=337, row 2 y=355, row 3 y=373, row 4 y=391 → 18 pt row pitch. "5/16/2025" value at x=200, "3.5 minutes" at x=456.

---

## 6. Hail Impact Narrative

Banner, then justified paragraph.

| Property | Value |
|---|---|
| Paragraph x | **70** (indented 20 pt past page margin for visual breathing room) |
| Paragraph width | **472** (70 → 542) |
| Font | `Helvetica`, **9 pt**, `BODY_TEXT` `#1A1A1A` |
| Line height | **14 pt** (verified: line baselines at y=453.81, 467.79, 481.77 → 14 pt) |
| Alignment | Justified (`align: 'justify'`) |
| Top spacing after banner | 18 pt |
| Bottom spacing after paragraph | 18 pt |

PDFKit:
```
doc.font('Helvetica').fontSize(9).fillColor('#1A1A1A')
   .text(narrative, 70, y, { width: 472, align: 'justify', lineGap: 5 });
```

---

## 7. Ground Observations Tables (Hail + Wind)

Both use identical table style.

### 7a. Sub-caption (above table)

| Property | Value |
|---|---|
| Caption x | 50 |
| Caption width | 512 |
| Font | `Helvetica`, **8 pt** |
| Color | `LABEL_GRAY` `#666666` |
| Top spacing after banner | 12 pt |
| Bottom spacing before table | 8 pt |

### 7b. Table

| Property | Value |
|---|---|
| Table x | 50 |
| Table width | 512 |
| Header row height | **18 pt** |
| Header fill | `BANNER_BG` `#D9D9D9` (same gray as banner) |
| Header font | `Helvetica-Bold`, **8.5 pt**, `LABEL_GRAY` `#666666` |
| Header text padding | 4 pt top, 4 pt left |
| Body row height | **24 pt** (taller than typical to allow date+time stacking) |
| Body row fill | White (`#FFFFFF`) — alternating stripe `ROW_STRIPE` `#F7F7F7` is OPTIONAL but target shows clean white only |
| Body font | `Helvetica`, **8.5 pt**, `BODY_TEXT` |
| Body text padding | 4 pt top, 4 pt left |
| Borders | 0.5 pt `BORDER_GRAY` `#BFBFBF` on all four sides + horizontal row dividers |
| Vertical column separators | **None** (target uses no vertical lines inside body — only row dividers) |

Verified column anchors (Hail table):
| Column | xMin | width |
|---|---|---|
| Date / Time | 54 | 80 |
| Source | 134 | 50 |
| Hail Size | 184 | 55 |
| Distance from Property | 239 | 130 |
| Comments | 369 | ~193 |

(Source bbox `xMin=134 xMax=160.96`, Distance label `xMin=239 xMax=327.30` → roughly 4-pt left padding on each column.)

Wind table uses same column geometry but "Hail Size" → "Wind Speed".

If body cell text wraps, expand row height to accommodate (auto-grow). Comments column carries the longest content.

---

## 8. Severe Weather Warnings — Per-Warning Block

### 8a. Intro paragraph (only once, before all warning blocks)

| Property | Value |
|---|---|
| Paragraph x | 70 |
| Width | 472 |
| Font | `Helvetica`, **9 pt** |
| Color | `BODY_TEXT` |
| Top spacing after banner | 14 pt |
| Bottom spacing | 16 pt |

### 8b. Per-warning block geometry

Each warning block is ~210 pt tall. Two-column upper area, then full-width caption + narrative below.

#### Upper two-column area (y = warningTop to warningTop + 130)

| Property | Value |
|---|---|
| Left column (radar image) x | 50 |
| Left column width | 200 |
| Image dimensions | **200 × 130 pt** (rendered at 250×180 px @ 2× scale, fit into 200×130) |
| Image y | warningTop |
| Right column x | **265** |
| Right column width | 297 (265 → 562) |
| Gap between columns | 15 pt |

#### Right column — Title (top) + 2×3 metadata grid (below)

**Title (2 lines wrapped):**
| Property | Value |
|---|---|
| Title x | 265, width 297 |
| Title y | warningTop (top-aligned with image) |
| Font | `Helvetica-Bold`, **10 pt** |
| Color | `BODY_TEXT` `#1A1A1A` |
| Line height | 11.5 pt |
| Title block height | ~24 pt (2 lines) |

**2×3 metadata grid (label + value, 6 cells = 3 rows × 2 column-pairs):**

Verified bbox positions (yMin per row = 343, 361, 379 → 18 pt row pitch):

| Cell | x | width | content |
|---|---|---|---|
| Row 1 Left label "Effective:" | 265 | 73 | label |
| Row 1 Left value | 340 | 73 | "4:15 PM EDT" |
| Row 1 Right label "Expires:" | 413.5 | 73 | label |
| Row 1 Right value | 488.5 | 73 | "4:45 PM EDT" |
| Row 2 Left label "Hail Size:" | 265 | 73 | label |
| Row 2 Left value | 340 | 73 | "1.75″" |
| Row 2 Right label "Wind Speed:" | 413.5 | 73 | label |
| Row 2 Right value | 488.5 | 73 | "45 mph" or "n/a" |
| Row 3 Left label "Urgency:" | 265 | 73 | label |
| Row 3 Left value | 340 | 73 | "Immediate" |
| Row 3 Right label "Certainty:" | 413.5 | 73 | label |
| Row 3 Right value | 488.5 | 73 | "Observed" |

**Grid styling:**
| Property | Value |
|---|---|
| Grid top y | title.bottom + 8 (≈warningTop + 32) |
| Row pitch | **18 pt** |
| Total grid height | 54 pt (3 rows × 18) |
| Label font | `Helvetica`, **9 pt** |
| Label color | `LINK_RED` `#C8102E` (verified — labels rendered in red on target) |
| Value font | `Helvetica-Bold`, **9 pt** |
| Value color | `BODY_TEXT` `#1A1A1A` |
| Borders | None |
| Label-to-value gap | label x=265, value x=340 → label width 75 pt, value left-aligned at 340 |

#### Below the two columns (full-width caption + narrative)

| Property | Value |
|---|---|
| Top spacing after image bottom | 8 pt |
| Caption "NEXRAD Radar Image from <date> / <time>" | x=50, width=512 |
| Caption font | `Helvetica`, **8 pt** |
| Caption color | `MUTED_GRAY` `#8C8C8C` |
| Caption alignment | Left |
| Spacing before narrative | 4 pt |
| Narrative paragraph x | 70 |
| Narrative width | 472 |
| Narrative font | `Helvetica`, **8.5 pt** |
| Narrative color | `BODY_TEXT` |
| Narrative alignment | Justified |
| Bottom spacing after narrative | 18 pt before next warning block |

#### Page break logic

Each warning block is ~210 pt tall (130 image + 16 caption-gap + ~50 narrative + 18 bottom). Before drawing a new warning, check: `if (y + 210 > 752) doc.addPage()`.

---

## 9. Historical Storm Activity — 9-column Table

| Property | Value |
|---|---|
| Table x | 50 |
| Table width | 512 |
| Header height | 22 pt (taller because some headers wrap to 2 lines like "Within 10mi") |
| Header fill | `BANNER_BG` `#D9D9D9` |
| Header font | `Helvetica-Bold`, **8 pt**, `LABEL_GRAY` |
| Header padding | 4 pt left, 6 pt top |
| Body row height | **30 pt** (taller — values like "5/16/2025, 4:30 PM EDT" wrap to 2 lines) |
| Body font | `Helvetica`, **8 pt**, `BODY_TEXT` |
| Body padding | 4 pt left, 6 pt top |
| Borders | 0.5 pt `BORDER_GRAY` `#BFBFBF` on outer + row dividers; **no vertical column dividers** in body, but header row HAS thin vertical dividers between columns (verified) |

Verified column anchors (page 4 layout):
| # | Column | xMin | xMax | width |
|---|---|---|---|---|
| 1 | Map Date* | 54 | 116 | 62 |
| 2 | Impact Time | 116 | 186 | 70 |
| 3 | Direction | 186 | 234 | 48 |
| 4 | Speed | 234 | 272 | 38 |
| 5 | Duration | 272 | 316 | 44 |
| 6 | At Location | 316 | 374 | 58 |
| 7 | Within 1mi | 374 | 428 | 54 |
| 8 | Within 3mi | 428 | 482 | 54 |
| 9 | Within 10mi | 482 | 562 | 80 |

(Total = 512, matches page width.)

### 9a. Footnote

| Property | Value |
|---|---|
| Footnote x | 50, width 512 |
| Top spacing after table | 8 pt |
| Font | `Helvetica-Oblique`, **8 pt** |
| Color | `MUTED_GRAY` `#8C8C8C` |
| Bottom spacing | 18 pt |

Verified: footnote at `yMin=133.77 xMin=50 xMax=361.73`.

---

## 10. Disclaimer

| Property | Value |
|---|---|
| Banner | Same universal style |
| Paragraph x | 70 |
| Paragraph width | 472 |
| Font | `Helvetica`, **8.5 pt** |
| Color | `BODY_TEXT` `#1A1A1A` |
| Line height | 12 pt |
| Alignment | Justified |
| Top spacing after banner | 14 pt |
| Bottom spacing | 22 pt |

---

## 11. Copyright Strip (bottom of last page)

| Property | Value |
|---|---|
| Strip rect | x=0, y=copyrightTop, w=612, h=24 (full-bleed) |
| Fill | `STRIP_BG` `#E8E8E8` |
| Text | `Copyright © <year> by Roof-ER` |
| Font | `Helvetica`, **9.5 pt** |
| Color | `BODY_TEXT` `#1A1A1A` |
| Alignment | Centered horizontally |
| Baseline y offset | strip.y + 15 |

Verified: text at `yMin=268.07` on page 4, full-width strip.

---

## 12. Vertical Rhythm Summary (page 1 budget)

```
y=0    [Top strip "Hail Impact Report #:"             ] h=22
y=22   (padding 13)
y=35   [Logo  | Rep contact | Report meta | Seal      ] h=60
y=95   (padding 7)
y=102  [Verification line strip                       ] h=18
y=120  (padding 8)
y=128  [Property Information banner                   ] h=22
y=150  (padding 8)
y=158  [Map (160×120) | Address + Customer Info       ] h=120
y=278  (padding 12)
y=290  ... continues...
```

Page 1 typically ends mid-Ground-Observations-Hail. Page break logic should advance to next page when remaining y < 100 pt and the next block ≥ remaining height.

---

## 13. Font Usage Cheat Sheet

| Element | Font | Size | Color |
|---|---|---|---|
| Top strip text | Helvetica | 9.5 | `#666666` |
| Logo "ROOFER" | Helvetica-Bold | 22 | `#C8102E` |
| Logo "THE ROOF DOCS" | Helvetica-Bold | 8 | `#C8102E` |
| Rep name | Helvetica-Bold | 9 | `#1A1A1A` |
| Rep phone | Helvetica | 8.5 | `#1A1A1A` |
| Rep email (underlined) | Helvetica | 8.5 | `#C8102E` |
| Report meta title | Helvetica-Bold | 11 | `#1A1A1A` |
| Report meta lines | Helvetica | 8.5 | `#1A1A1A` |
| Verification strip text | Helvetica | 8.5 | `#1A1A1A` |
| Verification code | Helvetica-Bold underlined | 8.5 | `#C8102E` |
| Banner title | Helvetica | 13 | `#4A4A4A` |
| Section sub-caption | Helvetica | 8 | `#666666` |
| Hail Impact label | Helvetica | 9 | `#666666` |
| Hail Impact value | Helvetica-Bold | 9 | `#1A1A1A` |
| Narrative body | Helvetica | 9 | `#1A1A1A` |
| Table header | Helvetica-Bold | 8.5 | `#666666` |
| Table body | Helvetica | 8.5 | `#1A1A1A` |
| Warning title | Helvetica-Bold | 10 | `#1A1A1A` |
| Warning label (Effective/etc.) | Helvetica | 9 | `#C8102E` |
| Warning value | Helvetica-Bold | 9 | `#1A1A1A` |
| NEXRAD caption | Helvetica | 8 | `#8C8C8C` |
| Warning narrative | Helvetica | 8.5 | `#1A1A1A` |
| Historical table header | Helvetica-Bold | 8 | `#666666` |
| Historical table body | Helvetica | 8 | `#1A1A1A` |
| Footnote | Helvetica-Oblique | 8 | `#8C8C8C` |
| Disclaimer | Helvetica | 8.5 | `#1A1A1A` |
| Copyright | Helvetica | 9.5 | `#1A1A1A` |
| "Property Address:" / "Customer Info:" label | Helvetica-Bold | 9.5 | (`#1A1A1A` / `#C8102E`) |
| Address text | Helvetica | 9.5 | `#1A1A1A` |

---

## 14. Helper Constants (TypeScript-ready)

```ts
export const PDF_LAYOUT = {
  page: { width: 612, height: 792 },
  margin: { top: 8, bottom: 40, left: 50, right: 50 },
  contentWidth: 512,

  colors: {
    bannerBg: '#D9D9D9',
    bannerText: '#4A4A4A',
    bodyText: '#1A1A1A',
    labelGray: '#666666',
    mutedGray: '#8C8C8C',
    borderGray: '#BFBFBF',
    stripBg: '#E8E8E8',
    brandRed: '#C8102E',
    linkRed: '#C8102E',
    rowStripe: '#F7F7F7',
    white: '#FFFFFF',
  },

  banner: { height: 22, fontSize: 13, padTop: 14, padBottom: 8 },

  header: {
    topStrip:    { y: 0,   height: 22, fontSize: 9.5 },
    logo:        { x: 50,  y: 35, w: 140, h: 60 },
    repContact:  { x: 220, y: 47, w: 100 },
    reportMeta:  { x: 331.6, y: 42, w: 130 },
    seal:        { x: 510, y: 38, w: 52, h: 52, radius: 6 },
    verifyStrip: { y: 102, height: 18, fontSize: 8.5 },
  },

  property: {
    map:    { x: 70,  w: 160, h: 120, zoom: 16, type: 'roadmap' },
    text:   { x: 245, w: 317 },
  },

  hailImpact: {
    rowHeight: 18,
    rows: 4,
    col: {
      label1: { x: 58,  w: 140, fontSize: 9, font: 'Helvetica',      color: '#666666' },
      value1: { x: 200, w: 110, fontSize: 9, font: 'Helvetica-Bold', color: '#1A1A1A' },
      label2: { x: 314, w: 140, fontSize: 9, font: 'Helvetica',      color: '#666666' },
      value2: { x: 456, w: 100, fontSize: 9, font: 'Helvetica-Bold', color: '#1A1A1A' },
    },
  },

  groundObs: {
    headerHeight: 18, bodyRowHeight: 24,
    headerFontSize: 8.5, bodyFontSize: 8.5,
    cellPad: { top: 4, left: 4 },
    cols: {
      hail: [
        { key: 'datetime', x: 54,  w: 80  },
        { key: 'source',   x: 134, w: 50  },
        { key: 'size',     x: 184, w: 55  },
        { key: 'distance', x: 239, w: 130 },
        { key: 'comments', x: 369, w: 193 },
      ],
      // wind = same with size→wind speed
    },
  },

  warning: {
    image:      { x: 50,    w: 200, h: 130 },
    rightCol:   { x: 265,   w: 297 },
    titleFont:  { name: 'Helvetica-Bold', size: 10, lineHeight: 11.5 },
    grid: {
      rowPitch: 18, rows: 3,
      col: { labelL: 265, valueL: 340, labelR: 413.5, valueR: 488.5 },
      labelColor: '#C8102E',
      valueColor: '#1A1A1A',
    },
    captionFontSize: 8,  captionColor: '#8C8C8C',
    narrativeFontSize: 8.5,
    blockHeight: 210, // for page-break planning
  },

  historical: {
    headerHeight: 22, bodyRowHeight: 30,
    headerFontSize: 8, bodyFontSize: 8,
    cellPad: { top: 6, left: 4 },
    cols: [
      { key: 'mapDate',    x: 54,  w: 62 },
      { key: 'impactTime', x: 116, w: 70 },
      { key: 'direction',  x: 186, w: 48 },
      { key: 'speed',      x: 234, w: 38 },
      { key: 'duration',   x: 272, w: 44 },
      { key: 'atLocation', x: 316, w: 58 },
      { key: 'within1mi',  x: 374, w: 54 },
      { key: 'within3mi',  x: 428, w: 54 },
      { key: 'within10mi', x: 482, w: 80 },
    ],
    footnoteFontSize: 8,
  },

  copyright: { y: null /* set to last-element-bottom + 16 */, height: 24, fontSize: 9.5 },
};
```

---

## 15. Critical Implementation Notes

1. **All banners use the SAME width (512 pt) and SAME fill (#D9D9D9)** — banner consistency is the most visible style cue. Do not vary.
2. **Title text is NOT bold** in banners (target uses Helvetica regular at 13 pt). Easy to get wrong.
3. **No vertical column dividers in table bodies** — only row separators. Header row may have light verticals (optional).
4. **Email and verification code are underlined and red** (`#C8102E`). "Customer Info:" and warning labels (Effective/Expires/etc.) are also red — this red is the only accent color in the document.
5. **Top strip and verification strip are full-bleed** (x=0, w=612), not margin-bound. Banner fills are margin-bound (x=50, w=512).
6. **Page breaks**: pre-compute next block height and call `doc.addPage()` if `y + nextBlockHeight > 752`. Don't rely on auto-flow for warning blocks (too easy to split image from metadata).
7. **Map is roadmap type** (verified), not satellite. Single property zoom=16 with a red pin marker.
8. **NEXRAD radar images are 200×130 pt placeholders** — leave blank if fetch fails (8 s timeout per spec). Don't block rendering.
9. **Logo and seal are pure vector** — no image asset. Use `doc.path()` and `doc.roundedRect()` with `BRAND_RED` `#C8102E`.
10. **Margins are 50 pt, not 54** — current code is wrong. Update before anything else.
