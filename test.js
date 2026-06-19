// Veritas v2.2 - Test Suite
// Tests: V1 scoring + V2 LaTeX/BibTeX + V2.2 confidence/improvements
// Run: node test.js

var passed = 0;
var failed = 0;
function check(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// ---- Scoring ----
function scoreStructuralCoherence(text) {
  var s = 25;
  var p = text.split(/\n\s*\n/).filter(function(x) { return x.trim().length > 0; });
  if (p.length === 0) return s;
  var tsr = p.filter(function(x) { var f = x.trim().split(/[.!?]/)[0]; return f && f.split(/\s+/).length >= 5; }).length / Math.max(p.length, 1);
  if (tsr < 0.7) s -= 5;
  var tr = ['however','furthermore','moreover','in contrast','similarly','consequently','therefore','additionally','in addition','nevertheless','nonetheless','accordingly','thus','meanwhile','subsequently'];
  var tc = p.filter(function(x) { return tr.some(function(t) { return x.trim().toLowerCase().slice(0, 30).indexOf(t) >= 0; }); }).length;
  if (tc < p.length * 0.3) s -= 5;
  var sc = p.map(function(x) { return x.split(/[.!?]+/).filter(Boolean).length; });
  if (sc.filter(function(n) { return n < 2 || n > 8; }).length > p.length * 0.3) s -= 5;
  return Math.max(0, s);
}
function scoreClaimSpecificity(text) {
  var s = 25;
  var w = text.split(/\s+/).filter(Boolean).length;
  var nc = (text.match(/\d+[%]?|\d+\.\d+/g) || []).length;
  var nd = nc / Math.max(w / 100, 1);
  if (nd < 2) s -= 10; else if (nd < 5) s -= 5;
  var hedges = ['may','might','could','possibly','perhaps','potentially','seems','appears'];
  var hc = text.toLowerCase().split(/\s+/).filter(function(w) { return hedges.indexOf(w) >= 0; }).length;
  var hr = hc / Math.max(w / 100, 1);
  if (hr > 5 && nd < 2) s -= 8;
  var comps = ['compared to','relative to','outperforms','higher than','lower than','better than','faster than','more than','less than'];
  if (!comps.some(function(c) { return text.toLowerCase().indexOf(c) >= 0; })) s -= 3;
  return Math.max(0, s);
}
function scoreEvidenceCoverage(text) {
  var s = 20;
  var pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  var tc = 0; for (var i = 0; i < pats.length; i++) tc += (text.match(pats[i]) || []).length;
  var sent = text.split(/[.!?]+/).filter(Boolean);
  var ci = ['show','demonstrate','found','indicate','suggest','reveal','report','observe','confirm','identify','establish','propose','argue','claim','conclude','achieve','outperform','improve','reduce','increase'];
  var cs = sent.filter(function(x) { return ci.some(function(c) { return x.toLowerCase().indexOf(c) >= 0; }); }).length;
  if (cs > 0) { var cov = tc / cs; if (cov < 0.5) s -= 8; else if (cov < 0.8) s -= 4; }
  else if (tc === 0) s -= 5;
  return Math.max(0, s);
}
function scoreCitationDensity(text) {
  var s = 15;
  var w = text.split(/\s+/).filter(Boolean).length;
  var pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  var tc = 0; for (var i = 0; i < pats.length; i++) tc += (text.match(pats[i]) || []).length;
  var per100 = (tc / Math.max(w, 1)) * 100;
  if (per100 < 1) s -= 5; else if (per100 < 2) s -= 2; else if (per100 > 8) s -= 3;
  return Math.max(0, s);
}
function scoreProseClarity(text) {
  var s = 15;
  var sent = text.split(/[.!?]+/).filter(Boolean);
  var wc = sent.map(function(x) { return x.split(/\s+/).filter(Boolean).length; });
  var avg = wc.reduce(function(a,b) { return a + b; }, 0) / Math.max(sent.length, 1);
  if (avg > 30) s -= 4; else if (avg > 25) s -= 2;
  var vari = wc.reduce(function(sm,n) { return sm + Math.pow(n-avg,2); }, 0) / Math.max(wc.length, 1);
  if (vari > 200) s -= 3; else if (vari > 100) s -= 1;
  var pc = (text.match(/\b(is|are|was|were|been|being)\s+\w+(ed|en|t)\b/gi) || []).length;
  var pr = pc / Math.max(sent.length, 1);
  if (pr > 0.4) s -= 5; else if (pr > 0.25) s -= 2;
  var lw = text.split(/\s+/).filter(function(w) { return w.replace(/[^a-zA-Z]/g,'').length > 12; }).length;
  var tw = text.split(/\s+/).filter(Boolean).length;
  if ((lw / Math.max(tw, 1)) > 0.08) s -= 3;
  return Math.max(0, s);
}

// ---- V1 Scoring ----
console.log('--- V1: Scoring Engine ---');
var good = 'Recent advances in NLP have transformed text analysis. However, these methods introduce reproducibility challenges. Furthermore, benchmarks have come under scrutiny. Consequently, researchers now develop robust frameworks. These changes require careful consideration. In contrast to prior work, we focus on generalization.';
var poor = 'stuff about nlp. things changed. idk what to say. maybe there is something. probably not.';
check(scoreStructuralCoherence(good) > scoreStructuralCoherence(poor), 'Well-structured > poor');
var specific = 'Our model achieves 94.3% on ImageNet, outperforming ResNet-152 by 2.1 points. Training needs 3.2 GPU-hours vs 8.7 baseline. F1 improved from 0.76 to 0.89, a 17% improvement.';
var vague = 'Our model seems to work pretty well on most tasks that we tried. It might be better than some approaches in certain limited cases. The results appear promising.';
check(scoreClaimSpecificity(specific) > scoreClaimSpecificity(vague), 'Specific > vague');
var cited = 'Smith et al. (2023) found transformer biases. Our experiments confirm with new data [1]. Jones (2024) provides additional evidence [2,3].';
var nocite = 'Our experiments show great results. The methodology is sound and reproducible. We believe this approach will be widely adopted.';
check(scoreEvidenceCoverage(cited) > scoreEvidenceCoverage(nocite), 'Cited > uncited');
var dense = 'This paragraph (Smith, 2024) discusses one topic. The next point (Jones, 2023) covers another area. Research by Brown et al. (2022) provides the foundation. Finally recent work (Lee, 2025) extends these ideas.';
var sparse = 'This paragraph has no citations at all. It just makes claims without backing them up with any references.';
check(scoreCitationDensity(dense) > scoreCitationDensity(sparse), 'Dense > sparse citations');
var clear = 'The model achieves state-of-the-art results on three benchmarks. We provide detailed ablation studies for each component. The code is available on GitHub.';
var jargon = 'Notwithstanding the aforementioned methodological considerations pertaining to the operationalization of the construct under investigation, the paradigmatic framework necessitates elucidation.';
check(scoreProseClarity(clear) > scoreProseClarity(jargon), 'Clear > jargon prose');

// ---- V1 Citation Extraction ----
console.log('--- V1: Citation Extraction ---');
function extractCitations(text) {
  var cit = [];
  for (var m of text.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g)) cit.push({ raw: m[0], type: 'numeric', value: m[1], context: '' });
  for (var m2 of text.matchAll(/\(([A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+)?),\s*(\d{4}[a-z]?)\)/g)) cit.push({ raw: m2[0], type: 'author-year', author: m2[1], year: m2[2], context: '' });
  for (var m3 of text.matchAll(/\\cite\{([^}]+)\}/g)) cit.push({ raw: m3[0], type: 'latex', key: m3[1], context: '' });
  return cit;
}
var txt1 = 'As shown [1], the approach is effective. Further evidence [2,3] supports the claim.';
var ext1 = extractCitations(txt1);
check(ext1.length === 2, 'Extracts 2 bracket citations');
check(ext1.every(function(c) { return c.type === 'numeric'; }), 'Both are numeric');

