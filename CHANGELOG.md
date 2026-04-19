# Changelog

All notable changes to the Outline++ extension will be documented in this file.

This changelog adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is structured for clarity and readability, inspired by [Common Changelog](https://common-changelog.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.2] - 2026-04-19

### Changed
- Increased document-parsing debounce from 100 ms to 250 ms to reduce main-thread load during rapid edits. Introduced a **tiered debounce system**: 250 ms for expensive parsing operations, 100 ms for lightweight cursor tracking and UI refresh.

### Internal
- Centralized all command IDs, view IDs, configuration keys, and debounce timing constants into `src/constants.ts`, eliminating over 60 magic string duplications.
- Updated `@vscode/vsce` to `^3.9.1`; added npm `overrides` to replace deprecated `glob@11.1.0` with `glob@13.0.0`.

---

## [1.0.1] - 2026-03-30

### Added
- Debug logging commands: **Outline++: Show Debug Log** and **Outline++: Dump Diagnostic State** for diagnosing refresh issues.

### Changed
- Renamed npm package identifier from `outline-plus` to `outline-regions-plus` to match the VS Code Marketplace listing.

---

## [1.0.0] - 2026-03-29

✨ Initial release as Outline++ ✨
