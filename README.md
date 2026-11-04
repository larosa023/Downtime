<p align="center"><img src="assets/icon.png" width="96" alt="Downtime icon"></p>

<h1 align="center">Downtime</h1>
<p align="center">Classic desk games, done cleanly. One small Windows app.</p>

## Games

31 games in five groups.

| Group | Games |
| --- | --- |
| **Cards** | Spider (1, 2 or 4 suits), FreeCell, TriPeaks, Pyramid, Golf, Yukon, Scorpion, Forty Thieves, Canfield |
| **Puzzles** | Mahjong, Minesweeper, Sudoku, Kakuro, Nonograms, 2048, Fifteen, Lights Out, Pipes, Memory |
| **Words** | Word Guess, Word Search |
| **Board games** | Chess, Checkers, Reversi, Connect Four — each against the computer on three levels |
| **Arcade** | Snake, Blocks, Breakout, Pong, Rocks, Flapper |

**Daily puzzles:** Sudoku, Nonograms, Mahjong and Word Guess each have a daily puzzle that's the same for everyone. The **Today** page tracks your streak on a calendar.

**Trophies:** 46 achievements, from your first win to beating the computer at chess on Hard.

**Card games** have Hint (or press H) and a Finish button that plays out the rest once every card is face up. The card games, puzzles and board games have undo, and most games save progress when you leave.

**Make it yours:** 8 themes (Paper, Mint, Slate, Felt, Midnight, Ember, Dusk, High contrast), a custom accent color, 5 card backs, a four-color deck, large-print cards, favorites, a compact sidebar, and volume with per-sound toggles.

**Mini player:** click the mini player button in a game's top bar (or press M) to shrink Downtime into a small window that stays on top of your other apps.

## Download

Grab the latest build from [Releases](../../releases):

- **Downtime-portable.exe** — no install, just run it.
- **Downtime_x.y.z_x64-setup.exe** — installs with a Start menu shortcut.

Downtime needs Microsoft Edge WebView2, which comes with Windows 10 and 11.

### Updates

The installed version checks for updates when it starts and shows **Update available** in the sidebar. Click it and Downtime downloads, installs and restarts. You can also check from **Settings → Updates**. The portable .exe doesn't update itself; download the new one from Releases.

## Controls

| | |
| --- | --- |
| Cards | Drag to move. Click a card to send it to the best spot. Click the stock to deal. |
| Minesweeper | Left-click to reveal, right-click (or Ctrl+click) to flag. Click a number to clear around it. |
| Golf | Click a column's bottom card if it's one higher or lower than the open card. |
| Mahjong | Click two matching tiles that are free (nothing on top, and open on the left or right). **H** shows a hint. |
| Nonograms | Click or drag to fill, right-click or drag to mark X. Numbers turn grey when a line is right. |
| Memory | Click two cards to flip them. Matches stay face up. |
| Connect Four | Click a column or press 1–7. You and the computer take turns going first. |
| TriPeaks | Click a card one higher or lower than the open card. King and Ace connect. |
| Pyramid | Click two cards that add up to 13 (J = 11, Q = 12, K = 13). Kings go on their own. |
| Sudoku | Click a cell, then type 1–9 or use the pad. **N** toggles notes, arrow keys move. |
| Snake | Arrow keys or WASD. Space to pause. |
| Blocks | ← → move, ↑ or X rotate, Z rotate back, ↓ soft drop, Space hard drop, C hold, P pause. |
| Breakout | Mouse or ← →. Click or Space to launch. |
| 2048 | Arrow keys or WASD, or swipe. |
| Word Guess | Type a word and press Enter. |
| Word Search | Drag across a word in any of 8 directions. |
| Kakuro | Fill each run with different digits that add up to its clue. |
| Pipes | Click to rotate a tile clockwise, right-click to rotate back. |
| Chess, Checkers, Reversi | Click a piece, then a square. Chess also supports drag. |
| Pong | Mouse, W/S or arrow keys. |
| Rocks | Arrows or WASD to turn and thrust, Space to shoot. |
| Flapper | Click or Space to flap. |
| Anywhere | **Ctrl+Z** undo, **F2** new game, **M** mini player, **H** hint in card games. |

## Building it yourself

You need [Node.js 22+](https://nodejs.org) and [Rust](https://rustup.rs).

```sh
npm install
npm run tauri dev     # run the app with live reload
npm run tauri build   # make the .exe and installers in src-tauri/target/release
```

`npm run dev` runs just the web version in a browser at http://localhost:1420, which is the quickest way to work on the games.

### Releasing

Every push to `main` builds Windows installers on GitHub Actions (look under the run's **Artifacts**). To publish a release:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. On GitHub, go to **Releases → Draft a new release**, type a new tag like `v0.3.0`, and publish.

The workflow builds the app, attaches the files, and uploads `latest.json`, which installed copies read to update themselves.

### Update signing

Updates are signed so the app only installs builds made by this repo's workflow. The workflow reads the private key from a repository secret named `TAURI_SIGNING_PRIVATE_KEY` (**Settings → Secrets and variables → Actions**). The matching public key is in `src-tauri/tauri.conf.json`. Keep a backup of the private key: if it's lost, existing installs can't receive updates until people reinstall. Without the secret, builds still work but can't be used for self-updates.

## Project layout

```
src/
  core/      settings, stats, sound, timer, storage
  cards/     card engine shared by the solitaire games
  games/     one file per game
  ui/        home-screen art and icons
  styles/    themes and layout
src-tauri/   the Windows app wrapper (Tauri 2)
```

Adding a game means writing one module in `src/games/` that exports a `GameModule` and listing it in `src/games/index.ts`.

## License

MIT
