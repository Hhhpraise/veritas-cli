#!/usr/bin/env node
// Veritas v2.2 — Multi-format academic paper quality scoring, live citation verification, claim dependency graph
// Usage: veritas <command> [options]

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import {
  parseSections, analyzeSection, computeOverall, generateImprovements,
  extractCitations, improveSectionText
} from './lib/scoring.js';
import { extractClaims, buildDependencyGraph, analyzeImpact } from './lib/claims.js';

const VERSION = '2.2.0';
const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';
const CROSSREF_API = 'https://api.crossref.org/works';

const program = new Command();
program
  .name('veritas')
  .description('Academic paper quality scoring, citation verification, claim dependency graph, and one-click repair')
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
    return { content: fs.readFileSync(filepath, 'utf-8'), format: ext === '.md' ? 'markdown' : 'text' };
  }

  if (ext === '.tex') {
    let content = fs.readFileSync(filepath, 'utf-8');
    content = content.replace(/\\(?:section|subsection|subsubsection)\{([^}]*)\}/g, '## $1');
    if (bibPath && fs.existsSync(bibPath)) {
      const bib = fs.readFileSync(bibPath, 'utf-8');
      content += '\n\n' + bib;
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
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    return { content: text, format: 'html' };
  }

  return { content: fs.readFileSync(filepath, 'utf-8'), format: 'unknown' };
}

function extractTextFromPDF(filepath) {
  try {
    return execFileSync('pdftotext', [filepath, '-'], { encoding: 'utf-8', timeout: 10000 });
  } catch (e) {
    if (process.env.VERITAS_VERBOSE) console.error(chalk.dim('[debug] pdftotext extraction failed: ' + e.message));
    return `[PDF text extraction requires pdftotext (poppler-utils). Cannot extract text from ${filepath}. Install poppler-utils.]`;
  }
}

