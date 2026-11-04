// Builds src/games/words.json from the wordlist-english devDependency.
// Run by hand: node scripts/build-words.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const w = require("wordlist-english");

const BLOCK = new Set(
  "abuse anal anus arse bitch boner boobs booty bosom butts crack crap cunt damn dicks dildo drunk dyke fag fart feces fuck gay gays hell homo horny hooker idiot jerk kill kills killer moron naked nazi negro nude penis pimp piss porn pussy queer rape raped rapes rapist semen sex sexy shit slave slut sperm spunk stupid suck tits turd twat urine vomit whore wank weed wench booze drug drugs bomb bombs death dead die died dies murder gun guns knife blood bloody devil satan beer vodka whisky cocaine heroin lsd suicide corpse".split(
    " ",
  ),
);

const tier = (...names) => names.flatMap((n) => w[`english/${n}`] ?? []);
const clean = (x) => /^[a-z]+$/.test(x) && !BLOCK.has(x);
const uniq = (a) => [...new Set(a)].sort();

const answers = uniq(
  tier(10, 20).filter((x) => x.length === 5 && clean(x) && !(x.endsWith("s") && !x.endsWith("ss"))),
);
const guesses = uniq(tier(10, 20, 35, 40, 50, 55, 60, 70).filter((x) => x.length === 5 && /^[a-z]+$/.test(x)));
const search = uniq(tier(10).filter((x) => x.length >= 4 && x.length <= 8 && clean(x)));

writeFileSync(new URL("../src/games/words.json", import.meta.url), JSON.stringify({ answers, guesses, search }));
console.log(`answers ${answers.length}, guesses ${guesses.length}, search ${search.length}`);
