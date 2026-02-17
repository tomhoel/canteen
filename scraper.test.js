const test = require('node:test');
const assert = require('node:assert');

// Mock dependencies that are not installed in the environment
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'playwright') {
        return { chromium: {} };
    }
    if (request === '@google/genai') {
        return { GoogleGenAI: class {} };
    }
    return originalLoad.apply(this, arguments);
};

const { mergeItems } = require('./scraper.js');

test('mergeItems - basic merging with preposition', () => {
    const input = [
        'Fullkorn pasta Bolognese med',
        'parmesan 1,3,4'
    ];
    const expected = ['Fullkorn pasta Bolognese med parmesan 1,3,4'];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - merging with different prepositions', () => {
    const preps = ['med', 'og', 'with', 'and', 'in', 'på', 'i', 'over', 'under', 'til', 'fra', 'av', 'uten', 'mashed'];
    preps.forEach(prep => {
        const input = [`Dish ${prep}`, 'side'];
        const expected = [`Dish ${prep} side`];
        assert.deepStrictEqual(mergeItems(input), expected, `Failed for preposition: ${prep}`);
    });
});

test('mergeItems - merging short lowercase line', () => {
    const input = [
        'Pasta',
        'med saus'
    ];
    const expected = ['Pasta med saus'];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - should NOT merge long lowercase line', () => {
    const input = [
        'Pasta',
        'this is a very long line that starts with lowercase but is more than thirty characters long'
    ];
    const expected = [
        'Pasta',
        'this is a very long line that starts with lowercase but is more than thirty characters long'
    ];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - should NOT merge uppercase line', () => {
    const input = [
        'Item 1',
        'Item 2'
    ];
    const expected = ['Item 1', 'Item 2'];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - multiple merges', () => {
    const input = [
        'Kylling og',
        'ris',
        'med salat'
    ];
    const expected = ['Kylling og ris med salat'];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - handles empty lines and whitespace', () => {
    const input = [
        '  Item 1  ',
        '',
        '   ',
        'Item 2'
    ];
    const expected = ['Item 1', 'Item 2'];
    assert.deepStrictEqual(mergeItems(input), expected);
});

test('mergeItems - Norwegian characters', () => {
    const input = [
        'Laks på',
        'eng av grønnsaker'
    ];
    const expected = ['Laks på eng av grønnsaker'];
    assert.deepStrictEqual(mergeItems(input), expected);
});
