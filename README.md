<p align="center"><img src="assets/icon.png" width="96" alt="Downtime icon"></p>

<h1 align="center">Downtime</h1>
<p align="center">Classic desk games, done cleanly. One small Windows app.</p>

## Games

| Cards | Puzzles | Arcade |
| --- | --- | --- |
| **Klondike** — draw 1 or draw 3 | **Minesweeper** — easy, medium, hard | **Snake** — three speeds, walls or wrap-around |
| **Spider** — 1, 2 or 4 suits | **Sudoku** — easy, medium, hard | **Blocks** — falling-block puzzle with hold and ghost piece |
| **FreeCell** | **2048** | **Breakout** — levels that get faster |
| **TriPeaks** | | |
| **Pyramid** | | |

Every game has smooth animations, a timer or score, and personal bests. The card games, Sudoku and 2048 have undo, and games in progress are saved when you leave, so you can pick up where you left off.

**Themes:** Paper, Slate, Felt, Midnight and Ember, plus three card backs. Switch from the dots at the bottom of the sidebar or in Settings.

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
| TriPeaks | Click a card one higher or lower than the open card. King and Ace connect. |
| Pyramid | Click two cards that add up to 13 (J = 11, Q = 12, K = 13). Kings go on their own. |
| Sudoku | Click a cell, then type 1–9 or use the pad. **N** toggles notes, arrow keys move. |
| Snake | Arrow keys or WASD. Space to pause. |
| Blocks | ← → move, ↑ or X rotate, Z rotate back, ↓ soft drop, Space hard drop, C hold, P pause. |
| Breakout | Mouse or ← →. Click or Space to launch. |
| 2048 | Arrow keys or WASD, or swipe. |
| Anywhere | **Ctrl+Z** undo, **F2** new game. |

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
