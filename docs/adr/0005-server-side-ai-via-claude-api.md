# 0005. Server-side AI via Claude API

- **Status:** Proposed
- **Date:** 2026-10-12

## Context
AI must parse recipes from photos (including handwriting and multi-page), web pages, and free text (FR-10), and suggest substitutions (FR-24). Keys must never ship on the device (NFR-3), and per-household cost must be tracked and capped (NFR-7).

## Decision
All AI calls go through an **LLM Gateway** module in Edge Functions using the **Anthropic Claude API** (vision-capable model). Outputs are requested as structured JSON and validated against a shared recipe schema. Prompts are versioned files. For URL imports, schema.org `Recipe` JSON-LD is used first and the LLM only fills gaps.

## Alternatives considered
- **On-device OCR + rules:** free and offline, but poor on handwriting and layout; still needs an LLM for structure.
- **Other LLM providers:** viable; the gateway keeps this swappable.

## Consequences
- AI features require connectivity; imports queue offline (FR-29).
- Model choice is one config value; can use a smaller model for substitutions and a larger one for photo parsing.
- Need an evaluation set of real recipes (photos, URLs, text) to catch regressions when prompts or models change.
