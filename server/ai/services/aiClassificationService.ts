import { GoogleGenAI } from "@google/genai";
import type { StreetViewAngle } from "./imageFetchService.js";

export interface ClassificationResult {
  roofType: string;
  roofSubtype: string;
  roofCondition: string;
  roofAgeEstimate: number;
  roofConfidence: number;
  roofColor: string;
  roofFeatures: string[];
  sidingType: string;
  isAluminumSiding: boolean;
  sidingCondition: string;
  sidingConfidence: number;
  sidingFeatures: string[];
  damageIndicators: Array<{
    type: string;
    severity: string;
    location: string;
  }>;
  reasoning: string;
  notes: string;
  modelUsed: string;
}

export interface AllModeInsights {
  retail: {
    upgradeOpportunity: string;
    crossSellPotential: string;
    curbAppealScore: number;
    talkingPoints: string[];
  };
  insurance: {
    claimPotential: string;
    visibleDamageTypes: string[];
    supplementItems: string[];
    materialObsolescence: string;
    fullExteriorClaim: boolean;
    adjusterNotes: string;
  };
  solar: {
    solarCandidate: string;
    bestRoofFace: string;
    shadeObstruction: string;
    materialCompatibility: string;
    reroofFirst: boolean;
    estimatedPanelCount: number;
    talkingPoints: string[];
  };
}

// ============================================================
// PASS 1: Visual Feature Extraction
// Forces the AI to carefully OBSERVE before classifying.
// ============================================================

const FEATURE_EXTRACTION_PROMPT = `You are an expert property inspector. DO NOT classify materials yet.
Describe ONLY what you observe in the images.

=== ROOF SURFACE — describe each of these ===
1. TEXTURE: Granular/gritty? Smooth? Rough/irregular? Layered?
2. SHADOW PATTERN: Are horizontal shadow lines UNIFORM and equally spaced (like a ruler)? Or RANDOM with varied depths (some deep, some shallow)?
3. TAB PATTERN: Can you see a repeating grid of identical rectangular tabs with thin vertical CUTOUT SLOTS between them? Or are tabs varied sizes in a random/staggered pattern? Or individual overlapping units (tiles)?
4. DIMENSIONAL DEPTH: Does the roof look FLAT (like colored paper) or does it have visible 3D THICKNESS with raised/recessed areas?
5. REFLECTIVITY: Matte/granular? Slight metallic sheen? Highly reflective with sun glare spots?
6. COLOR: Specific color and uniformity. Is color consistent or mottled/varied?
7. WEAR SIGNS: Dark patches (exposed asphalt from granule loss)? Curling edges (edges lifting up)? Cupping (centers sinking down into concave bowls)? Cracking? Moss/algae dark streaks? Missing pieces? Bald spots?
8. FROM SATELLITE (overview): Uniform single-tone blanket? Or textured/mottled with random lighter/darker patches? Visible parallel lines? Any bright reflective hotspots?
9. FROM SATELLITE CLOSEUP (if available): Can you see individual shingle outlines? Are tabs uniform rectangles in a grid, or varied/staggered shapes? Is the granule color uniform or multi-tonal? This ultra-zoom image is your BEST evidence for shingle type.
10. FROM ROOF CLOSEUP (if available — high-pitch street view angled up at the roof): Can you see individual shingle edges at the eave? Are they all the same width/height, or varied? Is the surface flat or dimensional?

=== SIDING/WALLS — describe each of these ===
1. MATERIAL APPEARANCE: Horizontal overlapping planks? Vertical boards? Continuous flat surface? Masonry units with mortar?
2. SURFACE SHEEN: Does it have a METALLIC GLINT (subtle reflective shimmer like metal)? Or MATTE PLASTIC look (waxy, uniform)? Or NATURAL variation?
3. DENTING: Can you see ANY small circular depressions/dimples on the surface? (These indicate metal — vinyl and fiber cement do NOT dent)
4. SURFACE HAZE: Does the color appear WASHED-OUT, MILKY, or HAZY (chalking/oxidation)? Or CLEAR and VIVID?
5. PANEL THICKNESS: Do panels look PAPER-THIN and flat against the wall? Or do they have visible DEPTH at the bottom edge creating shadow lines?
6. TRIM PIECES: Do you see J-CHANNEL trim (narrow recessed grooves) around windows/doors? WIDE CORNER POSTS (2-4" vertical strips) at building corners? These are vinyl indicators.
7. FASTENERS: Visible nail heads on panel faces? Or hidden/concealed?
8. DAMAGE CLUES: Scratches showing bare SILVER METAL underneath paint? Or scratches showing SAME COLOR throughout (vinyl)? Paint peeling/flaking? Warping/buckling?

=== PROPERTY CONTEXT ===
- Property type (single-family, townhouse, duplex, commercial)
- Approximate construction era from architectural style
- What sides are visible? Any obstructions (trees, vehicles, shadows)?
- How much of the roof is visible? How much siding is visible?

Return ONLY valid JSON:
{
  "roof": {
    "texture": "",
    "shadowPattern": "",
    "tabPattern": "",
    "dimensionalDepth": "",
    "reflectivity": "",
    "color": "",
    "wearSigns": "",
    "satelliteAppearance": "",
    "satelliteCloseupDetail": "",
    "roofCloseupDetail": ""
  },
  "siding": {
    "materialAppearance": "",
    "surfaceSheen": "",
    "denting": "",
    "surfaceHaze": "",
    "panelThickness": "",
    "trimPieces": "",
    "fasteners": "",
    "damageClues": ""
  },
  "context": {
    "propertyType": "",
    "constructionEra": "",
    "visibleSides": "",
    "obstructions": "",
    "roofVisibilityPct": 0,
    "sidingVisibilityPct": 0
  }
}`;

