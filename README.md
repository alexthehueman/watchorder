# WatchOrder

A viewing-order engine for filmographies. Pick a director, answer five questions, get an ordered
path through their work that suits how you actually watch films — beside a single hand-curated
house pick.

**Live: https://alexthehueman.github.io/watchorder**

Status: **All eight phases complete, plus must-see pinning, kind-separated browsing, and search.**
Fifteen directors, three actors and three studios — 241 films, 21 entities, every gate passing.

## The bet

The obvious way to build this is to hand-write one ordered list per filmmaker. That is what
`watchinorder.in` does, and it is why they have 26 directors and no David Lynch: every entity is a
writing project, so the roster is capped by authoring effort. Their per-film blurbs are also fixed,
which means they structurally cannot explain *why a film sits at a given position*.

So we do not author orders. **We author tags.**

Each film is tagged once with a small subjective vector. Each entity–film pair carries two
relationship facts. Orders are then *computed* from quiz weights. Tagging Lynch's 14 films once
yields every possible Lynch order, for every kind of viewer, forever. That is also the moat —
anyone can copy a list; nobody cheaply copies a few hundred well-judged tag vectors.

## Layout

```
build.js         reads YAML, writes dist/ — hand-written, no framework
tools/           ingest.mjs (TMDB → skeleton) · validate.mjs (data gate)
src/core/        THE ENGINE. pure. no node:, no DOM, zero dependencies
src/data/        films.yaml + entities/*.yaml — the corpus, hand-tagged
src/ui/          quiz.js, site.css — vanilla ESM, no bundler
src/templates/   template-literal renderers → HTML strings
test/            node --test suites
dist/            build output; GitHub Pages publishes this. gitignored
```

## Develop

```bash
npm install
npm test
```

```bash
npm run build
```

Writes `dist/`, which is what GitHub Pages publishes. To look at it, serve the directory from
somewhere *other* than inside it — a server whose working directory is `dist/` locks it on
Windows, which is why the build empties the directory rather than removing it.

Pushing to `main` deploys. `.github/workflows/deploy.yml` builds with the base path
`actions/configure-pages` reports, and refuses to publish if the stylesheet href does not match
the base it was built with — a project site is served from `/watchorder/`, and that mismatch is
invisible locally.

To reproduce a deployed build by hand:

```bash
MSYS_NO_PATHCONV=1 BASE=/watchorder ORIGIN=https://alexthehueman.github.io npm run build
```

`MSYS_NO_PATHCONV=1` is not optional in Git Bash on Windows: without it, MSYS rewrites
`/watchorder` into `C:/Program Files/Git/watchorder` and the build silently emits that.

```bash
npm run preview -- david-lynch
```

`preview` prints an entity's path under five contrasting profiles. The spread suite measures
whether paths diverge; `preview` is how you check whether the divergence is any *good*. Both
matter, and they fail in opposite directions — spread is trivially gamed by adding randomness,
which only a human reading the output will catch.

## Where the engine currently stands

170 films, 15 directors, 108 profiles each, every gate live.

| metric | range across the roster | gate |
|---|---|---|
| M9 best RBO vs house pick | Denis 0.702 → Ramsay 1.000 | ≥ 0.60 ✓ |
| M6 profile-driven score variance | Carpenter 0.442 → Cronenberg 0.779 | ≥ 0.40 ✓ |
| M1 median path distance | 0.43 → 0.68 | ≥ 0.35 ✓ |
| M2 opener entropy | 1.21 → 2.27 bits | ≥ 1.2 bits ✓ |
| M4 per-question sensitivity | register quiet for 2 of 15 | live on ≥70% ✓ |
| M7 taste share of spread | 41% → 76% | ≥ 40% ✓ |
| M5 invariants, 10k fuzzed profiles | — | 100% ✓ |
| tag collinearity, pooled | opacity×bleakness 0.274, bleakness×humor −0.541 | ≤ 0.75 ✓ |

M6 is the one that matters most. It says the quiz — not signature, not acclaim — drives between
44% and 78% of the variance in a film's score. An earlier draft of this engine would have scored
near zero there, and would have shipped looking fine.

Five directors — Ramsay, Varda, Wong, Hou, Paul Thomas Anderson — come back with **perfect set
overlap** against their hand-written house picks: the engine independently selects exactly the
films a human curator chose.

### What the roster settled

