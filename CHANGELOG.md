# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Explain pattern** panel: a plain-English, line-by-line breakdown of the current pattern (anchors, character classes, groups, quantifiers, alternation, backreferences, lookaround) shown beneath the error panel whenever the pattern is valid. Descriptions are flag-aware (e.g. `^`/`$` explain multiline mode, `.` explains dotAll mode). Implements the "Regex explanation / breakdown panel" roadmap item.

## [1.0.1] - 2026-09-06

### Fixed

- Match list mislabeling named capture groups: the label for each numbered
  group (e.g. "Group 2") was chosen by comparing its **captured text** to the
  values in `match.groups`, which is ambiguous whenever two different groups
  happen to capture identical text. For example, `/(?<year>\d{4})-(\d{4})/`
  matched against `"2024-2024"` incorrectly labeled *both* groups as
  `(year)`, even though only group 1 is actually named. Group names are now
  resolved by parsing the pattern source itself to map each capturing
  group's position to its name, so labeling is correct regardless of what
  text is captured.