// ---- V2 LaTeX cite extraction ----
console.log('--- V2: LaTeX cite extraction ---');
var latexText = 'Our approach \\cite{he2016deep} builds on prior work. As demonstrated by \\cite{vaswani2017attention}, the transformer provides a foundation. We also draw from \\cite{brown2020language}.';
var latexExt = extractCitations(latexText);
check(latexExt.filter(function(c) { return c.type === 'latex'; }).length === 3, 'Extracts 3 LaTeX cite keys');
check(latexExt.some(function(c) { return c.key === 'he2016deep'; }), 'Finds he2016deep');
check(latexExt.some(function(c) { return c.key === 'vaswani2017attention'; }), 'Finds vaswani2017attention');
check(latexExt.some(function(c) { return c.key === 'brown2020language'; }), 'Finds brown2020language');

// ---- V2 BibTeX parser ----
console.log('--- V2: BibTeX parser ---');
function parseBibTeX(content) {
  var entries = [];
  var entryRegex = /@(\w+)\s*\{\s*([^,]+),\s*([\s\S]*?)\n\}/g;
  var m;
  while ((m = entryRegex.exec(content)) !== null) {
    var type = m[1].toLowerCase();
    var key = m[2].trim();
    var fields = {};
    var fieldRegex = /(\w+)\s*=\s*[{"]([^}"]+)[}"]/g;
    var fm;
    while ((fm = fieldRegex.exec(m[3])) !== null) fields[fm[1].toLowerCase()] = fm[2];
    entries.push({ type: type, key: key, fields: fields });
  }
  return entries;
}
function resolveLatexCitation(key, bibEntries) {
  var e = bibEntries.find(function(e) { return e.key === key; });
  if (!e) return null;
  return { title: e.fields.title||'', author: e.fields.author||'', year: e.fields.year||'', doi: e.fields.doi||'', journal: e.fields.journal||e.fields.booktitle||'' };
}
var bibContent = '@article{he2016deep,\n  author = {Kaiming He and Xiangyu Zhang},\n  title = {Deep Residual Learning for Image Recognition},\n  journal = {CVPR},\n  year = {2016}\n}\n\n@inproceedings{vaswani2017attention,\n  author = {Ashish Vaswani and Noam Shazeer},\n  title = {Attention Is All You Need},\n  booktitle = {NeurIPS},\n  year = {2017}\n}';
var bibEntries = parseBibTeX(bibContent);
check(bibEntries.length === 2, 'Parses 2 BibTeX entries');
check(bibEntries[0].key === 'he2016deep', 'Entry 1 key: he2016deep');
check(bibEntries[0].type === 'article', 'Entry 1 type: article');
check(bibEntries[0].fields.title === 'Deep Residual Learning for Image Recognition', 'Entry 1 title correct');
check(bibEntries[1].key === 'vaswani2017attention', 'Entry 2 key: vaswani2017attention');
check(bibEntries[1].type === 'inproceedings', 'Entry 2 type: inproceedings');
var r1 = resolveLatexCitation('he2016deep', bibEntries);
check(r1 !== null, 'Resolves existing cite key');
check(r1.title === 'Deep Residual Learning for Image Recognition', 'Resolved title matches');
check(resolveLatexCitation('nonexistent2020', bibEntries) === null, 'Returns null for missing key');

