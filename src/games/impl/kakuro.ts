import { GameContext, GameInstance } from "../../core/types";
import { GameTimer } from "../../core/timer";
import { formatTime, recordLoss, recordStart, recordWin } from "../../core/stats";
import { load, remove, save } from "../../core/storage";
import { sfx } from "../../core/sound";

// ---------------------------------------------------------------------------
// Generator and solver. Patterns are built so every white cell sits in an
// across run and a down run of 2+ cells; digits are filled with a lean toward
// extreme sums, then repaired until the solver finds exactly one solution.

interface Run {
  cells: number[];
  sum: number;
  clue: number; // index of clue cell
  dir: "a" | "d";
}

interface Puzzle {
  rows: number;
  cols: number;
  white: boolean[];
  solution: number[];
  runs: Run[];
}

const BIAS_NOISE = 3;
const SOLVE_BUDGET = 20000;
const POP: number[] = [];
const SUMM: number[] = [];
for (let m = 0; m < 512; m++) {
  let p = 0;
  let s = 0;
  for (let d = 0; d < 9; d++)
    if (m & (1 << d)) {
      p++;
      s += d + 1;
    }
  POP.push(p);
  SUMM.push(s);
}
const COMBOS = new Map<string, number[]>();
for (let m = 1; m < 512; m++) {
  const k = `${POP[m]}:${SUMM[m]}`;
  if (!COMBOS.has(k)) COMBOS.set(k, []);
  COMBOS.get(k)!.push(m);
}

function makePattern(rows: number, cols: number, rng: () => number, maxRun: number): boolean[] | null {
  const n = rows * cols;
  const white = Array(n).fill(false);
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) white[r * cols + c] = true;
  const at = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && white[r * cols + c];
  const runLen = (r: number, c: number, dr: number, dc: number) => {
    if (!at(r, c)) return 0;
    let len = 1;
    for (let k = 1; at(r + dr * k, c + dc * k); k++) len++;
    for (let k = 1; at(r - dr * k, c - dc * k); k++) len++;
    return len;
  };
  const partner = (i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return (rows - r) * cols + (cols - c);
  };
  /** Blacken i (and its mirror) unless that would leave a one-cell run. */
  const tryBlack = (i: number): boolean => {
    const set = [...new Set([i, partner(i)])];
    if (set.some((j) => !white[j])) return false;
    set.forEach((j) => (white[j] = false));
    for (const j of set) {
      const r = Math.floor(j / cols);
      const c = j % cols;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (!at(nr, nc)) continue;
        if (runLen(nr, nc, 0, 1) === 1 || runLen(nr, nc, 1, 0) === 1) {
          set.forEach((x) => (white[x] = true));
          return false;
        }
      }
    }
    return true;
  };
  const interior = rows - 1;
  const target = Math.round(interior * (cols - 1) * (0.1 + rng() * 0.08));
  let placed = 0;
  for (let t = 0; t < 400 && placed < target; t++) {
    const i = (1 + Math.floor(rng() * (rows - 1))) * cols + 1 + Math.floor(rng() * (cols - 1));
    if (tryBlack(i)) placed += 2;
  }
  // Break runs longer than maxRun.
  for (let pass = 0; pass < 40; pass++) {
    let long: number[] | null = null;
    for (let r = 1; r < rows && !long; r++)
      for (let c = 1; c < cols && !long; c++) {
        if (!at(r, c)) continue;
        if (!at(r, c - 1) && runLen(r, c, 0, 1) > maxRun) {
          long = [];
          for (let k = c; at(r, k); k++) long.push(r * cols + k);
        } else if (!at(r - 1, c) && runLen(r, c, 1, 0) > maxRun) {
          long = [];
          for (let k = r; at(k, c); k++) long.push(k * cols + c);
        }
      }
    if (!long) break;
    const options = long.slice(2, -2).sort(() => rng() - 0.5);
    if (!options.some((i) => tryBlack(i))) return null;
  }
  // Every white cell needs a run of 2+ both ways, and all whites must connect.
  const whites = white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  for (const i of whites) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (runLen(r, c, 0, 1) < 2 || runLen(r, c, 1, 0) < 2 || runLen(r, c, 0, 1) > maxRun || runLen(r, c, 1, 0) > maxRun) return null;
  }
  const seen = new Set([whites[0]]);
  const stack = [whites[0]];
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / cols);
    const c = i % cols;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(r + dr, c + dc)) {
        const j = (r + dr) * cols + c + dc;
        if (!seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
  }
  if (seen.size !== whites.length) return null;
  return white;
}

function findRuns(rows: number, cols: number, white: boolean[]): Run[] {
  const runs: Run[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (white[i]) continue;
      if (c + 1 < cols && white[i + 1]) {
        const cells: number[] = [];
        for (let k = c + 1; k < cols && white[r * cols + k]; k++) cells.push(r * cols + k);
        runs.push({ cells, sum: 0, clue: i, dir: "a" });
      }
      if (r + 1 < rows && white[i + cols]) {
        const cells: number[] = [];
        for (let k = r + 1; k < rows && white[k * cols + c]; k++) cells.push(k * cols + c);
        runs.push({ cells, sum: 0, clue: i, dir: "d" });
      }
    }
  return runs;
}