Two gates were deferred while the corpus was one auteur, on the argument that pooled statistics
over a single filmography measure *that artist* rather than the schema. The argument held, and the
numbers kept improving as the roster grew:

- **Collinearity.** `opacity × bleakness` was 0.792 on Lynch alone, 0.463 at four directors, and
  **0.274** across all fifteen. Lynch's most opaque films really are his bleakest; that was a fact
  about Lynch. The humor axis correlates with bleakness at −0.541 and with opacity at −0.230,
  which is the difficulty cluster being broken exactly as intended.
- **M9.** Passes everywhere from 0.702 to 1.000. It was never a schema failure — it was a bug in
  the metric, described below.

### What actors needed, and what the film table finally paid for

Five of the actors' films were already in the corpus — *The Piano Teacher*, *Amour* and *Happy End*
arrived with Haneke, *White Material* with Denis, *Wild at Heart* with Lynch. None are duplicated.
Only the relationship differs, which is the entire reason `signature` lives on the pair:

| film | | |
|---|---|---|
| *Amour* | Haneke **4** | Huppert **2** — a major film, a supporting part |
| *Wild at Heart* | Lynch **3** | Cage **4** — a mid-tier Lynch, a defining Cage |
| *The Piano Teacher* | Haneke **5** | Huppert **5** |

Three fields the director schema did not have:

- **`role_size`** — lead, supporting or cameo. Cameos are excluded outright below the completist
  depth, because recommending a film someone appears in for four minutes is the fastest possible
  way to lose a viewer who trusted the list.
- **`register`** — restrained, unhinged, comic, menacing, warm. The tone of the *performance*, not
  the film, and what `range` mode maximises contrast across.
- **`showcase`**, separate from `signature`. For a director one number suffices; for an actor it
  would be doing two jobs — persona ("is this the Cage people mean") versus range ("does this show
  what he can do"). *Mandy* is peak persona and a moderate showcase; *Pig* and *Leaving Las Vegas*
  are the reverse. Collapsed into one number, everyone gets the same six shouting performances.

`range` replaces `chrono` for actors — release order is mostly the order other people hired them.
The quiz keeps the answer *index* stable so shared URLs survive across entity kinds, and changes
what the question says. A twelve-film Cage path comes back with 9% adjacent register repeats.

### What studios needed: eras — and a per-director quota that was added, then removed

A studio's output across decades is not development. It is several different companies wearing one
name — Cannon in 1980 and Cannon in 1987 shared a logo and almost nothing else — so `era` replaces
`chrono`, and the path groups by regime with the transitions called out. That part held.

The other half didn't. Studios originally shipped with a per-director quota — Miyazaki directed
eight of the twelve Ghibli films here, and the reasoning was that an unconstrained path would be a
Miyazaki path wearing a studio's name. It went through two rounds of correction: first a flat cap
of two, which was wrong for Ghibli specifically (it returned **four films to someone who asked for
six**, a promise quietly broken rather than a preference expressed), then a cap scaled to how many
directors the catalogue actually has.

**The whole mechanism was the wrong idea, not just its calibration**, and choosing a studio is
choosing a starting point in *that* catalogue — a viewer who picks Ghibli has no standing complaint
about the fact that Miyazaki directed most of it, any more than someone picking Lynch would want
his least-Lynchian film forced into the mix to balance things out. Diversity by fiat also worked
against the one thing a quota can't fake: Takahata's films were never excluded by taste, only by
running out of headroom under the cap, and *The Tale of the Princess Kaguya* — signature 5, higher
acclaim than several Miyazaki entries — deserves its place in a path on that basis, not a reserved
slot for being someone else's work. The quota is gone. A six-film Ghibli path can now be five films
by Miyazaki and one by Takahata if that's genuinely what the taste profile selects, and Takahata
still wins a place on his own merits whenever the numbers say he should — which the M9 house-pick
comparison already confirmed they do, since the hand-written Ghibli order includes him.

### A dominant opener can be the right answer

*Cléo from 5 to 7* opens 69% of Varda's paths and *Ali: Fear Eats the Soul* opens 74% of
Fassbinder's. Both are their director's most acclaimed, most accessible, gateway-5 film, and the
runners-up are further from right.

Forcing those below the 55% concentration cap would mean deliberately sending two visitors in five
somewhere worse to improve a number — manufacturing precisely the indefensible openers the human
review exists to catch. So concentration is gated on 70% of entities while the entropy floor stays
per-entity: if one film opened *every* path the opener would have stopped being a decision, and
that is still caught. **Spread is only worth having where it is also correct.**

### A filmography can be too narrow to answer a question

Wong Kar-wai's register sensitivity is 0.02. Carpenter's confusion sensitivity is 0.115. Neither
is an engine defect: Wong's films are tonally narrow (humor 1–2 throughout bar *Chungking
Express*), and Carpenter tells stories plainly (opacity mostly 1–2). A question can only reorder a
filmography that varies on the axis it asks about.

