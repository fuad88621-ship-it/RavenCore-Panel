import net from 'node:net';

// --- Minecraft protocol helpers ---

function writeVarInt(value) {
  const bytes = [];
  do {
    let b = value & 0x7f;
    value >>>= 7;
    if (value !== 0) b |= 0x80;
    bytes.push(b);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    if (pos >= buffer.length) return { value: null, length: 0 };
    const b = buffer[pos];
    value |= (b & 0x7f) << shift;
    pos++;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) return { value: null, length: 0 };
  }
  return { value, length: pos - offset };
}

// Parse a status response packet. Returns null if the buffer is incomplete.
function parseStatusResponse(buffer) {
  const len = readVarInt(buffer, 0);
  if (len.value === null) return null;
  let pos = len.length;
  const id = readVarInt(buffer, pos);
  if (id.value === null) return null;
  pos += id.length;
  if (id.value !== 0) return null;
  const strLen = readVarInt(buffer, pos);
  if (strLen.value === null) return null;
  pos += strLen.length;
  if (pos + strLen.value > buffer.length) return null; // incomplete — wait for more
  const json = buffer.slice(pos, pos + strLen.value).toString('utf8');
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const desc = data.description;
  let motd = '';
  if (typeof desc === 'string') motd = desc;
  else if (desc && typeof desc === 'object') {
    if (typeof desc.text === 'string') motd = desc.text;
    else if (Array.isArray(desc.extra)) motd = desc.extra.map((e) => (e && e.text) || '').join('');
    else motd = JSON.stringify(desc);
  }
  return {
    online: true,
    players: (data.players && data.players.online) || 0,
    max_players: (data.players && data.players.max) || 0,
    version: (data.version && data.version.name) || '',
    motd,
  };
}

// Ping a Minecraft server and return its status.
export function pingMinecraft(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let responded = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ online: false, error: 'timeout' }), timeoutMs);

    socket.on('connect', () => {
      // Handshake: packet id 0, protocol version 0, server address string,
      // server port (ushort), next state 1 (status).
      const addr = host;
      const handshake = Buffer.concat([
        writeVarInt(0),
        writeVarInt(0),
        writeVarInt(Buffer.byteLength(addr)),
        Buffer.from(addr, 'utf8'),
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1),
      ]);
      const handshakePacket = Buffer.concat([writeVarInt(handshake.length), handshake]);
      const statusReq = Buffer.concat([writeVarInt(1), Buffer.from([0])]);
      socket.write(Buffer.concat([handshakePacket, statusReq]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseStatusResponse(buffer);
      if (parsed) {
        responded = true;
        finish(parsed);
      }
    });

    socket.on('error', () => finish({ online: false, error: 'connection' }));
    socket.on('close', () => {
      if (!responded) finish({ online: false, error: 'closed' });
    });
  });
}
