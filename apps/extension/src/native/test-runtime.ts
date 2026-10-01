/** In-memory browser adapter for public Host client/session tests. */
export function testRuntime() {
  const ports: ReturnType<typeof createPort>[] = [];
  function createPort() {
    const messages: ((value: unknown) => void)[] = [];
    const disconnects: (() => void)[] = [];
    const sent: { type: string; id?: string; [key: string]: unknown }[] = [];
    let closed = false;
    return {
      sent,
      get closed() {
        return closed;
      },
      onMessage: {
        addListener(listener: (value: unknown) => void) {
          messages.push(listener);
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnects.push(listener);
        },
      },
      postMessage(value: (typeof sent)[number]) {
        sent.push(value);
      },
      disconnect() {
        if (!closed) {
          closed = true;
          for (const listener of disconnects) listener();
        }
      },
      receive(value: unknown) {
        for (const listener of messages) listener(value);
      },
    };
  }
  const runtime = {
    connect() {
      const port = createPort();
      ports.push(port);
      return port;
    },
  } as unknown as typeof chrome.runtime;
  return { runtime, ports };
}
