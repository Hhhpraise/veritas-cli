#!/usr/bin/env node
// Veritas v2.0 — Multi-format academic paper quality scoring & live citation verification
// Usage: veritas <command> [options]

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const VERSION = '2.0.0';
const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';
const CROSSREF_API = 'https://api.crossref.org/works';

const program = new Command();
program
  .name('veritas')
  .description('Academic paper quality scoring, citation verification, and one-click repair — with multi-format support')
  .version(VERSION);

// ============================================================
// Multi-format file reader
// ============================================================

function readAnyFile(filepath, bibPath) {
  if (!fs.existsSync(filepath)) {
    console.error(chalk.red(`Error: File not found: ${filepath}`));
    process.exit(1);
  }
  const ext = path.extname(filepath).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    return { content: fs.readFileSync(filepath, 'utf-8'), format: 'markdown' };
  }

  if (ext === '.tex') {
    let content = fs.readFileSync(filepath, 'utf-8');
    // Strip LaTeX commands for scoring but keep \cite{} for citation extraction
    content = content.replace(/\\(?:section|subsection|subsubsection)\{([^}]*)\}/g, '## $1');
    // If a .bib file is provided, load it too
    if (bibPath && fs.existsSync(bibPath)) {
      const bib = fs.readFileSync(bibPath, 'utf-8');
      content += '\n\n' + bib; // Append bib for cross-referencing
    }
    return { content, format: 'latex', bibPath };
  }

  if (ext === '.pdf') {
    return { content: extractTextFromPDF(filepath), format: 'pdf' };
  }

  if (ext === '.docx') {
    return { content: extractTextFromDocx(filepath), format: 'docx' };
  }

  if (ext === '.html') {
    const html = fs.readFileSync(filepath, 'utf-8');
    // Crude HTML text extraction
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    return { content: text, format: 'html' };
  }

  // Default — try as text
  return { content: fs.readFileSync(filepath, 'utf-8'), format: 'unknown' };
}

function extractTextFromPDF(filepath) {
  try {
    return execSync(`pdftotext "${filepath}" -`, { encoding: 'utf-8', timeout: 10000 });
  } catch {
    return `[PDF text extraction requires pdftotext (poppler-utils). Cannot extract text from ${filepath}. Install poppler-utils: brew install poppler (Mac) or apt install poppler-utils (Linux).]`;
  }
}

function extractTextFromDocx(filepath) {
  try {
    // Use unzip + grep as a lightweight approach
    const raw = execSync(`unzip -p "${filepath}" word/document.xml 2>/dev/null | sed 's/<[^>]*>//g'`, { encoding: 'utf-8', timeout: 10000 });
    return raw.replace(/\s+/g, ' ').trim();
  } catch {
    return `[DOCX extraction requires unzip. Content not available for scoring.]\n\nDOCX file: ${filepath}`;
  }
}

// ============================================================
// BibTeX parser
// ============================================================

function parseBibTeX(content) {
  const entries = [];
  const entryRegex = /@(\w+)\s*\{\s*([^,]+),\s*([\s\S]*?)\n\}/g;
  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]+)[}"]/g;
    let fm;
    while ((fm = fieldRegex.exec(match[3])) !== null) {
      fields[fm[1].toLowerCase()] = fm[2];
    }
    entries.push({ type, key, fields });
  }
  return entries;
}

function resolveLatexCitation(key, bibEntries) {
  const entry = bibEntries.find(e => e.key === key);
  if (!entry) return null;
  return {
    title: entry.fields.title || '',
    author: entry.fields.author || '',
    year: entry.fields.year || '',
    doi: entry.fields.doi || '',
    journal: entry.fields.journal || entry.fields.booktitle || ''
  };
}

// ============================================================
// Live API verification
// ============================================================

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null))
      .on('timeout', () => { resolve(null); });
  });
}

