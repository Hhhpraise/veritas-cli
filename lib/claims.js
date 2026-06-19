// Veritas v2.2 - Claim Dependency Graph Engine
// Extracts factual claims from paper sections and builds a directed dependency graph.
// This is Gap 3 from the Tier 2 analysis.

export function extractClaims(body, sectionName) {
  const claims = [];
  const sentences = body.split(/(?<=[.!?])\s+/);
  const claimIndicators = ['show', 'demonstrate', 'found', 'indicate', 'suggest', 'reveal', 'report', 'observe', 'confirm', 'identify', 'establish', 'propose', 'argue', 'claim', 'conclude', 'achieve', 'outperform', 'improve', 'reduce', 'increase', 'present', 'introduce', 'develop', 'design', 'implement', 'evaluate'];
  const quantifierRegex = /\%\d|\%\s|\d+\%|\d+\.\d+|significantly|substantially|notably/i;
  let claimNum = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20) continue;
    const foundIndicators = claimIndicators.filter(function(ci) { return new RegExp('\\b' + ci + '(?:s|ed|ing)?\\b', 'i').test(trimmed); });
    const hasQuantifier = quantifierRegex.test(trimmed);
    const hasCitation = /\([A-Z].*\d{4}\)|\\cite\{|\[\d+\]/.test(trimmed);
    const isClaim = (foundIndicators.length > 0 && (hasQuantifier || hasCitation)) || (foundIndicators.length >= 2) || (hasQuantifier && /\b(is|are|was|were)\b/.test(trimmed) && trimmed.length > 50);
    if (isClaim) {
      claimNum++;
      claims.push({
        id: 'C' + String(claimNum).padStart(3, '0'),
        text: trimmed,
        type: classifyClaimType(trimmed, foundIndicators),
        sectionName: sectionName,
        indicators: foundIndicators,
        hasQuantifier: hasQuantifier,
        hasCitation: hasCitation
      });
    }
  }
  return claims;
}

function classifyClaimType(text, indicators) {
  var lower = text.toLowerCase();
  if (indicators.some(function(i) { return ['propose', 'introduce', 'present', 'develop', 'design', 'implement'].indexOf(i) >= 0; })) return 'contribution';
  if (indicators.some(function(i) { return ['show', 'demonstrate', 'found', 'achieve', 'outperform', 'improve', 'reduce', 'increase'].indexOf(i) >= 0; }) && /\%|\d+\.\d+|accuracy|score|bleu|f1|precision|recall/i.test(lower)) return 'result';
  if (indicators.some(function(i) { return ['identify', 'reveal', 'observe', 'report', 'confirm'].indexOf(i) >= 0; })) return 'finding';
  if (indicators.some(function(i) { return ['argue', 'claim', 'conclude', 'suggest', 'indicate'].indexOf(i) >= 0; })) return 'argument';
  if (indicators.some(function(i) { return ['establish', 'propose'].indexOf(i) >= 0; }) || /prior work|previous|existing|state.of.the.art/.test(lower)) return 'baseline';
  return 'assertion';
}

