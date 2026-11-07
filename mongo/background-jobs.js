function startBackgroundJobs({ jobs, intervalMs = 1000, onError = console.error }) {
  let stopped = false;
  let timer;
  let active;
  const tick = () => {
    if (stopped) return;
    active = (async () => {
      for (const job of jobs) {
        if (stopped) break;
        try { await job(); } catch (error) { onError(error); }
      }
    })().finally(() => {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    });
  };
  tick();
  return { async close() { stopped = true; clearTimeout(timer); await active; } };
}
module.exports = { startBackgroundJobs };
