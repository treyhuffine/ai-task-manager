// Loaded before Next by an ordinary Node child with a private IPC channel.
// Losing the controller closes Next so an orphan cannot keep scheduling.
process.once('disconnect', () => {
  process.kill(process.pid, 'SIGTERM');
  setTimeout(() => process.exit(1), 15_000).unref();
});
export {};
