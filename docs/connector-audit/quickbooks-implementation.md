# QuickBooks implementation

Status: native read implementation complete and fixture-verified. Read operations only. No live company, credentials, app registration, or accounting mutations used for verification.

## Delivery checklist

- [x] Verify official hosted MCP eligibility and local-server alternative.
- [x] Bind company identity and production/sandbox environment to each connection.
- [x] Preserve existing actions and add useful financial reports and invoice/customer reads.
- [x] Validate read-only queries, dates, filters, pagination, and provider errors.
- [x] Verify with fixture tests and connector package checks.
- [x] Document setup, coverage, and remaining gates.

## Integration decision

Use the native QuickBooks Online Accounting API with the user's own Intuit developer app. The official hosted developer MCP at `https://mcp.quickbooks.intuit.com/mcp` is an invitation-only App Partner Program pilot. Onboarding requires a Solution Engineer, approved AppID and MCP scopes, IP range allowlisting, and a partner User-Agent. It is not a public dynamic-client-registration service. Its own README recommends REST for deterministic code-driven integrations. [Official developer pilot](https://github.com/IntuitDeveloper/intuit-3p-ai-pilot/blob/main/README.md).

The Claude directory lists a different official endpoint, `https://ai-inc.quickbooks.intuit.com/v1/mcp`. Intuit documents connecting that service through Claude, but does not document general third-party OAuth client onboarding for our app. Directory presence alone does not establish eligibility. [QuickBooks connector for Claude](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/use-quickbooks-connector-claude/L3YBlo6Ht_US_en_US).

Intuit also publishes an official local stdio MCP server with broad accounting entity CRUD and reports. It still needs the user's own Intuit OAuth app, environment, company realm, and rotating refresh tokens. Adopting it requires process lifecycle and a secure token-storage bridge to our connection store. It is not a hosted URL replacement. Its README provides separate switches to disable writes, updates, and deletes. [Official local server](https://github.com/intuit/quickbooks-online-mcp-server), [registered tools](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/index.ts).

## Connection requirements

