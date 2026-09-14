import type { DishDescription } from "../../lib/types.js";

/**
 * Trimming a stored description to what a card can show.
 *
 * This lives apart from ai.service.ts on purpose. It is pure string work with
 * no dependencies, but ai.service.ts imports `@google/genai` at module scope —
 * 14 MB — and `/api/menu` reaches this file on every read. Importing it from
 * there meant a menu read cold-booted the whole image/text model SDK to trim
 * two sentences. Keep this module dependency-free.
 */

/**
 * How much description a phone card can show: two lines.
 *
 * Measured on the built bundle with the real face, wrapping real Norwegian
 * prose rather than a repeated character, because word length is what decides
 * where a line breaks:
 *
 *   360x740   187px wide, 13.5px line   72 characters
 *   390x844   198px wide, 15.4px line   69 characters
 *   430x932   221px wide, 17.0px line   69 characters
 *
 * The three agree because the font is sized in dvh and the column in vw, so a
 * taller screen buys bigger text and a wider one buys more room, and they
 * cancel. 68 is the smallest of them, minus one.
 *
 * The old prompt asked for "under 110 characters", which is three and a half
 * lines, and the week's live descriptions ran 93 to 132 — every one of them
 * cut off mid-sentence on the card.
 */
export const DESCRIPTION_MAX_CHARS = 68;

/**
 * Trims a description to something that fits, preferring a complete sentence.
 *
 * The card cannot show more than two lines, so the choice is between text that
 * ends where the author meant it to and text that stops mid-word. A menu
 * description that trails off is worse than a shorter one: the reader cannot
 * tell whether they are missing something that mattered.
 *
 * So the last sentence that fits wins, and a word-boundary cut is the fallback
 * for prose with no sentence break in range — that one keeps an ellipsis,
 * because it genuinely is unfinished and saying so is better than pretending.
 *
 * The sentence rule is skipped when it would leave a stub: a first sentence of
 * four words out of a 68-character budget wastes more than it saves.
 */
export function fitDescriptionText(text: string, max = DESCRIPTION_MAX_CHARS): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;

  const window = t.slice(0, max);
  // The last ". ", "! " or "? " inside the budget, tolerating a closing quote.
  const sentence = window.match(/^[\s\S]*[.!?]["'»]?(?=\s|$)/);
  if (sentence) {
    const candidate = sentence[0].trim();
    if (candidate.length >= Math.floor(max * 0.4)) return candidate;
  }

  const cut = window.lastIndexOf(" ");
  const head = (cut > 0 ? window.slice(0, cut) : window).replace(/[\s,;:–—-]+$/, "");
  return `${head}…`;
}

/** fitDescriptionText across both languages of a stored description. */
export function fitDescription(d: DishDescription): DishDescription {
  const out: DishDescription = {};
  if (d?.no) out.no = fitDescriptionText(d.no);
  if (d?.en) out.en = fitDescriptionText(d.en);
  return out;
}
