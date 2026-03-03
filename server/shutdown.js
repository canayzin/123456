function attachGracefulShutdown(server, { timeoutMs = 5000, onBeforeClose = async () => {}, onAfterClose = async () => {} } = {}) {
  const sockets = new Set();
  let closing = false;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  async function closeGracefully() {
    if (closing) return;
    closing = true;
    await onBeforeClose();
    await new Promise((resolve) => server.close(resolve));
    for (const s of sockets) {
      try { s.end(); } catch {}
      setTimeout(() => { try { s.destroy(); } catch {} }, timeoutMs).unref?.();
    }
    await onAfterClose();
  }

  return { closeGracefully };
}

module.exports = { attachGracefulShutdown };
