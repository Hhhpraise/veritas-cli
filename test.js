// Veritas v2 — Test Suite (V1 scoring + V2 LaTeX, BibTeX, verifyCitationLive)
// Run: node test.js

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// ---- V1 Scoring (mirrors cli.js) ----
function scoreStructuralCoherence(text) {
  let s = 25;
  const p = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (p.length === 0) return s;
  const tsr = p.filter(x => { const f = x.trim().split(/[.!?]/)[0]; return f && f.split(/\s+/).length >= 5; }).length / Math.max(p.length, 1);
  if (tsr < 0.7) s -= 5;
  const tr = ['however','furthermore','moreover','in contrast','similarly','consequently','therefore','additionally','in addition','nevertheless','nonetheless','accordingly','thus','meanwhile','subsequently'];
  const tc = p.filter(x => tr.some(t => x.trim().toLowerCase().slice(0, 30).includes(t))).length;
  if (tc < p.length * 0.3) s -= 5;
  const sc = p.map(x => x.split(/[.!?]+/).filter(Boolean).length);
  if (sc.filter(n => n < 2 || n > 8).length > p.length * 0.3) s -= 5;
  return Math.max(0, s);
}
function scoreClaimSpecificity(text) {
  let s = 25;
  const w = text.split(/\s+/).filter(Boolean).length;
  const nc = (text.match(/\d+[%]?|\d+\.\d+/g) || []).length;
  const nd = nc / Math.max(w / 100, 1);
  if (nd < 2) s -= 10; else if (nd < 5) s -= 5;
  const hc = text.toLowerCase().split(/\s+/).filter(w => ['may','might','could','possibly','perhaps','potentially','seems','appears'].includes(w)).length;
  const hr = hc / Math.max(w / 100, 1);
  if (hr > 5 && nd < 2) s -= 8;
  if (!['compared to','relative to','outperforms','higher than','lower than','better than','faster than','more than','less than'].some(c => text.toLowerCase().includes(c))) s -= 3;
  return Math.max(0, s);
}
function scoreEvidenceCoverage(text) {
  let s = 20;
  const pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  let tc = 0; for (const p of pats) tc += (text.match(p) || []).length;
  const sent = text.split(/[.!?]+/).filter(Boolean);
  const ci = ['show','demonstrate','found','indicate','suggest','reveal','report','observe','confirm','identify','establish','propose','argue','claim','conclude','achieve','outperform','improve','reduce','increase'];
  const cs = sent.filter(x => ci.some(c => x.toLowerCase().includes(c))).length;
  if (cs > 0) { const cov = tc / cs; if (cov < 0.5) s -= 8; else if (cov < 0.8) s -= 4; }
  else if (tc === 0) s -= 5;
  return Math.max(0, s);
}
function scoreCitationDensity(text) {
  let s = 15;
  const w = text.split(/\s+/).filter(Boolean).length;
  const pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
  let tc = 0; for (const p of pats) tc += (text.match(p) || []).length;
  const per100 = (tc / Math.max(w, 1)) * 100;
  if (per100 < 1) s -= 5; else if (per100 < 2) s -= 2; else if (per100 > 8) s -= 3;
  return Math.max(0, s);
}
function scoreProseClarity(text) {
  let s = 15;
  const sent = text.split(/[.!?]+/).filter(Boolean);
  const wc = sent.map(x => x.split(/\s+/).filter(Boolean).length);
  const avg = wc.reduce((a,b) => a+b, 0) / Math.max(sent.length, 1);
  if (avg > 30) s -= 4; else if (avg > 25) s -= 2;
  const vari = wc.reduce((sm,n) => sm + Math.pow(n-avg,2), 0) / Math.max(wc.length, 1);
  if (vari > 200) s -= 3; else if (vari > 100) s -= 1;
  const pc = (text.match(/\b(is|are|was|were|been|being)\s+\w+(ed|en|t)\b/gi) || []).length;
  const pr = pc / Math.max(sent.length, 1);
  if (pr > 0.4) s -= 5; else if (pr > 0.25) s -= 2;
  const lw = text.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g,'').length > 12).length;
  const tw = text.split(/\s+/).filter(Boolean).length;
  if ((lw / Math.max(tw, 1)) > 0.08) s -= 3;
  return Math.max(0, s);
}