// ============================================================
// PASS 2: Expert Classification with Decision Trees
// ============================================================

const CLASSIFICATION_PROMPT = `You are a master roofing inspector with 30 years of field experience. You have already extracted visual features from property images. Now classify the materials by walking through the decision trees below.

EXTRACTED FEATURES:
{{FEATURES}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ROOF MATERIAL DECISION TREE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Is the roof surface FLAT with NO visible individual shingles/tiles?
  YES → Does it have bright reflective hotspots or metallic sheen?
    YES → METAL (go to Step 2)
    NO → "flat_membrane" (TPO/EPDM/built-up, appears as uniform matte surface)
  NO → Go to Step 2

STEP 2 — Are there VERTICAL SEAMS running from ridge to eave?
  YES → Are seams RAISED 1-3 inches with smooth flat panels between them?
    YES → "metal_standing_seam" (clean parallel lines, no visible fasteners, 12-18" panel widths)
    NO → Corrugated wave/rib pattern? → "metal_ribbed" (exposed fasteners, closer-spaced ribs)
  NO → Go to Step 3

STEP 3 — Are the individual roof units CURVED (barrel/S-shaped)?
  YES → Terracotta/red/orange? → "tile_clay"
  YES → Gray/brown/flat concrete? → "tile_concrete"
  NO → Go to Step 4

STEP 4 — Are units THICK rectangular pieces with natural stone color variation (grays, blue-grays)?
  YES → Precisely aligned with very straight edges? → "slate"
  NO → Go to Step 5

STEP 5 — Visible WOOD GRAIN or warm brown/silver-gray weathered wood tones?
  YES → Is there a distinctive SILVER-GRAY PATINA with irregular edges and deep thick-butt shadow lines?
    YES → "wood_shake" (natural cedar, each piece unique, weathers to silver-gray, 1.25" thick butts)
    NO → Pieces very UNIFORM in size/color/spacing? → "synthetic_shake" (manufactured polymer/composite)
  NO → Go to Step 6 (ASPHALT SHINGLES)

STEP 6 — ★★★ THE CRITICAL 3-TAB vs ARCHITECTURAL TEST ★★★

Look at the shadow pattern and tab geometry:

■ TEST A — Check for 3-TAB indicators:
  □ Shadow lines are PERFECTLY UNIFORM horizontal lines at EQUAL intervals (~5" apart)
  □ You can see thin vertical CUTOUT SLOTS (1/2" wide gaps) between tabs, repeating every 12"
  □ The tabs form a REPEATING GRID like brickwork: [tab][slot][tab][slot][tab]
  □ Surface is FLAT with NO dimensional variation — looks like colored paper
  □ From satellite: UNIFORM SINGLE-TONE blanket with regular grid texture
  □ Color is highly consistent across the entire roof — almost no variation
  → If 3+ of these match → "three_tab_shingle"

■ TEST B — Check for ARCHITECTURAL indicators:
  □ Shadow lines have VARIED DEPTHS — some deep, some shallow, creating 3D appearance
  □ Tab pattern is RANDOM/STAGGERED — tabs are different widths and heights ("dragon's teeth")
  □ NO visible cutout slots — instead, tabs overlap in an irregular pattern
  □ Surface has visible THICKNESS VARIATION — raised areas and recessed areas
  □ Shadow bands of darker granules create depth even on single-layer sections
  □ From satellite: TEXTURED/MOTTLED appearance with random lighter and darker patches
  □ Multi-tonal color variation across the roof surface
  → If 3+ of these match → "architectural_shingle"

■ TEST C — Check for DESIGNER/LUXURY indicators:
  □ Individual shingle units are OVERSIZED (2x larger than standard)
  □ Mimics SLATE or CEDAR SHAKE appearance with dramatic depth
  □ EXTRA-PRONOUNCED dimensional profile with very deep shadow lines visible from 50+ feet
  □ May have SCALLOPED or IRREGULAR bottom edges
  □ Blended multi-tone color variations
  □ Overall appears significantly THICKER and more substantial than standard shingles
  → If 3+ of these match → "designer_shingle"

★ KEY SHORTCUT: If you see a repeating grid of identical cutout slots → 3-Tab.
  If the pattern looks random with dimensional depth → Architectural.
  If units are oversized and mimic natural materials → Designer.

★ COMMON MISCLASSIFICATION TRAPS:
  - AGED ARCHITECTURAL can look flat like 3-tab because granule loss removes the dimensional shadow.
    CHECK: Do you see ANY areas with varied tab widths or staggered pattern? Even one section = architectural.
  - SATELLITE VIEW is your best friend: 3-tab looks like a UNIFORM SINGLE-TONE blanket from above.
    Architectural shows MOTTLED/SPECKLED texture with random color variation from above.
  - NEW 3-TAB is rare (discontinued by most manufacturers). If the roof looks <10 years old, it's almost certainly architectural.
  - WEATHERED 3-TAB: dark streaks + uniform flat surface + visible cutout slots = old 3-tab. The streaks alone don't make it architectural.
  - If the street view CLOSEUP (roof_closeup image, pitch 40°) shows varied tab sizes at the eave/rake edge → architectural.
  - When in doubt between 3-tab and architectural, CHECK THE SATELLITE CLOSEUP for texture pattern — this is the tiebreaker.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SIDING MATERIAL DECISION TREE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Is the exterior MASONRY?
  Individual rectangular units with mortar joints → "brick"
  Irregular/natural shaped units with mortar → "stone"
  NO masonry → Go to Step 2

STEP 2 — Is it a continuous TEXTURED SURFACE with no panels/boards?
  YES → "stucco" (bumpy/rough plaster, seamless)
  NO → Go to Step 3

STEP 3 — Horizontal overlapping panels? → ★★★ ALUMINUM vs VINYL vs FIBER CEMENT ★★★

■ ALUMINUM CHECKLIST (score each):
  □ METALLIC SHEEN — subtle reflective glint when light hits surface (vinyl is ALWAYS matte)
  □ DENTING — small circular depressions/dimples scattered on surface (DEFINITIVE — vinyl NEVER dents)
  □ CHALKING — washed-out, MILKY, HAZY appearance (oxidized paint). Color looks desaturated/dusty
  □ THIN PROFILE — panels appear paper-thin and flat against the wall. Aluminum is 0.019" thick
  □ VISIBLE NAIL HEADS — regular grid of small nail dimples on panel faces
  □ PAINT BUILDUP — visible thickness from multiple repaintings over decades
  □ SCRATCH MARKS showing bare SILVER METAL underneath paint
  □ ERA — house appears to be from 1940s-1970s construction
  → Score 3+ indicators = "aluminum" with isAluminumSiding=true

■ VINYL CHECKLIST (score each):
  □ MATTE PLASTIC appearance — smooth, slightly waxy, never metallic
  □ WOOD GRAIN EMBOSSING — visible texture pattern on panel surface
  □ J-CHANNEL TRIM — narrow recessed grooves around windows, doors, roofline transitions
  □ WIDE CORNER POSTS — 2-4" vertical strips at every building corner
  □ THICKER PROFILE than aluminum (0.040-0.048"), visible depth at bottom edge
  □ INTERLOCKING PANELS — bottom lip hooks onto panel below, creating double-line at seams
  □ COLOR GOES THROUGH — scratches/chips show SAME COLOR (not different substrate)
  □ May show slight WAVINESS/BUCKLING from thermal expansion on sun-facing walls
  → Score 3+ indicators = "vinyl"

■ FIBER CEMENT (HARDIEPLANK) CHECKLIST:
  □ DEEP SHADOW LINES — thick butt edge (5/16" to 5/8") creates pronounced dark line under each plank
  □ RIGID AND SUBSTANTIAL — panels look heavy, do not flex or wave
  □ PRECISE STRAIGHT EDGES — sharper, crisper lines than vinyl
  □ REALISTIC WOOD GRAIN — deeper and more natural-looking than vinyl's embossing
  □ PAINTED SURFACE — when chipped, reveals GRAY CEMENT substrate underneath
  □ VISIBLE CAULK at butt joints where planks meet end-to-end
  □ NO J-CHANNEL or corner posts — uses different trim system
  → Score 3+ indicators = "fiber_cement"

STEP 4 — Vertical boards with natural grain? → "wood"
  Engineered/mixed? → "composite"
  Cannot determine? → "unknown"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ROOF AGE ESTIMATION GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ASPHALT SHINGLES:
  0-2yr:  Flat, vibrant color, full granule coverage, crisp edges, zero biological growth
  3-7yr:  Still flat, minimal wear, first algae streaks may appear on north slopes in humid areas
  8-12yr: First granule thinning (slightly darker patches), color fading begins on south-facing slopes
  12-18yr: Visible curling starting at edges, dark patches from granule loss, algae streaks wider, some cupping
  18-25yr: Widespread curling/cupping/cracking, bald spots (complete granule loss), missing shingles, brittle
  25-30+yr: Structural compromise visible, heavy sagging, widespread missing pieces, needs immediate replacement

METAL: Add 10-15 years to visual age. Rust spots = 20+ years. Fading = 15+ years.
TILE: Add 15-25 years. Cracked/displaced tiles = 30+ years.
WOOD: Silver-gray patina develops 6-12 months. Splitting/curling = 15+ years.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 CONDITION RATING SCALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  "excellent": 0-5yr, no visible issues, full granule coverage, crisp edges
  "good": 5-12yr, minor cosmetic wear only, shingles still flat
  "fair": 12-18yr, visible aging (granule loss, fading, minor curling) but structurally sound
  "poor": 18-25yr, significant wear (widespread curling, cracking, bald spots, heavy algae)
  "critical": 25+yr, needs immediate replacement (structural issues, missing pieces, sagging)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 REGIONAL MATERIAL KNOWLEDGE (Mid-Atlantic)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the property's location and year built to narrow material probabilities:

ROOFING by era and region (MD/VA/PA):
  Pre-1960:  Slate (in PA especially), wood shake, early asphalt (organic 3-tab)
  1960-1985: Almost exclusively 3-tab shingle (organic felt base). These are the prime upgrade targets.
  1985-2005: Mix of 3-tab (declining) and early architectural. 3-tab still dominant until ~2000.
  2005-2015: Architectural shingle becomes standard. 3-tab rarely installed new.
  2015+:     Architectural is 90%+ of new installs. 3-tab essentially discontinued by major manufacturers (2023).
  Metal:     Rare in suburban MD/VA, more common in rural PA and farm areas.
  Tile:      Very rare in this region — if you see it, it's unusual and noteworthy.

SIDING by era:
  1940-1970: Aluminum siding was the standard. LOOK FOR IT on older homes.
  1970-1990: Vinyl replaced aluminum. Many homes re-sided vinyl over aluminum (check corners/trim for clues).
  1990+:     Vinyl dominant, fiber cement (HardiePlank) growing since 2005.
  Brick:     Common in MD/VA colonials and ranches. Often full brick or brick-front with vinyl sides.

CRITICAL RULE: If year_built is provided, use it as a STRONG prior:
  - Built 1965, appears to have asphalt shingles → VERY LIKELY 3-tab unless clearly re-roofed
  - Built 2015, appears to have asphalt shingles → VERY LIKELY architectural
  - Built 1955, horizontal panel siding → CHECK CAREFULLY for aluminum (denting, sheen, chalking)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SELF-VERIFICATION CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before finalizing, verify your classification against these sanity checks:

□ Does your roof type match what's typical for the era? (3-tab on a 2020 build = suspicious)
□ Does the satellite texture match the street view classification?
□ If you said "architectural" — can you see varied tab widths or dimensional depth? If not, reconsider 3-tab.
□ If you said "3-tab" — do you see uniform cutout slots in a grid? If not, reconsider architectural.
□ Does your age estimate match the year_built data? (If year_built=1985 and you estimated 5yr, the roof was likely replaced)
□ Does your condition match your age? (A "poor" 5-year-old roof is unusual — double check)
□ If you said "aluminum siding" — did you see metallic sheen OR denting? Without either, reconsider vinyl.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 NOW CLASSIFY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Think step by step through the decision trees. State which test/step you followed and what evidence supports your choice.

For NEGATIVE EVIDENCE: State what you would EXPECT to see for the alternative material that you DO NOT see.
Example: "If this were metal roofing, I would expect visible seam lines and reflective glare, but I see neither."

Run the SELF-VERIFICATION CHECKLIST and note any flags. Adjust your classification if a check fails.

Return ONLY valid JSON:
{
  "roofType": "<from decision tree>",
  "roofSubtype": "<variant if identifiable, e.g. 'laminate/dimensional' or 'organic 3-tab' or empty string>",
  "roofCondition": "excellent|good|fair|poor|critical",
  "roofAgeEstimate": <integer years>,
  "roofConfidence": <0.0-1.0>,
  "roofColor": "<specific color>",
  "roofFeatures": ["<visual features that led to this classification>"],
  "sidingType": "aluminum|vinyl|wood|fiber_cement|brick|stone|stucco|composite|unknown",
  "isAluminumSiding": <true|false>,
  "sidingCondition": "excellent|good|fair|poor|critical",
  "sidingConfidence": <0.0-1.0>,
  "sidingFeatures": ["<visual features that led to this classification>"],
  "damageIndicators": [{"type": "<damage>", "severity": "minor|moderate|severe", "location": "<where>"}],
  "reasoning": "<3-4 sentences: which decision tree steps you followed, what evidence confirmed your choice, what negative evidence ruled out alternatives>",
  "verificationFlags": ["<list any self-verification checks that raised concerns, e.g. 'Age estimate conflicts with year_built' or 'Satellite texture inconsistent with street view'>"],
  "notes": "<anything a roofing sales rep should know about this property>"
}

CONFIDENCE CALIBRATION:
  0.90-1.0: Textbook example, crystal clear, multiple confirming features
  0.70-0.89: Strong ID, clear features, minor ambiguity
  0.50-0.69: Probable, but some features ambiguous or obscured
  0.30-0.49: Best guess, significant obstruction or image quality issues
  0.00-0.29: Cannot determine reliably`;

