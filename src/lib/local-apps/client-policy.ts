/** What an `app_client` key may reach. Kept apart from the service so the proxy loads nothing else. */
const CLIENT_ROUTE = /^\/api\/local-apps\/client\/[a-z][a-z0-9_]{0,63}$/;

export function appClientMayReach(pathname: string, method: string): boolean {
  return method === 'POST' && CLIENT_ROUTE.test(pathname);
}
