/**
 * The view's markdown: what Ri's editor writes draws as it does in Ri, and
 * nothing in a body ever becomes markup, script or a link to anything but
 * the web or mail.
 */
import { parseHTML } from 'linkedom';
import { beforeAll, expect, it, vi } from 'vitest';

let markdown: typeof import('./markdown').markdown;
const openItem = vi.fn();
const openLink = vi.fn();

beforeAll(async () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('document', document);
  ({ markdown } = await import('./markdown'));
});

function draw(source: string, links: Record<string, { type: 'task' | 'note'; title: string }> = {}): string {
  const box = document.createElement('div');
  box.append(markdown(source, { links, openItem, openLink }));
  return box.innerHTML;
}

it('draws headings, paragraphs, emphasis and code as Ri’s editor writes them', () => {
  expect(draw('# Plan\n\nShip **it** with *care*, _today_ and ~~never~~.\nSame paragraph.')).toBe(
    '<h2>Plan</h2><p>Ship <strong>it</strong> with <em>care</em>, <em>today</em> and <s>never</s>.\nSame paragraph.</p>',
  );
  expect(draw('A `code *span*` and snake_case_name and 2*3*4')).toBe('<p>A <code>code *span*</code> and snake_case_name and 2*3*4</p>');
  expect(draw('my_var__name, parent.__x=1 and __bold__')).toBe('<p>my_var__name, parent.__x=1 and <strong>bold</strong></p>');
  expect(draw('\\*not emphasis\\*')).toBe('<p>*not emphasis*</p>');
  expect(draw('```\nconst a = 1 < 2;\n**x**\n```')).toBe('<pre><code>const a = 1 &lt; 2;\n**x**</code></pre>');
  expect(draw('Line one  \nLine two')).toBe('<p>Line one<br>Line two</p>');
});

it('draws lists, nested lists, task lists, quotes, rules and tables', () => {
  expect(draw('- one\n- two\n  - inner\n- three')).toBe('<ul class="md-list"><li>one</li><li>two<ul class="md-list"><li>inner</li></ul></li><li>three</li></ul>');
  expect(draw('3. three\n4. four')).toBe('<ol start="3" class="md-list"><li>three</li><li>four</li></ol>');
  expect(draw('1. one\n\n2. two')).toBe('<ol class="md-list"><li>one</li><li>two</li></ol>');
  expect(draw('- [x] Discovery\n- [ ] Consent')).toBe(
    '<ul class="md-list"><li class="md-task"><span aria-label="Done" role="img" class="md-box on">✓</span><span>Discovery</span></li>'
    + '<li class="md-task"><span aria-label="Not done" role="img" class="md-box"></span><span>Consent</span></li></ul>',
  );
  expect(draw('> quoted **words**\n> more')).toBe('<blockquote><p>quoted <strong>words</strong>\nmore</p></blockquote>');
  expect(draw('above\n\n---\n\nbelow')).toBe('<p>above</p><hr><p>below</p>');
  expect(draw('| a | b |\n|---|:-:|\n| 1 | **2** |')).toBe('<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table></div>');
  expect(draw('para\n- list after')).toBe('<p>para</p><ul class="md-list"><li>list after</li></ul>');
  expect(draw('a | b\n\n---')).toBe('<p>a | b</p><hr>');
});

it('makes web and mail links open through the host, and leaves every other kind as words', () => {
  expect(draw('[spec](https://example.com/a) and <mailto:a@b.co> and https://ri.example/x.')).toBe(
    '<p><a class="md-link" href="https://example.com/a">spec</a> and <a class="md-link" href="mailto:a@b.co">mailto:a@b.co</a> and <a class="md-link" href="https://ri.example/x">https://ri.example/x</a>.</p>',
  );
  expect(draw('[run](javascript:alert(1)) [data](data:text/html,hi)')).toBe('<p>run) data</p>');
});

it('never turns a body into markup', () => {
  const html = draw('<img src=x onerror=alert(1)> <script>alert(1)</script>\n\n<b>bold?</b>');
  expect(html).toBe('<p>&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;alert(1)&lt;/script&gt;</p><p>&lt;b&gt;bold?&lt;/b&gt;</p>');
  expect(draw('![a cat](https://cdn.example/cat.png)')).toBe('<p><span class="chip">Image: a cat</span></p>');
});

it('draws Ri’s task and note links with their titles, opening them in the view', () => {
  const html = draw('See [[note:n1]], [[task:t1]], [[task:gone]], [[task:home/t2]] and [[file:0193.pdf]].', { n1: { type: 'note', title: 'Launch notes' }, t1: { type: 'task', title: 'Ship it' } });
  expect(html).toBe('<p>See <button class="md-ref" type="button">Launch notes</button>, <button class="md-ref" type="button">Ship it</button>, '
    + '<span class="chip">A task in Ri</span>, <span class="chip">A task in Ri</span> and <span class="chip">File 0193.pdf</span>.</p>');
});
