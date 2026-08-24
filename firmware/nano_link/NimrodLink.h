// NimrodLink — hand your logged bytes to a box in the room, over BLE, resumably.
//
// WHAT THIS IS FOR. A datalogger on a wheelchair fills up with readings and somebody has
// to go and get them. This is the other half: a small always-plugged-in box sits where the
// chair parks, and whenever the chair is near, it pulls whatever is new and posts it
// onward. Nobody drives anywhere and nobody charges anything.
//
// WHAT IT IS NOT. It is not a logger, it does not decide what to record, and IT DOES NOT
// KNOW WHAT YOUR DATA MEANS. You keep your own logging exactly as it is; this ships bytes.
// See "format-agnostic" below, which is the single most important design decision here.
//
// HOW YOU ADD IT to an existing sketch — three lines:
//
//     #include "NimrodLink.h"
//     NimrodLinkRamBuffer store(4096);          // or your own source, see below
//
//     void setup() { ...your setup...; NimrodLink.begin("wheeltrak-01", store); }
//     void loop()  { ...your logging...; NimrodLink.poll(); }
//
//     // wherever you already write a record:
//     store.append(&record, sizeof(record));
//
// FORMAT-AGNOSTIC, ON PURPOSE. This code never parses a record. The box never parses one
// either, and the server stores an opaque blob with a timestamp and a device id. Only the
// people who wrote the logger ever need to know what a record contains. That means: your
// record layout can change without anything here changing, there is no second
// implementation of your format to drift out of sync with yours, and nobody has to send
// anybody a spec before any of this can be built. "Here is a pipe, put your bytes in it."
//
// RESUMABLE, AND THAT IS NOT OPTIONAL. Somebody will roll past mid-transfer. A transfer
// that restarts from zero every time it is interrupted never finishes a long backlog — and
// it gets WORSE the more data is waiting, which is exactly backwards. So every chunk
// carries its own byte offset, the box can ask to start from any offset it likes, and a
// dropped packet costs one re-request rather than the whole transfer.
//
// THE BOOKMARK IS NOT A DELETE POINTER. `confirmed` records how far the box says it has
// got. It is ADVISORY: a box can always seek backwards and re-read anything the source
// still holds. That is what makes the box disposable — if it dies with data on it that
// never reached a server, a replacement asks for an older offset and nothing is lost.
//
// THIS FILE HAS NOT BEEN COMPILED. There is no Arduino toolchain on the machine it was
// written on, so treat the C++ as a first draft until it builds on real hardware.
//
// THE PROTOCOL IT IMPLEMENTS *IS* TESTED, and separately: tools/nano_protocol.py is the
// authoritative wire format and tools/test_nano_protocol.py exercises it — 41 checks,
// including dropped packets, resumption, a wrapped ring buffer, and a negative control.
// That suite found two real design bugs before any hardware existed:
//
//   1. a dropped FINAL chunk is indistinguishable from a completed transfer, so
//      completion must be decided by comparing against `total`, never by silence;
//   2. when a re-seek cannot close a gap, the history is genuinely gone and the loss has
//      to be RECORDED rather than seeking into the void forever.
//
// Both are now rules in this file and in the box's side.

#ifndef NIMROD_LINK_H
#define NIMROD_LINK_H

#include <Arduino.h>
#include <ArduinoBLE.h>

// Wire protocol version. Bumped only for an incompatible change; the box reads it out of
// the status characteristic before doing anything, so an old box meeting a new logger
// fails loudly instead of misreading a struct.
#define NIMROD_LINK_PROTO 1

// UUIDs. Fixed, and derived from the ASCII of "NimrodLink" so they are recognisable in a
// scanner rather than being one more random blob to look up.
#define NIMROD_LINK_SERVICE_UUID "4e696d72-6f64-4c69-6e6b-000000000001"
#define NIMROD_LINK_STATUS_UUID  "4e696d72-6f64-4c69-6e6b-000000000002"
#define NIMROD_LINK_CONTROL_UUID "4e696d72-6f64-4c69-6e6b-000000000003"
#define NIMROD_LINK_DATA_UUID    "4e696d72-6f64-4c69-6e6b-000000000004"

