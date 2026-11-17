// lumi.js: the blocks for talking to a Lumi light over Web Bluetooth. The remote page (index.html) uses these;
// build your own page on them too. Load with <script src="lumi.js"></script>; everything is on window.Lumi.
// Licensed under PolyForm Noncommercial 1.0.0 (see LICENSE.md).
(() => {
  // full UUID strings, not numbers: Bluefy (iPhone) can't parse numeric UUIDs
  const u16 = n => `0000${n.toString(16)}-0000-1000-8000-00805f9b34fb`;
  const SERVICE = u16(0xffe0), CHAR = u16(0xffe1), OTA_SERVICE = u16(0xfee0), OTA_CHAR = u16(0xfee1);
  const MOTION_SERVICE = u16(0xffe8), MOTION_CHAR = u16(0xffe2);   // lights with a motion sensor
  const SLOTS = 27, AUTO = 26;              // mode slots per set; slot 26 cycles the solid colours
  const STYLES = ['steps', 'fade', 'blink', 'juggle'];
  const FX = { SPARK: 1, CYCLE: 2, TOP: 4 };   // throw effects (lights with a motion sensor)
  const UNPAIRED = 0x80000000;              // a light's radio group before it was ever paired
  const NO_CUSTOM = new Array(14).fill(0);
  const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));   // '#rrggbb' -> [r, g, b]

  // ---- the state characteristic (0xFFE1): 20 bytes, read, write, notify ----
  // on, mode, brightness, set (1 fast, 2 slow), hue, custom pattern (14 bytes), speed
  function parseState(dv) {
    const u = i => i < dv.byteLength ? dv.getUint8(i) : null;
    return { st: { on: u(0), mode: u(1), bright: u(2), hue: u(4) ?? 0, speed: u(19) ?? 128 },
             custom: dv.byteLength >= 19 ? [...new Uint8Array(dv.buffer, dv.byteOffset + 5, 14)] : NO_CUSTOM,
             prog: u(3) ? 'slow' : 'fast' };
  }
  // st: { on 0/1, mode 0-26, bright 1-255, hue 0-255 (0 = as made), speed 0-255 (128 = as made) }; len: the light's
  // state size (its first read), so older firmware gets what it understands
  function stateBytes(st, custom = NO_CUSTOM, prog = 'fast', len = 20) {
    const all = [st.on, st.mode, st.bright, prog === 'slow' ? 2 : 1, st.hue, ...custom, st.speed];
    return new Uint8Array(all.slice(0, len >= 20 ? 20 : len >= 19 ? 19 : len >= 5 ? 5 : 3));
  }
  // your own pattern: up to 4 colours, a style from STYLES, each step stepMs long (10-2550 ms)
  function customBlock(colours, style = 'steps', stepMs = 500) {
    const n = Math.min(colours.length, 4), rgb = colours.slice(0, 4).flatMap(c => typeof c === 'string' ? hex2(c) : c);
    return [n | Math.max(0, STYLES.indexOf(style)) << 4, Math.max(1, Math.min(255, Math.round(stepMs / 10))), ...rgb, ...new Array(12 - rgb.length).fill(0)];
  }
  const customColours = c => { const out = []; for (let i = 0; i < (c[0] & 15); i++) out.push(c.slice(2 + i * 3, 5 + i * 3)); return out; };
  // the same characteristic takes other lengths as settings:
  const sleepBytes = min => new Uint8Array([min & 255, min >> 8]);                                  // minutes off before it sleeps (firmware 17)
  const radioBytes = id => new Uint8Array([id & 255, id >> 8 & 255, id >> 16 & 255, id >>> 24]);  // radio group, 0 = unpaired (22); write with response
  function fxBytes(f, ver = 99) {   // f: { fx: FX bits, modes: [slots], every: throws per change, spark, top: '#rrggbb' } (13; colours 17)
    const m = f.modes.reduce((a, s) => a | 1 << s, 0);
    return new Uint8Array([f.fx, m & 255, m >> 8 & 255, m >> 16 & 255, m >>> 24 & 255, f.every, ...(ver >= 17 ? [...hex2(f.spark), ...hex2(f.top)] : [])]);
  }

  // ---- the command characteristic (0xFEE1): write a command, then read until the answer is there ----
  const cmd = (op, addr = 0, data = []) => new Uint8Array([op, data.length, addr & 255, addr >> 8, ...data]);
  const CMD = { INFO: 0x84, FIND: 0x85, HEARD: 0x86, FIND_HEARD: 0x87 };
  function parseInfo(v) {   // INFO answer: version, board type, battery, USB, sleep minutes, radio group
    const n = v.byteLength, ver = n > 10 ? v.getUint8(10) : 0;
    return { ver, type: n > 11 ? v.getUint8(11) : 0, mv: n > 13 ? v.getUint8(12) * 20 : 0, usb: n > 13 ? v.getUint8(13) : 0,
             sleepMin: ver >= 17 ? v.getUint16(14, true) : 5, rf: ver >= 22 ? v.getUint32(16, true) : null };
  }
  function parseHeard(v) {   // HEARD answer: how many lights it hears in all, then up to 3 of them
    const lights = [];
    for (let o = 1; o + 6 <= v.byteLength; o += 6) {
      const u = v.getUint8(o + 5);
      lights.push({ id: v.getUint16(o, true).toString(16).toUpperCase().padStart(4, '0'), type: v.getUint8(o + 2),
                    ver: v.getUint8(o + 3), mv: v.getUint8(o + 4) * 20, usb: u & 3, paired: !!(u & 4) });
    }
    return { total: v.getUint8(0), lights };
  }
  // ---- gate events (firmware 26, lights with a motion sensor): 4-byte notifications on MOTION_CHAR ----
  // kind, detail, the light's ms (uint16 LE). Only while the light is on. Other lengths there are the bench stream
  const EVENTS = { 1: 'throw', 2: 'catch', 3: 'top', 4: 'shake' };
  function parseEvent(v) {   // -> { type, ms, kind ('fall' | 'spin') for a throw, flightMs for a catch }, or null
    if (v.byteLength !== 4 || !EVENTS[v.getUint8(0)]) return null;
    const e = { type: EVENTS[v.getUint8(0)], ms: v.getUint16(2, true) }, d = v.getUint8(1);
    if (e.type === 'throw') e.kind = d === 2 ? 'spin' : 'fall';
    if (e.type === 'catch') e.flightMs = d * 10;
    return e;
  }
  // ---- your own moves (firmware 26): the builder stream, and matching on the phone ----
  // Stream packet, format 1, 16 bytes: format, sequence, ms of the first sample (uint16 LE), 4 samples of x y z as
  // int8 in 16 mg steps (+-2 g), 20 ms apart. Only while the light is on
  const SAMPLE_MS = 20;
  function parseSamples(v) {   // -> { seq, samples: [{ ms, x, y, z }] in mg }, or null
    if (v.byteLength !== 16 || v.getUint8(0) !== 1) return null;
    const ms = v.getUint16(2, true), samples = [];
    for (let i = 0; i < 4; i++) samples.push({ ms: (ms + i * SAMPLE_MS) & 0xffff, x: v.getInt8(4 + 3 * i) * 16, y: v.getInt8(5 + 3 * i) * 16, z: v.getInt8(6 + 3 * i) * 16 });
    return { seq: v.getUint8(1), samples };
  }
  // A move is a burst of change between reads, with stillness either side. samples: [{ x, y, z }] in mg, 50 a second
  function segments(samples, { moveMg = 150, stillMs = 300, minMs = 200, padMs = 100 } = {}) {
    const out = [], still = stillMs / SAMPLE_MS, pad = padMs / SAMPLE_MS;
    let start = -1, quiet = 0;
    for (let i = 1; i <= samples.length; i++) {
      const a = samples[i], b = samples[i - 1];
      const d = a ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) : 0;
      if (d > moveMg) { if (start < 0) start = i - 1; quiet = 0; }
      else if (start >= 0 && (++quiet >= still || !a)) {
        const end = i - quiet + 1;
        if ((end - start) * SAMPLE_MS >= minMs) out.push([Math.max(0, start - pad), Math.min(samples.length, end + pad)]);
        start = -1; quiet = 0;
      }
    }
    return out;
  }
  // 'xyz': the move as held (a gesture with a handle); 'anyway': only how hard, for things that turn in flight (balls)
  const FEATURES = { xyz: s => [s.x / 1000, s.y / 1000, s.z / 1000], anyway: s => [Math.hypot(s.x, s.y, s.z) / 1000, 0, 0] };
  const activity = r => { let d = 0; for (let i = 1; i < r.length; i++) d += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1], r[i][2] - r[i - 1][2]); return d / r.length; };
  function dtw(a, b) {   // dynamic time warping, Euclidean in g, per step of the path; a band of a third either way
    const n = a.length, m = b.length, w = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) / 3));
    let prev = new Float64Array(m + 1).fill(Infinity), cur = new Float64Array(m + 1);
    prev[0] = 0;
    for (let i = 1; i <= n; i++) {
      cur.fill(Infinity);
      for (let j = Math.max(1, i - w); j <= Math.min(m, i + w); j++)
        cur[j] = Math.hypot(a[i - 1][0] - b[j - 1][0], a[i - 1][1] - b[j - 1][1], a[i - 1][2] - b[j - 1][2]) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      [prev, cur] = [cur, prev];
    }
    return prev[m] / (n + m);
  }
  // reps: 2 or more recordings of the same move ([{ x, y, z }] each). Plain JSON: save it, load it, share it
  // slack: how far past the reps' own spread a match may be. Too many false matches: lower it, or record more reps
  function makeTemplate(reps, name = 'move', { slack = 1.2, features = 'xyz' } = {}) {
    const f = FEATURES[features], r = reps.map(x => x.map(f));
    let worst = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) worst = Math.max(worst, dtw(r[i], r[j]));
    return { format: 1, name, features, reps: r, threshold: Math.max(0.05, worst * slack), activity: Math.min(...r.map(activity)) };
  }
  // push(sample) for each new sample: { distance } when the last samples match one of the reps, else null
  function moveMatcher(template, { threshold = template.threshold, coolMs } = {}) {
    const len = Math.max(...template.reps.map(r => r.length)), buf = [], f = FEATURES[template.features || 'xyz'];
    const cool = (coolMs ?? len * SAMPLE_MS) / SAMPLE_MS;
    let wait = 0;
    return {
      push(s) {
        buf.push(f(s)); if (buf.length > len) buf.shift();
        if (wait > 0) { wait--; return null; }
        let best = Infinity;
        for (const r of template.reps) {
          if (buf.length < r.length) continue;
          const w = buf.slice(buf.length - r.length);
          if (activity(w) < template.activity / 2) continue;   // nowhere near as much going on: not this move
          best = Math.min(best, dtw(w, r));
        }
        if (best > threshold) return null;
        wait = cool;
        return { distance: best };
      },
    };
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function answer(ch) {   // empty while the light is still busy
    for (let i = 0; i < 600; i++) { const v = await ch.readValue(); if (v.byteLength) return v; await sleep(50); }
    throw new Error('the light stopped answering');
  }

  // ---- one light, the simple way: const light = await Lumi.connect(); light.set({ on: 1, mode: 3 }) ----
  async function connect(device) {
    device ??= await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }], optionalServices: [OTA_SERVICE, MOTION_SERVICE] });
    const srv = await device.gatt.connect();
    const ch = await (await srv.getPrimaryService(SERVICE)).getCharacteristic(CHAR);
    let ota; try { ota = await (await srv.getPrimaryService(OTA_SERVICE)).getCharacteristic(OTA_CHAR); } catch (e) {}
    const first = await ch.readValue(), len = first.byteLength;
    let busy = Promise.resolve();   // one Bluetooth operation at a time
    const queue = f => (busy = busy.then(f, f));
    const ask = c => queue(() => ota.writeValueWithResponse(c).then(() => answer(ota)));
    const light = {
      device, len, ...parseState(first), handlers: {},
      set(changes, custom) {   // changes: any of on, mode, bright, hue, speed; custom: a customBlock()
        Object.assign(light.st, changes); if (custom) light.custom = custom;
        return queue(() => ch.writeValueWithoutResponse(stateBytes(light.st, light.custom, light.prog, len)));
      },
      pattern(colours, style, stepMs) { return light.set({ on: 1 }, customBlock(colours, style, stepMs)); },
      info: async () => ota ? parseInfo(await ask(cmd(CMD.INFO, 0, new Array(14).fill(0)))) : { ver: 0 },
      find: () => ota && ask(cmd(CMD.FIND)),   // flashes green
      write: (bytes, withResponse) => queue(() => withResponse ? ch.writeValueWithResponse(bytes) : ch.writeValueWithoutResponse(bytes)),
      // on('change', cb): its own button presses, and other lights in its group. On a sensor light (firmware 26):
      // 'throw' (e.kind 'fall' or 'spin'), 'freefall', 'spin' (a throw of that kind), 'catch' (e.flightMs), 'top', 'shake'
      on(type, cb) { (light.handlers[type] ??= []).push(cb); return light; },
      motion: false,   // true once events can arrive
      // the builder stream (firmware 26): cb({ ms, x, y, z }) for every sample, in mg; returns stop()
      stream(cb) {
        if (!mc) throw new Error('no motion stream: a sensor light on firmware 26, picked with Lumi.connect()');
        (light.handlers.sample ??= []).push(cb);
        if (light.handlers.sample.length === 1) queue(() => mc.writeValueWithResponse(new Uint8Array([3])));
        return () => {
          light.handlers.sample = light.handlers.sample.filter(f => f !== cb);
          if (!light.handlers.sample.length) return queue(() => mc.writeValueWithResponse(new Uint8Array([0])));
        };
      },
      // record a move `times` times; onStep(i) after each. Resolves with a template (makeTemplate)
      learnMove({ times = 3, name, onStep, ...opts } = {}) {   // opts: makeTemplate's slack, features
        return new Promise(done => {
          let buf = [], reps = [];
          const stop = light.stream(s => {
            buf.push(s);
            const seg = segments(buf).find(([, end]) => end < buf.length);   // a whole move, stillness after it
            if (!seg) { if (buf.length > 500) buf = buf.slice(-100); return; }
            reps.push(buf.slice(seg[0], seg[1])); buf = [];
            onStep?.(reps.length);
            if (reps.length === times) { stop(); done(makeTemplate(reps, name, opts)); }
          });
        });
      },
      // cb({ distance }, light) on each match; returns stop()
      matchMove(template, cb, opts) {
        const m = moveMatcher(template, opts);
        return light.stream(s => { const r = m.push(s); if (r) cb(r, light); });
      },
      disconnect: () => device.gatt.disconnect(),
    };
    const fire = (type, e) => (light.handlers[type] || []).forEach(f => f(e, light));
    ch.addEventListener('characteristicvaluechanged', e => { Object.assign(light, parseState(e.target.value)); fire('change', light); });
    await ch.startNotifications();
    let mc;
    try {   // no sensor, or a device picked before without MOTION_SERVICE: no events. Never read MOTION_CHAR while subscribed (macOS)
      mc = await (await srv.getPrimaryService(MOTION_SERVICE)).getCharacteristic(MOTION_CHAR);
      mc.addEventListener('characteristicvaluechanged', ev => {
        const p = parseSamples(ev.target.value);
        if (p) { for (const s of p.samples) fire('sample', s); return; }
        const e = parseEvent(ev.target.value);
        if (!e) return;
        e.at = performance.now();
        fire(e.type, e);
        if (e.type === 'throw') fire(e.kind === 'spin' ? 'spin' : 'freefall', e);
      });
      await mc.startNotifications();
      light.motion = true;
    } catch (e) {}
    return light;
  }

  window.Lumi = { SERVICE, CHAR, OTA_SERVICE, OTA_CHAR, MOTION_SERVICE, MOTION_CHAR, EVENTS, parseEvent, SLOTS, AUTO, STYLES, FX, CMD, UNPAIRED, NO_CUSTOM, hex2,
                  SAMPLE_MS, FEATURES, parseSamples, segments, dtw, makeTemplate, moveMatcher,
                  parseState, stateBytes, customBlock, customColours, sleepBytes, radioBytes, fxBytes, cmd, parseInfo, parseHeard, answer, connect };
})();