So M4 and M7 gate on "at least 70% of entities" rather than every one, and the suite prints which
axis is quiet for whom. **That is a UI signal worth using later** — a question that provably does
nothing for the filmmaker on screen probably should not be asked about them.

### How a series is priced, and why it took two attempts

A series is not a very long film, and the first version of the runtime penalty treated it as one —
charging *Twin Peaks: The Return* 3.56 points for being seventeen hours, which buried both Twin
Peaks entries beneath films nobody would rank above them. Time cost is now two terms:

- **Endurance** — can you sit through this in one go — measured *per episode*. Seventeen hours
  spread over a month asks nothing like what a seventeen-hour film asks.
- **Commitment** — how much of your life this claims — measured on the total, and logarithmic,
  because a long work amortises.

That fixed the burial but produced a worse answer: a three-film introduction to Lynch came back
with all thirty episodes of *Twin Peaks* as its second entry. No coefficient fixed it, because the
scoring was not the problem. **"Three films" is a time budget wearing a count's clothing**, and
counting a twenty-one hour series as one slot of three is a unit error, not a weighting one. So
the budget is now measured in slots, and a series costs up to three of them.

The visible consequence is that a six-film path containing a series lists four titles. The page
says so rather than hoping nobody notices.

### M9 spent weeks looking like a schema failure and was a broken ruler

For most of the build, M9 sat at ~0.50 against a 0.60 gate and read as evidence that the tag
schema could not express a curator's order. It was measuring wrong.

Rank-biased overlap converges to 1 only as depth goes to infinity. Over a list of length *n* it
cannot exceed `1 - pⁿ` — **0.52 at seven films, 0.61 at nine**. The 0.60 threshold was therefore
unreachable by construction, whatever the engine produced.

What exposed it was adding a fourth director. Wong Kar-wai scored 0.422 while the engine had
selected *exactly* his house pick, every film, no differences. A perfect set overlap cannot be a
0.42 anything, and the ceiling arithmetic followed immediately. Normalising by `1 - pⁿ` moved all
four entities to 0.81–0.83, and it also makes scores comparable across house picks of different
lengths, which they are — seven films for Wong, nine for the others.

Two lessons kept here on purpose. A metric that never reaches its own maximum will read as a
product defect indefinitely, and the way to catch it is a calibration test — `test/spread.test.js`
now asserts that identical lists score exactly 1 and disjoint ones score 0. And the bug was only
visible because a second data point disagreed with the first; on one entity it was invisible.

Fixing the ruler also shifted every distance in the suite by a consistent factor of 0.75, so the
M7 floor moved from 0.25 to 0.19. That is the same claim restated in the corrected units, not a
lowered bar — the engine did not change at all.

## Must-see: a film pinned regardless of taste, and what that actually costs

`must_see` on an entity–film pair guarantees the film a slot no matter what the quiz says — Blue
Velvet and Mulholland Drive appear in every one of Lynch's 108 grid profiles, including a
three-film "keep me oriented" path that would otherwise never touch either. "No matter what" is
scoped precisely: it beats every taste answer, but never a content exclusion or the seen set. A
must-see containing something a viewer excluded still doesn't appear — the same rule the engine
has enforced since prerequisites were designed in Phase 2, extended to a new mechanism rather than
carved an exception into.

**The first version of this broke the product it was added to.** Pinning uncapped sent 8 of 20
entities' openers above 55% concentration and killed the register question for 11 — every pinned
film is a slot the quiz no longer controls, and the films worth marking essential are usually
already an entity's highest-scoring work by every measure the engine uses, so guaranteeing them
amplified a dominance that was often already there. Two corrections, in order:

