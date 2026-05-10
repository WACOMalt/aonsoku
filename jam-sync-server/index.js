const io = require('socket.io')(7548, {
  path: '/jam-sync/socket.io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
  const { sessionId, username, isLead, deviceName, sessionType } = socket.handshake.query;

  // Determine session type: 'private' or 'jam' (default to 'jam' for backward compat)
  const resolvedSessionType = sessionType || 'jam';

  if (resolvedSessionType === 'private') {
    // ── Private Session Connection ──
    if (!username) {
      console.log(`[Connect] Rejected connection: missing username`);
      return socket.disconnect();
    }

    // Create or join the user's private session
    if (!privateSessions[username]) {
      privateSessions[username] = {
        devices: new Map(),
        playbackState: null
      };
      console.log(`[Connect] Private session created for user: ${username}`);
    }

    const session = privateSessions[username];

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
    socketMeta[socket.id] = { username, sessionType: 'private' };

    // Emit devices_update to all user's devices
    emitDevicesUpdate(username);

    // If playbackState exists, catch up the new device
    if (session.playbackState && !isFirstDevice) {
      socket.emit('sync_playback', session.playbackState);
    }

    console.log(`[Connect] ${username} connected device "${device.name}" (Active: ${isFirstDevice})`);

    // ── Private Session Events ──

    socket.on('playback_update', (data) => {
      const privateSession = privateSessions[username];
      if (!privateSession) return;

      const dev = privateSession.devices.get(socket.id);
      if (dev && dev.isActivePlayer) {
        privateSession.playbackState = { ...data };
        // Broadcast to all OTHER devices of this user
        for (const [sid] of privateSession.devices) {
          if (sid !== socket.id) {
            io.to(sid).emit('sync_playback', data);
          }
        }
      }
    });

    socket.on('transfer_playback', ({ targetDeviceId }) => {
      const privateSession = privateSessions[username];
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
        emitDevicesUpdate(username);
      }
    });

    socket.on('remote_command', ({ command, args }) => {
      // Forward command to the active player device
      const privateSession = privateSessions[username];
      if (!privateSession) return;

      for (const [sid, dev] of privateSession.devices) {
        if (dev.isActivePlayer && sid !== socket.id) {
          io.to(sid).emit('remote_command', { command, args });
        }
      }
    });

    socket.on('heartbeat', () => {
      const privateSession = privateSessions[username];
      if (privateSession) {
        const dev = privateSession.devices.get(socket.id);
        if (dev) dev.lastSeen = new Date();
      }
    });

    socket.on('disconnect', () => {
      const privateSession = privateSessions[username];
      if (privateSession) {
        const wasActive = privateSession.devices.get(socket.id)?.isActivePlayer;
        privateSession.devices.delete(socket.id);

        if (privateSession.devices.size === 0) {
          // No devices left, clean up session
          delete privateSessions[username];
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
          emitDevicesUpdate(username);
        }
      }

      delete socketMeta[socket.id];
      console.log(`[Connect] ${username} device disconnected`);
    });

  } else {
    // ── Jam Session Connection (existing logic) ──
    if (!sessionId || !username) {
      console.log(`[Jam] Rejected connection: missing sessionId or username`);
      return socket.disconnect();
    }

    socket.join(sessionId);

    if (!jamSessions[sessionId]) {
      jamSessions[sessionId] = {
        participants: [],
        lastState: null,
        canGuestsControl: false
      };
      console.log(`[Jam] Session created: ${sessionId} by ${username}`);
    }

    const user = {
      id: socket.id,
      name: username,
      isLead: isLead === 'true'
    };

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
        session.lastState = data;
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
