import Adapt from 'core/js/adapt';
import drawer from 'core/js/drawer';
import GlossaryView from './adapt-contrib-glossaryView';

function escapeRegExp(string = '') {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeTermText(value = '') {
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

function normalizeCsvSourceText(csvText = '') {
  return String(csvText)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<\/li>\s*<li[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|span)[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

function parseCsvRows(csvText = '') {
  const rows = [];
  let row = [];
  let value = '';
  let isInsideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (isInsideQuotes && nextChar === '"') {
        value += '"';
        i++;
        continue;
      }
      isInsideQuotes = !isInsideQuotes;
      continue;
    }

    if (char === ',' && !isInsideQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !isInsideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function getGlossaryItemsFromCsv(csvText = '') {
  const normalizedCsvText = normalizeCsvSourceText(csvText);
  if (!normalizedCsvText) return [];

  return parseCsvRows(normalizedCsvText).reduce((items, row) => {
    for (let i = 0; i < row.length; i += 2) {
      while (i < row.length && !row[i].trim()) {
        i++;
      }
      if (i >= row.length) break;

      const term = sanitizeTermText(row[i]);
      const description = (row[i + 1] || '').trim();
      if (!term || !description) continue;

      items.push({
        term,
        termAriaLabel: term,
        description
      });
    }
    return items;
  }, []);
}

function parseTermWithDerivatives(rawTerm = '') {
  const term = sanitizeTermText(rawTerm);
  if (!term) {
    return {
      term: '',
      variants: []
    };
  }

  const firstBracketIndex = term.indexOf('[');
  const hasDerivativeSyntax = firstBracketIndex > -1 && term.endsWith(']');
  if (!hasDerivativeSyntax) {
    return {
      term,
      variants: [term]
    };
  }

  const termHeadword = sanitizeTermText(term.slice(0, firstBracketIndex));
  const rawDerivativeTerms = term.slice(firstBracketIndex + 1, -1);
  if (!termHeadword) {
    return {
      term,
      variants: [term]
    };
  }

  const variants = [
    termHeadword,
    ...rawDerivativeTerms.split('|').map(value => sanitizeTermText(value)).filter(Boolean)
  ];

  return {
    term: termHeadword,
    variants: _.uniq(variants)
  };
}

function normalizeGlossaryItems(glossaryItems = []) {
  return glossaryItems.map(item => {
    const parsedTerm = parseTermWithDerivatives(item.term || '');
    const shouldUpdateTermAriaLabel = !item.termAriaLabel || item.termAriaLabel === item.term;

    return {
      ...item,
      term: parsedTerm.term,
      termAriaLabel: shouldUpdateTermAriaLabel ? parsedTerm.term : item.termAriaLabel,
      _autoLinkTerms: parsedTerm.variants
    };
  });
}

function createAutoLinkMatcher(glossaryItems = []) {
  const termsByLowercase = {};
  const terms = glossaryItems.reduce((results, item) => {
    const glossaryTerm = sanitizeTermText(item && item.term);
    if (!glossaryTerm || !glossaryTerm.trim()) return results;

    const candidateTerms = Array.isArray(item._autoLinkTerms) ? item._autoLinkTerms : [glossaryTerm];
    candidateTerms.forEach(candidateTerm => {
      const cleanedTerm = sanitizeTermText(candidateTerm);
      if (!cleanedTerm) return;
      const loweredTerm = cleanedTerm.toLowerCase();
      if (termsByLowercase[loweredTerm]) return;
      termsByLowercase[loweredTerm] = glossaryTerm;
      results.push(cleanedTerm);
    });

    return results;
  }, []);

  if (!terms.length) {
    return null;
  }

  terms.sort((termA, termB) => termB.length - termA.length);

  return {
    termsByLowercase,
    termRegex: new RegExp(`(^|[^0-9A-Za-z])(${terms.map(escapeRegExp).join('|')})(?=$|[^0-9A-Za-z])`, 'gi')
  };
}

function transformTextNodeWithGlossaryLinks(textNode, matcher) {
  const { termRegex, termsByLowercase } = matcher;
  const text = textNode.nodeValue || '';
  termRegex.lastIndex = 0;

  if (!termRegex.test(text)) {
    return false;
  }

  termRegex.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = termRegex.exec(text))) {
    const leadingCharacter = match[1] || '';
    const matchedTerm = match[2];
    const leadingIndex = match.index;
    const matchStartIndex = leadingIndex + leadingCharacter.length;
    const matchEndIndex = matchStartIndex + matchedTerm.length;

    if (leadingIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, leadingIndex)));
    }

    if (leadingCharacter) {
      fragment.appendChild(document.createTextNode(leadingCharacter));
    }

    const glossaryTerm = termsByLowercase[matchedTerm.toLowerCase()] || matchedTerm;
    const glossaryLink = document.createElement('a');
    glossaryLink.setAttribute('href', '#');
    glossaryLink.setAttribute('data-glossaryterm', glossaryTerm);
    glossaryLink.textContent = matchedTerm;
    fragment.appendChild(glossaryLink);

    lastIndex = matchEndIndex;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return true;
}

function autoLinkTermsInElement($element, matcher) {
  const rootElement = $element && $element[0];
  if (!rootElement || rootElement.getAttribute('data-glossary-autolinked') === 'true') {
    return;
  }

  const excludedParentSelector = 'a, button, textarea, script, style';
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;

  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    const parentElement = node.parentElement;
    if (parentElement && parentElement.closest(excludedParentSelector)) continue;
    textNodes.push(node);
  }

  textNodes.forEach(textNode => transformTextNodeWithGlossaryLinks(textNode, matcher));
  rootElement.setAttribute('data-glossary-autolinked', 'true');
}

