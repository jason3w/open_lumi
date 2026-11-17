# Building on Lumi

`lumi.js` has the blocks the Lumi remote is made of. Use them to make your own page for your lights. Load the file, then everything is on `window.Lumi`. Web Bluetooth needs Chrome (Android, desktop) or Bluefy (iPhone), and the page must be served over https or from localhost.

```html
<script src="lumi.js"></script>
<button id="go">Connect</button>
<script>
document.getElementById('go').onclick = async () => {
  const light = await Lumi.connect();          // Chrome's picker, then the link
  await light.set({ on: 1, mode: 3 });         // mode 0-25 of its set, 26 = auto-cycle
};
</script>
```

## Blocks

| Block | What it does |
|---|---|
| `Lumi.connect(device?)` | Picks a light (or uses `device`) and returns `light` |
| `light.set({ on, mode, bright, hue, speed })` | Any of them: on 0/1, mode 0-26, bright 1-255, hue 0-255 (0 = as made), speed 0-255 (128 = as made) |
| `light.pattern(colours, style, stepMs)` | Your own pattern: up to 4 colours (`'#ff0000'` or `[255, 0, 0]`), style `'steps'`, `'fade'`, `'blink'` or `'juggle'`, each step 10-2550 ms |
| `light.find()` | Flashes the light green |
| `light.info()` | `{ ver, type, mv, usb, sleepMin, rf }`: firmware version, board type, battery in mV, USB (1 charging, 2 full) |
| `light.on(type, cb)` | Events, below |
| `light.st`, `light.custom`, `light.prog` | Its last known state |
| `light.disconnect()` | |

Lower down, `Lumi.stateBytes`, `parseState`, `fxBytes`, `cmd`, `parseInfo` and friends are the raw formats, if you'd rather drive the characteristics yourself.

## Movement triggers

Lights with a motion sensor (firmware 26 or later) tell the page what they detect, while they're on:

| Event | When | Extra |
|---|---|---|
| `'throw'` | it leaves the hand | `e.kind`: `'fall'` (thrown) or `'spin'` (a spun club or poi) |
| `'freefall'`, `'spin'` | a throw of that kind | |
| `'catch'` | it lands | `e.flightMs`: how long it was up |
| `'top'` | the top of the flight, timed from the last flight | |
| `'shake'` | it has been shaken for about 0.4 s | |
| `'bump'` | a knock: one short jolt with stillness either side (firmware 27) | `e.mg`: how hard, the biggest jump between two reads |
| `'stall'` | it stops moving after a throw, shake or bump (firmware 27) | `e.stillMs`: how long it has been still |
| `'change'` | its button, or another light in its group, changed its state | |

Every event has `e.ms` (the light's clock, ms, wraps at 65536) and `e.at` (the page's `performance.now()`). `light.motion` is true once events can arrive. A light first picked by an older page may not show events: pick it again with `Lumi.connect()`.

Tie an event to any block:

```js
const light = await Lumi.connect();
light.on('catch', () => light.pattern(['#ffffff', '#000000'], 'blink', 50));   // a white strobe on every catch
light.on('shake', () => light.set({ mode: (light.st.mode + 1) % 26 }));         // shake for the next mode
```

**Timing.** The light's own effects (Flash on catch, New mode on throws) react on the light itself. Your page hears the same moment later: up to one Bluetooth connection event (30-50 ms) plus the phone's own delay, usually 40-80 ms in all. Fine for changing modes; a flash timed off `'catch'` lands just after the light's own one.

## Rules on the light

With firmware 27 a sensor light can keep up to 8 rules, "when this happens, do that", and run them itself: no phone needed once they're set, and no Bluetooth delay. It keeps them through power-off.

```js
const light = await Lumi.connect();
await light.rules([
  { when: 'bump',  do: 'flash',  colour: '#ff0000' },             // a red flash on every knock
  { when: 'shake', do: 'next' },                                  // shake for the next mode
  { when: 'stall', atLeast: 500, do: 'colour', colour: '#0000ff' },   // still for half a second: turn blue
]);
```

| `when` | `atLeast` (optional) |
|---|---|
| `'throw'`, `'top'`, `'shake'` | |
| `'catch'` | the flight, in ms: only throws that were up this long |
| `'bump'` | how hard, in mg (default 1200; a light tap is about 700) |
| `'stall'` | how long still, in ms (default 300). One time for all the rules: the first stall rule's |

| `do` | |
|---|---|
| `'flash'` | `colour` for a quarter of a second, on this light only |
| `'next'` | the next mode |
| `'mode'` | `mode`: 0-26 |
| `'colour'` | a steady `colour` |
| `'speed'` | `speed`: 0-255, 128 as made |

A mode, colour or speed change spreads to the lights paired with it, as a button press does. `light.rules([])` clears them. The remote page keeps its own rules per group (Throws tab) and writes them to each light it connects, so set them in one place.

A bump is known about 80 ms after it happens: the light waits to see it isn't the start of a throw or a shake.

## Your own moves

For anything the light doesn't detect itself (a flick, a figure eight, a tap on the leg), record it and let the page watch for it. The light streams its sensor (`light.stream`, 50 samples a second, x y z in mg, ±2 g) while it's on, and all the matching runs in your page.

```js
const light = await Lumi.connect();
const flick = await light.learnMove({ times: 3, name: 'flick', onStep: n => console.log(`got ${n} of 3`) });
localStorage.setItem('flick', JSON.stringify(flick));          // a template is plain JSON
light.matchMove(flick, () => light.set({ mode: (light.st.mode + 1) % 26 }));   // flick for the next mode
```

- Do the move with a still moment before and after each time: that's how `learnMove` finds where it starts and ends.
- `features: 'anyway'` (in `learnMove`) matches on how hard, not which way: for things that turn as they move, like a thrown ball. The default, `'xyz'`, is the move as held.
- Too many false matches: `learnMove({ slack: 1 })` (default 1.2), or record more times. Missed ones: raise it.
- `matchMove` returns `stop()`; so does `light.stream(cb)` if you'd rather work on the samples yourself.

**Timing.** A match fires as the move ends, plus 80 ms for a stream packet (4 samples) and one Bluetooth connection event (30-50 ms): about 100-200 ms after the move, against 60-80 ms for the light's own throw and catch. Good for "do a move, change something"; for flashes on throws and catches use the events above.