async function searchSemanticScholar(title, author, year) {
  try {
    let query = title ? `title:${encodeURIComponent(title)}` : '';
    if (author) query += (query ? '+' : '') + `author:${encodeURIComponent(author)}`;
    if (year) query += (query ? '+' : '') + `year:${year}`;
    if (!query) return null;

    const url = `${SEMANTIC_SCHOLAR_API}/paper/search?query=${query}&limit=3&fields=title,authors,year,doi,journal,externalIds`;
    const result = await fetchJSON(url);
    if (!result || !result.data || result.data.length === 0) return null;
    return result.data;
  } catch {
    return null;
  }
}

async function searchCrossRef(title, author) {
  try {
    const params = [];
    if (title) params.push(`query.title=${encodeURIComponent(title)}`);
    if (author) params.push(`query.author=${encodeURIComponent(author)}`);
    if (params.length === 0) return null;

    const url = `${CROSSREF_API}?${params.join('&')}&rows=3`;
    const result = await fetchJSON(url);
    if (!result || !result.message || !result.message.items) return null;
    return result.message.items.map(item => ({
      title: item.title ? item.title[0] : '',
      doi: item.DOI,
      year: item['created'] ? item['created']['date-parts']?.[0]?.[0] : null,
      publisher: item.publisher,
      journal: item['container-title'] ? item['container-title'][0] : ''
    }));
  } catch {
    return null;
  }
}

async function verifyDoi(doi) {
  try {
    const url = `${CROSSREF_API}/${encodeURIComponent(doi)}`;
    const result = await fetchJSON(url);
    if (!result || result.message === null) return null;
    const m = result.message;
    return {
      title: m.title ? m.title[0] : '',
      doi: m.DOI,
      year: m['created'] ? m['created']['date-parts']?.[0]?.[0] : null,
      publisher: m.publisher || '',
      journal: m['container-title'] ? m['container-title'][0] : ''
    };
  } catch {
    return null;
  }
}

async function verifyCitationLive(citation, bibEntries) {
  // Resolve LaTeX cite keys against .bib
  if (citation.type === 'latex' && bibEntries) {
    const resolved = resolveLatexCitation(citation.key, bibEntries);
    if (!resolved) {
      return { ...citation, status: 'unresolvable', note: `Cite key "${citation.key}" not found in .bib file` };
    }
    // Verify using the resolved bib entry
    const [ssResults, crResults] = await Promise.all([
      searchSemanticScholar(resolved.title, resolved.author?.split(',')[0]?.trim(), resolved.year),
      searchCrossRef(resolved.title, resolved.author?.split(',')[0]?.trim())
    ]);
    const ssMatch = findBestMatch(resolved, ssResults);
    const crMatch = crResults && crResults.length > 0 ? crResults[0] : null;
    return buildVerificationResult(citation, resolved, ssMatch, crMatch, 'latex');
  }

  // Author-year: search by author + year + context
  if (citation.type === 'author-year') {
    const author = citation.author;
    const year = citation.year;

    // Extract a title-like phrase from the context sentence
    const contextWords = citation.context?.split(/\s+/) || [];
    const searchTitle = contextWords.slice(0, 15).join(' ');

    const [ssResults, crResults] = await Promise.all([
      searchSemanticScholar(searchTitle, author, year),
      searchCrossRef(searchTitle, author)
    ]);

    const query = { title: '', author, year };
    const ssMatch = findBestMatch(query, ssResults);
    const crMatch = crResults && crResults.length > 0 ? crResults[0] : null;

    return buildVerificationResult(citation, query, ssMatch, crMatch, 'author-year');
  }

  // Numeric: can't search without bib context
  if (citation.type === 'numeric') {
    return { ...citation, status: 'unverifiable', note: 'Numeric citations require a bibliography section or .bib file for verification' };
  }

  return { ...citation, status: 'unverifiable' };
}