function setupAutoLinking(glossaryModel, glossaryItems) {
  if (!glossaryModel._autoLinkTermsInBody) return;

  const matcher = createAutoLinkMatcher(glossaryItems);
  if (!matcher) return;

  Adapt.on('view:postRender', view => {
    if (!view || !view.model || view.model.get('_type') !== 'component') return;

    const selectorsToAutoLink = [
      '.component__body-inner',
      '.component__body',
      '.matching-item__title_inner',
      '.matching-item__title'
    ];

    selectorsToAutoLink.forEach(selector => {
      view.$(selector).each((index, element) => {
        autoLinkTermsInElement($(element), matcher);
      });
    });
  });
}

function setupGlossary(glossaryModel, glossaryItems) {

  const options = {
    model: new Backbone.Model(glossaryModel),
    collection: new Backbone.Collection(glossaryItems)
  };

  Adapt.on('glossary:showGlossary', () => {
    drawer.openCustomView(new GlossaryView(options).$el);
  });

  /**
   * handler for links in the content in the following format:
   * <a href='#' data-glossaryterm='term name'>glossary term link</a>
   * these links should trigger the glossary to open with that term automatically selected
   */
  $('body').on('click.glossary', 'a[data-glossaryterm]', e => {
    if (e) e.preventDefault();

    const newOptions = {
      ...options,
      attributes: {
        'data-termtoshow': e.currentTarget.getAttribute('data-glossaryterm')
      }
    };

    drawer.openCustomView(new GlossaryView(newOptions).$el);
  });
}

function initGlossary() {
  const courseGlossary = Adapt.course.get('_glossary');

  if (!courseGlossary || !courseGlossary._isEnabled) {
    return;
  }

  const drawerObject = {
    title: courseGlossary.title,
    description: courseGlossary.description,
    className: 'is-glossary',
    drawerOrder: courseGlossary._drawerOrder || 0
  };

  const manualGlossaryItems = courseGlossary._glossaryItems || [];
  const csvGlossaryItems = getGlossaryItemsFromCsv(courseGlossary._csvGlossaryItems || '');
  const glossaryItems = normalizeGlossaryItems([
    ...manualGlossaryItems,
    ...csvGlossaryItems
  ]);

  setupAutoLinking(courseGlossary, glossaryItems);

  drawer.addItem(drawerObject, 'glossary:showGlossary');

  setupGlossary(courseGlossary, glossaryItems);
}

Adapt.on('app:dataReady', initGlossary);