function extractTextFromDocx(filepath) {
  try {
    const rawXml = execFileSync('unzip', ['-p', filepath, 'word/document.xml'], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    return rawXml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    if (process.env.VERITAS_VERBOSE) console.error(chalk.dim('[debug] DOCX extraction failed: ' + e.message));
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
// Live API verification with confidence scoring
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
    let queryParts = [];
    if (title && title.length > 3) queryParts.push(`title:"${encodeURIComponent(title.slice(0, 120))}"`);
    if (author) queryParts.push(`author:"${encodeURIComponent(author)}"`);
    if ((title || author) && year) queryParts.push(`year:${year}-${year}`);
    const query = queryParts.length >= 2 ? queryParts.join('+') :
      (title ? `title:${encodeURIComponent(title.slice(0, 80))}` : '');
    if (!query) return null;

    const url = `${SEMANTIC_SCHOLAR_API}/paper/search?query=${query}&limit=3&fields=title,authors,year,doi,journal,externalIds,abstract`;
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
    if (title && title.length > 3) params.push(`query.title=${encodeURIComponent(title.slice(0, 150))}`);
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

function computeConfidence(query, match) {
  const reasons = [];
  let score = 0;

  if (query.author && match.authors) {
    const matchAuthors = Array.isArray(match.authors)
      ? match.authors.map(a => (a.name || a).toLowerCase())
      : [String(match.author || '').toLowerCase()];
    const queryAuthor = query.author.toLowerCase();
    const authorMatch = matchAuthors.some(ma => ma.includes(queryAuthor) || queryAuthor.includes(ma));
    if (authorMatch) { score++; reasons.push('author match'); }
    else { reasons.push('author mismatch'); }
  }

  const queryYear = parseInt(query.year);
  const matchYear = parseInt(match.year);
  if (queryYear && matchYear) {
    const yearDiff = Math.abs(queryYear - matchYear);
    if (yearDiff <= 1) { score++; reasons.push('year match'); }
    else if (yearDiff <= 3) { reasons.push('year close'); }
    else { reasons.push('year mismatch'); }
  }

  if (query.title && match.title) {
    const qWords = new Set(query.title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const mWords = new Set(match.title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const overlap = [...qWords].filter(w => mWords.has(w)).length / Math.max(qWords.size, 1);
    if (overlap > 0.3) { score++; reasons.push('title overlap'); }
    else { reasons.push('low title overlap'); }
  }

  const confidence = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { confidence, score, reasons };
}

async function verifyCitationLive(citation, bibEntries) {
  if (citation.type === 'latex' && bibEntries) {
    const resolved = resolveLatexCitation(citation.key, bibEntries);
    if (!resolved) {
      return { ...citation, status: 'unresolvable', confidence: 'low', note: `Cite key "${citation.key}" not found in .bib file` };
    }
    const [ssResults, crResults] = await Promise.all([
      searchSemanticScholar(resolved.title, resolved.author?.split(',')[0]?.trim(), resolved.year),
      searchCrossRef(resolved.title, resolved.author?.split(',')[0]?.trim())
    ]);
    const ssMatch = findBestMatch(resolved, ssResults);
    const crMatch = crResults && crResults.length > 0 ? crResults[0] : null;
    return buildVerificationResult(citation, resolved, ssMatch, crMatch);
  }

  if (citation.type === 'author-year') {
    const author = citation.author;
    const year = citation.year;
    const contextWords = (citation.context || '').split(/\s+/);
    const significant = contextWords
      .filter(w => w.length > 4 && !/^(which|that|these|those|their|about|with|from|this)$/i.test(w))
      .slice(0, 8);
    const searchTitle = significant.join(' ');

    const [ssResults, crResults] = await Promise.all([
      searchSemanticScholar(searchTitle, author, year),
      searchCrossRef(searchTitle, author)
    ]);

    const query = { title: searchTitle, author, year };
    const ssMatch = findBestMatch(query, ssResults);
    const crMatch = crResults && crResults.length > 0 ? crResults[0] : null;
    return buildVerificationResult(citation, query, ssMatch, crMatch);
  }

  if (citation.type === 'numeric') {
    return { ...citation, status: 'unverifiable', confidence: 'low', note: 'Numeric citations require a .bib file for verification' };
  }

  return { ...citation, status: 'unverifiable', confidence: 'low' };
}

function findBestMatch(query, results) {
  if (!results || results.length === 0) return null;
  const queryYear = query.year?.toString();
  for (const r of results) {
    const rYear = r.year?.toString() || '';
    if (queryYear && rYear === queryYear) {
      if (query.author && r.authors) {
        const matchAuthors = Array.isArray(r.authors)
          ? r.authors.map(a => (a.name || a).toLowerCase())
          : [String(r.author || '').toLowerCase()];
        if (matchAuthors.some(ma => ma.includes(query.author.toLowerCase()))) return r;
      }
    }
  }
  for (const r of results) {
    if (r.year?.toString() === queryYear) return r;
  }
  return results[0];
}

function buildVerificationResult(citation, query, ssMatch, crMatch) {
  const matchedPaper = ssMatch || crMatch;
  if (!matchedPaper) {
    return { ...citation, status: 'unmatched', confidence: 'low', note: 'No match found in Semantic Scholar or CrossRef — likely hallucinated' };
  }

  const mid = {
    title: matchedPaper.title || '',
    authors: matchedPaper.authors
      ? matchedPaper.authors.map(a => a.name || a).join(', ')
      : (matchedPaper.author || ''),
    year: (matchedPaper.year || '').toString(),
    doi: matchedPaper.doi || matchedPaper.DOI || '',
    source: ssMatch ? 'Semantic Scholar' : 'CrossRef'
  };
  const { confidence, reasons } = computeConfidence(query, mid);

  return {
    ...citation,
    status: 'real',
    confidence,
    confidenceReasons: reasons,
    verifiedMetadata: mid,
    action: `Verified: ${mid.title} (${mid.year})${mid.doi ? ' — DOI: ' + mid.doi : ''} [${confidence} confidence]`
  };
}

async function findReplacementLive(citation) {
  if (citation.type === 'author-year') {
    const author = citation.author;
    const year = citation.year;
    const contextTopic = citation.context?.split(/\s+/)
      .filter(w => w.length > 4 && !/^(which|that|these|those|their|about|with|from|this)$/i.test(w))
      .slice(0, 10).join(' ') || '';
    const ssResults = await searchSemanticScholar(contextTopic, author, year);
    if (ssResults && ssResults.length > 0) {
      const paper = ssResults[0];
      const firstAuthor = paper.authors?.[0]?.name?.split(' ').pop() || 'Author';
      return { citation: `(${firstAuthor}, ${paper.year || year})`, title: paper.title || '', doi: paper.doi || '' };
    }
    const crResults = await searchCrossRef(contextTopic, author);
    if (crResults && crResults.length > 0) {
      const paper = crResults[0];
      return { citation: `(${author.split(' ').pop() || 'Author'}, ${paper.year || year})`, title: paper.title || '', doi: paper.doi || '' };
    }
  }
  return null;
}

// ============================================================
// Print helpers
// ============================================================

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

function printCitationAuditLive(results) {
  let real = 0, unmatched = 0, unverifiable = 0, highConf = 0, medConf = 0, lowConf = 0;
  for (const r of results) {
    if (r.status === 'real') {
      real++;
      if (r.confidence === 'high') highConf++;
      else if (r.confidence === 'medium') medConf++;
      else lowConf++;
    } else if (r.status === 'unmatched') unmatched++;
    else unverifiable++;
  }
  console.log(chalk.bold(`\nResults: ${results.length} total`));
  console.log(chalk.green(`  ✅ Verified (live): ${real}`));
  if (real > 0) console.log(chalk.dim(`     High: ${highConf} · Medium: ${medConf} · Low: ${lowConf}`));
  console.log(chalk.red(`  ❌ Unmatched: ${unmatched}`));
  console.log(chalk.dim(`  ◻ Unverifiable: ${unverifiable}`));
  if (real > 0) {
    console.log(chalk.green.bold('\nVerified citations:'));
    for (const r of results.filter(r => r.status === 'real')) {
      const m = r.verifiedMetadata || {};
      const confColor = r.confidence === 'high' ? chalk.green : r.confidence === 'medium' ? chalk.yellow : chalk.dim;
      console.log(confColor(`  ✅ ${r.raw} [${r.confidence}]`));
      console.log(chalk.dim(`     ${m.title} (${m.year}) — ${m.source}${m.doi ? ' · DOI: ' + m.doi : ''}`));
    }
  }
  if (unmatched > 0) {
    console.log(chalk.red.bold('\nUnmatched citations:'));
    for (const r of results.filter(r => r.status === 'unmatched')) {
      console.log(chalk.red(`  ❌ ${r.raw} — ${r.note || 'No match found'}`));
    }
  }
  if (unverifiable > 0) {
    console.log(chalk.dim('\nUnverifiable:'));
    for (const r of results.filter(r => r.status === 'unverifiable')) {
      console.log(chalk.dim(`  ◻ ${r.raw} — ${r.note}`));
    }
  }
  console.log(chalk.dim(`\nSemantic Scholar API · CrossRef API · Rate-limited to 3 req/s`));
}

function printGraphReport(graph, sections) {
  console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║   VERITAS — Claim Dependency Graph  ║'));
  console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));
  console.log(chalk.bold(`Claims extracted: ${graph.claims.length}`));
  console.log(chalk.bold(`Dependencies found: ${graph.dependencies.length}\n`));

  const bySection = {};
  for (const claim of graph.claims) {
    const sec = claim.sectionName || 'Unknown';
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(claim);
  }
  for (const [section, claims] of Object.entries(bySection)) {
    console.log(chalk.bold(`${section}`) + chalk.dim(` (${claims.length} claims)`));
    for (const claim of claims) {
      const depCount = graph.dependencies.filter(d => d.from === claim.id).length;
      const supCount = graph.dependencies.filter(d => d.to === claim.id).length;
      const flags = [];
      if (depCount > 0) flags.push(`→${depCount}`);
      if (supCount > 0) flags.push(`←${supCount}`);
      const flagStr = flags.length > 0 ? chalk.dim(` [${flags.join(' ')}]`) : '';
      console.log(chalk.dim(`  ${claim.id}:`) + ` ${claim.text.slice(0, 100)}...` + flagStr);
    }
    console.log('');
  }
  console.log(chalk.bold('Impact Analysis:'));
  console.log(chalk.dim('If you modify a claim, dependent claims are flagged for review.\n'));
  for (const claim of graph.claims) {
    const impacted = analyzeImpact(graph, claim.id);
    if (impacted.length > 0) {
      console.log(chalk.yellow(`  ${claim.id}`) + chalk.dim(` → impacts ${impacted.length} claim(s):`));
      for (const imp of impacted) {
        console.log(chalk.dim(`    ${imp.type === 'supports' ? '↳ supports' : '↳ informs'} ${imp.target}`));
      }
    }
  }
  console.log('');
}

// ============================================================
// applyChanges — apply section text improvements + citation replacements
// ============================================================

function applyChanges(content, changes, improvedSections) {
  let result = content;

  // Apply section improvements (rewrite section bodies with real text)
  if (improvedSections) {
    for (const [sectionName, improvedText] of Object.entries(improvedSections)) {
      const headingPattern = new RegExp(
        `(##\\s+${escapeRegex(sectionName)}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, 'i'
      );
      if (headingPattern.test(result)) {
        result = result.replace(headingPattern, `$1${improvedText}\n`);
      } else {
        result += `\n<!-- VERITAS: Improved "${sectionName}" section -->\n${improvedText}`;
      }
    }
  }

  // Apply citation replacements
  for (const change of changes) {
    if (change.type === 'citation' && change.replacement) {
      result = result.replace(change.original, change.replacement);
    }
  }

  return result;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Commands
// ============================================================

program
  .command('analyze <file>')
  .description('Score a paper section by section across 5 quality dimensions')
  .option('-f, --format <type>', 'output format (terminal, json)', 'terminal')
  .option('-s, --section <name>', 'analyze only a specific section')
  .action(async (file, options) => {
    const { content: raw, format } = readAnyFile(file);
    const sections = parseSections(raw, options.section);

    if (sections.length === 0) {
      console.log(chalk.red('No sections found in the document.'));
      process.exit(1);
    }

    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║   VERITAS v2.2 — Paper Quality Analysis ║'));
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
  .description('Live-verify citations against Semantic Scholar and CrossRef, with confidence scoring')
  .option('--bib <file>', 'BibTeX file (for LaTeX .tex papers)')
  .option('-f, --format <type>', 'output format (terminal, json)', 'terminal')
  .action(async (file, options) => {
    const { content: raw, format } = readAnyFile(file, options.bib);
    const citations = extractCitations(raw);

    if (citations.length === 0) {
      console.log(chalk.yellow('No citations detected.'));
      process.exit(1);
    }

    let bibEntries = [];
    if (options.bib && fs.existsSync(options.bib)) {
      bibEntries = parseBibTeX(fs.readFileSync(options.bib, 'utf-8'));
      console.log(chalk.dim(`Loaded ${bibEntries.length} entries from ${options.bib}\n`));
    }
    if (!options.bib && format === 'latex') {
      const autoBib = file.replace(/\.tex$/, '.bib');
      if (fs.existsSync(autoBib)) {
        bibEntries = parseBibTeX(fs.readFileSync(autoBib, 'utf-8'));
        console.log(chalk.dim(`Auto-detected ${bibEntries.length} entries in ${autoBib}\n`));
      }
    }

    console.log(chalk.bold.blue('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║   VERITAS — Live Citation Audit     ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════╝\n'));
    console.log(chalk.dim(`Verifying ${citations.length} citations against Semantic Scholar & CrossRef...\n`));

    const results = [];
    for (let i = 0; i < citations.length; i += 3) {
      const batch = citations.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(c => verifyCitationLive(c, bibEntries)));
      results.push(...batchResults);
      if (i + 3 < citations.length) await sleep(1000);
    }

    if (options.format === 'terminal') {
      printCitationAuditLive(results);
    } else {
      console.log(JSON.stringify({ citations: results }, null, 2));
    }
  });

program
  .command('graph <file>')
  .description('Build and visualize the claim dependency graph — shows what depends on what')
  .option('--json', 'output as JSON')
  .action(async (file, options) => {
    const { content: raw } = readAnyFile(file);
    const sections = parseSections(raw);

    if (sections.length === 0) {
      console.log(chalk.red('No sections found.'));
      process.exit(1);
    }

    const graph = buildDependencyGraph(sections);

    if (options.json) {
      console.log(JSON.stringify({ graph, sectionCount: sections.length }, null, 2));
    } else {
      printGraphReport(graph, sections);
    }
  });

program
  .command('repair <file>')
  .description('Auto-repair: rewrite weak sections and replace hallucinated citations')
  .option('--bib <file>', 'BibTeX file (for LaTeX papers)')
  .option('--fix-citations', 'replace unverified/hallucinated citations with real ones')
  .option('--improve-sections', 'rewrite sections below target with real improvements')
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
      if (fs.existsSync(autoBib)) bibEntries = parseBibTeX(fs.readFileSync(autoBib, 'utf-8'));
    }

    // Pass section body for improvement
    const sectionMap = new Map(sections.map(s => [s.name, s.body]));
    const sectionResults = sections.map(s => {
      const r = analyzeSection(s);
      r.sectionBody = s.body;
      return r;
    });

    console.log(chalk.bold.green('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.green('║   VERITAS — One-Click Repair v2.2   ║'));
    console.log(chalk.bold.green('╚══════════════════════════════════════╝\n'));

    let changes = [];
    let improvedSections = {};

    const runCitationFix = options.fixCitations !== false;
    if (runCitationFix) {
      const citationResults = [];
      for (let i = 0; i < citations.length; i += 3) {
        const batch = citations.slice(i, i + 3);
        const br = await Promise.all(batch.map(c => verifyCitationLive(c, bibEntries)));
        citationResults.push(...br);
        if (i + 3 < citations.length) await sleep(1000);
      }

      const unverified = citationResults.filter(c =>
        c.status === 'unmatched' || c.status === 'hallucinated' || c.status === 'unresolvable' ||
        (c.confidence === 'low')
      );

      if (unverified.length > 0) {
        console.log(chalk.yellow(`\nFound ${unverified.length} unverified/low-confidence citation(s):`));
        for (const c of unverified) {
          console.log(chalk.red(`  ❌ ${c.raw} — ${c.confidenceReasons?.join(', ') || c.note || 'No match'}`));
          const replacement = await findReplacementLive(c);
          if (replacement) {
            changes.push({ type: 'citation', original: c.raw, replacement: replacement.citation, note: replacement.title });
            console.log(chalk.green(`     → ${replacement.citation} — ${replacement.title}`));
          } else {
            changes.push({ type: 'citation', original: c.raw, replacement: '[CITATION NEEDS MANUAL REVIEW]', note: '' });
            console.log(chalk.yellow('     → Manual review required.'));
          }
        }
      } else {
        console.log(chalk.green('All citations verified with acceptable confidence ✅'));
      }
    }

    const runSectionFix = options.improveSections !== false;
    if (runSectionFix) {
      const weak = sectionResults.filter(s => s.score < target);
      if (weak.length > 0) {
        console.log(chalk.yellow(`\nFound ${weak.length} section(s) below target score of ${target}:`));
        for (const w of weak) {
          const improvedText = improveSectionText(w.sectionBody, w.dimensions);
          const improvementNote = generateImprovements(w);
          changes.push({ type: 'section', section: w.name, score: w.score, improvements: improvementNote, target });
          improvedSections[w.name] = improvedText;
          console.log(chalk.dim(`  ${w.name}: ${w.score}/100 → applying ${improvementNote.length} improvement(s)`));
          for (const imp of improvementNote) console.log(chalk.cyan(`    → ${imp}`));
        }
      } else {
        console.log(chalk.green(`All sections at or above target score of ${target} ✅`));
      }
    }

    if (options.dryRun) {
      console.log(chalk.dim('\n--dry-run: no files written.'));
      const firstImproved = Object.entries(improvedSections)[0];
      if (firstImproved) {
        console.log(chalk.dim(`\nPreview of "${firstImproved[0]}" (first 300 chars):`));
        console.log(chalk.dim(firstImproved[1].slice(0, 300) + '...'));
      }
      return;
    }

    if (changes.length > 0) {
      let updated = applyChanges(raw, changes, improvedSections);
      const ext = path.extname(file);
      const backupPath = file.replace(new RegExp(`\\${ext}$`), `.veritas-backup${ext}`);
      fs.writeFileSync(backupPath, raw);
      fs.writeFileSync(file, updated);
      console.log(chalk.green('\n' + '\u2713' + ' Applied ' + changes.length + ' changes'));
      console.log(chalk.dim('  Backup: ' + backupPath));
    } else {
      console.log(chalk.dim('\nNo changes needed.'));
    }
  });

function sleep(ms) { return new Promise(function(resolve) { return setTimeout(resolve, ms); }); }

program.parse();
