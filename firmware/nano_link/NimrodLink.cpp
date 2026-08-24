// NimrodLink implementation. See NimrodLink.h for why any of this is shaped as it is.
//
// NOT COMPILED — there was no Arduino toolchain on the machine this was written on. The
// wire format is tested independently (tools/test_nano_protocol.py) and the host-side
// probe (tools/nano_probe.py) speaks it, so the PROTOCOL is verified; this C++ is not.

#include "NimrodLink.h"

// ---------------------------------------------------------------- little-endian helpers
// Written out by hand rather than memcpy'ing a struct. A packed struct's layout is a
// promise the compiler makes to itself, and the other end of this link is an ESP32 built
// by a different toolchain. Bytes on a wire should be laid out by code you can read.
static inline void put_u32(uint8_t* p, uint32_t v) {
  p[0] = (uint8_t)(v);
  p[1] = (uint8_t)(v >> 8);
  p[2] = (uint8_t)(v >> 16);
  p[3] = (uint8_t)(v >> 24);
}

static inline uint32_t get_u32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static inline void put_u16(uint8_t* p, uint16_t v) {
  p[0] = (uint8_t)(v);
  p[1] = (uint8_t)(v >> 8);
}

// ---------------------------------------------------------------- the RAM ring buffer
NimrodLinkRamBuffer::NimrodLinkRamBuffer(uint16_t capacity)
    : _buf((uint8_t*)malloc(capacity)), _cap(capacity), _written(0) {}

NimrodLinkRamBuffer::~NimrodLinkRamBuffer() { free(_buf); }

void NimrodLinkRamBuffer::append(const void* data, uint16_t len) {
  if (!_buf || !len) return;
  const uint8_t* in = (const uint8_t*)data;
  // A write longer than the whole buffer would wrap over itself; keep only the tail,
  // which is what a ring buffer means, and still advance `_written` by the full length so
  // offsets stay truthful about what was produced.
  if (len > _cap) {
    in += (len - _cap);
    _written += (uint32_t)(len - _cap);
    len = _cap;
  }
  for (uint16_t i = 0; i < len; i++) {
    _buf[(uint32_t)(_written + i) % _cap] = in[i];
  }
  _written += len;
}

uint32_t NimrodLinkRamBuffer::oldest() {
  return _written > _cap ? _written - _cap : 0;
}

uint32_t NimrodLinkRamBuffer::read(uint32_t offset, uint8_t* out, uint32_t len) {
  if (!_buf) return 0;
  // Asking for something the ring has already overwritten gets 0, not stale bytes. The
  // box can then tell the difference between "nothing new" and "I have lost history",
  // which is a distinction somebody will need at 2am.
  if (offset < oldest() || offset >= _written) return 0;
  uint32_t avail = _written - offset;
  if (len > avail) len = avail;
  for (uint32_t i = 0; i < len; i++) {
    out[i] = _buf[(offset + i) % _cap];
  }
  return len;
}

// ---------------------------------------------------------------- the link
NimrodLinkClass NimrodLink;

// 20 bytes: proto, flags, chunk, total, oldest, confirmed, fw. Still fits a single ATT
// read at the default 23-byte MTU (22 usable), which matters because it is the first
// thing every box does.
//
// `oldest` earns its four bytes: it lets a box learn IMMEDIATELY that some history is
// unrecoverable — a ring wrapped while it was away — instead of discovering it by asking
// for bytes and getting a silent jump forward. See tools/nano_protocol.py, which is the
// authoritative layout and is tested.
#define NL_STATUS_LEN 20
#define NL_CONTROL_LEN 5

bool NimrodLinkClass::begin(const char* deviceName, NimrodLinkSource& source, uint32_t fwVersion) {
  _src = &source;
  _fw = fwVersion;

  if (!BLE.begin()) return false;

  BLE.setLocalName(deviceName);
  BLE.setDeviceName(deviceName);

  _service = new BLEService(NIMROD_LINK_SERVICE_UUID);
  _status  = new BLECharacteristic(NIMROD_LINK_STATUS_UUID, BLERead | BLENotify, NL_STATUS_LEN);
  _control = new BLECharacteristic(NIMROD_LINK_CONTROL_UUID, BLEWrite | BLEWriteWithoutResponse, NL_CONTROL_LEN);
  // NOTIFY, not INDICATE. Indications are acknowledged one at a time and would roughly
  // halve an already slow link. The 4-byte offset header on every chunk is what buys the
  // reliability back: a dropped notification shows up as a gap in the offsets, and the box
  // seeks back to it. One re-request instead of a stalled transfer.
  _data = new BLECharacteristic(NIMROD_LINK_DATA_UUID, BLENotify, NIMROD_LINK_CHUNK + 4);

  _service->addCharacteristic(*_status);
  _service->addCharacteristic(*_control);
  _service->addCharacteristic(*_data);
  BLE.addService(*_service);

  // Advertise the SERVICE uuid, not just the name. A box should find the right chair by
  // what it can do, not by somebody having typed a matching string into two places.
  BLE.setAdvertisedService(*_service);

  writeStatus();
  BLE.advertise();
  return true;
}

