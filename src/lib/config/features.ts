/** Home-controlled feature availability, shared by UI and runtime boundaries. */
export function localAppsEnabled(): boolean {
  return (process.env.RI_LOCAL_APPS ?? '1') === '1';
}
