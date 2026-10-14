/**
 * ============================================================================
 *  Connect a Square account through the LinkToAny Unified API SDK
 * ============================================================================
 *
 * Square is an OAuth 2.0 integration, so connecting is a two-step handshake:
 *
 *   step 1  this script mints a Square connect link (`client.auth.createConnectLink`)
 *           and prints it. Open it in a browser, sign in to the Square seller
 *           account and approve the permissions. Square sends the browser back
 *           to LinkToAny, which exchanges the code for tokens, reads the
 *           merchant id from Square and stores the account. The browser then
 *           lands on LINKTOANY_SUCCESS_URL with `?provider=square&external_id=<square
 *           merchant id>` appended (`?accountId=…&merchantId=…` on the connectAccount path).
 *
 *           Why a connect link and not `connectAccount`? Square only accepts
 *           redirect URIs registered on the Square app. The connect link uses
 *           LinkToAny's own callback, which is registered; `connectAccount`
 *           uses the credential set's callback, which Square rejects as an
 *           invalid redirect URI unless it has been registered too. Set
 *           LINKTOANY_SQUARE_CONNECT=start to use `connectAccount` anyway.
 *
 *   step 2  re-run this script with LINKTOANY_ACCOUNT_ID=<id from the redirect>
 *           to confirm the account is active and its tokens are healthy.
 *
 * Run:
 *
 *   # step 1 — mint the authorization URL
 *   LINKTOANY_API_KEY=ak_... npx tsx examples/connect-square.ts
 *
 *   # step 2 — verify the connected account
 *   LINKTOANY_API_KEY=ak_... LINKTOANY_ACCOUNT_ID=... npx tsx examples/connect-square.ts
 *
 * Env vars:
 *   LINKTOANY_API_KEY           required — API key (`Authorization: Bearer <key>`)
 *   LINKTOANY_ENV               'dev' (default, api.staging.linktoany.com) or 'prod'
 *   LINKTOANY_SQUARE_SYSTEM_ID  optional — Square integration id; discovered by
 *                               name from the catalogue when omitted
 *   LINKTOANY_SQUARE_CREDENTIAL_ID optional — credential set to use for the connect
 *                               link; defaults to the one resolved for your key
 *   LINKTOANY_SQUARE_APPLICATION optional — credential-set slug for connectAccount
 *                               (LINKTOANY_SQUARE_CONNECT=start only)
 *   LINKTOANY_SQUARE_CONNECT    'link' (default) or 'start'
 *   LINKTOANY_SUCCESS_URL       optional — where the merchant lands after consent
 *   LINKTOANY_FAILURE_URL       optional — where the merchant lands on decline/error
 *   LINKTOANY_ACCOUNT_ID        optional — run the verification step instead
 *   LINKTOANY_MERCHANT_ID       optional — same, but look the account up by the Square
 *                               merchant id (the connect link's redirect carries it as
 *                               `?provider=square&external_id=<merchant id>`)
 * ============================================================================
 */

import { LinkToAny, LinkToAnyError, ValidationError } from '../src/index.js';

const API_KEY = process.env.LINKTOANY_API_KEY;
if (!API_KEY) {
  console.error('LINKTOANY_API_KEY is required. Create one in the dashboard and export it first.');
  process.exit(1);
}

const client = new LinkToAny({
  apiKey: API_KEY,
  environment: (process.env.LINKTOANY_ENV as 'dev' | 'prod') ?? 'dev'
});

const SUCCESS_URL = process.env.LINKTOANY_SUCCESS_URL ?? 'https://example.com/integrations/square/done';
const FAILURE_URL = process.env.LINKTOANY_FAILURE_URL ?? 'https://example.com/integrations/square/failed';

/**
 * Find the Square integration id — from env, or from the systems your instance
 * supports (its chosen vertical). The platform catalogue is deliberately not
 * used: it lists every integration on the platform, not the ones you can serve.
 */
async function resolveSquareSystemId(): Promise<string> {
  const fromEnv = process.env.LINKTOANY_SQUARE_SYSTEM_ID;
  if (fromEnv) return fromEnv;

  const instance = await client.instances.listSystems();
  console.log(`Instance "${instance.name}" (vertical ${instance.vertical}) supports: ${instance.systems.map(s => s.name).join(', ')}`);

  const square = instance.systems.find(s => /^square$/i.test(s.name ?? '')) ?? instance.systems.find(s => /square/i.test(s.name ?? ''));
  if (!square) {
    throw new Error(`Square is not part of the '${instance.vertical}' vertical your instance uses.`);
  }
  const readable = square.entityTypes.filter(e => e.read).map(e => e.entityType);
  console.log(`Square integration: "${square.name}" (${square.systemId}) — readable: ${readable.join(', ')}; connected accounts: ${square.connectedAccountCount}`);
  return square.systemId;
}

