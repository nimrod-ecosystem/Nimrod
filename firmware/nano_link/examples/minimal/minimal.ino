// NimrodLink, minimal - a fake logger you can pull from in five minutes.
//
// This is NOT what a real deployment looks like. It fabricates records so the link can be
// developed, measured and proven with nothing attached to the board but USB. Replace the
// fake record with your real one and the ring buffer with your real storage, and nothing
// else here changes - which is the point of the whole design.
//
// PLAIN ASCII ON PURPOSE. Arduino sketches get opened in a dozen editors on three
// platforms, and a stray em-dash that survives a round trip through the wrong encoding is
// a diff nobody asked for. (It already happened once, to this file.)
//
// TO TRY IT:
//   1. Board: Arduino Nano 33 BLE (or BLE Sense). Library: ArduinoBLE.
//   2. Flash this.
//   3. From a computer with Bluetooth:
//        pip install bleak
//        py -3.13 tools/nano_probe.py --scan
//        py -3.13 tools/nano_probe.py --name wheeltrak-dev --benchmark
//
// The benchmark prints bytes per second, which is the number this whole exercise exists to
// find out - everything downstream depends on whether a month of backlog moves in seconds
// or in twenty minutes.

#include <NimrodLink.h>

// 8 KB of RAM ring. The Nano 33 BLE has 256 KB, and ArduinoBLE wants a good chunk of it,
// so do not get greedy here while experimenting.
NimrodLinkRamBuffer store(8192);

// A stand-in for whatever WheelTrak actually records. NOTHING IN NimrodLink LOOKS INSIDE
// THIS - not the library, not the box, not the server. Change it freely; it is your
// business and nobody else's. That is what "format-agnostic" buys you.
struct FakeRecord {
  uint32_t t_ms;
  int16_t  ax, ay, az;       // where an accelerometer sample would go
  uint16_t rotations;
  uint16_t shock_peak;
};

static uint32_t lastSample = 0;

void setup() {
  Serial.begin(115200);
  // Deliberately does NOT wait for a serial monitor. A logger that will not boot without a
  // computer attached is useless in the field, and it is an easy thing to leave in by
  // accident while developing.
  delay(200);

  if (!NimrodLink.begin("wheeltrak-dev", store)) {
    Serial.println("BLE failed to start");
    while (1) delay(1000);
  }
  Serial.println("NimrodLink up. Advertising as 'wheeltrak-dev'.");

  // Pre-fill so there is something to pull immediately, and enough of it that a
  // throughput measurement means anything. ~4 KB of records.
  FakeRecord r{};
  for (uint16_t i = 0; i < 250; i++) {
    r.t_ms = i * 100;
    r.ax = (int16_t)(i * 37);
    r.ay = (int16_t)(-i * 11);
    r.az = 16384;
    r.rotations = i;
    r.shock_peak = (uint16_t)((i * 97) % 4096);
    store.append(&r, sizeof(r));
  }
}

void loop() {
  // Your real logging goes here, at whatever rate you already use.
  const uint32_t now = millis();
  if (now - lastSample >= 100) {
    lastSample = now;
    FakeRecord r{};
    r.t_ms = now;
    r.ax = (int16_t)random(-2000, 2000);
    r.ay = (int16_t)random(-2000, 2000);
    r.az = (int16_t)random(15000, 17000);
    r.rotations = (uint16_t)(now / 1000);
    r.shock_peak = (uint16_t)random(0, 4096);
    store.append(&r, sizeof(r));
  }

  // ONE LINE. Sends at most one chunk per call, so it never stalls the sampling above - a
  // logger that misses readings because it was busy uploading readings is a bad trade in
  // any direction.
  NimrodLink.poll();
}
