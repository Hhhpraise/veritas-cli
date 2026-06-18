// Veritas Content Script — Injects quality dashboard into Overleaf & Google Docs
// Runs in the page context to analyze academic paper content.

(function() {
  'use strict';

  // ============================================================
  // Quality Scoring Engine (mirrors CLI logic for browser context)
  // ============================================================

  function scoreSection(text) {
    if (!text || text.trim().length < 50) return null;

    const structuralCoherence = scoreStructuralCoherence(text);
    const claimSpecificity = scoreClaimSpecificity(text);
    const evidenceCoverage = scoreEvidenceCoverage(text);
    const citationDensity = scoreCitationDensity(text);
    const proseClarity = scoreProseClarity(text);

    const total = structuralCoherence + claimSpecificity + evidenceCoverage + citationDensity + proseClarity;
    const issues = [];

    if (structuralCoherence < 18) issues.push('Check paragraph ordering and transitions');
    if (claimSpecificity < 18) issues.push('Add numbers, percentages, or concrete outcomes to claims');
    if (evidenceCoverage < 14) issues.push('Some claims need supporting citations');
    if (citationDensity < 10) issues.push('Add references to support key claims');
    if (proseClarity < 10) issues.push('Shorten sentences and reduce passive voice');

    return {
      score: total,
      dimensions: { structuralCoherence, claimSpecificity, evidenceCoverage, citationDensity, proseClarity },
      issues,
      wordCount: text.split(/\s+/).filter(Boolean).length
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
    const patterns = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g, /\(\d{4}[a-z]?\)/g];
    let totalCitations = 0;
    for (const p of patterns) {
      const matches = text.match(p);
      if (matches) totalCitations += matches.length;
    }

    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const claimIndicators = ['show', 'demonstrate', 'found', 'indicate', 'suggest', 'reveal', 'report', 'observe', 'confirm', 'identify', 'establish', 'propose', 'argue', 'claim', 'conclude', 'achieve', 'outperform', 'improve', 'reduce', 'increase'];
    const claimSentences = sentences.filter(s => claimIndicators.some(c => s.toLowerCase().includes(c))).length;

    if (claimSentences > 0) {
      const coverage = totalCitations / claimSentences;
      if (coverage < 0.5) score -= 8;
      else if (coverage < 0.8) score -= 4;
    } else if (totalCitations === 0) {
      score -= 5;
    }
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

  // ============================================================
  // Dashboard Injection
  // ============================================================

  function injectDashboard() {
    if (document.getElementById('veritas-dashboard')) return;

    const dashboard = document.createElement('div');
    dashboard.id = 'veritas-dashboard';
    dashboard.innerHTML = `
      <div id="veritas-header">
        <span id="veritas-title">Veritas</span>
        <span id="veritas-toggle">_</span>
      </div>
      <div id="veritas-body">
        <div id="veritas-controls">
          <button id="veritas-analyze-btn">Analyze Document</button>
          <select id="veritas-section-select"><option value="">All sections</option></select>
        </div>
        <div id="veritas-overall-score"></div>
        <div id="veritas-section-scores"></div>
        <div id="veritas-citation-summary"></div>
      </div>
    `;

    dashboard.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; width: 360px; max-height: 500px;
      background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12); z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; color: #1a1a2e; overflow: hidden; transition: all 0.2s;
    `;

    document.body.appendChild(dashboard);

    // Toggle minimize
    let minimized = false;
    document.getElementById('veritas-toggle').addEventListener('click', () => {
      minimized = !minimized;
      document.getElementById('veritas-body').style.display = minimized ? 'none' : 'block';
      document.getElementById('veritas-toggle').textContent = minimized ? '□' : '_';
      dashboard.style.maxHeight = minimized ? '40px' : '500px';
    });

    // Analyze button
    document.getElementById('veritas-analyze-btn').addEventListener('click', analyzeDocument);
  }

  function analyzeDocument() {
    // Extract text from the page (works for Overleaf source panel, Google Docs content)
    let text = '';

    // Try Overleaf editor
    const overleafEditor = document.querySelector('.ace_text-input');
    if (overleafEditor) {
      const editor = document.querySelector('.ace_editor');
      if (editor) text = editor.textContent || '';
    }

    // Try Google Docs
    if (!text) {
      const docBody = document.querySelector('.kix-page-content-wrapper, .docs-editor-container');
      if (docBody) text = docBody.textContent || '';
    }

    // Fallback: any large text block
    if (!text || text.length < 100) {
      const bodies = document.querySelectorAll('p, .text, .content, article');
      let best = '';
      for (const b of bodies) {
        if (b.textContent.length > best.length) best = b.textContent;
      }
      text = best;
    }

    if (!text || text.length < 50) {
      document.getElementById('veritas-section-scores').innerHTML =
        '<p style="color:#92400e;padding:12px;">No paper content detected. Open your document on Overleaf or Google Docs and try again.</p>';
      return;
    }

    // Parse sections
    const sections = parseSections(text);

    // Score each section
    const results = sections.map(s => ({ name: s.name, ...scoreSection(s.body) })).filter(r => r.score !== null);

    if (results.length === 0) {
      document.getElementById('veritas-section-scores').innerHTML =
        '<p style="color:#92400e;padding:12px;">Could not identify sections. Ensure your document uses headings (## Title).</p>';
      return;
    }

    // Render results
    renderResults(results, sections);

    // Update section dropdown
    const select = document.getElementById('veritas-section-select');
    select.innerHTML = '<option value="">All sections</option>';
    sections.forEach(s => {
      select.innerHTML += `<option value="${s.name}">${s.name}</option>`;
    });
  }

  function parseSections(text) {
    const sections = [];
    const headingRegex = /^(#{1,3})\s+(.+)$/gm;
    const matches = [...text.matchAll(headingRegex)];

    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i];
      const name = heading[2].trim();
      const start = heading.index + heading[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      sections.push({ name, body: text.slice(start, end).trim() });
    }

    if (sections.length === 0 && text.trim().length > 0) {
      sections.push({ name: 'Full Document', body: text.trim() });
    }

    return sections;
  }

  function renderResults(results, sections) {
    const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
    const color = avgScore >= 85 ? '#10b981' : avgScore >= 70 ? '#f59e0b' : '#ef4444';

    // Overall score
    document.getElementById('veritas-overall-score').innerHTML = `
      <div style="text-align:center;padding:16px 0 8px;">
        <div style="font-size:48px;font-weight:800;color:${color};">${avgScore}</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Overall Score / 100</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">${sections.length} sections analyzed</div>
      </div>
    `;

    // Section scores
    let sectionHtml = '';
    results.forEach(r => {
      const bar = '█'.repeat(Math.round(r.score / 5)) + '░'.repeat(20 - Math.round(r.score / 5));
      const sc = r.score >= 85 ? '#10b981' : r.score >= 70 ? '#f59e0b' : '#ef4444';
      sectionHtml += `
        <div style="padding:10px 14px;border-top:1px solid #f3f4f6;">
          <div style="font-weight:600;margin-bottom:4px;font-size:12px;">${r.name}</div>
          <div style="font-family:monospace;font-size:11px;color:${sc};">${bar} ${r.score}/100</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">
            S:${r.dimensions.structuralCoherence} C:${r.dimensions.claimSpecificity} E:${r.dimensions.evidenceCoverage} R:${r.dimensions.citationDensity} P:${r.dimensions.proseClarity}
          </div>
          ${r.issues.length > 0 ? `<div style="margin-top:4px;">${r.issues.map(i => `<div style="font-size:10px;color:#f59e0b;">⚠ ${i}</div>`).join('')}</div>` : ''}
        </div>
      `;
    });
    document.getElementById('veritas-section-scores').innerHTML = sectionHtml;

    // Citation summary
    const totalCitations = sections.reduce((sum, s) => {
      const patterns = [/\[\d+\]/g, /\([A-Z][a-z]+,\s*\d{4}[a-z]?\)/g, /\\cite\{[^}]+\}/g];
      for (const p of patterns) {
        const matches = s.body.match(p);
        if (matches) sum += matches.length;
      }
      return sum;
    }, 0);

    document.getElementById('veritas-citation-summary').innerHTML = `
      <div style="padding:10px 14px;border-top:1px solid #f3f4f6;text-align:center;font-size:12px;color:#6b7280;">
        ${totalCitations} citations detected · <a href="https://github.com/Hhhpraise/veritas" target="_blank" style="color:#6366f1;">veritas</a>
      </div>
    `;
  }

  // ============================================================
  // Init
  // ============================================================

  // Wait for page to fully load
  if (document.readyState === 'complete') {
    setTimeout(injectDashboard, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(injectDashboard, 1500));
  }

})();
