// Veritas v2.2 - Shared Scoring Engine
// Used by CLI (cli.js) and Browser Extension (extension/content.js)

export function parseSections(content, filterName) {
  const sections = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const texHeadingRegex = /\\(?:section|subsection|subsubsection)\{([^}]*)\}/gm;
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
    if (sections.length > 0) return sections;
  }
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
  if (sections.length === 0 && content.trim().length > 0) {
    sections.push({ name: 'Full Document', body: content.trim(), level: 1 });
  }
  return sections;
}

export function analyzeSection(section) {
  const body = section.body;
  const dimensions = {};
  dimensions.structuralCoherence = scoreStructuralCoherence(body);
  dimensions.claimSpecificity = scoreClaimSpecificity(body);
  dimensions.evidenceCoverage = scoreEvidenceCoverage(body);
  dimensions.citationDensity = scoreCitationDensity(body);
  dimensions.proseClarity = scoreProseClarity(body);
  const total = Object.values(dimensions).reduce((a, b) => a + b, 0);
  const issues = [];
  if (dimensions.structuralCoherence < 18) issues.push('Structural flow - check paragraph ordering');
  if (dimensions.claimSpecificity < 18) issues.push('Claims need specificity - add numbers or concrete outcomes');
  if (dimensions.evidenceCoverage < 14) issues.push('Some claims lack citations');
  if (dimensions.citationDensity < 10) issues.push('Citation density is low');
  if (dimensions.proseClarity < 10) issues.push('Prose clarity - check sentence length and passive voice');
  return {
    name: section.name,
    score: total,
    dimensions,
    issues,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    sentenceCount: body.split(/[.!?]+/).filter(Boolean).length
  };
}

export function scoreStructuralCoherence(text) {
  let score = 25;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) return score;
  const topicSentenceRatio = paragraphs.filter(p => {
    const first = p.trim().split(/[.!?]/)[0];
    return first && first.split(/\s+/).length >= 5;
  }).length / Math.max(paragraphs.length, 1);
  if (topicSentenceRatio < 0.7) score -= 5;
  const transitions = ['however','furthermore','moreover','in contrast','similarly','consequently','therefore','additionally','in addition','nevertheless','nonetheless','accordingly','thus','meanwhile','subsequently'];
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

export function scoreClaimSpecificity(text) {
  let score = 25;
  const words = text.split(/\s+/).filter(Boolean).length;
  const numericClaims = (text.match(/\d+\.\d+%?|\d+[%]?/g) || []).length;
  const numericDensity = numericClaims / Math.max(words / 100, 1);
  if (numericDensity < 2) score -= 10;
  else if (numericDensity < 5) score -= 5;
  const hedges = ['may','might','could','possibly','perhaps','potentially','seems','appears'];
  const hedgeCount = text.toLowerCase().split(/\s+/).filter(w => hedges.includes(w)).length;
  const hedgeRatio = hedgeCount / Math.max(words / 100, 1);
  if (hedgeRatio > 5 && numericDensity < 2) score -= 8;
  const comparators = ['compared to','relative to','outperforms','higher than','lower than','better than','faster than','more than','less than'];
  if (!comparators.some(c => text.toLowerCase().includes(c))) score -= 3;
  return Math.max(0, score);
}

export function scoreEvidenceCoverage(text) {
  let score = 20;
  const patterns = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  let totalCitations = 0;
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) totalCitations += matches.length;
  }
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const claimIndicators = ['show','demonstrate','found','indicate','suggest','reveal','report','observe','confirm','identify','establish','propose','argue','claim','conclude','achieve','outperform','improve','reduce','increase'];
  const claimSentences = sentences.filter(s => claimIndicators.some(c => s.toLowerCase().includes(c))).length;
  if (claimSentences > 0) {
    const coverage = totalCitations / claimSentences;
    if (coverage < 0.5) score -= 8;
    else if (coverage < 0.8) score -= 4;
  } else if (totalCitations === 0) { score -= 5; }
  else if (totalCitations > 0) { score -= 3; } // citations without claim sentences
  return Math.max(0, score);
}

export function scoreCitationDensity(text) {
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

export function scoreProseClarity(text) {
  let score = 15;
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const wordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / Math.max(sentences.length, 1);
  if (avgWords > 30) score -= 4;
  else if (avgWords > 25) score -= 2;
  const variance = wordCounts.reduce((sum, n) => sum + Math.pow(n - avgWords, 2), 0) / Math.max(wordCounts.length, 1);
  if (variance > 200) score -= 3;
  else if (variance > 100) score -= 1;
  const PASSIVE_PATTERN = /\b(is|are|was|were|been|being)\s+\w{3,}(ed|en)\b/gi;
  const passiveCount = (text.match(PASSIVE_PATTERN) || []).length;
  const passiveRatio = passiveCount / Math.max(sentences.length, 1);
  if (passiveRatio > 0.4) score -= 5;
  else if (passiveRatio > 0.25) score -= 2;
  const longWords = text.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length > 12).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if ((longWords / Math.max(words, 1)) > 0.08) score -= 3;
  return Math.max(0, score);
}

