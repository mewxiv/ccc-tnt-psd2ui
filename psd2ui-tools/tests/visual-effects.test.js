const test = require('node:test');
const assert = require('node:assert/strict');

require('ag-psd/initialize-canvas');
const canvas = require('canvas');
const { PsdImage } = require('../dist/psd/PsdImage');
const { PsdText } = require('../dist/psd/PsdText');
const { Parser } = require('../dist/Parser');
const { CCLabel } = require('../dist/engine/cc/CCLabel');

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

test('large inner glow fades toward the center instead of flattening a short button', () => {
  const layerCanvas = canvas.createCanvas(143, 43);
  layerCanvas.getContext('2d').fillRect(0, 0, 143, 43);
  const image = new PsdImage({
    ...sourceWithEffects({}),
    right: 143,
    bottom: 43,
    canvas: layerCanvas,
    effects: {
      solidFill: [{
        enabled: true,
        color: { r: 96, g: 147, b: 82 },
        opacity: 1,
      }],
      innerGlow: {
        enabled: true,
        blendMode: 'screen',
        color: { r: 163, g: 255, b: 191 },
        opacity: 0.75,
        choke: { value: 0 },
        size: { value: 21 },
      },
    },
  }, null, null);

  const context = image.source.canvas.getContext('2d');
  const nearTop = context.getImageData(19, 2, 1, 1).data;
  const middle = context.getImageData(19, 21, 1, 1).data;
  const difference = Math.max(
    Math.abs(nearTop[0] - middle[0]),
    Math.abs(nearTop[1] - middle[1]),
    Math.abs(nearTop[2] - middle[2])
  );
  assert.ok(difference >= 20, `expected a soft glow gradient, got difference=${difference}`);
});

test('clipped layer is removed when its Photoshop clipping base is hidden', () => {
  const baseCanvas = canvas.createCanvas(40, 40);
  baseCanvas.getContext('2d').fillRect(0, 0, 40, 40);
  const clippedCanvas = canvas.createCanvas(40, 40);
  const clippedContext = clippedCanvas.getContext('2d');
  clippedContext.fillStyle = '#ff0000';
  clippedContext.fillRect(0, 0, 40, 20);
  clippedContext.fillStyle = '#0000ff';
  clippedContext.fillRect(0, 20, 40, 20);

  const parser = new Parser();
  const document = parser.parseLayer({
    name: 'document',
    width: 100,
    height: 100,
    children: [{
      name: 'group',
      children: [{
        name: 'hidden-base',
        left: 10,
        top: 10,
        right: 50,
        bottom: 50,
        hidden: true,
        opacity: 1,
        canvas: baseCanvas,
      }, {
        name: 'clipped-overlay',
        left: 10,
        top: 10,
        right: 50,
        bottom: 50,
        hidden: false,
        opacity: 1,
        clipping: true,
        blendMode: 'multiply',
        canvas: clippedCanvas,
      }],
    }],
  });

  assert.deepEqual(document.children[0].children.map((layer) => layer.source.name), ['hidden-base']);
});

test('multiline Photoshop leading and paragraph alignment are preserved in Cocos labels', () => {
  const textCanvas = canvas.createCanvas(57, 158);
  const source = {
    name: 'three-lines',
    left: 0,
    top: 0,
    right: 57,
    bottom: 158,
    hidden: false,
    opacity: 1,
    canvas: textCanvas,
    text: {
      text: '生命\n防御\n攻击',
      transform: [1, 0, 0, 1, 0, 0],
      style: {
        font: { name: 'AlimamaDongFangDaKai-Regular' },
        fontSize: 28,
        leading: 65,
      },
      paragraphStyle: { justification: 'left' },
    },
  };
  const root = { size: { width: 1920, height: 1080 }, anchorPoint: { x: 0.5, y: 0.5 } };
  const layer = new PsdText(source, {}, root);
  layer.parseSource();
  const label = new CCLabel();
  label.updateWithLayer(layer);

  assert.equal(label._lineHeight, 65);
  assert.equal(label['_N$horizontalAlign'], 0);
  assert.equal(label._horizontalAlign, 0);
});
