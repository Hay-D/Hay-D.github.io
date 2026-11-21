# HayDex / Hay-D

Build Buy, Sell, and Trade posts for Hay Day. Scan barn or silo stock and track deals. Photos, videos, lists, and deal history stay on your device. [Open HayDex](https://hay-d.github.io/)

## What's new in 1.2.0

- Scan screenshots and screen recordings with the local Rust scanner. Review uncertain matches before adding them to a trade.
- Create Have and Want exchanges with custom ratios and terms. Add a named percentage discount to selling posts.
- Keep open deals, see completed trades in History, and check Stats from the farm menu.
- Reopen old posts from HayDex PNGs, screenshots, text, or JSON.

## Guides

- [Illustrated PDF guide](public/HayDex-Guide.pdf)
- [User guide](GUIDE.md)
- [Scanner and build notes](SCANNER.md)

## Run locally

From the project folder, start the preview with Python.

```sh
python3 main.py
```

Open [localhost:5173](http://localhost:5173/). Restart the Python preview after updating so it uses the current video permissions.

Use `npm run build` with Node.js 22 or later to build the static site in `dist/`. The bundled scanner runs without installing Rust.

## Credits and license

HayDex takes inspiration from [Hay Day Image Generator](https://jjcuber.github.io/HayDayImageGeneratorSite/).

HayDex code uses [Apache-2.0](LICENSE). Hay Day artwork and trademarks belong to Supercell and are excluded. Bundled fonts keep their own licenses in `public/`.
