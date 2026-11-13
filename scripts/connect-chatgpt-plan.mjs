import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const planScope = 'chatgpt.tokens.use.direct';
const scopes = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', planScope];
const directory = join(homedir(), '.config', 'openmaic-chatgpt');
const hostFile = join(directory, 'host-id');
const registrationFile = join(directory, 'registration.json');
const callbackPath = '/auth/callback';
const random = () => randomBytes(32).toString('base64url');

async function jsonRequest(url, options) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok)
    throw new Error(`OpenAI returned HTTP ${response.status} (${new URL(url).pathname}).`);
  return response.json();
}

async function existingRegistration() {
  try {
    return JSON.parse(await readFile(registrationFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function readHostId() {
  try {
    await writeFile(hostFile, `urn:uuid:${randomUUID()}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const id = (await readFile(hostFile, 'utf8')).trim();
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid saved host identifier.');
  return id;
}

async function validateIdentity(token, clientId, nonce) {
  const [encodedHeader, encodedClaims, signature, extra] = token.split('.');
  if (!signature || extra !== undefined) throw new Error('Malformed ID token.');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url'));
  const { keys } = await jsonRequest(`${issuer}/.well-known/jwks.json`);
  const key = keys.find((entry) => entry.kid === header.kid && entry.kty === 'RSA');
  if (
    header.alg !== 'RS256' ||
    !key ||
    !verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(signature, 'base64url'),
    )
  )
    throw new Error('Invalid OpenAI ID token signature.');

  const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url'));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== issuer ||
    !audience.includes(clientId) ||
    (audience.length > 1 && claims.azp !== clientId) ||
    (claims.azp !== undefined && claims.azp !== clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= Date.now() / 1_000 ||
    claims.nonce !== nonce ||
    typeof claims.sub !== 'string' ||
    !claims.sub
  )
    throw new Error('OpenAI ID token validation failed.');
  return claims;
}

async function connect() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const hostId = await readHostId();
  const previous = await existingRegistration();
  const state = random();
  const nonce = random();
  const verifier = random();

  let receive;
  const callback = new Promise((resolve) => {
    receive = resolve;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== callbackPath) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid authorization state.');
      return;
    }
    receive({ params: url.searchParams, response });
  });

  let timer;
  let browserResponse;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const redirect = `http://127.0.0.1:${server.address().port}${callbackPath}`;
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: previous?.clientId ?? 'dynamic_agent_client',
      ...(previous ? {} : { agent_name_hint: 'OpenMAIC' }),
      ext_agent_host_id: hostId,
      response_type: 'code',
      redirect_uri: redirect,
      scope: scopes.join(' '),
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const browser = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(browser, [url.href], (error) => {
      if (error) console.error('Could not open the system browser.');
    });
    console.log('Opened the OpenAI authorization page for OpenMAIC.');

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Authorization timed out.')), 600_000);
    });
    const { params, response } = await Promise.race([callback, timeout]);
    browserResponse = response;
    if (params.has('error')) throw new Error('OpenAI authorization did not complete.');
    const code = params.get('code');
    const returnedClientId = params.get('client_id');
    const clientId = previous?.clientId ?? returnedClientId;
    if (
      !code ||
      !clientId ||
      !/^oaiapp_[\w-]+$/.test(clientId) ||
      (returnedClientId && returnedClientId !== clientId)
    ) {
      throw new Error('OpenAI did not return a valid client registration.');
    }

    const tokens = await jsonRequest(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        resource,
      }),
    });
    const identity = await validateIdentity(tokens.id_token ?? '', clientId, nonce);
    if (previous && identity.sub !== previous.subject)
      throw new Error('Selected ChatGPT account changed.');
    if (
      !tokens.scope?.split(/\s+/).includes(planScope) ||
      !tokens.access_token ||
      !tokens.refresh_token ||
      !Number.isFinite(tokens.expires_in)
    ) {
      throw new Error('ChatGPT plan permission was not granted.');
    }
    const record = {
      clientId,
      subject: identity.sub,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    const temporary = `${registrationFile}.${random()}.tmp`;
    await writeFile(temporary, JSON.stringify({ clientId, subject: identity.sub }), {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, registrationFile);

    // Transfer via stdin. The Docker runtime owns the only copy of the tokens.
    const docker = process.env.OPENMAIC_DOCKER ?? 'docker';
    const context = process.env.OPENMAIC_DOCKER_CONTEXT;
    const installed = spawnSync(
      docker,
      [
        ...(context ? ['--context', context] : []),
        'compose',
        'exec',
        '-T',
        'openmaic',
        'node',
        '-e',
        `const fs = require('node:fs');
       const path = 'data/chatgpt-plan.json';
       const temp = path + '.' + require('node:crypto').randomUUID() + '.tmp';
       fs.writeFileSync(temp, fs.readFileSync(0), {mode: 0o600, flag: 'wx'});
       fs.renameSync(temp, path);`,
      ],
      { input: JSON.stringify(record), stdio: ['pipe', 'ignore', 'ignore'] },
    );
    if (installed.status !== 0)
      throw new Error(
        'Authorization succeeded but the running OpenMAIC container could not store it.',
      );

    const catalog = await jsonRequest(`${resource}/models`, {
      headers: { Authorization: `Bearer ${record.accessToken}` },
    });
    response
      .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end('OpenMAIC is authorized. You can close this tab.');
    console.log('OpenMAIC authorization saved. Available plan models:');
    console.log(
      JSON.stringify(
        catalog.models
          ?.filter((model) => model.visibility === 'list')
          .map(({ slug, display_name }) => ({ slug, display_name })) ?? [],
        null,
        2,
      ),
    );
  } catch (error) {
    browserResponse
      ?.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end('OpenMAIC could not finish authorization. Check the local command output.');
    throw error;
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
  }
}

connect().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
