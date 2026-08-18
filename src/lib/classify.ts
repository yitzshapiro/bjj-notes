/**
 * Assigns position, phase, and technique tags to a division from its label and
 * the Drive path it sits under.
 *
 * The two signals are deliberately weighted differently. A folder tells you what
 * an instructional is *about* — everything under "Guard Retention" concerns
 * retention — but it is broad, so it scores lower. A label match is specific to
 * the one division, so it scores higher. When both agree the tag is treated as
 * near-certain.
 *
 * Rules are conservative on purpose: a missing tag is a gap the browser can
 * still search around, while a wrong tag is a division you will never find
 * again. Anything ambiguous is left untagged rather than guessed.
 */

export type TagKind = "position" | "phase" | "technique";

export type TagDefinition = {
  slug: string;
  kind: TagKind;
  label: string;
  sortOrder: number;
};

export type ClassifiedTag = {
  slug: string;
  /** 0–1. Below `REVIEW_THRESHOLD` the tag is a guess worth confirming. */
  confidence: number;
};

export const REVIEW_THRESHOLD = 0.7;

const POSITIONS: [string, string][] = [
  ["standing", "Standing"],
  ["closed-guard", "Closed guard"],
  ["open-guard", "Open guard"],
  ["half-guard", "Half guard"],
  ["butterfly-guard", "Butterfly guard"],
  ["x-guard", "X guard"],
  ["de-la-riva", "De la Riva"],
  ["leg-entanglement", "Leg entanglement"],
  ["turtle", "Turtle"],
  ["front-headlock", "Front headlock"],
  ["side-control", "Side control"],
  ["mount", "Mount"],
  ["back", "Back"],
  ["knee-on-belly", "Knee on belly"],
  ["north-south", "North–south"],
];

const PHASES: [string, string][] = [
  ["guard-pull", "Guard pull"],
  ["takedown", "Takedown"],
  ["entry", "Entry"],
  ["control", "Control"],
  ["sweep", "Sweep"],
  ["submission", "Submission"],
  ["pass", "Pass"],
  ["escape", "Escape"],
  ["retention", "Retention"],
  ["concept", "Concept"],
  ["solo-drill", "Solo drill"],
  ["mindset", "Mindset"],
];

const TECHNIQUES: [string, string][] = [
  ["triangle", "Triangle"],
  ["armbar", "Armbar"],
  ["kimura", "Kimura"],
  ["heel-hook", "Heel hook"],
  ["straight-ankle", "Straight ankle lock"],
  ["kneebar", "Kneebar"],
  ["strangle", "Strangle"],
  ["guillotine", "Guillotine"],
  ["omoplata", "Omoplata"],
  ["wrist-lock", "Wrist lock"],
  ["arm-drag", "Arm drag"],
  ["ankle-pick", "Ankle pick"],
  ["single-leg", "Single leg"],
  ["double-leg", "Double leg"],
  ["sumi-gaeshi", "Sumi gaeshi"],
  ["body-lock", "Body lock"],
  ["leg-drag", "Leg drag"],
  ["knee-cut", "Knee cut"],
  ["toreando", "Toreando"],
];

export const TAGS: TagDefinition[] = [
  ...POSITIONS.map(([slug, label], index) => ({ slug, label, kind: "position" as const, sortOrder: index })),
  ...PHASES.map(([slug, label], index) => ({ slug, label, kind: "phase" as const, sortOrder: index })),
  ...TECHNIQUES.map(([slug, label], index) => ({ slug, label, kind: "technique" as const, sortOrder: index })),
];

const TAG_SLUGS = new Set(TAGS.map((tag) => tag.slug));

type Rule = { test: RegExp; tags: string[] };

/**
 * Matched against the folders and video name a division sits under. These carry
 * the subject of the whole instructional.
 */