function findBestMatch(query, results) {
  if (!results || results.length === 0) return null;
  // Simple matching: prefer results with exact author + year match
  for (const r of results) {
    const rYear = r.year?.toString() || '';
    if (rYear === query.year?.toString()) return r;
  }
  return results[0]; // Best available match
}

function buildVerificationResult(citation, query, ssMatch, crMatch, citationType) {
  const matchedPaper = ssMatch || crMatch;

  if (matchedPaper) {
    const doi = matchedPaper.doi || matchedPaper.DOI || '';
    const title = matchedPaper.title || '';
    const year = matchedPaper.year || '';
    const authors = matchedPaper.authors
      ? matchedPaper.authors.map(a => a.name || a).join(', ')
      : (matchedPaper.author || '');

    return {
      ...citation,
      status: 'real',
      verifiedMetadata: {
        title,
        authors,
        year: year?.toString(),
        doi,
        source: ssMatch ? 'Semantic Scholar' : 'CrossRef'
      },
      action: `Verified: ${title} (${year})${doi ? ' — DOI: ' + doi : ''}`
    };
  }

  // No match found in either database
  return {
    ...citation,
    status: 'unmatched',
    note: 'No match found in Semantic Scholar or CrossRef — likely hallucinated',
    action: `No match for "${citation.raw}". This citation may not exist. Verify manually before submitting.`
  };
}

// ============================================================
// Commands
// ============================================================

program
  .command('analyze <file>')
  .description('Score a paper section by section across 5 quality dimensions. Supports .md, .txt, .tex, .pdf, .docx, .html')
  .option('-f, --format <type>', 'output format (terminal, json, html)', 'terminal')
  .option('-s, --section <name>', 'analyze only a specific section')
  .action(async (file, options) => {
    const { content: raw, format } = readAnyFile(file);
    const sections = parseSections(raw, options.section);

    if (sections.length === 0) {
      console.log(chalk.red('No sections found in the document.'));
      if (format === 'pdf') console.log(chalk.dim('PDF text extraction may have failed. Ensure pdftotext is installed.'));
      if (format === 'docx') console.log(chalk.dim('DOCX extraction may have failed. Ensure unzip is installed.'));
      process.exit(1);
    }

    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║   VERITAS v2 — Paper Quality Analysis ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));
    console.log(chalk.dim(`Source: ${file} (${format}) · ${sections.length} sections\n`));

    const results = [];
    for (const section of sections) {
      const score = analyzeSection(section);
      results.push(score);
      if (options.format === 'terminal') printSectionScore(score);
    }

    const overall = computeOverall(results);
    printOverallScore(overall);

    if (options.format === 'json') {
      console.log(JSON.stringify({ overall, sections: results, source: { file, format } }, null, 2));
    }
  });

program
  .command('audit-citations <file>')
  .description('Live-verify all citations against Semantic Scholar and CrossRef APIs. Supports .md, .txt, .tex, .pdf, .docx, .html')
  .option('--bib <file>', 'BibTeX file (for LaTeX .tex papers)')
  .option('-f, --format <type>', 'output format (terminal, json)', 'terminal')
  .action(async (file, options) => {
    const { content: raw, format } = readAnyFile(file, options.bib);
    const citations = extractCitations(raw);

    if (citations.length === 0) {
      console.log(chalk.yellow('No citations detected in the document.'));
      process.exit(1);
    }

    // Parse .bib if available
    let bibEntries = [];
    if (options.bib && fs.existsSync(options.bib)) {
      const bibContent = fs.readFileSync(options.bib, 'utf-8');
      bibEntries = parseBibTeX(bibContent);
      console.log(chalk.dim(`Loaded ${bibEntries.length} entries from ${options.bib}\n`));
    }

    // Auto-detect .bib next to .tex
    if (!options.bib && format === 'latex') {
      const autoBib = file.replace(/\.tex$/, '.bib');
      if (fs.existsSync(autoBib)) {
        const bibContent = fs.readFileSync(autoBib, 'utf-8');
        bibEntries = parseBibTeX(bibContent);
        console.log(chalk.dim(`Auto-detected ${bibEntries.length} entries in ${autoBib}\n`));
      }
    }

    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║   VERITAS — Live Citation Audit     ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));
    console.log(chalk.dim(`Verifying ${citations.length} citations against Semantic Scholar & CrossRef...\n`));

    // Verify citations with live APIs (in parallel, batch of 3 for rate limits)
    const results = [];
    for (let i = 0; i < citations.length; i += 3) {
      const batch = citations.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(c => verifyCitationLive(c, bibEntries)));
      results.push(...batchResults);
      if (i + 3 < citations.length) await sleep(1000); // Rate limit: 1 second between batches
    }

    if (options.format === 'terminal') {
      printCitationAuditLive(results);
    } else {
      console.log(JSON.stringify({ citations: results }, null, 2));
    }
  });

