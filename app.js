(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const input = byId('input');
  const highlights = byId('highlights');
  const undoStack = [];
  const MAX_VISIBLE_FINDINGS = 300;
  const formatNumber = n => new Intl.NumberFormat('en-US').format(n);
  const formatCodePoint = codePoint => 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');

  const invisibleNames = new Map([
    [0x00AD, 'Soft hyphen'],
    [0x034F, 'Combining Grapheme Joiner'],
    [0x061C, 'Arabic letter mark'],
    [0x180E, 'Mongolian vowel separator'],
    [0x200B, 'Zero-width space'],
    [0x200C, 'Zero Width Non-Joiner'],
    [0x200D, 'Zero Width Joiner'],
    [0x200E, 'Left-to-right mark'],
    [0x200F, 'Right-to-left mark'],
    [0x2060, 'Word Joiner'],
    [0xFEFF, 'BOM / zero-width no-break space']
  ]);
  const specialSpaces = new Map([
    [0x00A0, 'Non-breaking space'],
    [0x1680, 'Ogham space mark'],
    [0x202F, 'Narrow no-break space'],
    [0x205F, 'Medium mathematical space'],
    [0x3000, 'Ideographic space']
  ]);
  const invisiblePattern = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
  const invisibleCharacter = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
  const unusualSpacePattern = /[\p{Zs}\p{Zl}\p{Zp}]/gu;
  const anyUnusualSpace = /^[\p{Zs}\p{Zl}\p{Zp}]$/u;

  function classify(char, codePoint) {
    if ((codePoint >= 0x202A && codePoint <= 0x202E) || (codePoint >= 0x2066 && codePoint <= 0x2069)) {
      return {name: 'Bidirectional control', hidden: true, badge: 'BIDI'};
    }
    if (invisibleNames.has(codePoint) || invisibleCharacter.test(char)) {
      return {name: invisibleNames.get(codePoint) || 'Invisible character', hidden: true, badge: 'INV'};
    }
    if (codePoint === 0xFFFD) return {name: 'Replacement character', hidden: false, badge: char};
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return {name: 'Unpaired surrogate', hidden: true, badge: 'ERR'};
    if (codePoint < 0x20 || (codePoint >= 0x7F && codePoint <= 0x9F)) {
      return {name: 'Control character', hidden: true, badge: 'CTRL'};
    }
    if ((codePoint >= 0xE000 && codePoint <= 0xF8FF) || (codePoint >= 0xF0000 && codePoint <= 0xFFFFD) || (codePoint >= 0x100000 && codePoint <= 0x10FFFD)) {
      return {name: 'Private-use character', hidden: false, badge: char};
    }
    if (specialSpaces.has(codePoint) || (char !== ' ' && anyUnusualSpace.test(char))) {
      return {name: specialSpaces.get(codePoint) || 'Unusual Unicode space', hidden: true, badge: 'SPACE'};
    }
    if (/^\p{M}$/u.test(char)) return {name: 'Combining mark', hidden: true, badge: 'MARK'};
    if (codePoint >= 0xFF01 && codePoint <= 0xFF5E) return {name: 'Fullwidth character', hidden: false, badge: char};
    if (/[‘’“”–—…]/u.test(char)) return {name: 'Typographic punctuation', hidden: false, badge: char};
    if (/^[\p{Script=Cyrillic}\p{Script=Greek}]$/u.test(char)) {
      return {name: 'Letter from another script', hidden: false, badge: char};
    }
    return {name: 'Non-ASCII character', hidden: false, badge: char};
  }

  function scan(text) {
    const findings = [];
    let line = 1;
    let column = 1;
    let offset = 0;
    let nonAscii = 0;
    let hidden = 0;

    for (const char of text) {
      const codePoint = char.codePointAt(0);
      const ignored = char === '\n' || char === '\r' || char === '\t' || char === ' ';
      if (!ignored && (codePoint > 0x7E || codePoint < 0x20)) {
        const classification = classify(char, codePoint);
        findings.push({...classification, char, codePoint, line, column, offset, length: char.length});
        if (codePoint > 0x7F) nonAscii++;
        if (classification.hidden) hidden++;
      }

      if (char === '\n') {
        if (text[offset - 1] !== '\r') line++;
        column = 1;
      } else if (char === '\r') {
        line++;
        column = 1;
      } else {
        column++;
      }
      offset += char.length;
    }
    return {findings, nonAscii, hidden, lines: text ? line : 0};
  }

  function stripAccents(text) {
    return text
      .replace(/ß/g, 'ss').replace(/ẞ/g, 'SS')
      .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
      .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
      .replace(/ø/g, 'o').replace(/Ø/g, 'O')
      .replace(/ł/g, 'l').replace(/Ł/g, 'L')
      .normalize('NFD').replace(/\p{M}/gu, '');
  }

  function splitWords(text) {
    const separated = text
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
    return separated.match(/[\p{L}\p{N}]+/gu) || [];
  }

  function transformCase(text, mode) {
    if (mode === 'upper') return text.toUpperCase();
    if (mode === 'lower') return text.toLowerCase();

    const parts = splitWords(text).map(word => word.toLowerCase());
    const capitalize = word => {
      if (!word) return '';
      const first = Array.from(word)[0];
      return first.toUpperCase() + word.slice(first.length);
    };
    if (mode === 'title') return parts.map(capitalize).join(' ');
    if (mode === 'camel') return parts[0] ? parts[0] + parts.slice(1).map(capitalize).join('') : '';
    if (mode === 'pascal') return parts.map(capitalize).join('');
    if (mode === 'snake') return parts.join('_');
    if (mode === 'screaming') return parts.join('_').toUpperCase();
    if (mode === 'kebab') return parts.join('-');
    return text;
  }

  function syncOverlay() {
    if (input.clientWidth) highlights.style.width = input.clientWidth + 'px';
    highlights.scrollTop = input.scrollTop;
    highlights.scrollLeft = input.scrollLeft;
  }

  function renderHighlights(text, findings) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const finding of findings) {
      if (finding.offset > offset) fragment.append(document.createTextNode(text.slice(offset, finding.offset)));
      const mark = document.createElement('span');
      const needsMarker = finding.hidden && !anyUnusualSpace.test(finding.char);
      mark.className = 'mark' + (finding.hidden ? ' hidden' : '') + (needsMarker ? ' has-marker' : '');
      mark.textContent = finding.char;
      fragment.append(mark);
      offset = finding.offset + finding.length;
    }
    if (offset < text.length) fragment.append(document.createTextNode(text.slice(offset)));
    highlights.replaceChildren(fragment);
    syncOverlay();
  }

  function showEmpty(title, detail) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const strong = document.createElement('strong');
    strong.textContent = title;
    empty.append(strong, document.createTextNode(detail));
    byId('findings').append(empty);
  }

  function renderFindings(result) {
    const list = byId('findings');
    list.replaceChildren();
    if (!input.value) {
      showEmpty('Ready to inspect.', 'Type or paste text into the editor.');
      return;
    }
    if (!result.findings.length) {
      showEmpty('No gremlins found.', 'Your text contains only ordinary ASCII characters.');
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const finding of result.findings.slice(0, MAX_VISIBLE_FINDINGS)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'finding';
      row.setAttribute('aria-label', `${finding.name}, ${formatCodePoint(finding.codePoint)}, line ${finding.line}, column ${finding.column}. Locate in editor.`);

      const badge = document.createElement('span');
      badge.className = 'character-badge' + (finding.hidden ? ' invisible' : '');
      badge.textContent = finding.badge;
      const details = document.createElement('span');
      details.className = 'finding-details';
      const name = document.createElement('strong');
      name.textContent = finding.name;
      const detail = document.createElement('small');
      detail.textContent = formatCodePoint(finding.codePoint) + ' · ' + (finding.codePoint > 0x7F ? 'Non-ASCII' : 'ASCII control');
      const position = document.createElement('span');
      position.className = 'finding-position';
      position.textContent = `${finding.line}:${finding.column}`;
      details.append(name, detail);
      row.append(badge, details, position);
      row.addEventListener('click', () => {
        input.focus();
        input.setSelectionRange(finding.offset, finding.offset + finding.length);
        const lineNumber = input.value.slice(0, finding.offset).split(/\r\n|\r|\n/).length;
        input.scrollTop = Math.max(0, (lineNumber - 3) * parseFloat(getComputedStyle(input).lineHeight));
        syncOverlay();
      });
      fragment.append(row);
    }
    if (result.findings.length > MAX_VISIBLE_FINDINGS) {
      const more = document.createElement('div');
      more.className = 'more-findings';
      more.textContent = `Showing the first ${MAX_VISIBLE_FINDINGS} of ${formatNumber(result.findings.length)} findings.`;
      fragment.append(more);
    }
    list.append(fragment);
  }

  function refreshInspection(message = '') {
    const text = input.value;
    const result = scan(text);
    byId('input-count').textContent = `${formatNumber(Array.from(text).length)} characters - ${formatNumber(result.lines)} ${result.lines === 1 ? 'line' : 'lines'}`;
    byId('count-total').textContent = formatNumber(result.findings.length);
    byId('count-non-ascii').textContent = formatNumber(result.nonAscii);
    byId('count-hidden').textContent = formatNumber(result.hidden);
    renderHighlights(text, result.findings);
    renderFindings(result);
    byId('undo').disabled = undoStack.length === 0;
    byId('message').textContent = message;
  }

  function applyChange(change) {
    const changed = change(input.value);
    if (changed === input.value) {
      refreshInspection('No changes needed.');
      return;
    }
    undoStack.push(input.value);
    input.value = changed;
    refreshInspection('Changes applied.');
    input.focus();
  }

  input.addEventListener('input', () => { undoStack.length = 0; refreshInspection(); });
  input.addEventListener('scroll', syncOverlay);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncOverlay).observe(input);
  window.addEventListener('resize', syncOverlay);

  for (const mode of ['upper', 'lower', 'title', 'camel', 'pascal', 'snake', 'screaming', 'kebab']) {
    byId('case-' + mode).addEventListener('click', () => applyChange(text => transformCase(text, mode)));
  }
  byId('trim').addEventListener('click', () => applyChange(text => text.trim()));
  byId('remove-invisible').addEventListener('click', () => applyChange(text => text.replace(invisiblePattern, '')));
  byId('normalize-spaces').addEventListener('click', () => applyChange(text => text.replace(unusualSpacePattern, ' ')));
  byId('strip-accents').addEventListener('click', () => applyChange(stripAccents));
  byId('undo').addEventListener('click', () => {
    if (!undoStack.length) return;
    input.value = undoStack.pop();
    refreshInspection('Last change undone.');
    input.focus();
  });
  byId('clear').addEventListener('click', () => {
    if (!input.value) return;
    undoStack.push(input.value);
    input.value = '';
    refreshInspection('Text cleared.');
    input.focus();
  });
  byId('copy').addEventListener('click', async () => {
    if (!input.value) { byId('message').textContent = 'Nothing to copy.'; return; }
    try {
      await navigator.clipboard.writeText(input.value);
      byId('message').textContent = 'Copied!';
    } catch {
      input.focus();
      input.select();
      byId('message').textContent = 'Selected. Press Ctrl+C to copy.';
    }
  });
  refreshInspection();
})();
