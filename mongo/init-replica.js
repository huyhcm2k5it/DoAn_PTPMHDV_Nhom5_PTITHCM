function initializeReplica() {
  let initialized = false;
  try { initialized = Boolean(rs.status().ok); } catch (_) { initialized = false; }
  if (!initialized) rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if (rs.status().myState === 1) return; } catch (_) {}
    sleep(1000);
  }
  throw new Error("Mongo replica set did not become PRIMARY within 60 seconds");
}