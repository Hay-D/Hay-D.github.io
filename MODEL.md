# Scanner models

Two ONNX networks run on your device with ONNX Runtime Web 1.23.2. Photos are never sent to a server.

| | Item model | Digit model |
| --- | --- | --- |
| File | `items.onnx` | `digits.onnx` |
| Network | ResNet-50 | 3 convolution layers, 2 dense layers |
| Input | 224 × 224 RGB | 32 × 32 grayscale |
| Output | 430 item classes | Digits 0–9 |
| Exported parameters | 24,362,542 | 356,234 |
| File size | 92.96 MiB | 1.36 MiB |
| Weights | Float32 | Float32 |

Both models take `images` and return `logits`. Item tensors use `[1, 3, 224, 224]`; digits use `[N, 1, 32, 32]`.

These counts come from the exported weight tensors. The item network has batch normalization folded into its convolutions.

Item pixels use RGB means `[0.485, 0.456, 0.406]` and standard deviations `[0.229, 0.224, 0.225]`. Item confidence below 75% or digit confidence below 90% needs review. Confidence is not a promise of accuracy.

The first download is about 94.3 MiB. SHA-256 checks verify both files before use, and IndexedDB keeps them on the device for later visits. The scanner runs in a worker so the controls stay responsive. Browsers can clear cached files when storage is low.

Files, class order and checksums are in `public/models/v3/`. Chicken feed is recognized but is left out of trade lists. Always check names and quantities before creating a trade.

To replace a model, update its ONNX file and the matching sizes, hashes, classes and version in `manifest.json`. Keep the same input and output formats, then run `npm run build`.
