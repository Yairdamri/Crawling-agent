# Composition discipline — read before every Flux prompt

Flux is looser than Mystic, Imagen, or DALL·E. It will happily generate a beautiful image that completely ignores your composition. These rules are what keep the magazine look sharp instead of fighting the model.

**This file is not a style guide — it's a pre-flight checklist.** Read it every time, even when you're sure.

## The locked suffix (already in `scripts/generate_images.py`)

```
3D isometric illustration, centered composition, generous negative space, soft studio lighting, clean magazine editorial look, no text, no letters, no logos, no UI, no readable symbols, no people, no faces, sharp focus, single focal element
```

You don't add this — the script does. Your job is to write a subject sentence that **doesn't fight** these constraints.

## Eight rules, in order of how often Flux breaks them

### 1. One focal element only

Flux interprets "and" as "show both, fight for space." If your subject sentence has two nouns joined by "and", Flux will either drop one or render both at half-quality.

**Bad:** *a server rack and a glowing chip* → either the rack disappears or both look small.

**Fix:** make one the focal noun and the other the backdrop element.

**Good:** *a server rack with a single glowing chip embedded in its top slot*

### 2. Concrete nouns only — physicalize before you submit

Flux can render *objects*. It cannot render *concepts*.

**Bad:** *the rise of agentic AI* → Flux generates a generic robot, badly.

**Fix:** translate the concept into the *object* the article is talking about.

**Good (for an essay about LLM agents writing their own tools):** *a 3D isometric workbench with translucent floating tools assembling themselves above it*

### 3. No text. Anywhere. Ever.

The suffix says "no text, no letters." Flux will still try to put text in the image if your subject sentence contains:
- Brand names → Flux renders them as label-like letters
- Acronyms (CVE, KEV, RAG, GPU) → renders as garbled letters
- Quotation marks → triggers "this is a sign with text" interpretation

**Bad:** *a chip labeled "GPU"* → garbled "GPU"-shaped letters appear

**Fix:** describe what the *thing* looks like, not what's written on it.

**Good:** *a chip with bright green status traces along its edge*

### 4. Centered, with negative space — no edge-to-edge subjects

Flux loves to fill the frame. The magazine look needs ~25% negative space around the focal element, plus an off-center accent that doesn't overwhelm.

If you don't say "centered" and "with space around it" the image will be cropped tight and lose the magazine feel.

**Add the words:** *centered*, *small*, *with space around it*, *not filling the frame*. The suffix already says "centered composition, generous negative space" — don't fight it by writing *"a massive towering server rack..."*.

### 5. Isometric and 3D, explicitly

Flux's default for tech subjects is flat infographic style. We want **3D isometric** every time.

**Always include in the subject:** *3D isometric*. Yes, the suffix says it too — say it twice. Flux listens to repetition.

### 6. No people. No faces. No hands.

Faces are unreliable in Flux (uncanny valley, race/age randomization, off-center eyes). Hands are worse. The suffix forbids them; don't accidentally invite them in.

**Bad:** *a developer typing at a workstation* → ten-fingered horror

**Fix:** show the workstation without the developer.

**Good:** *a 3D isometric workstation with three monitors, code visualized as glowing translucent blocks above the keyboard*

### 7. Color belongs in the subject sentence, never the suffix

The suffix is color-free on purpose. Color comes from `...on a [color] backdrop` at the end of your subject sentence. This is what gives a batch its color rhythm.

**Bad:** putting `warm orange backdrop` in the suffix → every image becomes orange.

**Good:** putting `on a deep red backdrop` in *this* article's subject sentence and `on a federal navy backdrop` in *that* article's subject sentence.

### 8. Cartoon clouds — only when the metaphor calls for them

Clouds aren't in the suffix. They appear *only* in subject sentences for genuinely cloud-related topics (AWS / Azure / GCP services, cloud platforms generally, observability, distributed systems). Even then they're stylized cartoon clouds (small, rounded, single accent), not photoreal.

**Default is no clouds.** Don't sprinkle them as a generic tech metaphor — they become noise.

## The pre-submit checklist

Read your subject sentence and tick:

- [ ] One focal noun (or one focal pair where the second is clearly secondary)?
- [ ] 8-20 words?
- [ ] Concrete object — could a sculptor build it from your description?
- [ ] No brand names, no acronyms, no quoted text?
- [ ] No people, no faces, no hands?
- [ ] "3D isometric" explicitly present?
- [ ] Color shows up only as "...on a [color] backdrop"?
- [ ] Clouds only if the article is *about* cloud platforms?
- [ ] Reads naturally aloud — not a bag of style tags?

If any box can't be ticked, rewrite. Don't submit and hope.

## What to do when Flux ignores you anyway

Sometimes Flux just won't comply — it puts text in the image despite "no text", or generates two subjects despite "single focal element". When it happens:

1. **Add a different seed** in the URL (`&seed=`). Same prompt, different roll.
2. **Tighten the subject sentence**, not the suffix. Drop adjectives, drop the secondary element, drop any word that could be read as a label.
3. **If still failing after 3 retries**, the article subject is genuinely hard for Flux. Switch to a different focal noun for the same article (Pattern 6 conceptual → Pattern 1 product, or vice versa). Some subjects just don't render well.

Don't argue with the model. Find a phrasing it accepts.
