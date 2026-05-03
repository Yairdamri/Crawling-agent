# Prompt recipes — writing the subject sentence

The subject sentence is the **only** part of the Pollinations prompt that varies per article. The style suffix is locked in `scripts/generate_images.py` and contains the magazine look + composition guards. Your job is to write a clean, concrete, single-focal-point subject — and **then run it through `composition-discipline.md` before submitting**.

## The shape of a subject sentence

```
[concrete focal noun, with 1-2 short qualifying clauses], [optional secondary element]
```

That's it. One focal noun. One or two short clauses. Optionally one supporting element (a tinted backdrop, a hint of motion, a contextual prop).

Length: 8-20 words. Anything longer and Flux starts dropping clauses.

## The eight patterns

These cover ~95% of news articles. Pick the one that fits, fill in the slot.

### Pattern 1 — The product launch

> a 3D isometric [product type], floating on a [brand-tinted] backdrop

Examples:
- *a 3D isometric processor chip with neural pathways glowing along its edges, floating on a warm orange backdrop*
- *a 3D isometric server rack with a single status LED pulsing green, floating on a deep blue backdrop*

### Pattern 2 — The infrastructure update

> a 3D isometric [infrastructure object], with [physical metaphor for the change], on a [color] backdrop

Examples:
- *a 3D isometric data pipe with a fresh translucent segment being inserted mid-flow, on a teal backdrop*
- *a 3D isometric stack of cubes, with the topmost cube splitting into two smaller cubes, on a violet backdrop*

### Pattern 3 — The security incident

> a 3D isometric [object representing the broken thing], with [crack / glow / fracture] [where], on a [red/dark] backdrop

Examples:
- *a 3D isometric padlock with a hairline fracture across its face, glowing red along the crack, on a deep red backdrop*
- *a 3D isometric server rack with one slot pulled out and glowing orange, on a near-black backdrop*

### Pattern 4 — The institutional / regulatory story

> a 3D isometric [official building / document / seal], [single detail], on a [navy/federal blue] backdrop

Examples:
- *a 3D isometric stack of bound documents with a single glowing seal on the top page, on a federal navy backdrop*
- *a 3D isometric courtroom gavel resting on an open ledger, on a deep blue backdrop*

### Pattern 5 — The community / open-source story

> a 3D isometric [collaborative object — gears, hands, modular blocks], [interaction detail], on a [warm/neutral] backdrop

Examples:
- *a 3D isometric set of three interlocking gears, the middle one half-built from translucent panels, on a sand backdrop*
- *a 3D isometric open-source code repository visualized as a tree of modular blocks, on a warm orange backdrop*

### Pattern 6 — The conceptual / opinion piece

> a 3D isometric [abstract object that *physicalizes* the idea — never the idea itself], on a [color] backdrop

The trap: "the future of AI" → don't generate "the future of AI." Generate the *thing* the essay is about.

Examples:
- *a 3D isometric scaffold of glowing blueprints suspended above a workbench, on a navy backdrop* ← essay about specs in YAML
- *a 3D isometric brain made of interlocking translucent panels, with one panel being lifted out, on a warm orange backdrop* ← essay about LLM interpretability

### Pattern 7 — The benchmark / evaluation

> a 3D isometric [measuring instrument or chart], with [single highlighted reading], on a [color] backdrop

Examples:
- *a 3D isometric speedometer with the needle frozen mid-sweep, glowing at the high end, on a green backdrop*
- *a 3D isometric podium with three steps, the top step taller and lit from within, on a violet backdrop*

### Pattern 8 — The cloud platform topic (only here may you use clouds)

> a 3D isometric [cloud-platform object], with [stylized cartoon-cloud accent] [position], on a [color] backdrop

Cartoon clouds are *only* used here. They are stylized, not photoreal — small, rounded, slightly playful.

Examples:
- *a 3D isometric server rack with a small stylized cartoon cloud floating above it, on a sky blue backdrop*
- *a 3D isometric folder being lifted into a stylized cartoon cloud by a single beam of light, on a teal backdrop*

## What to **never** put in a subject sentence

- **Brand names as text** ("AWS", "Stripe") — Flux will try to render them as letters. Use the brand color and the abstract object instead.
- **People** — faces are unreliable in Flux, and they raise PR risk. Stick to objects.
- **Multiple focal nouns joined by "and"** — Flux drops one. If you need two things, make one the *backdrop*.
- **Abstract nouns as the subject** ("innovation", "transformation", "the future") — physicalize first.
- **Style words other than the suffix** ("photorealistic", "octane render", "trending on artstation") — the suffix already locks the look.
- **Color modifiers in the suffix slot** — color goes in the subject sentence ("...on a teal backdrop"), never in the suffix.

## Worked end-to-end examples

### Article: "Kubernetes 1.31 ships with sidecar containers GA" (DevOps, Tier 3 fallback to Tier 4)

Lead color: `#326CE5` (Kubernetes blue).

Pattern 2 (infrastructure update). Subject:

> a 3D isometric primary container cube with a smaller translucent sidecar cube docked to its right edge, both glowing softly, on a kubernetes blue backdrop

Run through `composition-discipline.md`: ✓ one focal pair, ✓ centered, ✓ no text, ✓ no people, ✓ isometric, ✓ negative space implied.

### Article: "CISA Adds Linux Root Access Bug to KEV" (Security)

Lead color: `#A4262C` (alert red).

Pattern 3 (security incident). Subject:

> a 3D isometric padlock with a hairline fracture spreading from the keyhole, glowing red along the crack, on a deep red backdrop

### Article: "Anthropic releases Claude 4.7 with extended context tools" (AI)

Lead color: `#D97757` (Anthropic / develeap orange — watch for batch collision).

Pattern 1 (product launch). Subject:

> a 3D isometric crystalline neural-network shape with a wide ring expanding outward at its base, on a warm orange backdrop

### Article: "Specsmaxxing — overcoming AI psychosis, why I write specs in YAML" (AI / Other)

Lead color: `develeap_navy` (`#1A2A44`) — desaturated counterweight to a batch otherwise dominated by saturated brand colors.

Pattern 6 (conceptual). Subject:

> a 3D isometric scaffold of glowing translucent blueprints stacked vertically, suspended above an empty workbench, on a navy backdrop

## Checklist before submitting

- [ ] One focal noun (or one focal pair, never three)
- [ ] 8-20 words in the subject sentence
- [ ] Color appears as "...on a [hex/named] backdrop" at the end
- [ ] No brand names spelled out
- [ ] No people, no faces
- [ ] Isometric and 3D explicitly stated
- [ ] No style words beyond what the suffix already provides
- [ ] Run through `composition-discipline.md`
