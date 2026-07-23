const test = require('node:test');
const assert = require('node:assert/strict');

const { imageMgr } = require('../dist/assets-manager/ImageMgr');

function image({ name, md5, imgName = name }) {
  return {
    name,
    md5,
    imgName,
    attr: { comps: {} },
    source: { name },
    isIgnore() { return false; },
    isBind() { return false; },
  };
}

test.afterEach(() => imageMgr.clear());

test('same layer name with different pixels receives separate export identities', () => {
  const background = image({ name: 'TuCeng_5', md5: 'md5-background' });
  const actor = image({ name: 'TuCeng_5', md5: 'md5-actor' });

  imageMgr.add(background);
  imageMgr.add(actor);

  assert.equal(background.imgName, 'TuCeng_5');
  assert.equal(actor.imgName, 'TuCeng_5_R0');
  assert.deepEqual([...imageMgr.getAllImage().keys()], ['md5-background', 'md5-actor']);
});

test('same layer name with identical pixels reuses one export identity', () => {
  const first = image({ name: 'button', md5: 'md5-button' });
  const duplicate = image({ name: 'button', md5: 'md5-button' });

  imageMgr.add(first);
  imageMgr.add(duplicate);

  assert.equal(first.imgName, 'button');
  assert.equal(duplicate.imgName, 'button');
  assert.equal(imageMgr.getAllImage().size, 1);
});

test('clearing between PSD exports releases reserved image names', () => {
  const firstDocument = image({ name: 'shared', md5: 'md5-first' });
  imageMgr.add(firstDocument);
  imageMgr.clear();

  const secondDocument = image({ name: 'shared', md5: 'md5-second' });
  imageMgr.add(secondDocument);

  assert.equal(secondDocument.imgName, 'shared');
  assert.deepEqual([...imageMgr.getAllImage().keys()], ['md5-second']);
});
