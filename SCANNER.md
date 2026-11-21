# Local scanner

HayDex compares item shapes, colors and number glyphs with the bundled reference artwork. The Rust engine runs in a browser worker via WebAssembly and segments barn and silo grids before matching items and digits. A JavaScript implementation remains available for browsers that cannot run the Rust engine. The browser handles image and video decoding, calibration, and review.

The reference images and index are under 1 MB. The Rust engine is bundled and cached with the site. Photos and screen recordings stay on your device. HayDex does not download a recognition model or send files to a recognition server.

Use clear, uncropped barn or silo screenshots or MP4, WebM and MOV screen recordings your browser can decode. Keep the inventory open, scroll slowly, and pause on each group of items. Use up to 3 minutes of video per scan and 250 MB per clip. Video scans skip rows clipped by the barn header and try a tighter digit mask when two item matches are close. Repeated sightings are combined by item. Conflicting or uncertain video rows stay in Review for manual confirmation. Photos also support roadside shop screenshots and retain the manual crop and alignment tools.

Check uncertain names and quantities in Review before creating a trade. Excluded items and individual animal feed quantities work for both photos and recordings.

Rebuild the scanner engine locally with Rust.

```sh
rustup target add wasm32-unknown-unknown
npm run build:scanner
```

The checked-in engine lets the normal website build and local Python preview run without Rust installed. To refresh the item references after changing the catalog, run `python3 scripts/prepare-scanner.py` with Pillow installed. Existing artwork is reused where available. The digit templates are in `public/scanner/references/digits.png`.

A local Python preview must serve the video permission header. After updating the checkout, restart the preview with its current `main.py`.