- Configure `CONNECTORS_QUICKBOOKS_CLIENT_ID`, `CONNECTORS_QUICKBOOKS_CLIENT_SECRET`, and `CONNECTORS_QUICKBOOKS_REDIRECT_URI` for the user's own registered Intuit app. Root implementation owns the app runtime wiring and settings presentation.
- Configure `CONNECTORS_QUICKBOOKS_ENVIRONMENT=production` or `sandbox`. Production is the compatibility default for old connections. The selected environment is saved when connecting, so changing a deployment setting does not redirect existing companies to another API host.
- Match credentials, selected environment, and registered callback. Intuit requires HTTPS for production redirects. Sandbox supports localhost callbacks. A local production install needs an eligible registered HTTPS redirect/relay arrangement. [Official server setup](https://github.com/intuit/quickbooks-online-mcp-server), [Intuit production callback example](https://github.com/IntuitDeveloper/SampleApp-SalesTax-Java).
- Request `com.intuit.quickbooks.accounting`. Intuit's accounting authorization-code grant returns refresh tokens without an `offline_access` scope. Company identity is read through Accounting, so this connector does not request unused OpenID identity scopes. [Official OAuth SDK](https://github.com/intuit/oauth-jsclient).
- Capture the OAuth callback's `realmId`, fetch that company's information before saving the connection, and display its actual company name. Production account IDs retain the previous realm ID contract. Sandbox account IDs use `sandbox:<realmId>` to distinguish the same realm across environments.

## Scope and evidence

The existing `quickbooks.query`, `quickbooks.get_customer`, `quickbooks.list_invoices`, and `quickbooks.get_company_info` names remain public contracts. Reports preserve QuickBooks' hierarchy and formatted amounts, including currencies, zeroes, and negative values. This layer does not calculate accounting totals.

API evidence: [invoice reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/invoice), [query syntax](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries), [API limits](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html). Report inputs are cross-checked against Intuit's own server tools and handlers, including [P&L](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/tools/get-profit-and-loss.tool.ts), [balance sheet handling](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/handlers/get-quickbooks-balance-sheet.handler.ts), [cash flow](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/tools/get-cash-flow.tool.ts), [aging](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/tools/get-aged-receivables.tool.ts), and [general ledger](https://github.com/intuit/quickbooks-online-mcp-server/blob/main/src/tools/get-general-ledger.tool.ts).

No write tools are being added while the requested read/write preference is unresolved. The Accounting OAuth scope itself is broad, but all exposed actions in this implementation issue GET reads only.

## Delivered read surface

| Action | Inputs and result |
| --- | --- |
| `quickbooks.query` | One SELECT, including COUNT, with native WHERE/ORDERBY/STARTPOSITION/MAXRESULTS. Returns the existing QueryResponse payload. Rejects mutation keywords, extra statements, comments, and unclosed literals before HTTP. Quoted values are handled separately from SQL keywords. |
| `quickbooks.get_customer` | Complete customer by ID. Existing action and unwrapped Customer result preserved. |
| `quickbooks.get_invoice` | Complete invoice by ID, including lines and balances. |
| `quickbooks.list_invoices` | Optional customer ID, inclusive transaction-date range, unpaid filter. Descending transaction date. Existing Invoice array preserved, with next_start_position added. |
| `quickbooks.list_customers` | Active, inactive, or all customers, with optional exact display-name filter. Ascending display name. |
| `quickbooks.get_company_info` | Connected company information. Existing action and unwrapped CompanyInfo result preserved. |
| `quickbooks.get_profit_and_loss` | Date range, Cash/Accrual, supported column grouping, customer/vendor/item/department/class filters. |
| `quickbooks.get_balance_sheet` | Date range, Cash/Accrual, column grouping. An end_date alone also supplies January 1 of that year, matching Intuit's official MCP workaround for the API ignoring an isolated end_date. |
| `quickbooks.get_cash_flow` | Date range and column grouping. |
| `quickbooks.get_trial_balance` | Date range and Cash/Accrual. |
| `quickbooks.get_general_ledger` | Date range, Cash/Accrual, account_id and source_account. account_id maps to Intuit's account parameter, avoiding the engine's reserved account selector. |
| `quickbooks.get_aged_receivables` | Report date, customer, aging method, period size and count. |
| `quickbooks.get_aged_payables` | Report date, vendor, aging method, period size and count. |

List actions take a one-based `start_position` and `limit` of 1 to 999, default 20. They request one extra record within Intuit's 1000-record maximum, return only the requested limit, and supply `next_start_position` or null. They do not incorrectly claim another page merely because the current page is full. As with offset pagination generally, changing remote data between requests can shift results. Native queries leave pagination under the caller's explicit STARTPOSITION/MAXRESULTS control.

Every date must be a real YYYY-MM-DD calendar date. Date ranges must be ordered. Report schemas only expose supported filters and reject extra fields. Provider Fault bodies, invalid entity wrappers, and malformed report shapes become provider errors instead of success results. Fixed Intuit hosts and validated realm/record IDs prevent config or IDs from changing the destination host or route.

The generic query also permits read access to other supported Accounting entities, for example accounts, vendors, bills, payments, and journal entries. This does not claim comprehensive dedicated-tool parity with the official local MCP server. Writes, invoice sending/PDF export, attachments, webhook handling, and CDC are not added in this pass.

## Verification

- 32 QuickBooks fixture tests cover production/sandbox routing and identity, old connection compatibility, company verification failures, SELECT validation, details, filters/escaping, pagination boundaries, invalid dates, provider errors, all seven report routes, amount preservation, as-of balance sheets, and reserved account-field mapping.
- All 414 connector tests across 52 files passed after the changes, including every-provider smoke coverage with realistic QuickBooks response envelopes.
- Connector package TypeScript check and scoped ESLint passed.
- Real Intuit authorization and live company reads remain unverified. The fifth-wave readiness check found no QuickBooks environment credentials, saved OAuth app or company connection in the active configuration checked. Configuring an eligible Intuit app is the remaining prerequisite. Production use requires matching production credentials and a registered HTTPS callback.

## Suggested setup copy

“Connect your QuickBooks Online company using your own Intuit app. Read invoices, customers, company details, and financial reports. Choose production or sandbox and enter matching client credentials. Production connections require a registered HTTPS callback.”

Hosted MCP should only replace this native path after Intuit confirms third-party client eligibility and the app can satisfy its OAuth/client approval requirements. A Claude listing or reachable endpoint alone is not sufficient.
