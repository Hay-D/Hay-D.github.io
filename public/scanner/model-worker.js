importScripts('../runtime/ort.wasm.min.js');

ort.env.wasm.wasmPaths = new URL('../runtime/', self.location.href).href;

ort.env.wasm.numThreads = 1;

ort.env.wasm.proxy = false;

let items = null, digits = null;

async function release() {
  await (items?.release());
  await (digits?.release());
  items = null;
  digits = null;
}

self.onmessage = async event => {
  const {id: id, kind: kind, ...data} = event.data;
  try {
    if (kind === 'load') {
      await release();
      items = await ort.InferenceSession.create(data.items, {
        executionProviders: [ 'wasm' ]
      });
      digits = await ort.InferenceSession.create(data.digits, {
        executionProviders: [ 'wasm' ]
      });
      if (items.inputNames[0] !== 'images' || digits.inputNames[0] !== 'images') throw new Error('Unexpected model input');
      const input = new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [ 1, 3, 224, 224 ]), result = await items.run({
        images: input
      });
      if (result[items.outputNames[0]].data.length !== data.classes) throw new Error('Model classes do not match');
      input.dispose();
      Object.values(result).forEach((x => x.dispose()));
      self.postMessage({
        id: id,
        result: true
      });
    } else if (kind === 'predict') {
      if (!items || !digits) throw new Error('Load the scanner first');
      const input = new ort.Tensor('float32', data.item, [ 1, 3, 224, 224 ]), output = await items.run({
        images: input
      }), itemLogits = Array.from(output[items.outputNames[0]].data);
      input.dispose();
      Object.values(output).forEach((x => x.dispose()));
      let digitLogits = [];
      if (data.digitCount) {
        const tensor = new ort.Tensor('float32', data.digit, [ data.digitCount, 1, 32, 32 ]), result = await digits.run({
          images: tensor
        });
        digitLogits = Array.from(result[digits.outputNames[0]].data);
        tensor.dispose();
        Object.values(result).forEach((x => x.dispose()));
      }
      self.postMessage({
        id: id,
        result: {
          itemLogits: itemLogits,
          digitLogits: digitLogits
        }
      });
    } else if (kind === 'release') {
      await release();
      self.postMessage({
        id: id,
        result: true
      });
    }
  } catch (error) {
    if (kind === 'load') await release().catch((() => {}));
    self.postMessage({
      id: id,
      error: error.message || 'Model failed'
    });
  }
};
