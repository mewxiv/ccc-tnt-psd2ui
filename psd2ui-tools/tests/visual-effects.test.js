const test = require('node:test');
const assert = require('node:assert/strict');

require('ag-psd/initialize-canvas');
const canvas = require('canvas');
const { PsdImage } = require('../dist/psd/PsdImage');
const { PsdText } = require('../dist/psd/PsdText');
const { Parser } = require('../dist/Parser');
const { CCLabel } = require('../dist/engine/cc/CCLabel');
const { Color } = require('../dist/values/Color');

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

test('smart object color overlay is baked with its Photoshop blend mode', () => {
  const layerCanvas = canvas.createCanvas(2, 1);
  const context = layerCanvas.getContext('2d');
  context.fillStyle = '#f55933';
  context.fillRect(0, 0, 2, 1);
  const image = new PsdImage({
    name: 'smart-object-color-overlay',
    left: 0,
    top: 0,
    right: 2,
    bottom: 1,
    hidden: false,
    opacity: 1,
    canvas: layerCanvas,
    placedLayer: { transform: [0, 0, 2, 0, 2, 1, 0, 1] },
    effects: {
      solidFill: [{
        enabled: true,
        blendMode: 'color',
        opacity: 1,
        color: { r: 253, g: 122, b: 255 },
      }],
    },
  }, null, null);

  const pixel = image.source.canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  assert.ok(pixel[2] > pixel[0], `expected purple color overlay, got ${[...pixel]}`);
  assert.ok(pixel[0] > pixel[1], `expected purple color overlay, got ${[...pixel]}`);
});

test('bitmap layer mask is baked in document coordinates and trims transparent pixels', () => {
  const layerCanvas = canvas.createCanvas(6, 4);
  layerCanvas.getContext('2d').fillRect(0, 0, 6, 4);
  const maskCanvas = canvas.createCanvas(4, 4);
  const maskContext = maskCanvas.getContext('2d');
  maskContext.fillStyle = '#ffffff';
  maskContext.fillRect(0, 0, 4, 4);

  const image = new PsdImage({
    name: 'masked-image',
    left: 10,
    top: 20,
    right: 16,
    bottom: 24,
    hidden: false,
    opacity: 1,
    canvas: layerCanvas,
    mask: {
      left: 12,
      top: 20,
      right: 16,
      bottom: 24,
      defaultColor: 0,
      disabled: false,
      positionRelativeToLayer: false,
      canvas: maskCanvas,
    },
  }, null, null);

  assert.deepEqual([image.source.canvas.width, image.source.canvas.height], [4, 4]);
  assert.deepEqual(
    [image.rect.left, image.rect.top, image.rect.right, image.rect.bottom],
    [12, 20, 16, 24]
  );
});

test('Photoshop fill opacity becomes the exported node opacity', () => {
  const image = new PsdImage(sourceWithEffects({}, 0.30196078431372547), null, null);
  image.parent = {};
  image.parseSource();
  assert.equal(image.opacity, 77);
});

test('Photoshop floating point color channels use nearest-byte quantization', () => {
  const color = new Color(105.00135, 93.9981, 77.00235, 255);
  assert.deepEqual([color.r, color.g, color.b, color.a], [105, 94, 77, 255]);
  assert.equal(color.toHEX(), '695e4d');
});

test('only gradient text effects require rasterized text output', () => {
  const parser = new Parser();
  assert.equal(parser.shouldRasterizeText({
    effects: { gradientOverlay: [{ enabled: true }] },
  }), true);
  assert.equal(parser.shouldRasterizeText({
    effects: { dropShadow: [{ enabled: true }] },
  }), false);
  assert.equal(parser.shouldRasterizeText({
    effects: { disabled: true, gradientOverlay: [{ enabled: true }] },
  }), false);
});

test('disabled Photoshop effects do not create a text outline', () => {
  const text = new PsdText({
    name: 'disabled-outline',
    left: 0, top: 0, right: 100, bottom: 20,
    hidden: false,
    opacity: 1,
    text: {
      text: 'no outline',
      style: { fontSize: 20, fillColor: { r: 255, g: 255, b: 255, a: 1 } },
    },
    effects: {
      disabled: true,
      stroke: [{
        enabled: true,
        position: 'outside',
        fillType: 'color',
        size: { value: 3 },
        opacity: 1,
        color: { r: 0, g: 0, b: 0 },
      }],
    },
  }, null, { size: { height: 100 } });

  text.parseSource();
  assert.equal(text.outline, undefined);
});

