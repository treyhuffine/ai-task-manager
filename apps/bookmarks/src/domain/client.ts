/** What an outside client is given. Built here so the view and the tests share one form. */

/** The extension's whole setup in one paste. It holds the key, so it is shown once. */
export function connectionCode(input: { homeUrl: string; appUrl: string; key: string }): string {
  return `ri-bookmarks:${Buffer.from(JSON.stringify({ v: 1, home: input.homeUrl, app: input.appUrl, key: input.key })).toString("base64url")}`;
}

/**
 * The bookmarklet. It holds no secret: it opens this app's save page, where the
 * browser's own Ri sign-in applies. The page can refuse a script but not a new window.
 */
export function bookmarkletFor(appUrl: string): string {
  const code = `(function(){var u=location.href;if(u.length>1000){alert('This link is too long to save from here.');return}var s=String(getSelection()).slice(0,500);window.open(${JSON.stringify(`${appUrl}/save`)}+'?url='+encodeURIComponent(u)+'&title='+encodeURIComponent(document.title.slice(0,300))+'&note='+encodeURIComponent(s),'ri-save','width=480,height=800')})()`;
  return `javascript:${code}`;
}