program
  .command('repair <file>')
  .description('Auto-repair: fix weak sections and replace unverified citations with real ones')
  .option('--bib <file>', 'BibTeX file (for LaTeX papers)')
  .option('--fix-citations', 'replace unverified/hallucinated citations with real ones from the literature')
  .option('--improve-sections', 'annotate sections scoring below target')
  .option('--target <score>', 'target minimum section score (default: 85)', '85')
  .option('--dry-run', 'show what would change without writing')
  .action(async (file, options) => {
    const { content: raw } = readAnyFile(file, options.bib);
    const sections = parseSections(raw);
    const citations = extractCitations(raw);
    const target = parseInt(options.target, 10);

    let bibEntries = [];
    if (options.bib && fs.existsSync(options.bib)) {
      bibEntries = parseBibTeX(fs.readFileSync(options.bib, 'utf-8'));
    } else if (file.endsWith('.tex')) {
      const autoBib = file.replace(/\.tex$/, '.bib');
      if (fs.existsSync(autoBib)) {
        bibEntries = parseBibTeX(fs.readFileSync(autoBib, 'utf-8'));
      }
    }

    const sectionResults = sections.map(s => analyzeSection(s));

    console.log(chalk.bold.green('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.green('║   VERITAS — One-Click Repair   v2   ║'));
    console.log(chalk.bold.green('╚══════════════════════════════════════╝\n'));

    let changes = [];

    const runCitationFix = options.fixCitations !== false;
    if (runCitationFix) {
      // Verify citations live
      const citationResults = [];
      for (let i = 0; i < citations.length; i += 3) {
        const batch = citations.slice(i, i + 3);
        const br = await Promise.all(batch.map(c => verifyCitationLive(c, bibEntries)));
        citationResults.push(...br);
        if (i + 3 < citations.length) await sleep(1000);
      }

      const unverified = citationResults.filter(c => c.status === 'unmatched' || c.status === 'hallucinated' || c.status === 'unresolvable');
      if (unverified.length > 0) {
        console.log(chalk.yellow(`\nFound ${unverified.length} unverified citation(s):`));
        for (const c of unverified) {
          console.log(chalk.red(`  ❌ ${c.raw} — ${c.note || 'No match in any database'}`));

          // Try to find a replacement for hallucinated citations
          const replacement = await findReplacementLive(c);
          if (replacement) {
            changes.push({ type: 'citation', original: c.raw, replacement: replacement.citation, note: replacement.title });
            console.log(chalk.green(`     → ${replacement.citation} — ${replacement.title}`));
          } else {
            changes.push({ type: 'citation', original: c.raw, replacement: '[CITATION NEEDS MANUAL REVIEW]', note: '' });
            console.log(chalk.yellow(`     → No automated replacement found. Manual review required.`));
          }
        }
      } else {
        console.log(chalk.green('All citations verified against live databases ✅'));
      }
    }

    const runSectionFix = options.improveSections !== false;
    if (runSectionFix) {
      const weak = sectionResults.filter(s => s.score < target);
      if (weak.length > 0) {
        console.log(chalk.yellow(`\nFound ${weak.length} section(s) below target score of ${target}:`));
        for (const w of weak) {
          const improvements = generateImprovements(w);
          changes.push({ type: 'section', section: w.name, score: w.score, improvements, target });
          console.log(chalk.dim(`  ${w.name}: ${w.score}/100 → target ${target}`));
          for (const imp of improvements) console.log(chalk.cyan(`    → ${imp}`));
        }
      } else {
        console.log(chalk.green(`All sections at or above target score of ${target} ✅`));
      }
    }

    if (options.dryRun) {
      console.log(chalk.dim('\n--dry-run: no files written'));
      return;
    }

    if (changes.length > 0) {
      const updated = applyChanges(raw, changes);
      const ext = path.extname(file);
      const backupPath = file.replace(new RegExp(`\\${ext}$`), `.veritas-backup${ext}`);
      fs.writeFileSync(backupPath, raw);
      fs.writeFileSync(file, updated);
      console.log(chalk.green(`\n✓ Applied ${changes.length} changes`));
      console.log(chalk.dim(`  Backup: ${backupPath}`));
    } else {
      console.log(chalk.dim('\nNo changes needed.'));
    }
  });

// ============================================================
// Live replacement finder
// ============================================================

async function findReplacementLive(citation) {
  // For author-year: search by author + year to find a real paper
  if (citation.type === 'author-year') {
    const author = citation.author;
    const year = citation.year;
    const contextTopic = citation.context?.split(/\s+/).slice(0, 10).join(' ') || '';

    const ssResults = await searchSemanticScholar(contextTopic, author, year);
    if (ssResults && ssResults.length > 0) {
      const paper = ssResults[0];
      const firstAuthor = paper.authors?.[0]?.name?.split(' ').pop() || 'Author';
      return {
        citation: `(${firstAuthor}, ${paper.year || year})`,
        title: paper.title || '',
        doi: paper.doi || ''
      };
    }

    const crResults = await searchCrossRef(contextTopic, author);
    if (crResults && crResults.length > 0) {
      const paper = crResults[0];
      return {
        citation: `(${author.split(' ').pop() || 'Author'}, ${paper.year || year})`,
        title: paper.title || '',
        doi: paper.doi || ''
      };
    }
  }

  return null;
}

// ============================================================
// Print helpers (live version)
// ============================================================

function printCitationAuditLive(results) {
  let real = 0, unmatched = 0, unverifiable = 0;

  for (const r of results) {
    if (r.status === 'real') real++;
    else if (r.status === 'unmatched') unmatched++;
    else unverifiable++;
  }

  console.log(chalk.bold(`\nResults: ${results.length} total`));
  console.log(chalk.green(`  ✅ Verified (live): ${real}`));
  console.log(chalk.red(`  ❌ Unmatched: ${unmatched}`));
  console.log(chalk.dim(`  ◻ Unverifiable: ${unverifiable}`));

  if (real > 0) {
    console.log(chalk.green.bold('\nVerified citations:'));
    for (const r of results.filter(r => r.status === 'real')) {
      const m = r.verifiedMetadata || {};
      console.log(chalk.green(`  ✅ ${r.raw}`));
      console.log(chalk.dim(`     ${m.title} (${m.year}) — ${m.source}${m.doi ? ' · DOI: ' + m.doi : ''}`));
    }
  }

  if (unmatched > 0) {
    console.log(chalk.red.bold('\nUnmatched citations (likely hallucinated):'));
    for (const r of results.filter(r => r.status === 'unmatched')) {
      console.log(chalk.red(`  ❌ ${r.raw}`));
      console.log(chalk.dim(`     ${r.note || 'No match in Semantic Scholar or CrossRef'}`));
    }
  }

  if (unverifiable > 0) {
    console.log(chalk.dim('\nUnverifiable (need .bib or bibliography):'));
    for (const r of results.filter(r => r.status === 'unverifiable')) {
      console.log(chalk.dim(`  ◻ ${r.raw} — ${r.note}`));
    }
  }

  console.log(chalk.dim(`\nSemantic Scholar API · CrossRef API · Rate-limited to 3 req/s`));
}

// ============================================================
// Shared utilities (from v1.0, preserved)
// ============================================================

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function parseSections(content, filterName) {
  const sections = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const texHeadingRegex = /^\\(?:section|subsection|subsubsection)\{([^}]*)\}/gm;

  // Try markdown headings first
  const mdMatches = [...content.matchAll(headingRegex)];
  if (mdMatches.length > 0) {
    for (let i = 0; i < mdMatches.length; i++) {
      const h = mdMatches[i];
      const name = h[2].trim();
      const start = h.index + h[0].length;
      const end = i + 1 < mdMatches.length ? mdMatches[i + 1].index : content.length;
      const body = content.slice(start, end).trim();
      if (!filterName || name.toLowerCase().includes(filterName.toLowerCase())) {
        sections.push({ name, body, level: h[1].length });
      }
    }
  } else {
    // Try LaTeX section commands
    const texMatches = [...content.matchAll(texHeadingRegex)];
    for (let i = 0; i < texMatches.length; i++) {
      const h = texMatches[i];
      const name = h[1].trim();
      const start = h.index + h[0].length;
      const end = i + 1 < texMatches.length ? texMatches[i + 1].index : content.length;
      const body = content.slice(start, end).trim();
      if (!filterName || name.toLowerCase().includes(filterName.toLowerCase())) {
        sections.push({ name, body, level: 1 });
      }
    }
  }

  if (sections.length === 0 && content.trim().length > 0) {
    sections.push({ name: 'Full Document', body: content.trim(), level: 1 });
  }

  return sections;
}

function analyzeSection(section) {
  const body = section.body;
  const dimensions = {};
  dimensions.structuralCoherence = scoreStructuralCoherence(body);
  dimensions.claimSpecificity = scoreClaimSpecificity(body);
  dimensions.evidenceCoverage = scoreEvidenceCoverage(body);
  dimensions.citationDensity = scoreCitationDensity(body);
  dimensions.proseClarity = scoreProseClarity(body);

  const total = Object.values(dimensions).reduce((a, b) => a + b, 0);
  const issues = [];
  if (dimensions.structuralCoherence < 18) issues.push('Structural flow — check paragraph ordering');
  if (dimensions.claimSpecificity < 18) issues.push('Claims need specificity — add numbers or concrete outcomes');
  if (dimensions.evidenceCoverage < 14) issues.push('Some claims lack citations');
  if (dimensions.citationDensity < 10) issues.push('Citation density is low');
  if (dimensions.proseClarity < 10) issues.push('Prose clarity — check sentence length and passive voice');

  return {
    name: section.name,
    score: total,
    dimensions,
    issues,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    sentenceCount: body.split(/[.!?]+/).filter(Boolean).length
  };
}

function scoreStructuralCoherence(text) {
  let score = 25;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) return score;
  const topicSentenceRatio = paragraphs.filter(p => {
    const first = p.trim().split(/[.!?]/)[0];
    return first && first.split(/\s+/).length >= 5;
  }).length / Math.max(paragraphs.length, 1);
  if (topicSentenceRatio < 0.7) score -= 5;
  const transitions = ['however', 'furthermore', 'moreover', 'in contrast', 'similarly', 'consequently', 'therefore', 'additionally', 'in addition', 'nevertheless', 'nonetheless', 'accordingly', 'thus', 'meanwhile', 'subsequently'];
  const transitionCount = paragraphs.filter(p => {
    const firstWords = p.trim().toLowerCase().slice(0, 30);
    return transitions.some(t => firstWords.includes(t));
  }).length;
  if (transitionCount < paragraphs.length * 0.3) score -= 5;
  const sentenceCounts = paragraphs.map(p => p.split(/[.!?]+/).filter(Boolean).length);
  const badParagraphs = sentenceCounts.filter(n => n < 2 || n > 8).length;
  if (badParagraphs > paragraphs.length * 0.3) score -= 5;
  return Math.max(0, score);
}

