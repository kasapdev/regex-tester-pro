# Regex Tester Pro

[![CI](https://github.com/kasapdev/regex-tester-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/kasapdev/regex-tester-pro/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?logo=javascript&logoColor=black)

Live regex tester with highlighted matches, capture groups, a replace-preview mode, and common pattern presets — fast, private, and fully offline.

> A zero-dependency regex workbench built entirely on native `RegExp`. Type a pattern and a test string, and watch matches highlight instantly with nested capture groups, a full match list with group values, and a live replace preview — all in your browser, with nothing ever leaving your machine.

## Overview

Regex Tester Pro is part of the **Web Utility Suite**. It runs entirely in the browser with no build step, no frameworks, and no network calls — open `index.html` from disk and it works. Matches are found using the browser's own `RegExp` engine, so behavior always matches what you'd get in real JavaScript code. Matches and their capture groups are rendered as properly nested highlights directly inside your test string, with a detailed match list and a replace-preview panel underneath.

## Features

- **Live pattern matching** — pattern + flags input, debounced live matching against native `RegExp`, with a clear error panel for invalid patterns.
- **Inline highlighted matches** — every match is highlighted in the test string, with capturing groups (including named groups) shown as distinctly nested sub-highlights inside each match, built from a proper containment tree so nesting is always visually correct.
- **Match list** — every match's index, start/end offsets, full matched text, and every capturing group (numbered and named) with its captured value or `undefined` when it didn't participate.
- **Replace-preview mode** — a separate pattern + flags + replacement input showing the live result of `String.replace`, with full support for `$1`, `$<name>`, `$&`, `` $` ``, `$'` substitution syntax exactly as native JavaScript handles it (honors your flags — add `g` to replace all).
- **Pattern presets** — a dropdown that fills in real, working patterns for email addresses, URLs, IPv4 addresses, hex colors, US phone numbers, and ISO dates (`YYYY-MM-DD`).
- **Explain pattern** — a plain-English, line-by-line breakdown of the current pattern (anchors, character classes, groups, quantifiers, alternation, backreferences, lookaround), correctly nested and aware of the `m`/`s` flags.
- **Stats** — total match count, the max number of capture groups seen, and how many distinct named groups are in use.
- **Copy** the pattern or the replace-preview result.
- **Auto-persist** — your pattern, flags, test string, and replacement are saved to `localStorage` and restored on return.
- **Dark & light themes**, fully responsive down to 360px, accessible, and keyboard-driven.

## Installation

No dependencies, no build step.

```bash
git clone https://github.com/kasapdev/regex-tester-pro.git
cd regex-tester-pro
```

Then simply open `index.html` in any modern browser (double-click it, or `file://` it). That's it.

## Usage

1. Type or paste a **pattern** and optional **flags** (e.g. `gi`), or pick a **preset**.
2. Read the **Explain pattern** panel for a plain-English, line-by-line breakdown of what the pattern does.
3. Paste your **test string** — matches highlight instantly, with capture groups nested inside each match.
4. Scroll the **match list** for a full breakdown of every match and its groups.
5. Switch to the **replace preview** panel, type a replacement (supporting `$1`, `$<name>`, etc.), and see the live result.
6. **Copy** the pattern or the replace result whenever you need them.

## Keyboard Shortcuts

| Action               | Shortcut          |
| -------------------- | ------------------ |
| Clear everything      | <kbd>Ctrl/⌘</kbd> + <kbd>K</kbd> |
| Show shortcuts help   | <kbd>?</kbd>        |
| Close dialog          | <kbd>Esc</kbd>      |

## Screenshots

> _Screenshots coming soon._

![screenshot](docs/screenshot-1.png)
![screenshot](docs/screenshot-2.png)

## Roadmap

- [x] Regex explanation / breakdown panel (plain-English description of the pattern)
- [ ] Multi-line test cases with per-line match toggling
- [ ] Save & recall a personal library of favorite patterns
- [ ] Regex golf-style diff between two patterns' matches
- [ ] Export match list as CSV/JSON

## License

MIT Licensed. Part of the [Web Utility Suite](https://github.com/kasapdev/web-utility-suite).

---

## Part of the kasapdev Tools Suite

One of 45+ zero-dependency vanilla JS tools, all free and open source — [see the full list](https://github.com/kasapdev/kasapdev).