export function extractCitations(text) {
  const citations = [];
  for (const m of text.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g)) citations.push({ raw: m[0], type: 'numeric', value: m[1], context: getContext(text, m.index) });
  for (const m of text.matchAll(/\(([A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+)?),\s*(\d{4}[a-z]?)\)/g)) citations.push({ raw: m[0], type: 'author-year', author: m[1], year: m[2], context: getContext(text, m.index) });
  for (const m of text.matchAll(/\\cite\{([^}]+)\}/g)) citations.push({ raw: m[0], type: 'latex', key: m[1], context: getContext(text, m.index) });
  return citations;
}

function getContext(text, position) {
  const start = Math.max(0, position - 120);
  const end = Math.min(text.length, position + 120);
  return text.slice(start, end).replace(/\n/g, ' ').trim();
}

export function computeOverall(results) {
  if (results.length === 0) return { score: 0, grade: 'N/A' };
  const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  let grade;
  if (avgScore >= 90) grade = 'A - Ready for submission';
  else if (avgScore >= 80) grade = 'B - Minor improvements recommended';
  else if (avgScore >= 70) grade = 'C - Needs significant revision';
  else if (avgScore >= 60) grade = 'D - Major structural issues';
  else grade = 'F - Requires complete rewrite';
  return { score: avgScore, grade };
}

export function generateImprovements(result) {
  const improvements = [];
  if (result.dimensions.structuralCoherence < 18) { improvements.push('Add transition phrases between paragraphs'); improvements.push('Ensure each paragraph starts with a clear topic sentence'); }
  if (result.dimensions.claimSpecificity < 18) { improvements.push('Add specific numbers/percentages to claims'); improvements.push('Replace hedging language with concrete statements'); }
  if (result.dimensions.evidenceCoverage < 14) { improvements.push('Add citations to support factual claims'); improvements.push('Identify ' + Math.ceil(result.sentenceCount * 0.3) + ' key claims needing supporting references'); }
  if (result.dimensions.proseClarity < 10) { improvements.push('Shorten sentences averaging above 25 words'); improvements.push('Reduce passive voice constructions'); }
  return improvements;
}

export function improveSectionText(text, dimensions) {
  let improved = text;
  if (dimensions.proseClarity < 10) {
    const presentMap = { demonstrated: 'demonstrates', shown: 'shows', found: 'finds', reported: 'reports', observed: 'observes', confirmed: 'confirms', identified: 'identifies', established: 'establishes' };
    improved = improved.replace(/\b(is|are|was|were|been|being)\s+(\w+ed)\b\s+by\s+\w[\w\s,]+/gi, function(match, aux, verb) {
      return presentMap[verb.toLowerCase()] || verb;
    });
    improved = improved.replace(/\b(is|are|was|were|been|being)\s+(\w+ed)\b/gi, function(_, aux, verb) {
      return presentMap[verb.toLowerCase()] || verb;
    });
  }
  if (dimensions.claimSpecificity < 18) {
    improved = improved.replace(/\b(may|might|could|possibly|perhaps|potentially) be\b/gi, 'is');
    improved = improved.replace(/\bseems to\b/gi, '');
    improved = improved.replace(/\bappears to\b/gi, '');
    improved = improved.replace(/\b(may|might|could) (indicate|suggest|show|demonstrate)\b/gi, '$2s');
  }
  if (dimensions.structuralCoherence < 18) {
    const paragraphs = improved.split(/\n\s*\n/);
    if (paragraphs.length > 1) {
      const trans = ['Furthermore', 'Additionally', 'Moreover', 'In addition'];
      for (let i = 1; i < paragraphs.length; i++) {
        const p = paragraphs[i].trim();
        if (p.length > 0 && !/^(However|Furthermore|Moreover|In contrast|Similarly|Consequently|Therefore|Additionally|In addition|Nevertheless|Nonetheless|Accordingly|Thus|Meanwhile|Subsequently)/i.test(p)) {
          paragraphs[i] = trans[i % trans.length] + ', ' + p[0].toLowerCase() + p.slice(1);
        }
      }
      improved = paragraphs.join('\n\n');
    }
  }
  if (dimensions.claimSpecificity < 18) {
    improved = improved.replace(/\b(significantly|substantially|considerably) (improved|increased|decreased|reduced)\b/gi,
      '[$1 $2 - add specific percentage, e.g., "significantly improved by 23%"]');
  }
  if (dimensions.evidenceCoverage < 14) {
    var sentences = improved.split(/(?<=[.!?])\s+/);
    var claimRegex = /(show|demonstrate|found|indicate|suggest|reveal|report|observe|confirm|identify|establish|propose|argue|claim|conclude|achieve|outperform|improve|reduce|increase)s?\b/i;
    var citeRegex = /\([A-Z].*\d{4}\)|\\cite\{|\[\d+\]/;
    var added = 0;
    for (var i = 0; i < sentences.length && added < 3; i++) {
      var s = sentences[i];
      var needsCitation = claimRegex.test(s) && !citeRegex.test(s) && s.indexOf('[CITATION NEEDED]') < 0;
      if (needsCitation) {
        sentences[i] = s.replace(/([.!?])$/, ' [CITATION NEEDED]$1');
        added++;
      }
    }
    improved = sentences.join(' ');
  }
  return improved;
}
