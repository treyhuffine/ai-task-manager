export interface RiDesktop {
  platform: string;
  openExternal(url: string): Promise<void>;
}

declare global { interface Window { riDesktop?: RiDesktop } }

export async function openConnectorAuthorization(url: string) {
  if (window.riDesktop) await window.riDesktop.openExternal(url);
  else window.location.assign(url);
}
