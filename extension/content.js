// Veritas Content Script — Quality dashboard for Overleaf & Google Docs
// Uses shared scoring engine via injection.

(function() {
  'use strict';

  // ============================================================
  // Scoring Engine (browser-compatible copy — ES module import not available in content scripts)
  // Mirrors lib/scoring.js for browser context
  // ============================================================

  function parseSections(text) {
    const sections = [];
    const headingRegex = /^(#{1,3})\s+(.+)$/gm;
    const matches = [...text.matchAll(headingRegex)];
    for (let i = 0; i < matches.length; i++) {
      const h = matches[i];
      const name = h[2].trim();
      const start = h.index + h[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      sections.push({ name, body: text.slice(start, end).trim() });
    }
    // Also try LaTeX section commands (Overleaf source)
    if (sections.length === 0) {
      const texHeadingRegex = /\\(?:section|subsection|subsubsection)\{([^}]*)\}/gm;
      const texMatches = [...text.matchAll(texHeadingRegex)];
      for (let i = 0; i < texMatches.length; i++) {
        const h = texMatches[i];
        const name = h[1].trim();
        const start = h.index + h[0].length;
        const end = i + 1 < texMatches.length ? texMatches[i + 1].index : text.length;
        sections.push({ name, body: text.slice(start, end).trim() });
      }
    }
    if (sections.length === 0 && text.trim().length > 0) {
      sections.push({ name: 'Full Document', body: text.trim() });
    }
    return sections;
  }

  function analyzeSection(section) {
    const body = section.body;
    const dims = {};
    dims.structuralCoherence = scoreStructuralCoherence(body);
    dims.claimSpecificity = scoreClaimSpecificity(body);
    dims.evidenceCoverage = scoreEvidenceCoverage(body);
    dims.citationDensity = scoreCitationDensity(body);
    dims.proseClarity = scoreProseClarity(body);
    const total = Object.values(dims).reduce(function(a, b) { return a + b; }, 0);
    const issues = [];
    if (dims.structuralCoherence < 18) issues.push('Check paragraph ordering and transitions');
    if (dims.claimSpecificity < 18) issues.push('Add numbers, percentages, or concrete outcomes');
    if (dims.evidenceCoverage < 14) issues.push('Some claims need supporting citations');
    if (dims.citationDensity < 10) issues.push('Add references to support key claims');
    if (dims.proseClarity < 10) issues.push('Shorten sentences and reduce passive voice');
    return {
      name: section.name,
      score: total,
      dimensions: dims,
      issues: issues,
      wordCount: body.split(/\s+/).filter(Boolean).length,
      sentenceCount: body.split(/[.!?]+/).filter(Boolean).length
    };
  }

  function scoreStructuralCoherence(text) {
    var s = 25;
    var paragraphs = text.split(/\n\s*\n/).filter(function(p) { return p.trim().length > 0; });
    if (paragraphs.length === 0) return s;
    var tsr = paragraphs.filter(function(p) { var f = p.trim().split(/[.!?]/)[0]; return f && f.split(/\s+/).length >= 5; }).length / Math.max(paragraphs.length, 1);
    if (tsr < 0.7) s -= 5;
    var tr = ['however','furthermore','moreover','in contrast','similarly','consequently','therefore','additionally','in addition','nevertheless','nonetheless','accordingly','thus','meanwhile','subsequently'];
    var tc = paragraphs.filter(function(p) { var fw = p.trim().toLowerCase().slice(0, 30); return tr.some(function(t) { return fw.indexOf(t) >= 0; }); }).length;
    if (tc < paragraphs.length * 0.3) s -= 5;
    var sc = paragraphs.map(function(p) { return p.split(/[.!?]+/).filter(Boolean).length; });
    if (sc.filter(function(n) { return n < 2 || n > 8; }).length > paragraphs.length * 0.3) s -= 5;
    return Math.max(0, s);
  }

  function scoreClaimSpecificity(text) {
    var s = 25;
    var words = text.split(/\s+/).filter(Boolean).length;
    var nc = (text.match(/\d+[%]?|\d+\.\d+/g) || []).length;
    var nd = nc / Math.max(words / 100, 1);
    if (nd < 2) s -= 10; else if (nd < 5) s -= 5;
    var hedges = ['may','might','could','possibly','perhaps','potentially','seems','appears'];
    var hc = text.toLowerCase().split(/\s+/).filter(function(w) { return hedges.indexOf(w) >= 0; }).length;
    var hr = hc / Math.max(words / 100, 1);
    if (hr > 5 && nd < 2) s -= 8;
    if (!['compared to','relative to','outperforms','higher than','lower than','better than','faster than','more than','less than'].some(function(c) { return text.toLowerCase().indexOf(c) >= 0; })) s -= 3;
    return Math.max(0, s);
  }

  function scoreEvidenceCoverage(text) {
    var s = 20;
    var pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
    var tc = 0;
    for (var i = 0; i < pats.length; i++) { var m = text.match(pats[i]); if (m) tc += m.length; }
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
    var tc = 0;
    for (var i = 0; i < pats.length; i++) { var m = text.match(pats[i]); if (m) tc += m.length; }
    var p100 = (tc / Math.max(w, 1)) * 100;
    if (p100 < 1) s -= 5; else if (p100 < 2) s -= 2; else if (p100 > 8) s -= 3;
    return Math.max(0, s);
  }

  function scoreProseClarity(text) {
    var s = 15;
    var sent = text.split(/[.!?]+/).filter(Boolean);
    var wc = sent.map(function(x) { return x.split(/\s+/).filter(Boolean).length; });
    var avg = wc.reduce(function(a, b) { return a + b; }, 0) / Math.max(sent.length, 1);
    if (avg > 30) s -= 4; else if (avg > 25) s -= 2;
    var vari = wc.reduce(function(sm, n) { return sm + Math.pow(n - avg, 2); }, 0) / Math.max(wc.length, 1);
    if (vari > 200) s -= 3; else if (vari > 100) s -= 1;
    var pc = (text.match(/\b(is|are|was|were|been|being)\s+\w+(ed|en|t)\b/gi) || []).length;
    var pr = pc / Math.max(sent.length, 1);
    if (pr > 0.4) s -= 5; else if (pr > 0.25) s -= 2;
    var lw = text.split(/\s+/).filter(function(w) { return w.replace(/[^a-zA-Z]/g, '').length > 12; }).length;
    var tw = text.split(/\s+/).filter(Boolean).length;
    if ((lw / Math.max(tw, 1)) > 0.08) s -= 3;
    return Math.max(0, s);
  }

  // ============================================================
  // Dashboard Injection
  // ============================================================

  function injectDashboard() {
    if (document.getElementById('veritas-dashboard')) return;

    var dashboard = document.createElement('div');
    dashboard.id = 'veritas-dashboard';
    dashboard.innerHTML = [
      '<div id="veritas-header">',
      '  <span id="veritas-title">Veritas v2.2</span>',
      '  <span id="veritas-toggle">_</span>',
      '</div>',
      '<div id="veritas-body">',
      '  <div id="veritas-controls">',
      '    <button id="veritas-analyze-btn">Analyze Document</button>',
      '    <button id="veritas-graph-btn" style="background:#6366f1;color:#fff;border:none;border-radius:4px;padding:4px 8px;margin-left:4px;font-size:11px;cursor:pointer;">Claim Graph</button>',
      '    <select id="veritas-section-select"><option value="">All sections</option></select>',
      '  </div>',
      '  <div id="veritas-overall-score"></div>',
      '  <div id="veritas-section-scores"></div>',
      '  <div id="veritas-graph-view" style="display:none;padding:12px;font-family:monospace;font-size:10px;max-height:200px;overflow-y:auto;background:#f8f9fa;border-radius:6px;margin:8px;"></div>',
      '  <div id="veritas-citation-summary"></div>',
      '</div>'
    ].join('');

    dashboard.style.cssText = 'position:fixed;bottom:20px;right:20px;width:400px;max-height:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#1a1a2e;overflow:hidden;transition:all 0.2s;';

    document.body.appendChild(dashboard);

    var minimized = false;
    document.getElementById('veritas-toggle').addEventListener('click', function() {
      minimized = !minimized;
      document.getElementById('veritas-body').style.display = minimized ? 'none' : 'block';
      document.getElementById('veritas-toggle').textContent = minimized ? '□' : '_';
      dashboard.style.maxHeight = minimized ? '40px' : '600px';
    });

    document.getElementById('veritas-analyze-btn').addEventListener('click', analyzeDocument);
    document.getElementById('veritas-graph-btn').addEventListener('click', showClaimGraph);
  }

  var _lastSections = [];
  var _lastText = '';

  function getDocumentText() {
    var text = '';
    // Overleaf ACE editor
    var editor = document.querySelector('.ace_editor');
    if (editor && editor.textContent) text = editor.textContent;
    // Google Docs
    if (!text) {
      var docBody = document.querySelector('.kix-page-content-wrapper, .docs-editor-container');
      if (docBody && docBody.textContent) text = docBody.textContent;
    }
    // Fallback
    if (!text || text.length < 100) {
      var bodies = document.querySelectorAll('p, .text, .content, article');
      var best = '';
      for (var i = 0; i < bodies.length; i++) {
        if (bodies[i].textContent.length > best.length) best = bodies[i].textContent;
      }
      text = best;
    }
    return text;
  }

  function analyzeDocument() {
    var text = getDocumentText();
    _lastText = text;

    if (!text || text.length < 50) {
      document.getElementById('veritas-section-scores').innerHTML = '<p style="color:#92400e;padding:12px;">No paper content detected. Open your document on Overleaf or Google Docs.</p>';
      return;
    }

    var sections = parseSections(text);
    _lastSections = sections;
    var results = sections.map(function(s) {
      var r = analyzeSection(s);
      return r;
    }).filter(function(r) { return r.score !== null; });

    if (results.length === 0) {
      document.getElementById('veritas-section-scores').innerHTML = '<p style="color:#92400e;padding:12px;">Could not identify sections. Use markdown headings (## Title) or LaTeX section commands.</p>';
      return;
    }

    renderResults(results, sections);

    var select = document.getElementById('veritas-section-select');
    select.textContent = ''; // Clear safely
    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All sections';
    select.appendChild(allOption);
    sections.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  }

  function renderResults(results, sections) {
    var avgScore = Math.round(results.reduce(function(a, r) { return a + r.score; }, 0) / results.length);
    var color = avgScore >= 85 ? '#10b981' : avgScore >= 70 ? '#f59e0b' : '#ef4444';

    document.getElementById('veritas-overall-score').innerHTML = '<div style="text-align:center;padding:16px 0 8px;">' +
      '<div style="font-size:48px;font-weight:800;color:' + color + ';">' + avgScore + '</div>' +
      '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Overall Score / 100</div>' +
      '<div style="font-size:12px;color:#6b7280;margin-top:4px;">' + sections.length + ' sections analyzed</div></div>';

    var sectionHtml = '';
    results.forEach(function(r) {
      var bar = '█'.repeat(Math.round(r.score / 5)) + '░'.repeat(20 - Math.round(r.score / 5));
      var sc = r.score >= 85 ? '#10b981' : r.score >= 70 ? '#f59e0b' : '#ef4444';
      sectionHtml += '<div style="padding:10px 14px;border-top:1px solid #f3f4f6;">' +
        '<div style="font-weight:600;margin-bottom:4px;font-size:12px;">' + r.name + '</div>' +
        '<div style="font-family:monospace;font-size:11px;color:' + sc + ';">' + bar + ' ' + r.score + '/100</div>' +
        '<div style="font-size:10px;color:#9ca3af;margin-top:2px;">S:' + r.dimensions.structuralCoherence + ' C:' + r.dimensions.claimSpecificity + ' E:' + r.dimensions.evidenceCoverage + ' R:' + r.dimensions.citationDensity + ' P:' + r.dimensions.proseClarity + '</div>';
      if (r.issues.length > 0) {
        sectionHtml += '<div style="margin-top:4px;">' + r.issues.map(function(i) { return '<div style="font-size:10px;color:#f59e0b;">⚠ ' + i + '</div>'; }).join('') + '</div>';
      }
      sectionHtml += '</div>';
    });
    document.getElementById('veritas-section-scores').innerHTML = sectionHtml;

    // Count citations for summary
    var totalCitations = 0;
    var pats = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g];
    sections.forEach(function(s) {
      pats.forEach(function(p) {
        var matches = s.body.match(p);
        if (matches) totalCitations += matches.length;
      });
    });
    document.getElementById('veritas-citation-summary').innerHTML = '<div style="padding:10px 14px;border-top:1px solid #f3f4f6;text-align:center;font-size:12px;color:#6b7280;">' +
      totalCitations + ' citations detected · veritas · v2.2</div>';
  }

  // Simple claim graph visualization for the extension
  function showClaimGraph() {
    if (_lastSections.length === 0) {
      analyzeDocument();
      if (_lastSections.length === 0) return;
    }
    var claims = [];
    var claimNum = 0;
    var claimIndicators = ['show','demonstrate','found','indicate','suggest','reveal','report','observe','confirm','identify','establish','propose','argue','claim','conclude','achieve','outperform','improve','reduce','increase','present','introduce','develop','design','implement'];

    _lastSections.forEach(function(section) {
      var sentences = section.body.split(/(?<=[.!?])\s+/);
      sentences.forEach(function(sentence) {
        var t = sentence.trim();
        if (t.length < 20) return;
        var found = claimIndicators.filter(function(ci) { return new RegExp('\\b' + ci + '(?:s|ed|ing)?\\b','i').test(t); });
        var hasNum = /\d+[%]|\d+\.\d+|significantly|substantially/i.test(t);
        var hasCit = /\([A-Z].*\d{4}\)|\\cite\{|\[\d+\]/.test(t);
        if ((found.length > 0 && (hasNum || hasCit)) || found.length >= 2) {
          claimNum++;
          claims.push({ id: 'C' + String(claimNum).padStart(3,'0'), text: t.slice(0, 80), section: section.name });
        }
      });
    });

    var view = document.getElementById('veritas-graph-view');
    view.style.display = 'block';

    if (claims.length === 0) {
      view.textContent = 'No claims detected. Try analyzing a document with more content.';
      view.style.color = '#92400e';
    } else {
      var header = document.createElement('div');
      header.style.cssText = 'font-weight:700;color:#6366f1;margin-bottom:6px;';
      header.textContent = 'Claim Graph (' + claims.length + ' claims)';
      view.appendChild(header);
      claims.forEach(function(c) {
        var row = document.createElement('div');
        row.style.cssText = 'padding:3px 0;border-top:1px solid #e5e7eb;';
        var idSpan = document.createElement('span');
        idSpan.style.cssText = 'color:#6366f1;font-weight:600;';
        idSpan.textContent = c.id;
        var secSpan = document.createElement('span');
        secSpan.style.cssText = 'color:#6b7280;';
        secSpan.textContent = ' [' + c.section + '] ';
        var textSpan = document.createElement('span');
        textSpan.textContent = c.text + '...';
        row.appendChild(idSpan);
        row.appendChild(secSpan);
        row.appendChild(textSpan);
        view.appendChild(row);
      });
    }
  }

  // Init
  if (document.readyState === 'complete') {
    setTimeout(injectDashboard, 1500);
  } else {
    window.addEventListener('load', function() { setTimeout(injectDashboard, 1500); });
  }
})();