// ---- V2 BibTeX parser (mirrors cli.js) ----
function parseBibTeX(content) {
  const entries = [];
  const entryRegex = /@(\w+)\s*\{\s*([^,]+),\s*([\s\S]*?)\n\}/g;
  let m;
  while ((m = entryRegex.exec(content)) !== null) {
    const type = m[1].toLowerCase();
    const key = m[2].trim();
    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]+)[}"]/g;
    let fm;
    while ((fm = fieldRegex.exec(m[3])) !== null) fields[fm[1].toLowerCase()] = fm[2];
    entries.push({ type, key, fields });
  }
  return entries;
}
function resolveLatexCitation(key, bibEntries) {
  const e = bibEntries.find(e => e.key === key);
  if (!e) return null;
  return { title: e.fields.title||'', author: e.fields.author||'', year: e.fields.year||'', doi: e.fields.doi||'', journal: e.fields.journal||e.fields.booktitle||'' };
}

// ---- V2 Citation extraction (with \cite) ----
function extractCitations(text) {
  const cit = [];
  for (const m of text.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g)) cit.push({ raw: m[0], type: 'numeric', value: m[1], context: (text.slice(Math.max(0,m.index-60), Math.min(text.length,m.index+60))||'').replace(/\n/g,' ') });
  for (const m of text.matchAll(/\(([A-Z][a-z]+(?:\s(?:&|and)\s[A-Z][a-z]+)?),\s*(\d{4}[a-z]?)\)/g)) cit.push({ raw: m[0], type: 'author-year', author: m[1], year: m[2], context: (text.slice(Math.max(0,m.index-60), Math.min(text.length,m.index+60))||'').replace(/\n/g,' ') });
  for (const m of text.matchAll(/\\cite\{([^}]+)\}/g)) cit.push({ raw: m[0], type: 'latex', key: m[1], context: (text.slice(Math.max(0,m.index-60), Math.min(text.length,m.index+60))||'').replace(/\n/g,' ') });
  return cit;
}

// ---- V2 verifyCitationLive (deterministic paths only) ----
async function verifyCitationLive(citation, bibEntries) {
  if (citation.type === 'latex' && bibEntries) {
    const r = resolveLatexCitation(citation.key, bibEntries);
    if (!r) return { ...citation, status: 'unresolvable', note: 'Cite key not found in .bib' };
    return { ...citation, status: 'resolved', verifiedMetadata: { title: r.title, doi: r.doi }, action: 'Resolved: ' + r.title };
  }
  if (citation.type === 'latex') return { ...citation, status: 'unverifiable', note: '.bib required' };
  if (citation.type === 'numeric') return { ...citation, status: 'unverifiable', note: 'Bibliography required' };
  return { ...citation, status: 'pending', note: 'Live API needed' };
}

// ============================================================
// TEST: V1 Scoring Engine
// ============================================================
console.log('--- V1: Scoring Engine ---');
const good = 'Recent advances in NLP have transformed text analysis. However, these methods introduce reproducibility challenges. Furthermore, benchmarks have come under scrutiny. Consequently, researchers now develop robust frameworks. These changes require careful consideration. In contrast to prior work, we focus on generalization.';
const poor = 'stuff about nlp. things changed. idk what to say. maybe there is something. probably not.';
check(scoreStructuralCoherence(good) > scoreStructuralCoherence(poor), 'Well-structured > poor');

const specific = 'Our model achieves 94.3% on ImageNet, outperforming ResNet-152 by 2.1 points. Training needs 3.2 GPU-hours vs 8.7 baseline. F1 improved from 0.76 to 0.89, a 17% improvement.';
const vague = 'Our model seems to work pretty well on most tasks that we tried. It might be better than some approaches in certain limited cases. The results appear promising.';
check(scoreClaimSpecificity(specific) > scoreClaimSpecificity(vague), 'Specific > vague');

const cited = 'Smith et al. (2023) found transformer biases. Our experiments confirm with new data [1]. Jones (2024) provides additional evidence [2,3].';
const nocite = 'Our experiments show great results. The methodology is sound and reproducible. We believe this approach will be widely adopted.';
check(scoreEvidenceCoverage(cited) > scoreEvidenceCoverage(nocite), 'Cited > uncited');

const dense = 'This paragraph (Smith, 2024) discusses one topic. The next point (Jones, 2023) covers another area. Research by Brown et al. (2022) provides the foundation. Finally recent work (Lee, 2025) extends these ideas.';
const sparse = 'This paragraph has no citations at all. It just makes claims without backing them up with any references.';
check(scoreCitationDensity(dense) > scoreCitationDensity(sparse), 'Dense > sparse citations');

const clear = 'The model achieves state-of-the-art results on three benchmarks. We provide detailed ablation studies for each component. The code is available on GitHub.';
const jargon = 'Notwithstanding the aforementioned methodological considerations pertaining to the operationalization of the construct under investigation, the paradigmatic framework necessitates elucidation.';
check(scoreProseClarity(clear) > scoreProseClarity(jargon), 'Clear > jargon prose');

