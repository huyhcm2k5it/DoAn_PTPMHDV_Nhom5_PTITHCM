function live(req, res) { res.status(200).json({ status: 'live' }); }
function ready(connection) { return (req, res) => { const isReady = Boolean(connection && connection.readyState === 1 && connection.db); res.status(isReady ? 200 : 503).json({ status: isReady ? 'ready' : 'not_ready' }); }; }
module.exports = { live, ready };