# WatchOrder

A viewing-order engine for filmographies. Pick a director, answer five questions, get an ordered
path through their work that suits how you actually watch films — beside a single hand-curated
house pick.

Status: **Phase 4 complete — the quiz works and paths are shareable.** The roster is still Lynch
alone; expanding it to fifteen directors is Phase 5.

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

```bash
npm run preview -- david-lynch
```

`preview` prints an entity's path under five contrasting profiles. The spread suite measures
whether paths diverge; `preview` is how you check whether the divergence is any *good*. Both
matter, and they fail in opposite directions — spread is trivially gamed by adding randomness,
which only a human reading the output will catch.

## Where the engine currently stands

Measured on the Lynch corpus, 108 profiles:

| metric | result | gate |
|---|---|---|
| M1 median path distance | 0.673, 2.0% identical | ≥ 0.35 ✓ |
| M2 opener entropy | 1.91 bits, 4 distinct openers, top 38% | ≥ 1.2 bits, ≤ 55% ✓ |
| M4 weakest question | register, mean D 0.359 | ≥ 0.10 ✓ |
| M6 profile-driven share of score variance | **0.618** | ≥ 0.40 ✓ |
| M7 taste-only spread | 0.468, **75% of all spread** | ≥ 0.25, ≥ 40% ✓ |
| M9 best RBO vs house pick | 0.498, set overlap 0.778 | ≥ 0.60 ✗ *(deferred)* |
| M5 invariants, 10k fuzzed profiles | 9879 paths, 121 explicit no-path | 100% ✓ |

M6 is the one that matters most. It says the quiz — not signature, not acclaim — drives 60% of the
variance in a film's score. An earlier draft of this engine would have scored near zero there, and
would have shipped looking fine.

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

### Open: M9 does not pass, and the reason is worth keeping

The engine's closest approach to the hand-written Lynch house pick is RBO 0.498 against a 0.60
gate. Set overlap is 0.778 — eight of nine films agree, and only *The Straight Story* versus *Wild
at Heart* differs.

So the remaining gap is almost entirely **ordering, not membership**, and the orderings that
disagree are both defensible. The engine groups the Twin Peaks material together; the house pick
interleaves it. RBO weights early positions hard (p=0.9), so two reasonable readings of the same
nine films score far apart. Nothing here suggests the schema cannot express a good order — it
expresses a different one, and arguably a better one.

The gate is deferred rather than lowered, and deferred rather than tuned away. Its specification
is "0.60 on at least 70% of entities", which cannot mean anything against a single entity; tuning
weights until one hand-made list is reproduced would fit the engine to one opinion. It becomes a
real gate at Phase 5, when the roster reaches 15 directors.

The same reasoning applies to the tag collinearity gate in `test/data.test.js`. `opacity` and
`bleakness` correlate at 0.792 across the corpus — but the corpus is one auteur, and Lynch's most
opaque films genuinely *are* his bleakest. That is a fact about Lynch rather than a defect in the
schema, so the gate waits for three entities. Meanwhile `humor` correlates with `opacity` at
0.034, which is the whole reason that axis exists.

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