// ============================================================
// PASS 3: All-Mode Insights (single call, 3 modes in parallel JSON)
// ============================================================

const ALL_MODES_PROMPT = `You are a roofing industry expert analyzing a property for THREE different sales scenarios simultaneously.

You have already identified the structural classification of this property:
{{CLASSIFICATION}}

Now provide targeted insights for all THREE sales modes in a single response.
Each mode has a different buyer and goal.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RETAIL MODE — Roofing upgrade sales rep
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Focus on: upgrade opportunities, 3-tab to architectural upgrades, aluminum siding cross-sells,
aging materials (15+ years = sales opportunity), curb appeal improvement potential.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSURANCE MODE — Insurance restoration rep
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Focus on: damage detection (hail dents/dimples, wind lift, impact cracks, water staining),
supplement items commonly missed (gutters, window screens, fences, AC condenser, garage door,
chimney, fascia/soffits), material obsolescence (3-tab discontinued), full exterior claim potential.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOLAR MODE — Solar panel sales rep
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Focus on: roof orientation (south-facing = ideal), pitch (15-40deg optimal), unobstructed area,
shade from trees/buildings, material compatibility (metal standing seam best, tile difficult),
roof age (if roof needs replacement, recommend solar + re-roof bundle).

Return ONLY valid JSON with this exact structure:
{
  "retail": {
    "upgradeOpportunity": "<specific upgrade that would benefit this home>",
    "crossSellPotential": "<siding, gutters, windows, or other items that also need work>",
    "curbAppealScore": <1-10, how much would a new roof improve the look>,
    "talkingPoints": ["<point 1>", "<point 2>", "<point 3>"]
  },
  "insurance": {
    "claimPotential": "none|low|moderate|high|excellent",
    "visibleDamageTypes": ["<damage type 1>", "<damage type 2>"],
    "supplementItems": ["<item 1>", "<item 2>", "<item 3>"],
    "materialObsolescence": "<is the current material discontinued or non-code-compliant?>",
    "fullExteriorClaim": <true if roof + siding + gutters all show damage>,
    "adjusterNotes": "<what to point out to the adjuster>"
  },
  "solar": {
    "solarCandidate": "poor|fair|good|excellent",
    "bestRoofFace": "<direction the best solar-facing slope points>",
    "shadeObstruction": "none|minimal|moderate|heavy",
    "materialCompatibility": "excellent|good|fair|poor",
    "reroofFirst": <true if roof should be replaced before installing solar>,
    "estimatedPanelCount": <rough estimate based on visible unobstructed area>,
    "talkingPoints": ["<point 1>", "<point 2>", "<point 3>"]
  }
}`;

