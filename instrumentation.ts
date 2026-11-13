export async function register(): Promise<void> {
  // Next builds this entry point for both runtimes. Keep the Node startup
  // code behind a compile-time guard so the Edge bundle never imports it.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register: registerNode } = await import('@/lib/server/instrumentation-node');
    await registerNode();
  }
}