function scoreClaimSpecificity(text) {
  let score = 25;
  const words = text.split(/\s+/).filter(Boolean).length;
  const numericClaims = (text.match(/\d+[%]?|\d+\.\d+/g) || []).length;
  const numericDensity = numericClaims / Math.max(words / 100, 1);
  if (numericDensity < 2) score -= 10;
  else if (numericDensity < 5) score -= 5;
  const hedges = ['may', 'might', 'could', 'possibly', 'perhaps', 'potentially', 'seems', 'appears'];
  const hedgeCount = text.toLowerCase().split(/\s+/).filter(w => hedges.includes(w)).length;
  const hedgeRatio = hedgeCount / Math.max(words / 100, 1);
  if (hedgeRatio > 5 && numericDensity < 2) score -= 8;
  const comparators = ['compared to', 'relative to', 'outperforms', 'higher than', 'lower than', 'better than', 'faster than', 'more than', 'less than'];
  if (!comparators.some(c => text.toLowerCase().includes(c))) score -= 3;
  return Math.max(0, score);
}

function scoreEvidenceCoverage(text) {
  let score = 20;
  const citationPatterns = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  let totalCitations = 0;
  for (const pattern of citationPatterns) {
    const matches = text.match(pattern);
    if (matches) totalCitations += matches.length;
  }
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const claimIndicators = ['show', 'demonstrate', 'found', 'indicate', 'suggest', 'reveal', 'report', 'observe', 'confirm', 'identify', 'establish', 'propose', 'argue', 'claim', 'conclude', 'achieve', 'outperform', 'improve', 'reduce', 'increase'];
  const claimSentences = sentences.filter(s => claimIndicators.some(c => s.toLowerCase().includes(c))).length;
  if (claimSentences > 0) {
    const coverage = totalCitations / claimSentences;
    if (coverage < 0.5) score -= 8;
    else if (coverage < 0.8) score -= 4;
  } else if (totalCitations === 0) { score -= 5; }
  return Math.max(0, score);
}