const PATH_RULES: Rule[] = [
  { test: /fundamental standing skills|takedowns & standing skills|upper body takedowns/i, tags: ["standing", "takedown"] },
  // Feet to Floor splits by sub-folder: Vol 2 is throws, Vol 3 is guard pulling.
  // Anchored to the folder separators — a video *named* "Volume 3" can sit
  // inside the "Volume 2" folder, and an unanchored match mistags all of it.
  { test: /feet to floor \/ volume 3 \//i, tags: ["guard-pull", "standing"] },
  { test: /feet to floor \/ volume 2 \//i, tags: ["standing", "takedown"] },
  { test: /no-gi guard passing|passing the guard|systematically attacking the guard/i, tags: ["pass"] },
  { test: /half guard passing and dynamic pins/i, tags: ["pass", "half-guard"] },
  { test: /guard retention/i, tags: ["retention", "open-guard"] },
  { test: /closed guard/i, tags: ["closed-guard"] },
  { test: /open guard/i, tags: ["open-guard"] },
  { test: /half guard/i, tags: ["half-guard"] },
  { test: /leglocks/i, tags: ["leg-entanglement", "submission"] },
  { test: /triangles/i, tags: ["triangle", "submission"] },
  { test: /arm bar/i, tags: ["armbar", "submission"] },
  { test: /kimura/i, tags: ["kimura", "submission"] },
  { test: /front headlock/i, tags: ["front-headlock"] },
  { test: /back attacks|systematically attacking the back/i, tags: ["back", "submission"] },
  { test: /turtle/i, tags: ["turtle"] },
  { test: /strangles & turtle breakdowns/i, tags: ["strangle", "turtle", "submission"] },
  { test: /mounted pin attacks|4x4 mount system/i, tags: ["mount", "submission"] },
  { test: /philosophy of positional escapes|^.*\bescapes\b/i, tags: ["escape"] },
  { test: /philosophy of submission escapes|joint lock escapes|pillars of defense/i, tags: ["escape", "submission"] },
  { test: /positional dominance & scrimmage wrestling/i, tags: ["control"] },
  { test: /sweeps & reversals/i, tags: ["sweep"] },
  { test: /self mastery|solo bjj training drills/i, tags: ["solo-drill"] },
  { test: /sport of kings|high performance mindset|getting swole/i, tags: ["mindset"] },
  { test: /two foundations of guard play/i, tags: ["open-guard", "retention"] },
];

/**
 * Matched against the division label itself. Word boundaries and explicit
 * phrases keep common words ("back", "post", "cross") from over-matching.
 */
const LABEL_RULES: Rule[] = [
  // --- positions ---
  { test: /\bclosed guard\b/i, tags: ["closed-guard"] },
  { test: /\bhalf ?guard\b|\bhalf butterfly\b|\bknee shield\b|\breverse half\b|\blockdown\b/i, tags: ["half-guard"] },
  { test: /\bbutterfly\b/i, tags: ["butterfly-guard"] },
  { test: /\bx.?guard\b|\bshoelace\b/i, tags: ["x-guard", "open-guard"] },
  { test: /\bde la riva\b|\bdlr\b|\brdlr\b/i, tags: ["de-la-riva", "open-guard"] },
  { test: /\bashi\b|\bashi garami\b|\bsaddle\b|\b50\/?50\b|\bheel exposure\b|\birimi\b/i, tags: ["leg-entanglement"] },
  { test: /\bturtle\b/i, tags: ["turtle"] },
  { test: /\bfront headlock\b|\bsnap ?down\b/i, tags: ["front-headlock"] },
  { test: /\bside (control|pin)\b|\bkesa.?gatame\b|\bcrossface\b/i, tags: ["side-control"] },
  { test: /(?<!\brear )(?<!\bback )\bmount(ed)?\b/i, tags: ["mount"] },
  { test: /\brear mount\b|\bback (take|attack|exposure|control)\b|\btaking (the )?back\b|\bseatbelt\b|\bstraitjacket\b|\bbody triangle\b|\bgo behind\b/i, tags: ["back"] },
  { test: /\bknee.?on.?belly\b/i, tags: ["knee-on-belly"] },
  { test: /\bnorth.?south\b/i, tags: ["north-south"] },
  { test: /\bstanding\b|\bstance\b|\bkuzushi\b|\bgrip fighting\b|\bai.?yotsu\b|\bkenka.?yotsu\b/i, tags: ["standing"] },
  { test: /\bseated\b|\bsupine\b|\btripod\b|\bcollar cuff\b|\bbicep guard\b/i, tags: ["open-guard"] },

  // --- phases ---
  { test: /\bpull(ing)? (guard|to)\b|\bguard pull\b|\bjump.?pull\b/i, tags: ["guard-pull"] },
  { test: /\bsweep\b|\breversal\b|\belevator\b|\bgaeshi\b|\bnage\b|\botoshi\b|\bguruma\b|\bhip heist\b/i, tags: ["sweep"] },
  { test: /\bpass(ing|es)?\b|\bknee ?(cut|slice)\b|\btoreando\b|\bleg drag\b|\blong step\b|\bsmash pass\b|\bdouble under(hook)? pass\b|\bover.?under\b/i, tags: ["pass"] },
  { test: /\bescape\b|\bescaping\b|\bdefen[cs]e\b|\bnegat(e|ing|ion)\b|\bcounter\b/i, tags: ["escape"] },
  { test: /\bretention\b|\bretain\b|\brecover(y|ing)?\b|\bframe|framing\b|\bshrimp/i, tags: ["retention"] },
  { test: /\bentry\b|\bentries\b|\bentering\b|\bsetup\b|\bset.?up\b/i, tags: ["entry"] },
  { test: /\bcontrol\b|\bgrip\b|\bpin\b|\bconnection\b|\bclamp\b|\bhold\b|\b2.?on.?1\b|\bunderhook\b|\boverhook\b/i, tags: ["control"] },
  { test: /\btakedown\b|\bthrow\b|\bwaza\b|\bosoto\b|\bkouchi\b|\bouchi\b|\bkosoto\b|\bseoi\b|\bsasae\b|\bharai\b/i, tags: ["takedown"] },
  { test: /\bintro(duction)?\b|\boverview\b|\btheory\b|\bprinciple\b|\bphilosophy\b|\bconcept\b|\bmindset\b|\bunderstanding\b|\bbig picture\b|\bcommentary\b|\breflections?\b|\bgolden rule\b|\bmechanics\b|\bdilemma\b/i, tags: ["concept"] },

  { test: /\bdrill\b|\bpummel(ing)?\b|\bsolo\b/i, tags: ["solo-drill"] },
  { test: /\bmindset\b|\bconfidence\b|\bcompetition\b|\btraining\b|\bgoals?\b|\bacademy\b/i, tags: ["mindset"] },

  // --- techniques (each also implies a submission) ---
  { test: /\btriangle\b|\bsankaku\b/i, tags: ["triangle", "submission"] },
  { test: /\barm ?bar\b|\bjuji\b|\bude gatame\b|\barm ?lock\b/i, tags: ["armbar", "submission"] },
  { test: /\bkimura\b/i, tags: ["kimura", "submission"] },
  { test: /\bheel ?hook\b/i, tags: ["heel-hook", "submission", "leg-entanglement"] },
  { test: /\bachilles\b|\bstraight ankle\b|\bankle lock\b/i, tags: ["straight-ankle", "submission", "leg-entanglement"] },
  { test: /\bknee ?bar\b/i, tags: ["kneebar", "submission", "leg-entanglement"] },
  { test: /\bstrangle\b|\bchoke\b|\bjime\b|\bezekiel\b|\bcollar\b.*\b(cross|sliding|clock)\b|\bkata.?juji\b|\brear naked\b/i, tags: ["strangle", "submission"] },
  { test: /\bguillotine\b/i, tags: ["guillotine", "submission"] },
  { test: /\bomoplata\b/i, tags: ["omoplata", "submission"] },
  { test: /\bwrist lock\b|\bwrist\b.*\block\b/i, tags: ["wrist-lock", "submission"] },
  { test: /\bsubmission\b|\bfinish(es|ing)?\b|\btap\b/i, tags: ["submission"] },

  // --- named techniques ---
  { test: /\barm ?drag\b/i, tags: ["arm-drag"] },
  { test: /\bankle pick\b/i, tags: ["ankle-pick", "takedown"] },
  { test: /\bsingle ?leg\b/i, tags: ["single-leg"] },
  { test: /\bdouble ?leg\b/i, tags: ["double-leg"] },
  { test: /\bsumi\b/i, tags: ["sumi-gaeshi", "sweep"] },
  { test: /\bbody ?lock\b/i, tags: ["body-lock"] },
  { test: /\bleg ?drag\b/i, tags: ["leg-drag"] },
  { test: /\bknee ?(cut|slice)\b/i, tags: ["knee-cut"] },
  { test: /\btoreando\b/i, tags: ["toreando"] },
];

const PATH_CONFIDENCE = 0.6;
const LABEL_CONFIDENCE = 0.9;
const AGREEMENT_CONFIDENCE = 0.95;

function collect(rules: Rule[], subject: string) {
  const hits = new Set<string>();
  for (const rule of rules) {
    if (!rule.test.test(subject)) continue;
    for (const tag of rule.tags) {
      if (TAG_SLUGS.has(tag)) hits.add(tag);
    }
  }
  return hits;
}

/**
 * `path` is the division's Drive path — folders plus the video file name. The
 * final segment is included because volume names carry real signal
 * ("Volume 2 - Pulling to a Sweep").
 */
export function classify(input: { label: string; path: string[] }): ClassifiedTag[] {
  const fromPath = collect(PATH_RULES, input.path.join(" / "));
  const fromLabel = collect(LABEL_RULES, input.label);

  const slugs = new Set([...fromPath, ...fromLabel]);
  return [...slugs]
    .map((slug) => {
      const inPath = fromPath.has(slug);
      const inLabel = fromLabel.has(slug);
      const confidence =
        inPath && inLabel ? AGREEMENT_CONFIDENCE : inLabel ? LABEL_CONFIDENCE : PATH_CONFIDENCE;
      return { slug, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence || a.slug.localeCompare(b.slug));
}
