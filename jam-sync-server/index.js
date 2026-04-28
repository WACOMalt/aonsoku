const io = require('socket.io')(7548, {
  path: '/jam-sync/socket.io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const sessions = {};

io.on('connection', (socket) => {
  const { sessionId, username, isLead } = socket.handshake.query;
  
  if (!sessionId || !username) {
    console.log(`[Jam] Rejected connection: missing sessionId or username`);
    return socket.disconnect();
  }

  socket.join(sessionId);
  
  if (!sessions[sessionId]) {
    sessions[sessionId] = { 
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
  
  sessions[sessionId].participants.push(user);
  
  // Broadcast updated participant list to everyone in the room
  io.to(sessionId).emit('participants_update', sessions[sessionId].participants);
  
  // If there's an existing playback state, catch the new user up
  if (sessions[sessionId].lastState) {
    socket.emit('sync_playback', sessions[sessionId].lastState);
    socket.emit('guest_control_update', { canGuestsControl: sessions[sessionId].canGuestsControl || false });
  }

  console.log(`[Jam] ${username} joined session ${sessionId} (Lead: ${isLead})`);

  socket.on('playback_update', (data) => {
    const session = sessions[sessionId];
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
    const session = sessions[sessionId];
    if (session) {
      session.participants = session.participants.filter(p => p.id !== socket.id);
      if (session.participants.length === 0) {
        delete sessions[sessionId];
      } else {
        io.to(sessionId).emit('participants_update', session.participants);
      }
    }
    socket.leave(sessionId);
    socket.disconnect(true);
  });

  socket.on('set_guest_control', ({ canControl }) => {
    const session = sessions[sessionId];
    if (!session) return;
    const sender = session.participants.find(p => p.id === socket.id);
    if (!sender || !sender.isLead) return;
    session.canGuestsControl = canControl;
    io.to(sessionId).emit('guest_control_update', { canGuestsControl: canControl });
  });

  socket.on('end_session', () => {
    const session = sessions[sessionId];
    if (!session) return;
    const sender = session.participants.find(p => p.id === socket.id);
    if (!sender || !sender.isLead) return;
    io.to(sessionId).emit('session_ended');
    delete sessions[sessionId];
    socket.disconnect(true);
  });

  socket.on('disconnect', () => {
    if (sessions[sessionId]) {
      sessions[sessionId].participants = sessions[sessionId].participants.filter(p => p.id !== socket.id);
      
      if (sessions[sessionId].participants.length === 0) {
        console.log(`[Jam] Session ended: ${sessionId}`);
        delete sessions[sessionId];
      } else {
        io.to(sessionId).emit('participants_update', sessions[sessionId].participants);
      }
    }
    console.log(`[Jam] ${username} left session ${sessionId}`);
  });
});

console.log('Aonsoku Jam Sync Server running on port 7548');