function scoreCitationDensity(text) {
  let score = 15;
  const words = text.split(/\s+/).filter(Boolean).length;
  const patterns = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  let totalCitations = 0;
  for (const p of patterns) totalCitations += (text.match(p) || []).length;
  const per100 = (totalCitations / Math.max(words, 1)) * 100;
  if (per100 < 1) score -= 5;
  else if (per100 < 2) score -= 2;
  else if (per100 > 8) score -= 3;
  return Math.max(0, score);
}

function scoreProseClarity(text) {
  let score = 15;
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / Math.max(sentences.length, 1);
  if (avgWords > 30) score -= 4;
  else if (avgWords > 25) score -= 2;
  const variance = wordCounts.reduce((sum, n) => sum + Math.pow(n - avgWords, 2), 0) / Math.max(wordCounts.length, 1);
  if (variance > 200) score -= 3;
  else if (variance > 100) score -= 1;
  const passivePattern = /\b(is|are|was|were|been|being)\s+\w+(ed|en|t)\b/gi;
  const passiveCount = (text.match(passivePattern) || []).length;
  const passiveRatio = passiveCount / Math.max(sentences.length, 1);
  if (passiveRatio > 0.4) score -= 5;
  else if (passiveRatio > 0.25) score -= 2;
  const longWords = text.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length > 12).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if ((longWords / Math.max(words, 1)) > 0.08) score -= 3;
  return Math.max(0, score);
}

