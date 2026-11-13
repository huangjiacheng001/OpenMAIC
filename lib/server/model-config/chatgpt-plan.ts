import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const sessionPath = () => join(process.cwd(), 'data', 'chatgpt-plan.json');

interface PlanSession {
  clientId: string;
  subject: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function errorResponse(status: number, message: string, code: string): Response {
  return Response.json({ error: { message, code } }, { status });
}

async function readSession(): Promise<PlanSession | undefined> {
  try {
    const session: PlanSession = JSON.parse(await readFile(sessionPath(), 'utf8'));
    if (
      !session.clientId?.startsWith('oaiapp_') ||
      !session.subject ||
      !session.accessToken ||
      !session.refreshToken ||
      !Number.isFinite(session.expiresAt)
    )
      throw new Error('Invalid ChatGPT plan session.');
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function refreshSession(): Promise<PlanSession | undefined> {
  const session = await readSession();
  if (!session || session.expiresAt - Date.now() > 60_000) return session;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: session.clientId,
      refresh_token: session.refreshToken,
      resource: API,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 400 || response.status === 401) return undefined;
  if (!response.ok) throw new Error('Could not refresh the ChatGPT plan session.');
  const tokens = await response.json();
  if (
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token ||
    (tokens.scope !== undefined && !tokens.scope.split(/\s+/).includes(PLAN_SCOPE)) ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0
  )
    return undefined;

  const renewed: PlanSession = {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || session.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  const temporary = `${sessionPath()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(renewed), { flag: 'wx', mode: 0o600 });
    await rename(temporary, sessionPath());
  } finally {
    await rm(temporary, { force: true });
  }
  return renewed;
}

let sessionRead: Promise<PlanSession | undefined> | undefined;

function currentSession() {
  sessionRead ??= refreshSession().finally(() => {
    sessionRead = undefined;
  });
  return sessionRead;
}

type Item = Record<string, unknown>;

function requestBody(body: Item): Item {
  const result: Item = { store: false, stream: true };
  // Send the common fields supported by the subscription endpoint. Retain
  // every input turn since this transport doesn't store server-side history.
  for (const key of ['model', 'instructions', 'text', 'reasoning', 'parallel_tool_calls']) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  if (!Array.isArray(body.input)) throw new Error('ChatGPT plan requires an input array.');
  result.input = body.input.map((item: Item) =>
    item.role === 'system' ? { ...item, role: 'developer' } : item,
  );
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    if (body.tools.some((tool: Item) => tool.type !== 'function')) {
      throw new Error('ChatGPT plan supports OpenMAIC function tools only.');
    }
    let tools = body.tools as Item[];
    if (body.tool_choice && typeof body.tool_choice === 'object') {
      const choice = body.tool_choice as Item;
      if (choice.type !== 'function') throw new Error('Unsupported ChatGPT plan tool choice.');
      tools = tools.filter((tool) => tool.name === choice.name);
      if (tools.length !== 1) throw new Error('Requested ChatGPT plan tool was not declared.');
      result.tool_choice = 'required';
    } else if (typeof body.tool_choice === 'string') {
      result.tool_choice = body.tool_choice;
    }
    result.tools = [
      {
        type: 'namespace',
        name: 'openmaic',
        description: 'OpenMAIC classroom tools',
        tools,
      },
    ];
  }
  // The AI SDK reconstructs function calls from its own tool history.
  result.input = (result.input as Item[]).map((item) =>
    item.type === 'function_call' ? { ...item, namespace: 'openmaic' } : item,
  );
  return result;
}

async function completedResponse(response: Response): Promise<Response> {
  if (!response.body)
    return errorResponse(502, 'ChatGPT returned an empty stream.', 'empty_stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? '';
      if (done && pending) events.push(pending);
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        const payload = JSON.parse(data);
        if (payload.type === 'response.completed') return Response.json(payload.response);
        if (['response.failed', 'response.incomplete', 'error'].includes(payload.type)) {
          const error = payload.response?.error ?? payload;
          const code = typeof error.code === 'string' ? error.code : 'chatgpt_plan_failed';
          const status = code === 'subscription_sharing_usage_limit_exceeded' ? 429 : 502;
          return errorResponse(
            status,
            error.message ?? 'ChatGPT plan response did not complete.',
            code,
          );
        }
      }
      if (done)
        return errorResponse(502, 'ChatGPT stream ended before completion.', 'incomplete_stream');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Only this fixed, server-owned transport ever receives the OAuth credential. */
export const fetchWithChatGptPlan: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== `${API}/responses` || init?.method !== 'POST' || typeof init.body !== 'string') {
    return errorResponse(400, 'Unsupported ChatGPT plan request.', 'unsupported_request');
  }

  let body: Item;
  let upstreamBody: Item;
  try {
    body = JSON.parse(init.body);
    upstreamBody = requestBody(body);
  } catch (error) {
    return errorResponse(400, (error as Error).message, 'invalid_plan_request');
  }

  const session = await currentSession();
  if (!session) {
    return errorResponse(
      401,
      'Connect your ChatGPT plan using scripts/connect-chatgpt-plan.mjs.',
      'chatgpt_plan_disconnected',
    );
  }

  const response = await fetch(`${API}/responses`, {
    method: 'POST',
    signal: init.signal,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  });
  if (!response.ok || body.stream === true) return response;
  return completedResponse(response);
};