// Bytes of payload per notification, on top of the 4-byte offset header.
//
// 16 IS THE PESSIMISTIC DEFAULT AND IT IS DELIBERATE. The default BLE ATT MTU is 23 bytes,
// which leaves 20 for an attribute, which leaves 16 after the offset header. ArduinoBLE
// does not make MTU negotiation straightforward, so assuming a bigger one and being wrong
// means silently truncated chunks. THE BOX READS THIS VALUE OUT OF THE STATUS
// CHARACTERISTIC rather than assuming it, so raising it here is a one-line experiment and
// the throughput measurement is honest either way. Raise it, measure, keep what works.
#ifndef NIMROD_LINK_CHUNK
#define NIMROD_LINK_CHUNK 16
#endif

// Control opcodes, written to the control characteristic as {uint8 op, uint32 arg} LE.
enum : uint8_t {
  NL_OP_SEEK = 0x01,   // arg = byte offset to start sending from
  NL_OP_ACK  = 0x02,   // arg = "I have durably stored everything before this offset"
  NL_OP_STOP = 0x03,   // stop sending; the chair is leaving or the box is busy
  NL_OP_PING = 0x04,   // no-op, refreshes the status characteristic
};

// Status flags.
enum : uint8_t {
  NL_FLAG_MORE = 0x01,   // there are bytes past the read cursor
};

// WHERE THE BYTES COME FROM. Implement this over whatever you already use — an SD card, a
// flash region, a RAM ring, anything — and NimrodLink neither knows nor cares which.
//
// `size()` is the total number of bytes ever appended, NOT how many are currently stored.
// Offsets are therefore stable forever: byte 5000 is always the same byte, even after a
// ring buffer has overwritten it. That is what lets a box ask for an old offset and get a
// truthful answer, including the truthful answer "that is gone now" (a short read).
class NimrodLinkSource {
 public:
  virtual ~NimrodLinkSource() {}
  virtual uint32_t size() = 0;
  virtual uint32_t oldest() { return 0; }              // earliest offset still readable
  // Copy up to `len` bytes starting at `offset` into `out`. Return how many were copied;
  // 0 means "I no longer have that offset", which the box treats as a gap it cannot close.
  virtual uint32_t read(uint32_t offset, uint8_t* out, uint32_t len) = 0;
};

// A RAM ring buffer, so this runs on a bare board with nothing attached. Good enough to
// develop and measure against; NOT what you ship, because it does not survive a reset.
// Swap in an SD-backed source and nothing else in this file changes.
class NimrodLinkRamBuffer : public NimrodLinkSource {
 public:
  explicit NimrodLinkRamBuffer(uint16_t capacity);
  ~NimrodLinkRamBuffer();
  void append(const void* data, uint16_t len);
  uint32_t size() override { return _written; }
  uint32_t oldest() override;
  uint32_t read(uint32_t offset, uint8_t* out, uint32_t len) override;

 private:
  uint8_t* _buf;
  uint16_t _cap;
  uint32_t _written;      // total ever appended — the offset space, not the storage
};

class NimrodLinkClass {
 public:
  bool begin(const char* deviceName, NimrodLinkSource& source, uint32_t fwVersion = 1);
  // Call from loop(). Sends at most one chunk per call, so it never blocks your logging.
  void poll();
  void end();

  bool connected() const { return _connected; }
  uint32_t confirmed() const { return _confirmed; }
  // Set at boot from your own persistent store, if you keep one. Without it every reboot
  // re-offers the whole backlog — safe, just wasteful.
  void setConfirmed(uint32_t offset) { _confirmed = offset; }

 private:
  void writeStatus();
  void handleControl();

  NimrodLinkSource* _src = nullptr;
  BLEService* _service = nullptr;
  BLECharacteristic* _status = nullptr;
  BLECharacteristic* _control = nullptr;
  BLECharacteristic* _data = nullptr;

  uint32_t _cursor = 0;        // next byte to send
  uint32_t _confirmed = 0;     // bookmark, advisory — see the header comment
  uint32_t _fw = 1;
  bool _sending = false;
  bool _connected = false;
};

extern NimrodLinkClass NimrodLink;

#endif  // NIMROD_LINK_H