// ============================================================
// Two-Pass Classification Engine
// ============================================================

export async function classifyProperty(
  streetViewBuffers: Buffer | Buffer[] | null,
  satelliteBuffer: Buffer | null,
  address: string,
  apiKey: string,
  streetViewAngles?: StreetViewAngle[],
  satelliteCloseup?: Buffer | null
): Promise<ClassificationResult> {
  const genAI = new GoogleGenAI({ apiKey });

  // Build image parts array
  const allImages: Array<{ buffer: Buffer; label: string; mime: string }> = [];

  if (streetViewAngles && streetViewAngles.length > 0) {
    for (const angle of streetViewAngles) {
      allImages.push({
        buffer: angle.buffer,
        label: `Street View (${angle.label} side, heading ${angle.heading})`,
        mime: "image/jpeg",
      });
    }
  } else if (streetViewBuffers) {
    const buffers = Array.isArray(streetViewBuffers)
      ? streetViewBuffers
      : [streetViewBuffers];
    for (const buf of buffers) {
      allImages.push({ buffer: buf, label: "Street View", mime: "image/jpeg" });
    }
  }

  if (satelliteBuffer) {
    allImages.push({
      buffer: satelliteBuffer,
      label: "Satellite/Aerial (top-down view of roof — use for overall roof color/tone uniformity)",
      mime: "image/png",
    });
  }

  // Satellite closeup (zoom 21) — critical for texture analysis
  if (satelliteCloseup) {
    allImages.push({
      buffer: satelliteCloseup,
      label: "Satellite CLOSEUP (ultra-zoom of roof texture — use this to see individual shingle patterns, granule variation, and dimensional depth from above)",
      mime: "image/png",
    });
  }

  if (allImages.length === 0) {
    throw new Error("No images available for analysis");
  }

  const imageParts = allImages.map((img) => ({
    inlineData: { mimeType: img.mime, data: img.buffer.toString("base64") },
  }));

  const imageLabels = allImages
    .map((img, i) => `Image ${i + 1}: ${img.label}`)
    .join("\n");

  // ========== PASS 1: Feature Extraction ==========
  const pass1Response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${FEATURE_EXTRACTION_PROMPT}\n\nProperty: ${address}\n\n${imageLabels}\n\nExamine every image carefully. Describe what you see for each feature:`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  const pass1Text = pass1Response.text || "";
  let extractedFeatures: any = {};
  try {
    const jsonMatch = pass1Text.match(/\{[\s\S]*\}/);
    if (jsonMatch) extractedFeatures = JSON.parse(jsonMatch[0]);
  } catch {
    extractedFeatures = { rawDescription: pass1Text.substring(0, 2000) };
  }

  // ========== PASS 2: Expert Classification ==========
  const pass2Prompt = CLASSIFICATION_PROMPT.replace(
    "{{FEATURES}}",
    JSON.stringify(extractedFeatures, null, 2)
  );

  const pass2Response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${pass2Prompt}\n\nProperty: ${address}\n\n${imageLabels}\n\nWalk through the decision trees step by step:`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  const pass2Text = pass2Response.text || "";

  let parsed: any;
  try {
    const jsonMatch = pass2Text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON in classification response");
    }
  } catch (e) {
    console.error("Pass 2 parse failed:", pass2Text.substring(0, 500));
    throw new Error(`Classification parse failed: ${(e as Error).message}`);
  }

  return {
    roofType: parsed.roofType || "unknown",
    roofSubtype: parsed.roofSubtype || "",
    roofCondition: parsed.roofCondition || "unknown",
    roofAgeEstimate: parsed.roofAgeEstimate || 0,
    roofConfidence: parsed.roofConfidence || 0,
    roofColor: parsed.roofColor || "",
    roofFeatures: Array.isArray(parsed.roofFeatures) ? parsed.roofFeatures : [],
    sidingType: parsed.sidingType || "unknown",
    isAluminumSiding: parsed.isAluminumSiding === true,
    sidingCondition: parsed.sidingCondition || "unknown",
    sidingConfidence: parsed.sidingConfidence || 0,
    sidingFeatures: Array.isArray(parsed.sidingFeatures) ? parsed.sidingFeatures : [],
    damageIndicators: Array.isArray(parsed.damageIndicators) ? parsed.damageIndicators : [],
    reasoning: parsed.reasoning || "",
    notes: parsed.notes || "",
    modelUsed: "gemini-2.5-flash-2pass-v3",
  };
}