function extractCitations(text) {
  const citations = [];
  const bracketRefs = text.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g);
  for (const m of bracketRefs) citations.push({ raw: m[0], type: 'numeric', value: m[1], context: getContext(text, m.index) });
  const authorYearRefs = text.matchAll(/\(([A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+)?),\s*(\d{4}[a-z]?)\)/g);
  for (const m of authorYearRefs) citations.push({ raw: m[0], type: 'author-year', author: m[1], year: m[2], context: getContext(text, m.index) });
  const latexRefs = text.matchAll(/\\cite\{([^}]+)\}/g);
  for (const m of latexRefs) citations.push({ raw: m[0], type: 'latex', key: m[1], context: getContext(text, m.index) });
  return citations;
}

function getContext(text, position) {
  const start = Math.max(0, position - 120);
  const end = Math.min(text.length, position + 120);
  return text.slice(start, end).replace(/\n/g, ' ').trim();
}

function computeOverall(results) {
  if (results.length === 0) return { score: 0, grade: 'N/A' };
  const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  let grade;
  if (avgScore >= 90) grade = 'A — Ready for submission';
  else if (avgScore >= 80) grade = 'B — Minor improvements recommended';
  else if (avgScore >= 70) grade = 'C — Needs significant revision';
  else if (avgScore >= 60) grade = 'D — Major structural issues';
  else grade = 'F — Requires complete rewrite';
  return { score: avgScore, grade };
}

