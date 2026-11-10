import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(`
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TreeViewToggle } from './src/components/executions/file-tree/tree-view-toggle';

    document.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif';

    function Example({ count }) {
      const [mode, setMode] = useState('all');
      return <section data-count={count}>
        <TreeViewToggle mode={mode} onChange={setMode} changedCount={count} />
        <output>{mode}</output>
      </section>;
    }

    const width = Number(new URLSearchParams(location.search).get('width'));
    createRoot(document.getElementById('root')).render(
      <div style={{ width, padding: 8 }}>
        {[0, 6, 99, 5000].map(count => <Example key={count} count={count} />)}
      </div>
    );
  `, [], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

it.each([160, 180, 191, 192, 240, 360])('fits a %ipx file panel with a padded badge and a working switch', async width => {
  const page = await fixture.browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.goto(`${fixture.url}?width=${width}`);
    const example = page.locator('section[data-count="6"]');
    const toggle = example.getByRole('switch', { name: 'Changes only', exact: true });
    await toggle.waitFor();

    const problems = await page.locator('section label').evaluateAll(labels => labels.flatMap(label => {
      const bounds = label.getBoundingClientRect();
      const failures: string[] = [];
      let previousRight = bounds.left;
      for (const child of label.children) {
        const box = child.getBoundingClientRect();
        if (box.left < previousRight || box.right > bounds.right) failures.push('Filter controls overlap or overflow');
        previousRight = box.right;
      }
      const caption = label.children[1];
      const text = document.createRange();
      text.selectNodeContents(caption);
      if (text.getBoundingClientRect().height > parseFloat(getComputedStyle(caption).lineHeight) + 1) {
        failures.push('Filter label wraps');
      }
      const toggle = label.querySelector('[role="switch"]')!;
      if (toggle.getBoundingClientRect().width < 24) failures.push('Switch is squeezed');
      const badge = label.lastElementChild!;
      text.selectNodeContents(badge);
      const badgeBox = badge.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      if (textBox.left - badgeBox.left < 5.5 || badgeBox.right - textBox.right < 5.5) {
        failures.push('Count badge needs horizontal padding');
      }
      return failures;
    }));
    expect(problems).toEqual([]);

    // The label follows the panel's width, even on a wide browser viewport.
    expect(await example.locator('label > span').first().innerText()).toBe(width >= 192 ? 'Changes only' : 'Changes');
    const badgeWidths = await page.locator('section label > span:last-child').evaluateAll(badges =>
      badges.map(badge => badge.getBoundingClientRect().width));
    expect(new Set(badgeWidths).size).toBe(1);
    const largestBadge = page.locator('section[data-count="5000"] label > span:last-child');
    expect(await largestBadge.textContent()).toBe('99+');

    await toggle.click();
    expect(await toggle.isChecked()).toBe(true);
    expect(await example.locator('output').textContent()).toBe('changed');
    await example.locator('label > span').first().click();
    expect(await toggle.isChecked()).toBe(false);
    expect(await example.locator('output').textContent()).toBe('all');
    await toggle.focus();
    await toggle.press('Space');
    expect(await example.locator('output').textContent()).toBe('changed');

    // No changes is still a valid filtered view, rather than a disabled filter.
    const empty = page.locator('section[data-count="0"]');
    await empty.getByRole('switch', { name: 'Changes only', exact: true }).click();
    expect(await empty.locator('output').textContent()).toBe('changed');

    if (width === 240) {
      await largestBadge.hover();
      await page.getByRole('tooltip').waitFor();
      expect(await page.getByRole('tooltip').textContent()).toContain('5,000 changed files');
    }
  } finally { await page.close(); }
});