function fill(n: number, white: boolean[], runsOf: number[][], runs: Run[], rng: () => number): number[] | null {
  const vals = Array(n).fill(0);
  // Each run leans low or high; sums near the extremes have few digit combos, which makes unique puzzles likelier.
  const lean = runs.map(() => (rng() < 0.5 ? -1 : 1));
  const order = white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  let nodes = 0;
  const rec = (k: number): boolean => {
    if (k === order.length) return true;
    if (++nodes > 20000) return false;
    const i = order[k];
    let used = 0;
    for (const ri of runsOf[i]) for (const j of runs[ri].cells) if (vals[j]) used |= 1 << (vals[j] - 1);
    const l = runsOf[i].reduce((a, ri) => a + lean[ri], 0);
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .filter((d) => !(used & (1 << (d - 1))))
      .map((d) => ({ d, k: (l === 0 ? 0 : l > 0 ? -d : d) + rng() * BIAS_NOISE }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.d);
    for (const d of digits) {
      vals[i] = d;
      if (rec(k + 1)) return true;
    }
    vals[i] = 0;
    return false;
  };
  return rec(0) ? vals : null;
}

/** Count solutions up to `limit` (returns `limit` when the node budget runs out). */
function countSolutions(n: number, white: boolean[], runs: Run[], runsOf: number[][], limit = 2, budget = 60000, out?: number[][]): number {
  const vals = Array(n).fill(0);
  const cells = white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  const used = runs.map(() => 0);
  const partial = runs.map(() => 0);
  const filled = runs.map(() => 0);
  const runMask = runs.map(() => 0);
  const cand = Array(n).fill(0);
  let nodes = 0;
  let found = 0;
  /** Narrow each run's digit set and each cell's candidates. Returns false on contradiction. */
  const propagate = (): boolean => {
    for (let ri = 0; ri < runs.length; ri++) {
      const list = COMBOS.get(`${runs[ri].cells.length - filled[ri]}:${runs[ri].sum - partial[ri]}`);
      let m = 0;
      if (list) for (const c of list) if (!(c & used[ri])) m |= c;
      if (!m && filled[ri] < runs[ri].cells.length) return false;
      runMask[ri] = m;
    }
    for (let round = 0; round < 3; round++) {
      for (const i of cells) {
        if (vals[i]) continue;
        cand[i] = runMask[runsOf[i][0]] & runMask[runsOf[i][1]];
        if (!cand[i]) return false;
      }
      let changed = false;
      for (let ri = 0; ri < runs.length; ri++) {
        const remain = runs[ri].cells.length - filled[ri];
        if (!remain) continue;
        const list = COMBOS.get(`${remain}:${runs[ri].sum - partial[ri]}`)!;
        let m = 0;
        for (const c of list) {
          if (c & used[ri]) continue;
          let ok = true;
          let cover = 0;
          for (const j of runs[ri].cells) {
            if (vals[j]) continue;
            if (!(cand[j] & c)) {
              ok = false;
              break;
            }
            cover |= cand[j] & c;
          }
          if (ok && cover === c) m |= c;
        }
        if (!m) return false;
        if (m !== runMask[ri]) {
          runMask[ri] = m;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return true;
  };
  const rec = (): boolean => {
    if (++nodes > budget) {
      found = limit;
      return true;
    }
    if (!propagate()) return false;
    let best = -1;
    let bestCount = 99;
    for (const i of cells) {
      if (vals[i]) continue;
      const p = POP[cand[i]];
      if (p < bestCount) {
        best = i;
        bestCount = p;
        if (p === 1) break;
      }
    }
    if (best < 0) {
      found++;
      out?.push(vals.slice());
      return found >= limit;
    }
    const mask = cand[best];
    for (let d = 1; d <= 9; d++) {
      if (!(mask & (1 << (d - 1)))) continue;
      vals[best] = d;
      for (const ri of runsOf[best]) {
        used[ri] |= 1 << (d - 1);
        filled[ri]++;
        partial[ri] += d;
      }
      const stop = rec();
      for (const ri of runsOf[best]) {
        used[ri] &= ~(1 << (d - 1));
        filled[ri]--;
        partial[ri] -= d;
      }
      vals[best] = 0;
      if (stop) return true;
    }
    return false;
  };
  rec();
  return found;
}

function generate(rows: number, cols: number, rng: () => number = Math.random, maxRun = 5, timeLimit = 900): Puzzle | null {
  const n = rows * cols;
  const t0 = performance.now();
  for (let attempt = 0; attempt < 200; attempt++) {
    const white = makePattern(rows, cols, rng, maxRun);
    if (!white) continue;
    const runs = findRuns(rows, cols, white);
    const runsOf: number[][] = Array.from({ length: n }, () => []);
    runs.forEach((run, ri) => run.cells.forEach((i) => runsOf[i].push(ri)));
    const sol = fill(n, white, runsOf, runs, rng);
    if (!sol) continue;
    // Repair: while a second solution exists, change one cell where they differ.
    for (let step = 0; step < 60; step++) {
      runs.forEach((run) => (run.sum = run.cells.reduce((a, i) => a + sol[i], 0)));
      const sols: number[][] = [];
      const count = countSolutions(n, white, runs, runsOf, 2, SOLVE_BUDGET, sols);
      if (count === 1) return { rows, cols, white, solution: sol.slice(), runs: runs.map((r) => ({ ...r })) };
      const alt = sols.find((v) => v.some((d, i) => d !== sol[i]));
      const diff = alt ? sol.map((d, i) => (white[i] && d !== alt[i] ? i : -1)).filter((i) => i >= 0) : white.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
      const i = diff[Math.floor(rng() * diff.length)];
      let used = 0;
      for (const ri of runsOf[i]) for (const j of runs[ri].cells) if (j !== i) used |= 1 << (sol[j] - 1);
      const options = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== sol[i] && !(used & (1 << (d - 1))) && (!alt || d !== alt[i]));
      if (!options.length) break;
      // Prefer the digit that leaves its runs with the fewest digit combinations.
      const combos = (ri: number, d: number) => {
        const sum = runs[ri].cells.reduce((a, j) => a + (j === i ? d : sol[j]), 0);
        return COMBOS.get(`${runs[ri].cells.length}:${sum}`)?.length ?? 99;
      };
      const scored = options.map((d) => ({ d, k: combos(runsOf[i][0], d) * combos(runsOf[i][1], d) + rng() * 2 }));
      scored.sort((x, y) => x.k - y.k);
      sol[i] = scored[0].d;
    }
    if (performance.now() - t0 > timeLimit) break;
  }
  return null;
}

/** Generated with the code above and verified to have exactly one solution each. '#' marks a clue/block cell. */
const BANK: Record<"medium" | "large", string[]> = {
  medium: [
    "##########7926##12#57123#95#12#12346#241#51#####24#431#17324#12#96#12543#79##1428",
    "##########2589#125#3164#318###482#39##95#4967#6839#84##12#785###375#9758#251#7314",
    "##########17#3152##79#83917##351##38###89#879#163#73###47##315##32148#21##4389#83",
    "##########2941#13##1764#986###923#12#125#5324#2689#451#69#839###532#5897##79#7689",
    "##########96#31#92#82#93871#751#69###63215#12#41#24561###13#985#87653#96#91#72#53",
    "##########46#1785##97#78965#58729#97##95#51#####81#27##67#21346#98734#12##9142#59",
    "##########231#152##183#3978#49587#97###89#13###92#72###98#19324#2794#412##673#876",
    "##########21#16#26#13#48937#4276#315###231#49#79#759###241#2815#86729#21#98#13#97",
    "##########123##479#512#9125###16324##89674#39#72#86914##87956###7613#142#972##589",
    "##########137##98##389#1798#21463#79###62#137#183#13###29#13642#8697#214##47##867",
    "##########21#9867##14#86743##3179#51###25#897#486#16###14#9378##29174#98##7986#69",
    "##########12658#42#46987#21###81#135#79#71864#16243#13#371#21###98#56412#25#94827",
    "##########93#9814##81#5231##7213##28###87#839#964#24###84##7193##5134#82##7241#41",
    "##########91#79835#62#67924#8512##68###782#12#89#947###58##3927#24391#98#47986#15",
    "###########245#412#8379#948#97#786###51##2314#7698##36###241#29#145#4978#231#214#",
    "##########421###87#8967#796###89#132#68259#79#41#87963#321#16###946#8596#13###839",
    "##########8197#29##5789#871#95#24135##43#13#####13#45##16243#86#697#5679##25#1294",
    "##########8234##89#9783#124#51#12347#631#19#####21#279#12345#82#246#8957#31##6845",
    "##########8397##31#52897#23#79##5942#95#124#####539#12#6124##41#74#28134#86##1253",
    "##########13#85#89#21543#12###912#97#726#1365#9387#124#89#214###31#45826#68#32#13",
    "###########985#938#2351#619#12#348###56##1329#3512##67###419#31#937#7958#713#571#",
    "##########798##389#9845#278###795#37##89#8795#1952#42##31#123###253#1293#571##172",
    "###########892#197#5213#589#97#132###241#1342#8946#651###251#96#793#2174#156#478#",
    "##########1973##97#3597#231##78#93###13576#12#98#28634###98#94##124#9862#38##6721",
    "##########9487#412#3271#539#73##21###85#3698###1623#95###21##41#127#9876#318#7958",
    "##########48#94678#31#56789#127#12###26935#24#67#98746###21#958#85379#12#32148#31",
    "##########89#79486#97#37261#52413#72#689#65#####31#986#15#27351#21348#32#34152#43",
    "###########492#896#5321#479#26##19###92#12364#81346#92###12##51#986#6985#162#573#",
    "##########798#967##659#7926###476#13#3879#152#135#1234#76#235###2935#749##721#968",
    "##########73#95#89#98172#12###23#123#82#89347#94867#38#687#52###79#18324#51#46#51",
    "##########43#1234##21#94587#86579#32#948#73#####61#976#29#98765#68479#59##5126#98",
    "###########41#6312#972#1723#13#958###6987#61###51#7938###983#26#8975#987#2734#74#",
    "###########13#152##324#2134#26534#17###21#64###81#21###79#56498#6792#267##681#38#",
    "###########251#13##1394#218#59#21349#389#34#####12#718#16452#25#596#1243##85#315#",
    "##########298##421#1532#932#78#1234##369#16#####81#796##1624#62#287#2841#125##987",
    "##########7196##15#9785#537##47#19###12349#79#53#16453###95#39##976#4135#59##3289",
    "#############81964#21#72589#95746#97##29#41#####68#21##79#91638#16573#24#28965###",
    "##########13#159###98#23614#6985##21###93125###24631###15##6479#38495#58###879#13",
    "############896#86#18275#79#897#7458#23#489#####413#92#4975#974#97#39781#86#851##",
    "##########231#125##416#6879###21##15#92547#98#21#31547#35##21###7435#698##321#361",
    "###########9847#21#98615#52#47##3465#857#12#####98#927#1325##39#29#12346#48#9687#",
    "##########1235##95#2849#182#31##15###79#12473#53124#42###93##84#798#1265#15##3897",
    "##########1358##51#3579#968##69#25###12879#98#31#98765###12#57##398#9287#13##8129",
    "##########79##6142#98#15394##785##85###97#271#123#27###95##162##74956#76#5132##12",
    "##########84#892###63#5839##91576#65###89#381#139#85###29#13248##7859#14###967#89",
    "##########6598#978#1374#214#89##14###78#83196#47895#24###23##32#936#8965#713#4513",
    "###########6192#21#21357#43#34##8975#159#42#####79#198#2647##59#98#61235#79#8596#",
    "###########412#896#1536#178#276#49###89#1238###2153#12###27#968#957#1253#413#379#",
    "##########4915#839#2543#917##12#15###72#12673#98374#97###49#84##831#9631#975#5987",
    "###########3124#93##6598#31#9487#672#71#612#####689#13#412#4825#98#4795##72#1253#",
    "###########152#124#5798#578#23#978###34##3614#1562##67###135#39#172#1426#497#895#",
    "##########281#958##697#1362###21##31#58936#53#34#29374#15##87###2143#975##968#896",
    "###########98#2816#679#1239#21#531####613#72###43#261####241#32#5968#958#3651#74#",
    "##########586#1264#978#3182###98##96#92536#71#67#18243#79##13###4389#598#3152#142",
    "##########142#4123#431#9816#29#182####596#38###67#941####418#29#9486#135#4152#798",
    "############13#593##461#182##12#84###69#52316#48796#68###98#79##978#195##896#31##",
    "##########84#1253##71#61382##3625#56###93#398#498#12###12#4615##34812#13##6937#24",
    "###########978#965#8497#124#96##42###57#89573#15472#21###89##87#697#6142#986#849#",
    "##########4139##69#82479#16####1235##3125#821#948#6942##7695####95#82153#42##9874",
    "##########52##251##413#1789#9586#142#13#374#####415#96#719#1342#9685#123##214##71",
  ],
  large: [
    "############938#49##81#416#13#598###51#85762#24#39214###12357##127#315##91243###71342#12#91637#48###241#21#987#12##53#146",
    "#############13#13##13#738#26#521#12793#38#####65#41235#76#839#698#987#129#13#62135#82#####21#57689#213#68#132#96##79#39#",
    "############18#236#13##56#124#26##25136#1324#692#139#18###39#56987#13542#31###84#749#798#2136#89637##21#876#43##89#124#79",
    "############89#896#298#32#421#687#2531##98#####72863#93##19#596#32#29#124#98##18#34817#####97##6892#876#623#89#987#412#64",
    "############87213#9316#96784#6128###13#98#59#1234#137###69#213#986#285#649#79###284#5794#94#62#13###6895#93618#8579#84957",
    "############13#96#124##81375#9375#421#148#52#67#1723#31###978##594#126##218###98#2698#59#79#498#198#8671#79386##795#67#24",
    "#############97#58#769##78126#938#9864#94#12#85#29#1354###4382#123#123#7385###4526#59#12#89#12#2135#271#54726##384#19#67#",
    "##############42#97468#9863#73216#79#1624#89##52#5123###179##51249#26798##126###8597#56##79#1628#12#12634#3451#31547#97##",
    "############189##9586##8975#72586#25#678##98#476#132#79###182#1235#4135#346###13#241#371#25##964#12#57162#8793##4321##125",
    "############598#89#284#321#97#891###314#93####753#87496#96##61#179#792#12##57#68125#916####59#423###397#72#214#184#98#521",
    "############876#79##89#987#18#978###82#32854#17965#87###39#986#45###41#712#12###98#91265#96758#89###798#53#718#48##97#421",
    "#############94#81#123#986#62#561#27#59#241##4138#68297###1623##81#12##1234###96843#8124##421#39#16#879#61#968#314#92#64#",
    "############213#498#32#142#172#21###13#8314##29713#94###869#215#39#97#142#917###24#53428##7859#75###38#689#869#14#325#697",
    "#############251###461#16895#1523#59#2413#12#241#67#15##3857#897#####984#8697##98#19#273#14#1269#89#2876#87965#379###431#",
    "#############231#89#93#4985#27984#98#215#731#14##318#12###982#527###584#291###89#361##29#579#741#12#94738#2138#68#79#796#",
    "############6793#13#61#3145#21843#14#213#982#52#7251#94##37###37#####21###31##14#3297#89#735#689#97#62154#8975#21#13#5846",
    "############42#895##97#14#152#978#3175#132#####94##1362#21#213#123#623#519#98#1342##79#####213#8759#496#134#97#87##816#38",
    "############17#4912#97#28#1325#84##987##125####12#134###325#594#15#51#397#123###598#87####698##235##93#7489#42#81#6897#21",
    "############45892#98###86974#674##61##12#621#94#7912#13###985#9857#4986#987###98#9127#12#215#38##89##769#61245###98#73958",
    "############97#972#59##72#896#123##126##3286#134#261#31#658#5986#####5917#794#84#145#241#6314##987##987#175#34##12#298#89",
    "############234#51##97#312#94#132###193#12###5687#19486#12##948#93#98#986##51#79486#9832###21#146###218#92#986#53##73#732",
    "#############913#12364#1825#49687#34##867#79#26145##82##67259#49#####59#46798##98##21634#98#293##27#76158#3869#64213#197#",
    "##############13#1623##1425#38176#53#12###89#316#15#948###91#7986###9857#83###534#64#165#98###81#97#87192#6578##5361#21##",
    "############84#13#1742#12574#3917##598#84#51#21##87#12##68957#16#####76#92861##98#96##32#97#78#271##2618#95876#1839#61#21",
    "############1483##9251#48975#8975#97#172#48####28#123###347#791#31#12#326#395###659#31####97#459#95#1827#36241#8749##1432",
    "############68#2871#19#89#1253#27#5693###34####769#91###946#217#29#41#983#958###45#251####19###9458#32#1534#19#97#3428#36",
    "############68##612#49#89#7965#13#97268#152##3514##6759###5134##98#31##1234###9721##2978##213#91854#98#2854#96#13#897##89",
    "############812#39#681#985#17#973###71#657###7943##152##981#612#19#46#198#132##472##1798###147#36###879#81#892#136#92#251",
    "############89#973#986#93#896#769#6894##86#####87956#83##26#789#97#13#186#16##21#26983#####87##7218#142#986#21#986#632#49",
    "############28#597#97##31#689#142#1534#31427###134#98###876#968#21#65#879#987###13#896###24813#8729#134#415#97##15#976#18",
    "############98764#869##36215#9578##71#97#146###31#134###1243#21#81#31#29#7894###248#91###879#59#98##6489#28493##172#89276",
    "##############43#1534##1526#89654#62##79#132#317#324#13##3971#72#####59#5968##12#321#157#231#97##79#87213#1235##9857#34##",
    "############61#135#124#97#214#578#89746#27####897#94#32###8596#893#123#7516###37#68#698####93#95764#278#142#95#124#983#12",
    "############31##35#587#896#19#869###589#16###9317#35796#79#946##89#57##218#78#41368#4132###14#694###897#25#984#689#79##31",
    "############513#579#13#421#123#34#63412#1246###89#289###956#916#94#78#973#152###986#12###4356#92351#21#218#412#14#756#789",
    "############689#895#48#214#541#23###7128#25##9824#783###1253#59#92#31#72#7684###153#6153##72#1234###14#147#731#89#679#214",
    "############897#12#78##182#41#351###123#1423#6231#125###89#913#284#769#256#12###698#9561#8436#589###985#43#498##94#21#679",
    "############6134#13625#9857#38947#82#93#17#####132#789##712#125#31#98#267#174##386#126#####91#41#13#98257#3527#16432#5639",
    "############97#421#985#71#897#291#8217##48#####968#149##97##172#89#86#329##76##149#869#####15##1273#975#912#97#897#864#51",
    "############931##54#91#7534#98762#62#13#38###51#946#251###5362#986#142#9156###594#849#21###15#37#13#79681#8769#58#97##142",
    "############26##16#612#45#149#928#1392##17#####638#2879#21##913#48#46#962##96#1326#361#####78##4216#715#592#32#621#78##21",
    "############79#98#9864#96387#2613#812#614#32#62#792##25###89##8496#6142##92###42##985#14#86#162#125#9376#48739#5492#97#48",
    "############61524#21###94758#7251#82##98##32###9576#18##9781#97368#58643#8596##97#2398###45##98##13#9638#98756###79#16325",
    "#############513#59#15##958#16#27#23#91#7539#182#83#143###49#13258#94687#13###873#89#483#6813#85#91#56#12#297##79#41#124#",
    "############58##62#896#79#893#762#12938#79#####21#24657#137#879#89#21#496#213#42975#14#####89#32147#137#183#16#896#69##39",
    "############968#39#386#435#27#597###93#217###9871##2957#59#275#613#879#981#89#3689##2135###349#32###895#89#697#421#78#312",
    "#############13#12#91###21346#821#84#59#6432#2631#58#46#351#4978#####7918#721#12#23#8976#2381#25#98#769#21384###12#14#43#",
    "############15#6719#84#89#9128#32#46583#139###81#51#879###31#27#58#19#24#91###239#91#38###879#24517#95#5138#46#76#8269#31",
    "############13#12##579#24#74#4267#78236#97#####46#21349#31#241#127#928#638#38#53427#12#####31#43721#5394#89#94#126##96#86",
    "############57986##12##13462#4965#79##492#31#269#13#412###89#85947#14652#47###267#89#869#98#896##98#8769#81427##92##73216",
  ],
};

// ---------------------------------------------------------------------------
// Puzzle sources: small boards are generated live; medium and large come from
// a bank of generated, solver-verified puzzles, shown under a random symmetry
// and possibly with every digit d swapped for 10 − d (both keep the solution unique).

const SIZES: Record<string, number> = { small: 7, medium: 9, large: 11 };

function fromBankString(str: string, size: number): { white: boolean[]; solution: number[] } {
  const white = [...str].map((ch) => ch !== "#");
  const solution = [...str].map((ch) => (ch === "#" ? 0 : Number(ch)));
  // Transform the interior (everything but the clue row and column).
  const m = size - 1;
  const t = Math.floor(Math.random() * 8);
  const flip = Math.random() < 0.5;
  const outW = Array(size * size).fill(false);
  const outS = Array(size * size).fill(0);
  for (let r = 0; r < m; r++)
    for (let c = 0; c < m; c++) {
      let rr = r;
      let cc = c;
      if (t & 1) [rr, cc] = [cc, rr];
      if (t & 2) rr = m - 1 - rr;
      if (t & 4) cc = m - 1 - cc;
      const from = (r + 1) * size + c + 1;
      const to = (rr + 1) * size + cc + 1;
      outW[to] = white[from];
      outS[to] = white[from] ? (flip ? 10 - solution[from] : solution[from]) : 0;
    }
  return { white: outW, solution: outS };
}

function makePuzzle(level: string): Puzzle {
  const size = SIZES[level];
  if (level === "small") {
    for (let k = 0; k < 20; k++) {
      const p = generate(size, size, Math.random, 4, 400);
      if (p) return p;
    }
  }
  const pick = level === "large" ? "large" : "medium";
  const list = BANK[pick];
  const bsize = SIZES[pick];
  const { white, solution } = fromBankString(list[Math.floor(Math.random() * list.length)], bsize);
  const runs = findRuns(bsize, bsize, white);
  runs.forEach((run) => (run.sum = run.cells.reduce((a, i) => a + solution[i], 0)));
  return { rows: bsize, cols: bsize, white, solution, runs };
}

/** Digit combos for a run as text, e.g. "1 3 9 · 2 3 8". */
function comboText(len: number, sum: number): string {
  const list = COMBOS.get(`${len}:${sum}`) ?? [];
  const fmt = (m: number) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .filter((d) => m & (1 << (d - 1)))
      .join("");
  if (list.length > 4) return `${list.length} combos`;
  return list.map(fmt).join(" · ");
}

// ---------------------------------------------------------------------------

interface Saved {
  level: string;
  rows: number;
  cols: number;
  white: boolean[];
  solution: number[];
  values: number[];
  notes: number[];
  mistakes: number;
  seconds: number;
  counted: boolean;
}

const SAVE = "save:kakuro";

class Kakuro implements GameInstance {
  private el: HTMLDivElement;
  private gridEl!: HTMLDivElement;
  private padEl!: HTMLDivElement;
  private helpEl!: HTMLDivElement;
  private cellEls: HTMLElement[] = [];
  private level: string;
  private p!: Puzzle;
  private runsOf: number[][] = [];
  private values: number[] = [];
  private notes: number[] = [];
  private mistakes = 0;
  private history: { values: number[]; notes: number[] }[] = [];
  private sel = -1;
  private notesMode = false;
  private timer: GameTimer;
  private over = false;
  private counted = false;
  private resizeObs: ResizeObserver;

  constructor(root: HTMLElement, private ctx: GameContext) {
    this.level = ctx.option("size") in SIZES ? ctx.option("size") : "small";
    this.el = document.createElement("div");
    this.el.className = "kakuro";
    root.appendChild(this.el);
    window.addEventListener("keydown", this.onKey);
    this.timer = new GameTimer(() => this.status());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.el);

    const saved = load<Saved | null>(SAVE, null);
    if (saved && saved.level === this.level && saved.white?.length === saved.rows * saved.cols) {
      const runs = findRuns(saved.rows, saved.cols, saved.white);
      runs.forEach((run) => (run.sum = run.cells.reduce((a, i) => a + saved.solution[i], 0)));
      this.p = { rows: saved.rows, cols: saved.cols, white: saved.white, solution: saved.solution, runs };
      this.values = saved.values;
      this.notes = saved.notes;
      this.mistakes = saved.mistakes;
      this.counted = saved.counted;
      this.timer.reset(saved.seconds);
      this.build();
      this.status();
    } else this.newGame();
  }

  private get key() {
    return `kakuro:${this.level}`;
  }

  newGame() {
    if (this.counted && !this.over) recordLoss(this.key);
    this.p = makePuzzle(this.level);
    const n = this.p.rows * this.p.cols;
    this.values = Array(n).fill(0);
    this.notes = Array(n).fill(0);
    this.mistakes = 0;
    this.history = [];
    this.over = false;
    this.counted = false;
    this.timer.reset();
    this.ctx.clearEnd();
    this.build(true);
    this.persist();
    this.status();
  }

  undo() {
    const h = this.history.pop();
    if (!h || this.over) return;
    this.values = h.values;
    this.notes = h.notes;
    sfx.flip();
    this.paint();
    this.persist();
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.persist();
    this.timer.destroy();
    this.resizeObs.disconnect();
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const wide = r.width > r.height * 1.25;
    this.el.classList.toggle("wide", wide);
    const avail = wide ? Math.min(r.height - 48, r.width - 330) : Math.min(r.width - 40, r.height - 230);
    const cell = Math.floor(avail / this.p.cols);
    this.el.style.setProperty("--k", `${Math.max(26, Math.min(cell, 68))}px`);
  }

  private persist() {
    if (this.over) return remove(SAVE);
    const data: Saved = {
      level: this.level,
      rows: this.p.rows,
      cols: this.p.cols,
      white: this.p.white,
      solution: this.p.solution,
      values: this.values,
      notes: this.notes,
      mistakes: this.mistakes,
      seconds: this.timer.seconds,
      counted: this.counted,
    };
    save(SAVE, data);
  }

  private build(intro = false) {
    const { rows, cols, white, runs } = this.p;
    const n = rows * cols;
    this.runsOf = Array.from({ length: n }, () => []);
    runs.forEach((run, ri) => run.cells.forEach((i) => this.runsOf[i].push(ri)));
    const across: Record<number, number> = {};
    const down: Record<number, number> = {};
    runs.forEach((run) => ((run.dir === "a" ? across : down)[run.clue] = run.sum));

    this.el.innerHTML = `
      <div class="kk-grid" role="grid" aria-label="Kakuro" style="--cols:${cols};--rows:${rows}"></div>
      <div class="kk-side">
        <div class="kk-pad"></div>
        <div class="kk-help" aria-live="polite"></div>
      </div>`;
    this.gridEl = this.el.querySelector(".kk-grid")!;
    this.padEl = this.el.querySelector(".kk-pad")!;
    this.helpEl = this.el.querySelector(".kk-help")!;
    this.cellEls = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      let el: HTMLElement;
      if (white[i]) {
        el = document.createElement("button");
        el.className = "kk-cell";
        el.dataset.i = String(i);
      } else {
        el = document.createElement("div");
        const a = across[i];
        const d = down[i];
        el.className = a || d ? "kk-clue" : "kk-block";
        if (a || d)
          el.innerHTML = `<svg viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="10" y2="10"/></svg>${
            a ? `<span class="kk-a" data-clue="a${i}">${a}</span>` : ""
          }${d ? `<span class="kk-d" data-clue="d${i}">${d}</span>` : ""}`;
      }
      if (intro) {
        el.classList.add("intro");
        el.style.animationDelay = `${(r + c) * 16}ms`;
      }
      this.gridEl.appendChild(el);
      this.cellEls.push(el);
    }
    this.padEl.innerHTML =
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="sdk-key kk-key" data-n="${d}">${d}</button>`).join("") +
      `<button class="sdk-key sdk-tool kk-tool" data-tool="notes" aria-pressed="${this.notesMode}">Notes</button>` +
      `<button class="sdk-key sdk-tool kk-tool" data-tool="erase">Erase</button>`;
    this.gridEl.addEventListener("pointerdown", (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>(".kk-cell");
      if (c) this.select(Number(c.dataset.i));
    });
    this.padEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      if (b.dataset.n) this.enter(Number(b.dataset.n));
      else if (b.dataset.tool === "erase") this.enter(0);
      else if (b.dataset.tool === "notes") this.toggleNotes();
    });
    if (this.sel < 0 || !white[this.sel]) this.sel = white.findIndex(Boolean);
    this.el.classList.toggle("notes-on", this.notesMode);
    this.resize();
    this.paint();
  }

  private select(i: number) {
    this.sel = i;
    this.paint();
  }

  private toggleNotes() {
    this.notesMode = !this.notesMode;
    this.padEl.querySelector('[data-tool="notes"]')!.setAttribute("aria-pressed", String(this.notesMode));
    this.el.classList.toggle("notes-on", this.notesMode);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("select, input") || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) this.enter(Number(k));
    else if (k === "Backspace" || k === "Delete" || k === "0") this.enter(0);
    else if (k === "n" || k === "N") this.toggleNotes();
    else if (k.startsWith("Arrow")) this.move(k);
    else return;
    e.preventDefault();
  };

  /** Move the selection to the next white cell in the arrow's direction, skipping clue cells. */
  private move(k: string) {
    const { rows, cols, white } = this.p;
    const dr = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
    const dc = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
    let r = Math.floor(this.sel / cols);
    let c = this.sel % cols;
    for (let step = 0; step < Math.max(rows, cols); step++) {
      r += dr;
      c += dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) return;
      if (white[r * cols + c]) return this.select(r * cols + c);
    }
  }

  private enter(d: number) {
    const i = this.sel;
    if (this.over || i < 0 || !this.p.white[i]) return;
    const bit = d ? 1 << (d - 1) : 0;
    if (d && this.notesMode && !this.values[i]) {
      this.push();
      this.notes[i] ^= bit;
      sfx.tick();
    } else {
      if (this.values[i] === d && !this.notes[i]) return;
      this.push();
      this.values[i] = this.values[i] === d ? 0 : d;
      this.notes[i] = 0;
      if (this.values[i]) {
        // Clear this digit from notes in both of the cell's runs.
        for (const ri of this.runsOf[i]) for (const j of this.p.runs[ri].cells) this.notes[j] &= ~bit;
        if (this.values[i] !== this.p.solution[i]) this.mistakes++;
        sfx.place();
      }
    }
    if (!this.counted) {
      this.counted = true;
      recordStart(this.key);
    }
    this.timer.start();
    this.paint();
    this.status();
    this.checkWin();
    this.persist();
  }

  private push() {
    this.history.push({ values: this.values.slice(), notes: this.notes.slice() });
    if (this.history.length > 300) this.history.shift();
  }

  private paint() {
    const { white, runs } = this.p;
    const selRuns = this.sel >= 0 ? this.runsOf[this.sel] : [];
    const peers = new Set(selRuns.flatMap((ri) => runs[ri].cells));
    const dupes = new Set<number>();
    runs.forEach((run) => {
      const seen = new Map<number, number>();
      for (const j of run.cells) {
        const v = this.values[j];
        if (!v) continue;
        if (seen.has(v)) {
          dupes.add(j);
          dupes.add(seen.get(v)!);
        } else seen.set(v, j);
      }
      const full = run.cells.every((j) => this.values[j]);
      const total = run.cells.reduce((a, j) => a + this.values[j], 0);
      const clue = this.gridEl.querySelector<HTMLElement>(`[data-clue="${run.dir}${run.clue}"]`);
      clue?.classList.toggle("done", full && total === run.sum);
      clue?.classList.toggle("bad", (full && total !== run.sum) || total > run.sum);
      clue?.classList.toggle("active", selRuns.some((ri) => runs[ri] === run));
    });
    white.forEach((w, i) => {
      if (!w) return;
      const el = this.cellEls[i];
      const v = this.values[i];
      el.classList.toggle("sel", i === this.sel);
      el.classList.toggle("peer", i !== this.sel && peers.has(i));
      el.classList.toggle("wrong", dupes.has(i));
      if (v) el.textContent = String(v);
      else if (this.notes[i])
        el.innerHTML = `<span class="kk-notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9]
          .map((d) => `<i>${this.notes[i] & (1 << (d - 1)) ? d : ""}</i>`)
          .join("")}</span>`;
      else el.textContent = "";
      el.setAttribute("aria-label", `Cell${v ? ` ${v}` : ", empty"}`);
    });
    // Combination helper for the selected cell's runs.
    if (this.sel >= 0 && white[this.sel]) {
      this.helpEl.innerHTML = this.runsOf[this.sel]
        .map((ri) => {
          const run = runs[ri];
          return `<p><b>${run.dir === "a" ? "Across" : "Down"} ${run.sum} in ${run.cells.length}</b><span>${comboText(run.cells.length, run.sum)}</span></p>`;
        })
        .join("");
    }
    this.ctx.setUndo(this.history.length > 0 && !this.over);
  }

  private checkWin() {
    const { white, solution } = this.p;
    if (!white.every((w, i) => !w || this.values[i] === solution[i])) return;
    this.over = true;
    this.timer.stop();
    const secs = Math.round(this.timer.seconds);
    const { newBestTime } = recordWin(this.key, secs);
    remove(SAVE);
    sfx.win();
    this.gridEl.classList.add("solved");
    this.ctx.setUndo(false);
    this.status();
    const m = this.mistakes;
    setTimeout(
      () =>
        this.ctx.end({
          won: true,
          title: "Solved",
          lines: [`${formatTime(secs)}${newBestTime ? " — a new best" : ""}`, m ? `${m} mistake${m > 1 ? "s" : ""}` : "No mistakes"],
        }),
      800,
    );
  }

  private status() {
    this.ctx.setStatus([
      { label: "Mistakes", value: String(this.mistakes) },
      { label: "Time", value: formatTime(this.timer.seconds) },
    ]);
  }
}

export function create(root: HTMLElement, ctx: GameContext): GameInstance {
  return new Kakuro(root, ctx);
}