// ============================================================
// All-Modes Analysis: Pass 1 + Pass 2 (base classification)
// then Pass 3 (all mode insights in one Gemini call)
// ============================================================

export async function classifyPropertyAllModes(
  streetViewBuffers: Buffer | Buffer[] | null,
  satelliteBuffer: Buffer | null,
  address: string,
  apiKey: string,
  streetViewAngles?: StreetViewAngle[],
  satelliteCloseup?: Buffer | null
): Promise<{ base: ClassificationResult; modeInsights: AllModeInsights }> {
  const genAI = new GoogleGenAI({ apiKey });

  // Build shared image parts (used across all passes)
  const allImages: Array<{ buffer: Buffer; label: string; mime: string }> = [];

  if (streetViewAngles && streetViewAngles.length > 0) {
    for (const angle of streetViewAngles) {
      allImages.push({
        buffer: angle.buffer,
        label: `Street View (${angle.label} side, heading ${angle.heading})`,
        mime: "image/jpeg",
      });
    }
  } else if (streetViewBuffers) {
    const buffers = Array.isArray(streetViewBuffers)
      ? streetViewBuffers
      : [streetViewBuffers];
    for (const buf of buffers) {
      allImages.push({ buffer: buf, label: "Street View", mime: "image/jpeg" });
    }
  }

  if (satelliteBuffer) {
    allImages.push({
      buffer: satelliteBuffer,
      label: "Satellite/Aerial (top-down view of roof — use for overall roof color/tone uniformity)",
      mime: "image/png",
    });
  }

  if (satelliteCloseup) {
    allImages.push({
      buffer: satelliteCloseup,
      label: "Satellite CLOSEUP (ultra-zoom of roof texture — use this to see individual shingle patterns, granule variation, and dimensional depth from above)",
      mime: "image/png",
    });
  }

  if (allImages.length === 0) {
    throw new Error("No images available for analysis");
  }

  const imageParts = allImages.map((img) => ({
    inlineData: { mimeType: img.mime, data: img.buffer.toString("base64") },
  }));

  const imageLabels = allImages
    .map((img, i) => `Image ${i + 1}: ${img.label}`)
    .join("\n");

  // ========== PASS 1: Feature Extraction ==========
  const pass1Response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${FEATURE_EXTRACTION_PROMPT}\n\nProperty: ${address}\n\n${imageLabels}\n\nExamine every image carefully. Describe what you see for each feature:`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  const pass1Text = pass1Response.text || "";
  let extractedFeatures: any = {};
  try {
    const jsonMatch = pass1Text.match(/\{[\s\S]*\}/);
    if (jsonMatch) extractedFeatures = JSON.parse(jsonMatch[0]);
  } catch {
    extractedFeatures = { rawDescription: pass1Text.substring(0, 2000) };
  }

  // ========== PASS 2: Expert Classification + PASS 3: All-Mode Insights (parallel) ==========
  const pass2Prompt = CLASSIFICATION_PROMPT.replace(
    "{{FEATURES}}",
    JSON.stringify(extractedFeatures, null, 2)
  );

  const [pass2Response, pass3Response] = await Promise.all([
    // Pass 2: structural classification
    genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${pass2Prompt}\n\nProperty: ${address}\n\n${imageLabels}\n\nWalk through the decision trees step by step:`,
            },
            ...imageParts,
          ],
        },
      ],
    }),
    // Pass 3 (preliminary - use feature extraction context for mode insights)
    // We run this in parallel but may refine with pass2 result below if needed
    genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${ALL_MODES_PROMPT.replace("{{CLASSIFICATION}}", JSON.stringify(extractedFeatures, null, 2))}\n\nProperty: ${address}\n\n${imageLabels}\n\nAnalyze for all three modes:`,
            },
            ...imageParts,
          ],
        },
      ],
    }),
  ]);

  // Parse Pass 2 (structural classification)
  const pass2Text = pass2Response.text || "";
  let parsedBase: any;
  try {
    const jsonMatch = pass2Text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsedBase = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON in classification response");
    }
  } catch (e) {
    console.error("Pass 2 parse failed:", pass2Text.substring(0, 500));
    throw new Error(`Classification parse failed: ${(e as Error).message}`);
  }

  const base: ClassificationResult = {
    roofType: parsedBase.roofType || "unknown",
    roofSubtype: parsedBase.roofSubtype || "",
    roofCondition: parsedBase.roofCondition || "unknown",
    roofAgeEstimate: parsedBase.roofAgeEstimate || 0,
    roofConfidence: parsedBase.roofConfidence || 0,
    roofColor: parsedBase.roofColor || "",
    roofFeatures: Array.isArray(parsedBase.roofFeatures) ? parsedBase.roofFeatures : [],
    sidingType: parsedBase.sidingType || "unknown",
    isAluminumSiding: parsedBase.isAluminumSiding === true,
    sidingCondition: parsedBase.sidingCondition || "unknown",
    sidingConfidence: parsedBase.sidingConfidence || 0,
    sidingFeatures: Array.isArray(parsedBase.sidingFeatures) ? parsedBase.sidingFeatures : [],
    damageIndicators: Array.isArray(parsedBase.damageIndicators) ? parsedBase.damageIndicators : [],
    reasoning: parsedBase.reasoning || "",
    notes: parsedBase.notes || "",
    modelUsed: "gemini-2.5-flash-3pass-allmode-v1",
  };

  // Parse Pass 3 (all-mode insights)
  const pass3Text = pass3Response.text || "";
  let parsedModes: any = {};
  try {
    const jsonMatch = pass3Text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsedModes = JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Pass 3 (all-modes) parse failed:", pass3Text.substring(0, 500));
    // Return safe defaults — the base classification is still valid
    parsedModes = {};
  }

  const modeInsights: AllModeInsights = {
    retail: {
      upgradeOpportunity: parsedModes.retail?.upgradeOpportunity || "",
      crossSellPotential: parsedModes.retail?.crossSellPotential || "",
      curbAppealScore: parsedModes.retail?.curbAppealScore || 5,
      talkingPoints: Array.isArray(parsedModes.retail?.talkingPoints) ? parsedModes.retail.talkingPoints : [],
    },
    insurance: {
      claimPotential: parsedModes.insurance?.claimPotential || "low",
      visibleDamageTypes: Array.isArray(parsedModes.insurance?.visibleDamageTypes) ? parsedModes.insurance.visibleDamageTypes : [],
      supplementItems: Array.isArray(parsedModes.insurance?.supplementItems) ? parsedModes.insurance.supplementItems : [],
      materialObsolescence: parsedModes.insurance?.materialObsolescence || "",
      fullExteriorClaim: parsedModes.insurance?.fullExteriorClaim === true,
      adjusterNotes: parsedModes.insurance?.adjusterNotes || "",
    },
    solar: {
      solarCandidate: parsedModes.solar?.solarCandidate || "fair",
      bestRoofFace: parsedModes.solar?.bestRoofFace || "",
      shadeObstruction: parsedModes.solar?.shadeObstruction || "minimal",
      materialCompatibility: parsedModes.solar?.materialCompatibility || "good",
      reroofFirst: parsedModes.solar?.reroofFirst === true,
      estimatedPanelCount: parsedModes.solar?.estimatedPanelCount || 0,
      talkingPoints: Array.isArray(parsedModes.solar?.talkingPoints) ? parsedModes.solar.talkingPoints : [],
    },
  };

  return { base, modeInsights };
}