1. **Membership is pinned, position is not.** A must-see doesn't have to open the path; sequencing
   still places it by curve fit. Where a dominant opener *is* the pinned film — Cléo from 5 to 7
   for Varda, Ali: Fear Eats the Soul for Fassbinder — that's the same "a right answer can be
   common" result documented above for M2, and those entities are exempted from the concentration
   count rather than penalised for it.
2. **At most two must-sees per entity, enforced by the validator.** `tools/validate.mjs` rejects
   more than `MIN_DEPTH − 1` — a third pin at the smallest three-film depth would starve the
   quiz entirely, which is what a probe file with three confirms: *"only 2 of them a slot"*. Most
   entities carry one. Where two clearly cost too much — Ghibli's third pin, Mifune's third,
   several directors' second — they were reduced individually, checked against the actual
   register-sensitivity numbers rather than a guess.

**What's left is real and it's measured, not asserted away.** Rerunning the identical 108-profile
grid with every `must_see` flag stripped, per entity, and averaging: pinning reduces taste-only
path distance by a consistent ratio of **0.79** across the roster (0.202 with pins active against
0.254 without; per-entity ratios ranged 0.63–0.95, so this is a distribution, not one outlier). The
existing M7 floor was itself a rescale — 0.25 to 0.19 — from the RBO-normalisation fix earlier in
this document. Compounding both measured corrections onto the original claim, `0.25 × 0.75 × 0.79
≈ 0.15`, is what the floor is now: two independent, separately measured costs to the same number,
not a threshold nudged until a run went green.

## The index page separates what it lists, and search doesn't merge it back together

The roster used to be one flat list under "Filmmakers" that happened to also contain three
distributors and a Japanese leading man from 1954. The index now groups into three sections —
Directors, Actors, Studios — each its own heading and its own `<ul>`, and every entity page carries
a visible kind label between the breadcrumb and its name, so the kind is legible even reached from
a search result rather than from its own section.

Search is the same progressive-enhancement shape as the quiz: a JSON payload embedded at build
time, a hidden box revealed by script, filtered entirely client-side over 21 entities and 241
films — nothing here needs an index structure more complex than an array. It matches entities by
name or blurb and films by title, and it deliberately returns **one row per (film, entity) pair**
rather than deduplicating by film — Wild at Heart is a Lynch film and a Cage performance, and
searching it correctly surfaces both, linked to the entity each belongs to. Without JavaScript the
search box is simply absent; the three full rosters beneath it already list everything, so nothing
is lost, only the shortcut.

## The anchor rubric

Every subjective tag is 1–5 and every one of them will drift. One person tagging 200 films over
months slides half a point per axis without noticing, and the spread metrics decay silently behind
them. So the scale points are pinned to named films here, and this table is the reference of record
— when a tag and this table disagree, the table wins or the table changes.

Films outside our roster are used as anchors on purpose: they are landmarks everyone can picture.

### `opacity` — how much goes unexplained *(absorbs ambiguity and formalism)*

| | | anchors |
|---|---|---|
| 1 | everything is explained | *The Elephant Man* · *Jaws* |
| 2 | slight ambiguity, resolvable on one viewing | *Blue Velvet* · *No Country for Old Men* |
| 3 | deliberate gaps; a rewatch pays | *The Shining* · *Under the Skin* |
| 4 | narrative logic bends; several readings intended | *Last Year at Marienbad* · *Picnic at Hanging Rock* |
| 5 | dream logic; no stable reading exists | *Inland Empire* · *Eraserhead* |

### `stillness` — **5 is the most still.** Duration and contemplation, not length

Long and slow are different burdens. Runtime is already stored and penalised separately, so this
axis is purely about tempo.

| | | anchors |
|---|---|---|
| 1 | relentless momentum | *Mad Max: Fury Road* · *Uncut Gems* |
| 2 | conventional pacing | *Blue Velvet* · *The Silence of the Lambs* |
| 3 | measured; lingers | *There Will Be Blood* · *The Shining* |
| 4 | slow and contemplative | *Stalker* · *Eraserhead* |
| 5 | duration is the subject | *Jeanne Dielman* · *Sátántangó* |

### `bleakness` — worldview and ending, **never depicted content**

Kept clear of the content flags on purpose: *Come and See* is accessible and annihilating, while
*Marienbad* is difficult and not bleak at all. Conflating the two collapses a useful axis.