/** Step 1 — ask for the Square authorization URL. */
async function startConnection(systemId: string): Promise<void> {
  // What does connecting Square take? Expect mode 'oauth_redirect'.
  const reqs = await client.auth.getLinkRequirements(systemId);
  console.log(`\nLink requirements for ${reqs.systemName}:`);
  console.log(`  mode        = ${reqs.mode}`);
  console.log(`  authType    = ${reqs.authType}`);
  console.log(`  application = ${reqs.application}`);
  console.log(`  credential sets = ${reqs.availableApplications.map(a => `${a.application} (${a.authType})`).join(', ')}`);

  if (reqs.mode !== 'oauth_redirect') {
    throw new Error(
      `Expected Square to connect via OAuth redirect but got mode '${reqs.mode}'. ` +
        'The credential set resolved for this API key has no OAuth clientId configured.'
    );
  }

  if (process.env.LINKTOANY_SQUARE_CONNECT === 'start') {
    // Direct authorization URL. Only works when the credential set's callbackUrl is
    // registered as a redirect URI on the Square app.
    const application = process.env.LINKTOANY_SQUARE_APPLICATION ?? reqs.application;
    console.log(`\nConnecting with credential set: ${application}${application !== reqs.application ? ' (overriding server default)' : ''}`);
    const result = await client.auth.connectAccount(systemId, application, {
      successUrl: SUCCESS_URL,
      failureUrl: FAILURE_URL
    });
    if (result.data.authType !== 'oauth' || !result.data.authUrl) {
      throw new Error(`Unexpected connect response: ${JSON.stringify(result.data)}`);
    }
    console.log('\nOpen this URL in a browser and approve the Square permissions:\n');
    console.log(`  ${result.data.authUrl}\n`);
    console.log(`Square will redirect to: ${result.data.callbackUrl}`);
  } else {
    // Shareable connect link (default). Goes through LinkToAny's registered Square
    // callback, so it works without touching the Square app's redirect URIs.
    const clientCredentialId = process.env.LINKTOANY_SQUARE_CREDENTIAL_ID ?? reqs.clientCredentialId;
    const link = await client.auth.createConnectLink(systemId, {
      successUrl: SUCCESS_URL,
      failureUrl: FAILURE_URL,
      clientCredentialId
    });
    if (link.mode !== 'oauth_redirect') {
      throw new Error(`Expected an OAuth connect link but got mode '${link.mode}'`);
    }
    console.log(`\nConnect link minted (credential set ${link.clientCredentialId}, via ${link.authMethod}, expires ${link.expiresAt ?? 'n/a'}).`);
    console.log('Open it in a browser and approve the Square permissions:\n');
    console.log(`  ${link.accountLinkUrl}\n`);
  }

  console.log(`After consent the browser lands on ${SUCCESS_URL} with the merchant id in the query string.`);
  console.log('\nThen verify with either:');
  console.log('  LINKTOANY_MERCHANT_ID=<external_id from the redirect> npx tsx examples/connect-square.ts');
  console.log('  LINKTOANY_ACCOUNT_ID=<accountId from the redirect>   npx tsx examples/connect-square.ts');
}

/** Step 2 — confirm the account exists, is active and its tokens are healthy. */
async function verifyConnection(systemId: string, accountId?: string, merchantId?: string): Promise<void> {
  if (!accountId) {
    // Connect-link redirects carry the platform merchant id; resolve the account from it.
    const { data: matches } = await client.accounts.listByMerchant(merchantId!);
    const match = matches.find(a => String(a.systemId) === systemId) ?? matches[0];
    if (!match) throw new Error(`No account found for merchant ${merchantId}`);
    accountId = match._id;
    console.log(`\nMerchant ${merchantId} → account ${accountId}`);
  }

  const { data: status } = await client.auth.getStatus(accountId);
  console.log(`\nAccount ${status.accountId}: status=${status.status} authenticated=${status.isAuthenticated} merchantId=${status.merchantId ?? '-'} systemId=${status.systemId ?? '-'} lastAuthAt=${status.lastAuthAt ?? '-'}`);
  if (!status.isAuthenticated) {
    throw new Error('Account is not authenticated yet — did the merchant finish the Square consent screen?');
  }

  const tokens = await client.auth.getTokenStatus(accountId);
  console.log(`Token status: ${JSON.stringify(tokens.data)}`);

  // Prove the connection works end to end: read one page of unified records.
  const page = await client.records.list(accountId, 'order', { pageSize: 1 });
  console.log(`Unified read OK — ${page.data.length} order(s) on the first page, hasMore=${page.pagination?.hasMore ?? false}`);
}

async function main(): Promise<void> {
  console.log(`Base URL: ${client.baseUrl}`);
  const systemId = await resolveSquareSystemId();

  const accountId = process.env.LINKTOANY_ACCOUNT_ID;
  const merchantId = process.env.LINKTOANY_MERCHANT_ID;
  if (accountId || merchantId) {
    await verifyConnection(systemId, accountId, merchantId);
  } else {
    await startConnection(systemId);
  }
}

main().catch(err => {
  if (err instanceof ValidationError) {
    console.error(`Validation error: ${err.message}`);
    console.error(JSON.stringify(err.body, null, 2));
  } else if (err instanceof LinkToAnyError) {
    console.error(`${err.name} (${err.status ?? 'n/a'}): ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