// ============================================================
// TEST: V1 Citation Extraction
// ============================================================
console.log('--- V1: Citation Extraction ---');
const txt1 = 'As shown [1], the approach is effective. Further evidence [2,3] supports the claim.';
const ext1 = extractCitations(txt1);
check(ext1.length === 2, 'Extracts 2 bracket citations');
check(ext1.every(c => c.type === 'numeric'), 'Both are numeric');

// ============================================================
// TEST: V2 LaTeX cite extraction
// ============================================================
console.log('--- V2: LaTeX cite extraction ---');
const latexText = 'Our approach \\cite{he2016deep} builds on prior work. As demonstrated by \\cite{vaswani2017attention}, the transformer provides a foundation. We also draw from \\cite{brown2020language}.';
const latexExt = extractCitations(latexText);
check(latexExt.filter(c => c.type === 'latex').length === 3, 'Extracts 3 LaTeX cite keys');
check(latexExt.some(c => c.key === 'he2016deep'), 'Finds he2016deep');
check(latexExt.some(c => c.key === 'vaswani2017attention'), 'Finds vaswani2017attention');
check(latexExt.some(c => c.key === 'brown2020language'), 'Finds brown2020language');

// ============================================================
// TEST: V2 BibTeX parser
// ============================================================
console.log('--- V2: BibTeX parser ---');
const bibContent = '@article{he2016deep,\n  author = {Kaiming He and Xiangyu Zhang},\n  title = {Deep Residual Learning for Image Recognition},\n  journal = {CVPR},\n  year = {2016}\n}\n\n@inproceedings{vaswani2017attention,\n  author = {Ashish Vaswani and Noam Shazeer},\n  title = {Attention Is All You Need},\n  booktitle = {NeurIPS},\n  year = {2017}\n}';
const bibEntries = parseBibTeX(bibContent);
check(bibEntries.length === 2, 'Parses 2 BibTeX entries');
check(bibEntries[0].key === 'he2016deep', 'Entry 1 key: he2016deep');
check(bibEntries[0].type === 'article', 'Entry 1 type: article');
check(bibEntries[0].fields.title === 'Deep Residual Learning for Image Recognition', 'Entry 1 title correct');
check(bibEntries[0].fields.year === '2016', 'Entry 1 year correct');
check(bibEntries[1].key === 'vaswani2017attention', 'Entry 2 key: vaswani2017attention');
check(bibEntries[1].type === 'inproceedings', 'Entry 2 type: inproceedings');

// ============================================================
// TEST: V2 resolveLatexCitation
// ============================================================
console.log('--- V2: resolveLatexCitation ---');
const r1 = resolveLatexCitation('he2016deep', bibEntries);
check(r1 !== null, 'Resolves existing cite key');
check(r1.title === 'Deep Residual Learning for Image Recognition', 'Resolved title matches');
check(r1.author === 'Kaiming He and Xiangyu Zhang', 'Resolved author matches');
check(r1.year === '2016', 'Resolved year matches');
check(resolveLatexCitation('nonexistent2020', bibEntries) === null, 'Returns null for missing key');

// ============================================================
// TEST: V2 verifyCitationLive (deterministic paths)
// ============================================================
console.log('--- V2: verifyCitationLive ---');
const v1 = await verifyCitationLive({ raw: '\\cite{he2016deep}', type: 'latex', key: 'he2016deep', context: '' }, bibEntries);
check(v1.status === 'resolved', 'LaTeX + .bib resolves');
check(v1.verifiedMetadata.title === 'Deep Residual Learning for Image Recognition', 'Resolved title from bib');

const v2 = await verifyCitationLive({ raw: '\\cite{somekey}', type: 'latex', key: 'somekey', context: '' }, null);
check(v2.status === 'unverifiable', 'LaTeX without .bib: unverifiable');

const v3 = await verifyCitationLive({ raw: '\\cite{nonexistent}', type: 'latex', key: 'nonexistent', context: '' }, bibEntries);
check(v3.status === 'unresolvable', 'LaTeX key not in .bib: unresolvable');

const v4 = await verifyCitationLive({ raw: '[1]', type: 'numeric', value: '1', context: '' }, null);
check(v4.status === 'unverifiable', 'Numeric: unverifiable');

console.log('\n========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests');
if (failed === 0) { console.log('All tests passed! (V1 scoring + V2 LaTeX/BibTeX/verify)\n'); process.exit(0); }
else { console.log('Some tests failed\n'); process.exit(1); }
