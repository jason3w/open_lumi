# open_lumi

The phone remote for **Lumi** LED juggling and flow lights, and `lumi.js`, the blocks it's built from. Change the remote, or build your own page for your lights.

- **Use it:** [lumi-remote.vercel.app](https://lumi-remote.vercel.app) in Chrome on Android, or Bluefy on iPhone.
- **Build on it:** [BUILDERS.md](BUILDERS.md): connect, set modes and colours, react to throws and catches, teach the light your own moves.
- **Run it yourself:** serve this folder over https or localhost (Web Bluetooth won't run from a file):

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

Here the mode icons are plain grey: the lights still play their real patterns, and the hosted remote shows them in colour. Firmware updates over Bluetooth are only offered by the hosted remote. The firmware's source isn't part of this repo; its released images are on the [Releases](https://github.com/jason3w/open_lumi/releases) page.

## Flash a light over USB

For a light that won't update over Bluetooth, or to go back to an earlier version. Released images are on the [Releases](https://github.com/jason3w/open_lumi/releases) page, one per board: `lumi-1.hex` to `lumi-7.hex`.

1. Install [wchisp](https://github.com/ch32-rs/wchisp/releases), the open-source USB flasher for the light's CH572 chip. On Linux it needs a udev rule or `sudo` to reach the USB device.
2. Find the light's board: in the remote, Settings, Update boards names it. The wrong board's image leaves the LED or button not working until the right one is flashed.
3. Run the script (macOS or Linux), then put the light in its bootloader when it asks: plug it into USB and hold the button for 15 seconds, or plug it in with its boot switch on.

```bash
sh flash.sh
```

`sh flash.sh 4` skips the question for board 4, and `sh flash.sh 4 26` flashes version 26.

By hand, on Windows too, with the image downloaded and the light in its bootloader: `wchisp info` shows the chip, `wchisp config reset` unlocks one that refuses writes (replug it afterwards), and `wchisp flash lumi-4.hex` writes the image.

| Board | Image |
|---|---|
| nanoCH57x | `lumi-1.hex` |
| nanoCH57x with accelerometer | `lumi-2.hex` |
| Lumi R3 | `lumi-3.hex` |
| Lumi R3A | `lumi-4.hex` |
| Lumi R3D | `lumi-5.hex` |
| Lumi R3DA | `lumi-6.hex` |
| Lumi R4C / R4S | `lumi-7.hex` |

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md): use it, change it, fork it and share it for any noncommercial purpose (personal, hobby, study, research, charities, schools). Using it in or for a commercial product or service needs written permission: open an issue to ask.

The licence covers the code, not the name. Forks and your own pages are welcome, but please don't call them Lumi or make them look like an official Lumi app.

## Contributing

Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
