import Adapt from 'core/js/adapt';
import drawer from 'core/js/drawer';
import GlossaryView from './adapt-contrib-glossaryView';

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
  if (!csvText.trim()) return [];

  return parseCsvRows(csvText).reduce((items, row) => {
    for (let i = 0; i < row.length; i += 2) {
      while (i < row.length && !row[i].trim()) {
        i++;
      }
      if (i >= row.length) break;

      const term = row[i].trim();
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
  const glossaryItems = [
    ...manualGlossaryItems,
    ...csvGlossaryItems
  ];

  drawer.addItem(drawerObject, 'glossary:showGlossary');

  setupGlossary(courseGlossary, glossaryItems);
}

Adapt.on('app:dataReady', initGlossary);
