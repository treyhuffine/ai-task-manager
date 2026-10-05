import assert from 'node:assert/strict'
import { join } from 'node:path'
import { root } from './config.mjs'

export async function verifyThirdPartyFlow({ page, host, resultFrame, count, pass }) {
  await host.getByRole('button', { name: 'Open chart example', exact: true }).click()
  const chart = await resultFrame(host, 'flint-chart-mcp interactive result')
  await chart.view.getByText('Sample monthly revenue', { exact: true }).first().waitFor()
  await chart.view.getByRole('button', { name: 'Theme: The Economist', exact: true }).click()
  await chart.view.getByText('Flint default', { exact: true }).click()
  await chart.view.getByRole('button', { name: 'Theme: Flint default', exact: true }).waitFor()
  assert.equal(count('create_chart_view'), 1)
  pass('The public Flint app renders sample revenue and its theme control changes the actual chart')
  if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
    await host.getByTitle('flint-chart-mcp interactive result', { exact: true }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(root, 'evidence/ri-flint-chart.png') })
  }

  await host.getByRole('button', { name: 'Open building map', exact: true }).click()
  const map = await resultFrame(host, 'metadata-demo-best interactive result')
  await map.view.getByText('Rijksmuseum, Amsterdam', { exact: true }).first().waitFor()
  await map.view.getByTitle('Zoom out', { exact: true }).click()
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && !await map.view.locator('img').evaluateAll(images => images.some(image => image.src.startsWith('https://tile.openstreetmap.org/') && image.complete && image.naturalWidth > 0))) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await map.view.locator('img').evaluateAll(images => images.some(image => image.src.startsWith('https://tile.openstreetmap.org/') && image.complete && image.naturalWidth > 0)), true)
  assert.equal(count('get_building_profile'), 1)
  assert.equal(count('render_map'), 1)
  pass('A real public building lookup feeds the third-party map app')
  if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
    await host.getByTitle('metadata-demo-best interactive result', { exact: true }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(root, 'evidence/ri-building-map.png') })
  }

  await host.getByRole('region', { name: 'flint-chart-mcp result', exact: true }).getByTitle('Close', { exact: true }).click()
  await host.getByTitle('flint-chart-mcp interactive result', { exact: true }).waitFor({ state: 'detached' })

  await host.getByRole('button', { name: 'Open building table', exact: true }).click()
  const frames = host.getByTitle('metadata-demo-best interactive result', { exact: true })
  await frames.nth(1).waitFor()
  const proxy = await (await frames.last().elementHandle()).contentFrame()
  await proxy.locator('iframe').waitFor()
  const table = await (await proxy.locator('iframe').elementHandle()).contentFrame()
  await table.getByText('Museumstraat 1, 1071XX Amsterdam', { exact: true }).waitFor()
  await table.getByText('1885', { exact: true }).waitFor()
  await table.getByText('Built', { exact: true }).click()
  await table.locator('th').nth(1).locator('svg').waitFor()
  assert.equal(count('get_building_profile'), 2)
  assert.equal(count('render_table'), 1)
  pass('The third-party table renders the actual building data')
  return { chart, map, table }
}
