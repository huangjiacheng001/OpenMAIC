export class FamilyError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const messages: Record<string, string> = {
  password: '家长密码不正确，请再试一次。',
  login_code: '登录码不正确，或已由家长更新。',
  invalid: '请检查输入后重试。',
  already_setup: '家庭已设置，请用家长密码验证。',
  limited: '尝试次数较多，请在 15 分钟后再试。',
  guardian_required: '请先验证家长密码。',
  child_required: '请先登录孩子档案。',
  session_changed: '孩子档案已切换或登录过期，请刷新后继续。',
  review_limit: '当前档案已存满 250 道题。',
  child_limit: '家庭最多可建立 16 个孩子档案。',
  missing: '找不到这条记录。',
  completed: '这道题已经在另一台设备上重做完成，请刷新查看。',
};

export function familyMessage(error: unknown) {
  return error instanceof FamilyError && messages[error.code]
    ? messages[error.code]
    : '暂时无法连接学习记录，请稍后重试。';
}

async function request<T>(query = '', init?: RequestInit): Promise<T> {
  const response = await fetch('/api/family' + query, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new FamilyError(data?.code ?? 'unavailable');
  return data as T;
}

export function familyRead<T>(
  view: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return request<T>('?' + new URLSearchParams({ view, ...params }), { signal });
}

export function familyWrite<T>(action: string, fields: Record<string, unknown> = {}) {
  return request<T>('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
}