void NimrodLinkClass::end() {
  BLE.stopAdvertise();
  BLE.end();
}

void NimrodLinkClass::writeStatus() {
  if (!_status || !_src) return;
  uint8_t s[NL_STATUS_LEN];
  const uint32_t total = _src->size();
  s[0] = NIMROD_LINK_PROTO;
  s[1] = (_cursor < total) ? NL_FLAG_MORE : 0;
  put_u16(&s[2], (uint16_t)NIMROD_LINK_CHUNK);
  put_u32(&s[4], total);
  put_u32(&s[8], _src->oldest());
  put_u32(&s[12], _confirmed);
  put_u32(&s[16], _fw);
  _status->writeValue(s, NL_STATUS_LEN);
}

void NimrodLinkClass::handleControl() {
  if (!_control->written()) return;
  if (_control->valueLength() < NL_CONTROL_LEN) return;

  uint8_t buf[NL_CONTROL_LEN];
  _control->readValue(buf, NL_CONTROL_LEN);
  const uint8_t op = buf[0];
  const uint32_t arg = get_u32(&buf[1]);

  switch (op) {
    case NL_OP_SEEK:
      // Any offset is allowed, forwards or backwards. Seeking BACKWARDS is the whole
      // recovery story: a replacement box, or one that lost its cache before uploading,
      // asks for an older offset and gets it. The bookmark below never prevents this.
      _cursor = arg;
      _sending = true;
      break;
    case NL_OP_ACK:
      // Advisory. The box says it has the bytes somewhere durable — which is its OWN
      // storage, not necessarily a server yet. That is deliberate: it means a chair can
      // hand off and leave during a network outage instead of waiting for one to end.
      // Nothing is deleted here, so if the box then dies, seeking backwards still works.
      if (arg > _confirmed) _confirmed = arg;
      break;
    case NL_OP_STOP:
      _sending = false;
      break;
    case NL_OP_PING:
    default:
      break;
  }
  writeStatus();
}

void NimrodLinkClass::poll() {
  BLEDevice central = BLE.central();
  if (!central || !central.connected()) {
    if (_connected) {
      // Rolled out of range mid-transfer, which is the normal case and not an error.
      // Nothing is reset except the sending flag: the cursor and the bookmark survive, so
      // the next visit picks up where this one stopped.
      _connected = false;
      _sending = false;
      BLE.advertise();
    }
    return;
  }
  _connected = true;

  handleControl();
  if (!_sending || !_src) return;

  const uint32_t total = _src->size();
  if (_cursor >= total) {
    // Caught up. Say so once — by clearing the MORE flag in status — then go quiet rather
    // than spinning on an empty read.
    //
    // THE BOX MUST NOT TREAT SILENCE AS COMPLETION, and this is why: a dropped final
    // notification leaves the stream just as quiet as a finished one, with no later
    // offset to reveal the hole. The box compares what it has against `total` instead.
    // (Found by tools/test_nano_protocol.py, which lost 8 bytes off the end until the
    // rule was written down.)
    _sending = false;
    writeStatus();
    return;
  }

  // ONE CHUNK PER CALL. This is a library living inside somebody else's loop(); a busy
  // send loop here would stall their sampling, and a logger that misses readings because
  // it was busy uploading readings is a bad trade in any direction.
  uint8_t frame[NIMROD_LINK_CHUNK + 4];
  put_u32(frame, _cursor);
  const uint32_t got = _src->read(_cursor, frame + 4, NIMROD_LINK_CHUNK);
  if (got == 0) {
    // The source no longer has this offset — a ring buffer overwrote it while the box was
    // away. Skip to the oldest byte that still exists and keep going, so a long absence
    // costs history rather than the whole link. The jump is visible to the box as a gap
    // in the offsets, which is exactly how it should learn that some data is gone.
    const uint32_t o = _src->oldest();
    _cursor = (o > _cursor) ? o : total;
    writeStatus();
    return;
  }

  _data->writeValue(frame, got + 4);
  _cursor += got;
  if (_cursor >= total) writeStatus();     // the MORE flag just went false
}