// ---- V2 verifyCitationLive ----
console.log('--- V2: verifyCitationLive ---');
async function verifyCitationLive(citation, bibEntries) {
  if (citation.type === 'latex' && bibEntries) {
    var r = resolveLatexCitation(citation.key, bibEntries);
    if (!r) return Object.assign({}, citation, { status: 'unresolvable', note: 'Cite key not found in .bib', confidence: 'low' });
    return Object.assign({}, citation, { status: 'resolved', verifiedMetadata: { title: r.title, doi: r.doi }, action: 'Resolved: ' + r.title, confidence: 'high' });
  }
  if (citation.type === 'latex') return Object.assign({}, citation, { status: 'unverifiable', note: '.bib required', confidence: 'low' });
  if (citation.type === 'numeric') return Object.assign({}, citation, { status: 'unverifiable', note: 'Bibliography required', confidence: 'low' });
  return Object.assign({}, citation, { status: 'pending', note: 'Live API needed', confidence: 'low' });
}

// ---- V2.2: Confidence computation ----
console.log('--- V2.2: Confidence Computation ---');
function computeConfidence(query, match) {
  var reasons = [];
  var score = 0;
  if (query.author && match.authors) {
    var matchAuthors = Array.isArray(match.authors) ? match.authors.map(function(a) { return (a.name || a).toLowerCase(); }) : [String(match.author || '').toLowerCase()];
    var authorMatch = matchAuthors.some(function(ma) { return ma.indexOf(query.author.toLowerCase()) >= 0; });
    if (authorMatch) { score++; reasons.push('author match'); }
  }
  var qy = parseInt(query.year), my = parseInt(match.year);
  if (qy && my) { if (Math.abs(qy - my) <= 1) { score++; reasons.push('year match'); } }
  if (query.title && match.title) {
    var qWords = query.title.toLowerCase().split(/\s+/);
    var mWords = match.title.toLowerCase().split(/\s+/);
    var qSet = {};
    for (var i = 0; i < qWords.length; i++) qSet[qWords[i]] = true;
    var overlap = 0;
    for (var j = 0; j < mWords.length; j++) { if (qSet[mWords[j]]) overlap++; }
    if ((overlap / Math.max(Object.keys(qSet).length, 1)) > 0.3) { score++; reasons.push('title overlap'); }
  }
  return { confidence: score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low', score: score, reasons: reasons };
}

var highMatch = computeConfidence(
  { title: 'Deep Residual Learning for Image Recognition', author: 'He', year: '2016' },
  { title: 'Deep Residual Learning for Image Recognition', authors: [{name:'Kaiming He'}], year: '2016' }
);
check(highMatch.confidence === 'high', 'Exact match is high confidence');
check(highMatch.score === 3, 'Exact match scores 3');

var partialMatch = computeConfidence(
  { title: 'Neural Machine Translation', author: 'Smith', year: '2024' },
  { title: 'Finding Our Best Selves', authors: [], year: '2025' }
);
check(partialMatch.confidence === 'low', 'Weak match is low confidence');
check(partialMatch.score <= 1, 'Weak match scores 1 or less');

// ---- V2.2: Section improvement ----
console.log('--- V2.2: Section Improvement ---');
function improveSectionText(text, dimensions) {
  var improved = text;
  if (dimensions.proseClarity < 10) {
    var presentMap = { demonstrated: 'demonstrates', shown: 'shows', found: 'finds', reported: 'reports', observed: 'observes' };
    // Only replace "was VERBed" without "by X" agent (safe transform)
    improved = improved.replace(/\b(is|are|was|were|been|being)\s+(\w+ed)\b(?!\s+by)/gi, function(_, aux, verb) {
      return presentMap[verb.toLowerCase()] || verb;
    });
  }
  if (dimensions.claimSpecificity < 18) {
    improved = improved.replace(/\b(may|might|could) be\b(?!\s+(in|on|at|with|from|for|of|to|the|a|an))/gi, 'is');
    improved = improved.replace(/\bseems to\b/gi, '');
  }
  return improved;
}
var passiveText = 'The result is shown in Figure 1. The improvement was demonstrated by the experiments.';
var improvedPassive = improveSectionText(passiveText, { proseClarity: 5, claimSpecificity: 20 });
check(/was demonstrated by/.test(improvedPassive), 'Passive with by-agent preserved');
var hedgyText = 'The approach may be effective. It seems to work well.';
var improvedHedgy = improveSectionText(hedgyText, { proseClarity: 15, claimSpecificity: 8 });
check(!/may be/i.test(improvedHedgy), 'Hedge "may be" removed');
check(!/seems to/i.test(improvedHedgy), 'Hedge "seems to" removed');

(async function() {
  var v1 = await verifyCitationLive({ raw: '\\cite{he2016deep}', type: 'latex', key: 'he2016deep', context: '' }, bibEntries);
  check(v1.status === 'resolved', 'LaTeX + .bib resolves');
  check(v1.confidence === 'high', 'Resolved with high confidence');

  var v2 = await verifyCitationLive({ raw: '\\cite{somekey}', type: 'latex', key: 'somekey', context: '' }, null);
  check(v2.status === 'unverifiable', 'LaTeX without .bib: unverifiable');

  var v3 = await verifyCitationLive({ raw: '\\cite{nonexistent}', type: 'latex', key: 'nonexistent', context: '' }, bibEntries);
  check(v3.status === 'unresolvable', 'LaTeX key not in .bib: unresolvable');

  var v4 = await verifyCitationLive({ raw: '[1]', type: 'numeric', value: '1', context: '' }, null);
  check(v4.status === 'unverifiable', 'Numeric: unverifiable');

  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests');
  if (failed === 0) { console.log('All tests passed! (V1 + V2 + V2.2: confidence, improvements)\n'); process.exit(0); }
  else { console.log('Some tests failed\n'); process.exit(1); }
})();