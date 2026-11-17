# open_lumi

The phone remote for **Lumi** LED juggling and flow lights, and `lumi.js`, the blocks it's built from. Change the remote, or build your own page for your lights.

- **Use it:** [lumi-remote.vercel.app](https://lumi-remote.vercel.app) in Chrome on Android, or Bluefy on iPhone.
- **Build on it:** [BUILDERS.md](BUILDERS.md): connect, set modes and colours, react to throws and catches, teach the light your own moves.
- **Run it yourself:** serve this folder over https or localhost (Web Bluetooth won't run from a file):

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

Here the mode icons are plain grey: the lights still play their real patterns, and the hosted remote shows them in colour. Firmware updates are only offered by the hosted remote. The light firmware isn't part of this repo.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md): use it, change it, fork it and share it for any noncommercial purpose (personal, hobby, study, research, charities, schools). Using it in or for a commercial product or service needs written permission: open an issue to ask.

The licence covers the code, not the name. Forks and your own pages are welcome, but please don't call them Lumi or make them look like an official Lumi app.

## Contributing

Pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
