# Veritas v2

[![npm version](https://img.shields.io/badge/npm-install%20locally-orange?style=flat-square)](#quick-start)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-node%20%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![browser-extension](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge%20%7C%20Firefox-orange?style=flat-square)](#browser-extension)
[![version](https://img.shields.io/badge/version-2.0.0-purple?style=flat-square)](https://github.com/Hhhpraise/veritas)

> **Your paper, verified.** Multi-format quality scoring, live citation verification against Semantic Scholar & CrossRef, BibTeX support.

## What's New in v2.0

- **Live API verification** — every citation checked against Semantic Scholar and CrossRef in real time. No more guessing whether `(Smith, 2024)` is real.
- **Multi-format support** — `.md`, `.txt`, `.tex`, `.pdf`, `.docx`, `.html`. Works with whatever format your paper is in.
- **BibTeX integration** — LaTeX papers with `.bib` files get cite keys resolved and verified automatically.
- **Smart repair** — hallucinated citations get replaced with real papers from the literature, not just flagged.

## The Problem

Researchers are flying blind. They write paper sections without any objective quality feedback, paste LLM-suggested citations without knowing if they're real, and discover structural problems only after peer review — 4 months later.

The numbers are alarming. A May 2026 Lancet audit of 2.5 million PubMed-indexed papers found fabricated references in **1 in 277 papers** — a 12-fold increase since 2023. The GhostCite study (Feb 2026) found 1.07% of top AI/ML venue papers contain invalid citations, with an 80.9% increase in 2025 alone. Across arXiv, bioRxiv, SSRN, and PubMed Central, researchers estimate **146,932 hallucinated citations in 2025**.

Tools exist — MetricDraft's PRISM system (Applied Sciences, June 2026), PaperOrchestra's autoraters (Google, April 2026), Google's Paper Assistant Tool — but they're research papers, conference-gated, or require coding. Veritas is the first accessible tool that actually verifies citations against real databases.

## How It Works

```
# Score any paper format — markdown, LaTeX, PDF, DOCX, HTML
$ veritas analyze paper.tex

╔══════════════════════════════════════╗
║   VERITAS v2 — Paper Quality Analysis ║
╚══════════════════════════════════════╝
Source: paper.tex (latex) · 6 sections

Abstract
  Score: ████████░░ 82/100

# Verify citations against live academic databases
$ veritas audit-citations paper.tex --bib refs.bib

Loaded 47 entries from refs.bib
Verifying 34 citations against Semantic Scholar & CrossRef...

Results: 34 total
  ✅ Verified (live): 29
  ❌ Unmatched: 3
  ◻ Unverifiable: 2

Unmatched citations (likely hallucinated):
  ❌ (Thompson, 2025) — No match in Semantic Scholar or CrossRef

# One-click repair — replace fakes with real papers
$ veritas repair paper.tex --bib refs.bib --fix-citations
Found 3 unverified citation(s):
  ❌ (Thompson, 2025) — No match in any database
     → (Anderson, 2024) — Neural Approaches to Sequence Modeling
[████████████████] Done! Backup saved to paper.veritas-backup.tex
```

Veritas checks every citation against Semantic Scholar and CrossRef in real time. If a citation doesn't exist, it finds the closest real paper to replace it with.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Hhhpraise/veritas.git
cd veritas
npm install
npm link

# 2. Score any paper
veritas analyze my-paper.md
veritas analyze thesis.tex
veritas analyze manuscript.pdf
veritas analyze final.docx

# 3. Verify citations (with BibTeX for LaTeX)
veritas audit-citations my-paper.md
veritas audit-citations thesis.tex --bib refs.bib

# 4. Auto-repair — fix everything with live verification
veritas repair my-paper.md --fix-citations --target 85
veritas repair thesis.tex --bib refs.bib --fix-citations --dry-run  # preview first
```

## Commands / API Reference

| Command | Description | Options |
|---------|-------------|---------|
| `veritas analyze <file>` | Score all sections across 5 dimensions (any format) | `-f, --format` (terminal, json, html), `-s, --section` (filter) |
| `veritas audit-citations <file>` | Live-verify every citation against Semantic Scholar + CrossRef | `--bib <file>` (BibTeX for LaTeX), `-f, --format` (terminal, json) |
| `veritas repair <file>` | Auto-repair: replace fakes with real papers, annotate weak sections | `--bib <file>`, `--fix-citations`, `--improve-sections`, `--target <score>`, `--dry-run` |
| `veritas --version` | Show version | |
| `veritas --help` | Show help | |

### Supported Formats

| Format | Extension | Extraction Method | BibTeX |
|--------|-----------|-------------------|--------|
| Markdown | `.md` | Native | — |
| Plain Text | `.txt` | Native | — |
| LaTeX | `.tex` | Native + section command parsing | Auto-detected `.bib`, or `--bib` |
| PDF | `.pdf` | pdftotext (poppler-utils) | — |
| Word | `.docx` | unzip + XML extraction | — |
| HTML | `.html` | Tag stripping | — |

### Quality Dimensions

| Dimension | Max | What It Measures |
|-----------|-----|-----------------|
| Structural Coherence | 25 | Paragraph organization, topic sentences, transitions |
| Claim Specificity | 25 | Numerical precision, concrete comparisons, hedging ratio |
| Evidence Coverage | 20 | Citation-to-claim ratio, supporting references per assertion |
| Citation Density | 15 | Citations per 100 words (optimal: 2-8) |
| Prose Clarity | 15 | Sentence length, passive voice ratio, jargon density |

### Grade Scale

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-100 | A | Ready for submission |
| 80-89 | B | Minor improvements recommended |
| 70-79 | C | Needs significant revision |
| 60-69 | D | Major structural issues |
| <60 | F | Requires complete rewrite |

## Browser Extension

The Veritas browser extension overlays a quality dashboard on Overleaf and Google Docs. Open your paper, click "Analyze Document," and see section scores, weak spots, and improvement suggestions without leaving your editor.

Installation: Load `extension/` as an unpacked extension in Chrome/Edge (Developer mode → Load unpacked).

## Comparison vs Alternatives

| Tool | Section Scoring | Citation Verification | One-Click Repair | Accessible to Non-Coders | Price |
|------|:---:|:---:|:---:|:---:|---:|
| **Veritas** | ✅ 5 dimensions | ✅ Author-year + numeric | ✅ Auto-replace + annotate | ✅ CLI + Browser | Free / MIT |
| MetricDraft (Guo et al.) | ✅ PRISM system | ✅ CVRR (56%→15%) | ❌ Research only | ❌ Requires coding | N/A (paper) |
| PaperOrchestra (Google) | ✅ Autoraters | ✅ Citation F1 | ❌ Pipeline only | ❌ Requires API keys | N/A (paper) |
| PAT (Google) | ❌ Review feedback | ❌ No citation check | ❌ Feedback only | ❌ Conference-gated | Free (gated) |
| Grammarly | ❌ General grammar | ❌ No citation check | ✅ Grammar fixes | ✅ Browser extension | $12/mo |
| Writefull | ⚠ Academic tone | ❌ No hallucination check | ❌ Suggestions only | ✅ Overleaf plugin | Freemium |
| ChatGPT / Claude | ❌ No scoring | ❌ 14-95% fabrication | ❌ Manual prompting | ✅ Web | Free-$20/mo |
| Zotero | ❌ No scoring | ❌ Organize only | ❌ Reference mgmt | ✅ Desktop | Free |

## Research References

- Lancet audit: 1 in 277 PubMed papers in 2026 contain fabricated references (EurekAlert, May 2026)
- GhostCite: 1.07% of AI/ML venue papers have invalid citations, 80.9% increase in 2025 (arXiv:2602.06718)
- 146,932 hallucinated citations across major repositories in 2025 (arXiv:2605.07723)
- 41.5% of researchers copy-paste references without checking; 76.7% of reviewers don't verify citations (GhostCite, 2026)
- MetricDraft: +5.5 to +7.9 MQS improvement, reduced fabricated citations 56%→15% (Applied Sciences, June 2026)
- PaperOrchestra: 50-68% win rate over baselines for lit review quality (arXiv:2604.05018)
- APRES: humans preferred APRES-revised papers 79% of the time (arXiv:2603.03142)

## Project Structure

```
veritas/
├── cli.js                 # Main CLI (npm package entry point)
├── package.json           # npm package metadata
├── test.js                # Tests
├── extension/             # Browser extension
│   ├── manifest.json      # Chrome Extension manifest v3
│   ├── content.js         # Content script (injected dashboard)
│   ├── dashboard.css      # Dashboard styles
│   ├── popup.html         # Extension popup
│   └── icons/             # Extension icons (16, 48, 128)
├── README.md              # This file
├── LICENSE                # MIT
├── CONTRIBUTING.md        # Contribution guide
├── PUBLISHING.md          # Launch checklist
└── .gitignore             # Ignore rules
```

## Contributing

1. Fork the repo: [github.com/Hhhpraise/veritas](https://github.com/Hhhpraise/veritas)
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write tests for your feature
4. Implement, ensuring all tests pass
5. Submit a PR with a clear description and linked issue

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## License

MIT © [Praise O. A.](https://github.com/Hhhpraise)
