const crypto = require('crypto');

// The Navidrome (Subsonic) server whose accounts may use this sync server.
// It must come from server configuration: letting the client name the
// server to check against would let anyone point it at a fake one.
const NAVIDROME_URL = (process.env.NAVIDROME_URL || process.env.SERVER_URL || '')
  .trim()
  .replace(/\/+$/, '');

const io = require('socket.io')(7548, {
  path: '/jam-sync/socket.io',
  // Queues are sent in full whenever they change; allow long playlists.
  maxHttpBufferSize: 1e7,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

if (!NAVIDROME_URL) {
  console.error('[Auth] NAVIDROME_URL (or SERVER_URL) is not set; every connection will be refused.');
}

// ── Authentication ──
// Clients send their existing Subsonic credentials (u + t/s token, or u + p)
// in the handshake auth payload. We confirm them with a ping against the
// configured Navidrome server and only then trust the username.
const AUTH_CACHE_MS = 5 * 60 * 1000;
const authCache = new Map(); // sha256(credentials) -> expiry timestamp

function credentialKey(creds) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([creds.u, creds.t || '', creds.s || '', creds.p || '']))
    .digest('hex');
}

async function verifyWithNavidrome(creds) {
  const params = new URLSearchParams({
    u: creds.u,
    v: typeof creds.v === 'string' ? creds.v : '1.16.1',
    c: typeof creds.c === 'string' ? creds.c : 'aonsoku-sync',
    f: 'json',
  });
  if (creds.t && creds.s) {
    params.set('t', creds.t);
    params.set('s', creds.s);
  } else {
    params.set('p', creds.p);
  }
  const res = await fetch(`${NAVIDROME_URL}/rest/ping.view?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  return body?.['subsonic-response']?.status === 'ok';
}

io.use(async (socket, next) => {
  if (!NAVIDROME_URL) return next(new Error('sync_not_configured'));

  const creds = socket.handshake.auth || {};
  const hasToken = typeof creds.t === 'string' && typeof creds.s === 'string' && creds.t && creds.s;
  const hasPassword = typeof creds.p === 'string' && creds.p;
  if (typeof creds.u !== 'string' || !creds.u || (!hasToken && !hasPassword)) {
    return next(new Error('unauthorized'));
  }

  const key = credentialKey(creds);
  const cachedUntil = authCache.get(key);
  if (cachedUntil && cachedUntil > Date.now()) {
    socket.data.username = creds.u;
    return next();
  }

  try {
    if (await verifyWithNavidrome(creds)) {
      authCache.set(key, Date.now() + AUTH_CACHE_MS);
      socket.data.username = creds.u;
      return next();
    }
    return next(new Error('unauthorized'));
  } catch (err) {
    console.error('[Auth] Could not reach Navidrome:', err.message);
    return next(new Error('auth_unavailable'));
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [key, until] of authCache) if (until <= now) authCache.delete(key);
}, 60000).unref();

// Session keys are case-insensitive, matching Navidrome logins.
const userKey = (name) => name.toLowerCase();
const SESSION_ID_PATTERN = /^[a-z0-9]{6,32}$/i;

// Keeps the last known queue when an update omits it. Clients only send the
// queue when it changes, so most updates carry position and play state only.
function mergePlaybackState(previous, update) {
  const merged = { ...(previous || {}), ...update };
  if (!update.queue && previous && previous.queue) merged.queue = previous.queue;
  return merged;
}

// In-memory stores
const privateSessions = {}  // { [username]: { devices: Map<socketId, Device>, playbackState: PlaybackState|null } }
const jamSessions = {}      // { [sessionId]: { participants: [], lastState: null, canGuestsControl: false } }

// Track which socket belongs to which session type and username
const socketMeta = {}        // { [socketId]: { username, sessionType, sessionId? } }

function emitDevicesUpdate(username) {
  const session = privateSessions[username]
  if (!session) return
  const deviceList = Array.from(session.devices.values()).map(d => ({
    id: d.id,
    name: d.name,
    isActivePlayer: d.isActivePlayer,
    lastSeen: d.lastSeen
  }))
  for (const [sid] of session.devices) {
    io.to(sid).emit('devices_update', deviceList)
  }
}

io.on('connection', (socket) => {
  // Only the handshake-verified username is trusted. Any username or isLead
  // in the query string is ignored.
  const username = socket.data.username;
  // mode: 'create' starts a session, 'join' only enters an existing one.
  // Clients that predate it send neither and get the old create-or-join.
  const { sessionId, deviceName, sessionType, mode } = socket.handshake.query;

  // Determine session type: 'private' or 'jam' (default to 'jam' for backward compat)
  const resolvedSessionType = sessionType || 'jam';

  if (resolvedSessionType === 'private') {
    // ── Private Session Connection ──
    const key = userKey(username);

    // Create or join the user's private session
    if (!privateSessions[key]) {
      privateSessions[key] = {
        devices: new Map(),
        playbackState: null
      };
      console.log(`[Connect] Private session created for user: ${username}`);
    }

    const session = privateSessions[key];

    // The FIRST device to connect becomes isActivePlayer
    const isFirstDevice = session.devices.size === 0;

    const device = {
      id: socket.id,
      name: deviceName || 'Unknown Device',
      userAgent: socket.handshake.headers['user-agent'] || '',
      isActivePlayer: isFirstDevice,
      lastSeen: new Date()
    };

    session.devices.set(socket.id, device);

    // Track socket metadata
    socketMeta[socket.id] = { username: key, sessionType: 'private' };

    // Emit devices_update to all user's devices
    emitDevicesUpdate(key);

    // If playbackState exists, catch up the new device
    if (session.playbackState && !isFirstDevice) {
      socket.emit('sync_playback', session.playbackState);
    }

    console.log(`[Connect] ${username} connected device "${device.name}" (Active: ${isFirstDevice})`);

    // ── Private Session Events ──

    socket.on('playback_update', (data) => {
      const privateSession = privateSessions[key];
      if (!privateSession) return;

      const dev = privateSession.devices.get(socket.id);
      if (dev && dev.isActivePlayer) {
        privateSession.playbackState = mergePlaybackState(privateSession.playbackState, data);
        // Broadcast to all OTHER devices of this user
        for (const [sid] of privateSession.devices) {
          if (sid !== socket.id) {
            io.to(sid).emit('sync_playback', data);
          }
        }
      }
    });

    socket.on('transfer_playback', ({ targetDeviceId }) => {
      const privateSession = privateSessions[key];
      if (!privateSession) return;

      // Set all devices to inactive
      for (const [, dev] of privateSession.devices) {
        dev.isActivePlayer = false;
      }

      // Set target device to active
      const targetDevice = privateSession.devices.get(targetDeviceId);
      if (targetDevice) {
        targetDevice.isActivePlayer = true;
        // Tell the target device to start playing
        io.to(targetDeviceId).emit('become_active_player', privateSession.playbackState);
        // Tell all devices about the device list change
        emitDevicesUpdate(key);
      }
    });

    socket.on('remote_command', ({ command, args }) => {
      // Forward command to the active player device
      const privateSession = privateSessions[key];
      if (!privateSession) return;

      for (const [sid, dev] of privateSession.devices) {
        if (dev.isActivePlayer && sid !== socket.id) {
          io.to(sid).emit('remote_command', { command, args });
        }
      }
    });

    socket.on('heartbeat', () => {
      const privateSession = privateSessions[key];
      if (privateSession) {
        const dev = privateSession.devices.get(socket.id);
        if (dev) dev.lastSeen = new Date();
      }
    });

    socket.on('disconnect', () => {
      const privateSession = privateSessions[key];
      if (privateSession) {
        const wasActive = privateSession.devices.get(socket.id)?.isActivePlayer;
        privateSession.devices.delete(socket.id);

        if (privateSession.devices.size === 0) {
          // No devices left, clean up session
          delete privateSessions[key];
          console.log(`[Connect] Private session ended for user: ${username}`);
        } else {
          // If the active player disconnected, promote the oldest remaining device
          if (wasActive) {
            const firstDevice = privateSession.devices.values().next().value;
            if (firstDevice) {
              firstDevice.isActivePlayer = true;
              io.to(firstDevice.id).emit('become_active_player', privateSession.playbackState);
            }
          }
          emitDevicesUpdate(key);
        }
      }

      delete socketMeta[socket.id];
      console.log(`[Connect] ${username} device disconnected`);
    });

  } else {
    // ── Jam Session Connection (existing logic) ──
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      console.log(`[Jam] Rejected connection: invalid session id`);
      return socket.disconnect();
    }

    if (!jamSessions[sessionId] && mode === 'join') {
      // An invite link to a Jam that has ended must not quietly start a new
      // session with the invitee as its host.
      socket.emit('jam_error', { code: 'session_not_found' });
      return socket.disconnect(true);
    }

    socket.join(sessionId);

    if (!jamSessions[sessionId]) {
      // Whoever opens a session is its host. The client's own claim to be
      // the lead is not trusted.
      jamSessions[sessionId] = {
        participants: [],
        lastState: null,
        canGuestsControl: false,
        host: userKey(username)
      };
      console.log(`[Jam] Session created: ${sessionId} by ${username}`);
    }

    const isLead = userKey(username) === jamSessions[sessionId].host;
    const user = {
      id: socket.id,
      name: username,
      isLead
    };
    socket.emit('jam_role', { isLead });

    jamSessions[sessionId].participants.push(user);

    // Track socket metadata
    socketMeta[socket.id] = { username, sessionType: 'jam', sessionId };

    // Broadcast updated participant list to everyone in the room
    io.to(sessionId).emit('participants_update', jamSessions[sessionId].participants);

    // If there's an existing playback state, catch the new user up
    if (jamSessions[sessionId].lastState) {
      socket.emit('sync_playback', jamSessions[sessionId].lastState);
      socket.emit('guest_control_update', { canGuestsControl: jamSessions[sessionId].canGuestsControl || false });
    }

    console.log(`[Jam] ${username} joined session ${sessionId} (Lead: ${isLead})`);

    socket.on('playback_update', (data) => {
      const session = jamSessions[sessionId];
      if (!session) return;
      const sender = session.participants.find(p => p.id === socket.id);
      // Allow lead or guests if canGuestsControl is enabled
      if (sender && (sender.isLead || session.canGuestsControl)) {
        session.lastState = mergePlaybackState(session.lastState, data);
        // Broadcast to others in the same session
        socket.to(sessionId).emit('sync_playback', data);
      }
    });

    socket.on('leave_session', () => {
      const session = jamSessions[sessionId];
      if (session) {
        session.participants = session.participants.filter(p => p.id !== socket.id);
        if (session.participants.length === 0) {
          delete jamSessions[sessionId];
        } else {
          io.to(sessionId).emit('participants_update', session.participants);
        }
      }
      socket.leave(sessionId);
      delete socketMeta[socket.id];
      socket.disconnect(true);
    });

    socket.on('set_guest_control', ({ canControl }) => {
      const session = jamSessions[sessionId];
      if (!session) return;
      const sender = session.participants.find(p => p.id === socket.id);
      if (!sender || !sender.isLead) return;
      session.canGuestsControl = canControl;
      io.to(sessionId).emit('guest_control_update', { canGuestsControl: canControl });
    });

    socket.on('end_session', () => {
      const session = jamSessions[sessionId];
      if (!session) return;
      const sender = session.participants.find(p => p.id === socket.id);
      if (!sender || !sender.isLead) return;
      io.to(sessionId).emit('session_ended');
      delete jamSessions[sessionId];
      delete socketMeta[socket.id];
      socket.disconnect(true);
    });

    socket.on('disconnect', () => {
      if (jamSessions[sessionId]) {
        jamSessions[sessionId].participants = jamSessions[sessionId].participants.filter(p => p.id !== socket.id);

        if (jamSessions[sessionId].participants.length === 0) {
          console.log(`[Jam] Session ended: ${sessionId}`);
          delete jamSessions[sessionId];
        } else {
          io.to(sessionId).emit('participants_update', jamSessions[sessionId].participants);
        }
      }
      delete socketMeta[socket.id];
      console.log(`[Jam] ${username} left session ${sessionId}`);
    });
  }
});

// Heartbeat cleanup: every 30 seconds, clean up stale devices
setInterval(() => {
  const now = Date.now();
  for (const [username, session] of Object.entries(privateSessions)) {
    for (const [sid, device] of session.devices) {
      if (now - device.lastSeen.getTime() > 60000) { // 60s timeout
        session.devices.delete(sid);
        delete socketMeta[sid];
      }
    }
    if (session.devices.size === 0) {
      delete privateSessions[username];
    } else {
      emitDevicesUpdate(username);
    }
  }
}, 30000);

console.log('Aonsoku Jam Sync Server running on port 7548');