export function buildDependencyGraph(sections) {
  var allClaims = [];
  var globalClaimNum = 0;
  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];
    var claims = extractClaims(section.body, section.name);
    for (var ci = 0; ci < claims.length; ci++) {
      globalClaimNum++;
      claims[ci].id = 'C' + String(globalClaimNum).padStart(3, '0');
    }
    allClaims.push.apply(allClaims, claims);
  }
  var dependencies = [];
  for (var i = 0; i < allClaims.length; i++) {
    var claimA = allClaims[i];
    for (var j = i + 1; j < allClaims.length; j++) {
      var claimB = allClaims[j];
      var entitiesA = extractEntities(claimA.text);
      var entitiesB = extractEntities(claimB.text);
      var sharedEntities = entitiesA.filter(function(e) { return entitiesB.indexOf(e) >= 0; });
      if (sharedEntities.length > 0) {
        if (claimB.type === 'finding' || claimB.type === 'argument') {
          if (claimA.type === 'contribution' || claimA.type === 'baseline' || claimA.type === 'result') {
            dependencies.push({ from: claimA.id, to: claimB.id, type: 'supports', entities: sharedEntities.slice(0, 3) });
          }
        }
        if (claimA.type === 'contribution' && claimB.type === 'result') {
          var exists = dependencies.some(function(d) { return d.from === claimA.id && d.to === claimB.id; });
          if (!exists) {
            dependencies.push({ from: claimA.id, to: claimB.id, type: 'supports', entities: sharedEntities.slice(0, 3) });
          }
        }
      }
      if (claimA.sectionName !== claimB.sectionName) {
        var sectionOrder = ['abstract', 'introduction', 'related work', 'background', 'methodology', 'methods', 'experiment', 'experiments', 'results', 'discussion', 'conclusion'];
        var aIdx = -1, bIdx = -1;
        for (var k = 0; k < sectionOrder.length; k++) {
          if (claimA.sectionName.toLowerCase().indexOf(sectionOrder[k]) >= 0) aIdx = k;
          if (claimB.sectionName.toLowerCase().indexOf(sectionOrder[k]) >= 0) bIdx = k;
        }
        if (aIdx >= 0 && bIdx >= 0 && bIdx > aIdx) {
          var wordsA = claimA.text.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 4; });
          var wordsB = claimB.text.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 4; });
          var wordsASet = {};
          for (var wa = 0; wa < wordsA.length; wa++) wordsASet[wordsA[wa]] = true;
          var topicOverlap = 0;
          for (var wb = 0; wb < wordsB.length; wb++) { if (wordsASet[wordsB[wb]]) topicOverlap++; }
          if (topicOverlap >= 3) {
            var exists2 = dependencies.some(function(d) { return d.from === claimA.id && d.to === claimB.id; });
            if (!exists2) {
              dependencies.push({ from: claimA.id, to: claimB.id, type: 'informs', entities: [] });
            }
          }
        }
      }
      if (claimA.type === 'contribution' && (claimB.sectionName.toLowerCase().indexOf('conclusion') >= 0 || claimB.sectionName.toLowerCase().indexOf('discussion') >= 0)) {
        var exists3 = dependencies.some(function(d) { return d.from === claimA.id && d.to === claimB.id; });
        if (!exists3) {
          dependencies.push({ from: claimA.id, to: claimB.id, type: 'informs', entities: [] });
        }
      }
      if (claimA.type === 'result' && (claimB.type === 'argument' || claimB.type === 'finding') && claimB.sectionName !== claimA.sectionName) {
        var exists4 = dependencies.some(function(d) { return d.from === claimA.id && d.to === claimB.id; });
        if (!exists4) {
          dependencies.push({ from: claimA.id, to: claimB.id, type: 'supports', entities: [] });
        }
      }
    }
  }
  return { claims: allClaims, dependencies: dependencies, sections: sections.map(function(s) { return s.name; }) };
}

function extractEntities(text) {
  var entities = [];
  var capitalized = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  if (capitalized) entities.push.apply(entities, capitalized);
  var acronyms = text.match(/\b([A-Z]{2,}(?:\d+)?)\b/g);
  if (acronyms) entities.push.apply(entities, acronyms);
  var metrics = text.match(/\b(accuracy|precision|recall|F1|BLEU|ROUGE|perplexity|throughput|latency|GPU-hours?|parameters?)\b/gi);
  if (metrics) entities.push.apply(entities, metrics.map(function(m) { return m.toLowerCase(); }));
  var numbers = text.match(/\b\d+\.?\d*\s*(?:\%|points?|ms|GB|TB|hours?)\b/gi);
  if (numbers) entities.push.apply(entities, numbers.map(function(n) { return n.toLowerCase(); }));
  var seen = {};
  var deduped = [];
  for (var ei = 0; ei < entities.length; ei++) {
    var e = entities[ei].toLowerCase();
    if (!seen[e]) { seen[e] = true; deduped.push(e); }
  }
  return deduped;
}

export function analyzeImpact(graph, claimId) {
  var impacted = [];
  var visited = {};
  function traverse(id) {
    var outgoing = graph.dependencies.filter(function(d) { return d.from === id; });
    for (var i = 0; i < outgoing.length; i++) {
      var dep = outgoing[i];
      if (!visited[dep.to]) {
        visited[dep.to] = true;
        impacted.push({ target: dep.to, type: dep.type });
        traverse(dep.to);
      }
    }
  }
  traverse(claimId);
  return impacted;
}

export function toMermaid(graph, maxClaims) {
  maxClaims = maxClaims || 20;
  var lines = ['graph TD'];
  var claimSubset = graph.claims.slice(0, maxClaims);
  var claimIdSet = {};
  for (var ci = 0; ci < claimSubset.length; ci++) claimIdSet[claimSubset[ci].id] = true;
  for (var ci2 = 0; ci2 < claimSubset.length; ci2++) {
    var claim = claimSubset[ci2];
    var label = claim.text.slice(0, 60).replace(/["']/g, '');
    var shapeMap = { contribution: '[' + label + '...]', result: '{' + label + '...}', finding: '[' + label + '...]', argument: '(' + label + '...)', baseline: '[' + label + '...]', assertion: '[' + label + '...]' };
    var shape = shapeMap[claim.type] || '[' + label + '...]';
    lines.push('  ' + claim.id + shape);
  }
  for (var di = 0; di < graph.dependencies.length; di++) {
    var dep = graph.dependencies[di];
    if (claimIdSet[dep.from] && claimIdSet[dep.to]) {
      var arrow = dep.type === 'supports' ? '==>' : '-->';
      lines.push('  ' + dep.from + ' ' + arrow + ' |' + dep.type + '| ' + dep.to);
    }
  }
  return lines.join('\n');
}