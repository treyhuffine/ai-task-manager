export interface LocalPageStyleOptions {
  theme?: 'light' | 'dark';
  /** The same plain CSS token stylesheet imported by the web app. */
  themeCss?: string;
  fontDataUrl?: string;
  /** White monochrome mark, inverted by the light theme. */
  logoDataUrl?: string;
  platform?: string;
}

/** Local pages accept bundled assets only. No page can fetch another origin. */
export function localPageStyle(nonce: string, options: LocalPageStyleOptions = {}) {
  if (!/^[a-zA-Z0-9]+$/.test(nonce)) throw new Error('Invalid page nonce');
  const theme = options.theme ?? 'dark';
  if (theme !== 'light' && theme !== 'dark') throw new Error('Invalid page theme');
  const platform = options.platform ?? '';
  if (!['', 'darwin', 'linux', 'win32'].includes(platform)) throw new Error('Invalid page platform');
  const css = options.themeCss ?? '';
  if (css.length > 100_000 || /[<>]|@import\b|url\s*\(/i.test(css)) throw new Error('Invalid page theme stylesheet');
  const logo = options.logoDataUrl;
  if (logo && (logo.length > 200_000 || !/^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))) throw new Error('Invalid logo image');
  const font = options.fontDataUrl;
  if (font && (font.length > 2_000_000 || !/^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/.test(font))) throw new Error('Invalid page font');

  return {
    attributes: `lang="en" class="${theme}" data-ri-desktop="${platform}"`,
    head: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${css}
${font ? `@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url("${font}") format("woff2")}` : ''}
:root{color-scheme:light}.dark{color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;min-height:100dvh;display:grid;align-content:center;padding:64px 32px 40px;background:var(--background,Canvas);color:var(--foreground,CanvasText);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:560px;margin:0 auto}main.maintenance{max-width:720px}
.desktop-titlebar{display:none}html[data-ri-desktop=darwin] .desktop-titlebar{display:block;position:fixed;inset:0 0 auto;height:40px;padding-left:88px;background:var(--background,Canvas);z-index:20;-webkit-app-region:drag;user-select:none}
button,input,summary{-webkit-app-region:no-drag}.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:600;font-size:18px;letter-spacing:-.02em}.brand img{width:28px;height:28px;object-fit:contain;filter:invert(1)}.dark .brand img{filter:none}
h1{font-size:24px;line-height:1.3;font-weight:600;letter-spacing:-.025em;margin:0 0 10px}h2{font-size:16px;line-height:1.5;font-weight:600;margin:0 0 8px}p{color:var(--muted-foreground,GrayText);margin:8px 0 16px}strong{color:var(--foreground,CanvasText);font-weight:500}
button,input{font:inherit}button{min-height:36px;border:1px solid transparent;border-radius:calc(var(--radius,.75rem) - 4px);background:var(--primary,ButtonText);color:var(--primary-foreground,ButtonFace);padding:8px 14px;cursor:pointer;font-weight:500;line-height:20px;transition:background-color .15s,color .15s,border-color .15s}button:hover{background:color-mix(in oklab,var(--primary,ButtonText) 90%,transparent)}button.secondary{background:var(--background,Canvas);border-color:var(--input,ButtonBorder);color:var(--foreground,CanvasText)}button.secondary:hover{background:var(--accent,ButtonFace);color:var(--accent-foreground,ButtonText)}button.link{min-height:28px;border:0;background:none;color:var(--muted-foreground,GrayText);padding:4px 0;font-size:13px;font-weight:400;text-decoration:none}button.link:hover{color:var(--foreground,CanvasText);text-decoration:underline;text-underline-offset:4px}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:3px}h1:focus{outline:none}
.choices{display:grid;gap:10px;margin:24px 0 18px}.choices button{text-align:center;min-height:40px}.hint,small{font-size:13px;line-height:1.6;color:var(--muted-foreground,GrayText)}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}label{display:block;margin-top:14px;font-weight:500}input:not([type=checkbox]){display:block;width:100%;min-height:36px;padding:8px 12px;margin-top:6px;background:transparent;border:1px solid var(--input,ButtonBorder);border-radius:calc(var(--radius,.75rem) - 4px);color:inherit}input::placeholder{color:var(--muted-foreground,GrayText)}input[type=checkbox]{margin:3px 10px 0 0;accent-color:var(--primary,Highlight)}.check{display:flex;align-items:flex-start;line-height:1.5}.check span{flex:1}.card{border:1px solid var(--border,ButtonBorder);border-radius:var(--radius,.75rem);padding:20px;margin:24px 0}.card p:last-child{margin-bottom:0}.card label:first-child{margin-top:0}.help p{margin-bottom:18px}.help h2{margin-top:24px}.help ol{color:var(--muted-foreground,GrayText);padding-left:22px}.help li{padding:3px 0}
details{border-top:1px solid var(--border,ButtonBorder);padding:16px 0}summary{cursor:pointer;font-weight:500}details>p:first-of-type{margin-top:12px}.nested{border-top:0;padding:8px 0 0}.nested summary{font-size:13px;color:var(--muted-foreground,GrayText);font-weight:400}.nested p{font-size:12px;overflow-wrap:anywhere}.footer{margin-top:26px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}#back{margin:0 0 20px;text-decoration:none}#error{color:var(--destructive,red);white-space:pre-wrap;overflow-wrap:anywhere}#error:empty{display:none}#status{font-weight:500;margin:0 0 8px;color:var(--foreground,CanvasText)}#connection-message,#worker-reason,#reason{overflow-wrap:anywhere}.muted{color:var(--muted-foreground,GrayText)}.compact{margin-top:12px}#detected{padding:16px;background:var(--muted,ButtonFace)}
.maintenance section{border:1px solid var(--border,ButtonBorder);padding:20px;border-radius:var(--radius,.75rem);margin-top:24px}.maintenance section>details:first-child{padding:0;border:0}.maintenance details details{border:0;margin-top:12px;padding:12px 0}.field{display:flex;gap:8px;align-items:center}.field input{flex:1;min-width:0}.field button{margin-top:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--muted,ButtonFace);padding:12px;border-radius:calc(var(--radius,.75rem) - 4px);font-size:12px}#reason{white-space:pre-wrap}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border,ButtonBorder);border-radius:4px}::-webkit-scrollbar-thumb:hover{background:var(--muted-foreground,GrayText)}
@media(max-width:600px){body{padding:56px 24px 32px}h1{font-size:23px}.maintenance section{padding:16px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>`,
    chrome: '<div class="desktop-titlebar" data-desktop-titlebar aria-hidden="true"></div>',
    brand: `<div class="brand">${logo ? `<img src="${logo}" alt="">` : ''}<span>Ri</span></div>`,
    script: `window.riLocal?.onTheme?.(theme=>{if(theme==='light'||theme==='dark'){document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.classList.toggle('light',theme==='light');}});`,
  };
}

/** Available before a Home or the Next.js server exists. */
export function startingPage(nonce: string, options: LocalPageStyleOptions = {}) {
  const style = localPageStyle(nonce, options);
  return `<!doctype html><html ${style.attributes} data-ri-local-view="loading"><head><meta charset="utf-8"><title>Ri</title>${style.head}</head><body>${style.chrome}<main>${style.brand}<h1>Opening your Ri</h1><p role="status" aria-live="polite">Connecting…</p></main><script nonce="${nonce}">${style.script}</script></body></html>`;
}