| | | anchors |
|---|---|---|
| 1 | warm, affirming | *My Neighbor Totoro* · *The Straight Story* |
| 2 | bittersweet, finally hopeful | *Cinema Paradiso* |
| 3 | ambivalent; offers no comfort | *Lost in Translation* |
| 4 | the world is hostile, relief is scarce | *Chinatown* · *Blue Velvet* |
| 5 | annihilating | *Come and See* · *Salò* |

### `humor` — the axis that is deliberately *not* about difficulty

Every other tag measures some form of demand on the viewer, which is why they correlate and why a
quiz built on them alone collapses to a single difficulty slider. This one breaks that. "The funny
Kubrick path" and "the dread path" are a real distinction no difficulty axis can express.

| | | anchors |
|---|---|---|
| 1 | none whatsoever | *Come and See* · *Jeanne Dielman* |
| 2 | occasional dark levity | *Eraserhead* · *Lost Highway* |
| 3 | genuinely funny in places | *Fargo* · *Mulholland Drive* |
| 4 | comic register throughout | *Dr. Strangelove* · *Wild at Heart* |
| 5 | comedy is the point | *Playtime* · *Airplane!* |

### Pair-level tags — these live on the entity–film relationship, not the film

**`signature` 1–5** — how strongly this film exemplifies *this particular* entity. It measures
typicality, not quality. For Lynch: *Dune* is 1, *The Elephant Man* is 2, *Mulholland Drive* is 5.
The same film scores differently for a different entity — *Mulholland Drive* is a 5 for Lynch and a
3 for Naomi Watts, which is exactly why one film table can serve directors, actors and studios.

**`gateway` 0–5** — fitness as someone's *first* film by this entity. **0 means never open here**,
which is why no separate `never_first` list exists. Note that this is not the same as "easy to
watch": *Dune* is an easy watch and a catastrophic first Lynch, so it scores gateway 0.

**`acclaim` 0–1** is data-derived and never hand-tagged. Tagging budget is scarce and belongs where
data cannot reach. Kept separate from `signature` because "best first" must not silently mean "most
characteristic first" — and because the two together isolate *the anomaly*: low signature, high
acclaim, the cell that holds *The Straight Story*. That cell is most of the reason a cinephile site
deserves to exist.

## Design notes

### The quiz runs the same module the build ran

`src/ui/quiz.js` imports `../core/path.js`. So does `build.js`. Not a port of it, not a
reimplementation for the client — the same file, copied to `dist/core/` and loaded over native
ESM. There is no second copy of the ranking rules to drift away from the first, which is the
entire reason `src/core/` is kept pure.

The page answers the question before any of that runs. The house pick is in the HTML, the quiz
form ships with `hidden` set, and the script removes it. Without JavaScript a visitor gets a
complete curated order rather than a form with nothing behind it — and 12KB of the entity page
survives having every `<script>` stripped, which CI asserts.

A finished path is in the URL: answers as digits, the seen set as a bitmask, exclusions as
another. Reloading a shared link reproduces the same path byte for byte and restores the form
controls to match it. Content exclusions travel too — a link that dropped them would show the
recipient exactly what the sender had excluded.

### src/core/ is pure, and a test enforces it

The core modules run in two environments: under Node inside `build.js`, to render the crawlable
house-pick HTML, and in the browser over native ESM, to recompute a path once someone finishes the
quiz. Both callers import *the same files* — there is no bundler and no build step between them.

That is only safe while core stays free of `node:` imports, DOM references, and dependencies. There
is no type checker here to notice a violation, and a violation fails at runtime in whichever
environment we tested less, so `test/structure.test.js` asserts it directly.

### No bundler, no framework, one devDependency

The engine has to be pure anyway. Once it is, the browser can import it unchanged over native ESM,
which removes the reason to run a bundler at all. `yaml` is the only dependency and it is
build-time only — Node ships no YAML parser, and the corpus has to be YAML rather than JSON
because **the comments are part of the tagging work**: a tag without a recorded reason is a number
nobody can audit six months later.

### Why the corpus is YAML and the engine is JavaScript

Tagging is the expensive part of this project and the part most likely to rot. It gets the format
that is pleasant to edit by hand. Everything else follows the house conventions used in
`Tab-Closer` and `Lint`: plain ESM JavaScript, `node --test`, no ESLint, no Prettier, and build
scripts written by hand rather than configured.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

Film metadata and poster art are also sourced from the OMDb API (omdbapi.com), which itself draws
on IMDb data — used while a TMDB key was pending application approval.
