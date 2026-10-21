# Local scanner

HayDex compares item shapes and colors with the game's artwork. It reads quantities by comparing number shapes with fixed digit images. There are no neural networks, ONNX files, OCR language packs or inference servers.

The reference images and index are under 1 MB, bundled with the website and cached for offline use. Recognition runs in a browser worker. Photos stay on your device. Previous model downloads are removed from device storage when the new scanner starts.

Use clear, uncropped barn, silo or shop screenshots. Crop & alignment still lets you correct the grid. Uncertain matches need review; image matching cannot guarantee perfect results for every screenshot. Check names and quantities before creating a trade. Excluded items and overlapping-photo handling work as before.

Animal feed is included. Feed quantities count individual sacks, bundles or buckets.

To refresh the item reference sheet after changing the catalog, run `python3 scripts/prepare-scanner.py` with Pillow installed. Existing local artwork is reused; missing images are fetched from their catalog URLs. The fixed digit references are ordinary images in `public/scanner/references/digits.png`.