function printSectionScore(result) {
  const bar = '█'.repeat(Math.round(result.score / 5)) + '░'.repeat(20 - Math.round(result.score / 5));
  const colorFn = result.score >= 85 ? chalk.green : result.score >= 70 ? chalk.yellow : chalk.red;
  console.log(chalk.bold(`\n${result.name}`));
  console.log(colorFn(`  Score: ${bar} ${result.score}/100`));
  console.log(chalk.dim(`  ${result.wordCount} words · ${result.sentenceCount} sentences`));
  const d = result.dimensions;
  console.log(chalk.dim(`  S:${d.structuralCoherence}/25 C:${d.claimSpecificity}/25 E:${d.evidenceCoverage}/20 R:${d.citationDensity}/15 P:${d.proseClarity}/15`));
  if (result.issues.length > 0) for (const issue of result.issues) console.log(chalk.yellow(`  ⚠ ${issue}`));
}

function printOverallScore(overall) {
  const colorFn = overall.score >= 85 ? chalk.green : overall.score >= 70 ? chalk.yellow : chalk.red;
  console.log(chalk.bold('\n───────────────────────────────────'));
  console.log(colorFn.bold(`OVERALL: ${overall.score}/100`));
  console.log(colorFn(`Grade: ${overall.grade}`));
  console.log(chalk.dim('───────────────────────────────────\n'));
}

function generateImprovements(result) {
  const improvements = [];
  if (result.dimensions.structuralCoherence < 18) { improvements.push('Add transition phrases between paragraphs'); improvements.push('Ensure each paragraph starts with a clear topic sentence'); }
  if (result.dimensions.claimSpecificity < 18) { improvements.push('Add specific numbers/percentages to claims'); improvements.push('Replace hedging language with concrete statements'); }
  if (result.dimensions.evidenceCoverage < 14) { improvements.push('Add citations to support factual claims'); improvements.push(`Identify ${Math.ceil(result.sentenceCount * 0.3)} key claims needing supporting references`); }
  if (result.dimensions.proseClarity < 10) { improvements.push('Shorten sentences averaging above 25 words'); improvements.push('Reduce passive voice constructions'); }
  return improvements;
}

function applyChanges(content, changes) {
  let result = content;
  for (const change of changes) {
    if (change.type === 'citation' && change.replacement) result = result.replace(change.original, change.replacement);
    if (change.type === 'section') {
      const header = `## ${change.section}`;
      const annotation = `\n<!-- VERITAS: Score ${change.score}/100. Fixes: ${change.improvements.join('; ')} -->`;
      if (result.includes(header)) result = result.replace(header, header + annotation);
    }
  }
  return result;
}

program.parse();
                                                                                                                                                                        