test('text inherits an active outside color stroke from its Photoshop group', () => {
  const root = { size: { height: 100 } };
  const group = {
    parent: null,
    source: {
      effects: {
        stroke: [{
          enabled: true,
          position: 'outside',
          fillType: 'color',
          size: { value: 2 },
          opacity: 1,
          color: { r: 255, g: 0, b: 0.02 },
        }],
      },
    },
  };
  const text = new PsdText({
    name: 'group-outline',
    left: 0, top: 0, right: 100, bottom: 20,
    hidden: false,
    opacity: 1,
    text: {
      text: 'red outline',
      style: { fontSize: 20, fillColor: { r: 255, g: 255, b: 255, a: 1 } },
    },
  }, group, root);

  text.parseSource();
  assert.equal(text.outline.width, 2);
  assert.deepEqual(
    [text.outline.color.r, text.outline.color.g, text.outline.color.b, text.outline.color.a],
    [255, 0, 0, 255]
  );
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

test('clipping chain bakes the shared base alpha before image registration', () => {
  const baseCanvas = canvas.createCanvas(4, 3);
  const baseContext = baseCanvas.getContext('2d');
  const basePixels = baseContext.createImageData(4, 3);
  const alpha = [
    0, 0, 0, 0,
    0, 128, 255, 0,
    0, 0, 0, 0,
  ];
  alpha.forEach((value, index) => {
    basePixels.data[index * 4] = 255;
    basePixels.data[index * 4 + 3] = value;
  });
  baseContext.putImageData(basePixels, 0, 0);

  function clippedCanvas(color, opacity) {
    const result = canvas.createCanvas(6, 4);
    const context = result.getContext('2d');
    context.fillStyle = color;
    context.globalAlpha = opacity;
    context.fillRect(0, 0, 6, 4);
    return result;
  }

  const parser = new Parser();
  const document = parser.parseLayer({
    name: 'document',
    width: 30,
    height: 20,
    children: [{
      name: 'group',
      children: [{
        name: 'base',
        left: 12,
        top: 8,
        right: 16,
        bottom: 11,
        hidden: false,
        opacity: 1,
        canvas: baseCanvas,
      }, {
        name: 'first-clipped',
        left: 10,
        top: 7,
        right: 16,
        bottom: 11,
        hidden: false,
        opacity: 1,
        clipping: true,
        canvas: clippedCanvas('#ff0000', 1),
      }, {
        name: 'second-clipped',
        left: 11,
        top: 8,
        right: 17,
        bottom: 12,
        hidden: false,
        opacity: 1,
        clipping: true,
        canvas: clippedCanvas('#0000ff', 0.5),
      }],
    }],
  });

  const [, first, second] = document.children[0].children;
  assert.deepEqual(
    [first.source.left, first.source.top, first.source.right, first.source.bottom],
    [13, 9, 15, 10]
  );
  assert.deepEqual([first.source.canvas.width, first.source.canvas.height], [2, 1]);
  assert.deepEqual([...first.source.canvas.getContext('2d').getImageData(0, 0, 2, 1).data], [
    255, 0, 0, 128,
    255, 0, 0, 255,
  ]);

  assert.deepEqual(
    [second.source.left, second.source.top, second.source.right, second.source.bottom],
    [13, 9, 15, 10]
  );
  assert.deepEqual([second.source.canvas.width, second.source.canvas.height], [2, 1]);
  assert.deepEqual([...second.source.canvas.getContext('2d').getImageData(0, 0, 2, 1).data], [
    0, 0, 255, 64,
    0, 0, 255, 128,
  ]);
  assert.deepEqual([first.size.width, first.size.height], [2, 1]);
  assert.deepEqual([second.size.width, second.size.height], [2, 1]);
  assert.deepEqual([first.textureSize.width, first.textureSize.height], [2, 1]);
  assert.deepEqual([second.textureSize.width, second.textureSize.height], [2, 1]);
  assert.notEqual(first.md5, second.md5);
});

test('fully transparent clipping result keeps the node with a 1x1 texture', () => {
  const baseCanvas = canvas.createCanvas(2, 2);
  const clippedCanvas = canvas.createCanvas(2, 2);
  clippedCanvas.getContext('2d').fillRect(0, 0, 2, 2);

  const parser = new Parser();
  const document = parser.parseLayer({
    name: 'document',
    width: 10,
    height: 10,
    children: [{
      name: 'group',
      children: [{
        name: 'transparent-base',
        left: 4,
        top: 5,
        right: 6,
        bottom: 7,
        hidden: false,
        opacity: 1,
        canvas: baseCanvas,
      }, {
        name: 'clipped',
        left: 4,
        top: 5,
        right: 6,
        bottom: 7,
        hidden: false,
        opacity: 1,
        clipping: true,
        canvas: clippedCanvas,
      }],
    }],
  });

  const clipped = document.children[0].children[1];
  assert.deepEqual([clipped.source.canvas.width, clipped.source.canvas.height], [1, 1]);
  assert.deepEqual(
    [clipped.source.left, clipped.source.top, clipped.source.right, clipped.source.bottom],
    [4, 5, 5, 6]
  );
  assert.deepEqual([...clipped.source.canvas.getContext('2d').getImageData(0, 0, 1, 1).data], [0, 0, 0, 0]);
});

test('unsupported clipping base warns and preserves the original clipped layer', () => {
  const clippedCanvas = canvas.createCanvas(3, 2);
  clippedCanvas.getContext('2d').fillRect(0, 0, 3, 2);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const parser = new Parser();
    const document = parser.parseLayer({
      name: 'document',
      width: 10,
      height: 10,
      children: [{
        name: 'group',
        children: [{
          name: 'base-group',
          children: [],
        }, {
          name: 'clipped',
          left: 2,
          top: 3,
          right: 5,
          bottom: 5,
          hidden: false,
          opacity: 1,
          clipping: true,
          canvas: clippedCanvas,
        }],
      }],
    });

    const clipped = document.children[0].children[1];
    assert.deepEqual([clipped.source.canvas.width, clipped.source.canvas.height], [3, 2]);
    assert.deepEqual(
      [clipped.source.left, clipped.source.top, clipped.source.right, clipped.source.bottom],
      [2, 3, 5, 5]
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((message) => message.includes('document/group/clipped')));
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
