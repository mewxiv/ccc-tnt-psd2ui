const test = require('node:test');
const assert = require('node:assert/strict');

require('ag-psd/initialize-canvas');
const canvas = require('canvas');
const { PsdImage } = require('../dist/psd/PsdImage');
const { Parser } = require('../dist/Parser');

function sourceWithEffects(effects, fillOpacity = 1) {
  const layerCanvas = canvas.createCanvas(4, 4);
  const context = layerCanvas.getContext('2d');
  context.fillStyle = '#808080';
  context.fillRect(0, 0, 4, 4);
  return {
    name: 'effect-layer',
    left: 0,
    top: 0,
    right: 4,
    bottom: 4,
    hidden: false,
    opacity: 1,
    fillOpacity,
    canvas: layerCanvas,
    vectorMask: true,
    effects,
  };
}

test('vector gradient overlay is baked when ag-psd exposes it as an array', () => {
  const image = new PsdImage(sourceWithEffects({
    gradientOverlay: [{
      enabled: true,
      opacity: 1,
      angle: 90,
      gradient: {
        colorStops: [
          { location: 0, color: { r: 255, g: 0, b: 0 } },
          { location: 1, color: { r: 0, g: 0, b: 255 } },
        ],
      },
    }],
  }), null, null);

  const pixel = image.source.canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  assert.ok(pixel[0] > 200, `expected red gradient start, got ${[...pixel]}`);
  assert.ok(pixel[2] < 50, `expected red gradient start, got ${[...pixel]}`);
});

test('Photoshop fill opacity becomes the exported node opacity', () => {
  const image = new PsdImage(sourceWithEffects({}, 0.30196078431372547), null, null);
  image.parent = {};
  image.parseSource();
  assert.equal(image.opacity, 77);
});

test('only gradient text effects require rasterized text output', () => {
  const parser = new Parser();
  assert.equal(parser.shouldRasterizeText({
    effects: { gradientOverlay: [{ enabled: true }] },
  }), true);
  assert.equal(parser.shouldRasterizeText({
    effects: { dropShadow: [{ enabled: true }] },
  }), false);
});
