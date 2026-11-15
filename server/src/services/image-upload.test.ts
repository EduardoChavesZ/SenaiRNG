import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { inspectImageBuffer, staticImageMimeTypes } from './image-upload.js';

test('accepts structurally valid PNG, JPEG, and WebP files', async () => {
  const fixtures = [
    { buffer: pngFixture(), mime: 'image/png', name: 'card.png' },
    { buffer: jpegFixture(), mime: 'image/jpeg', name: 'card.jpeg' },
    { buffer: webpFixture(), mime: 'image/webp', name: 'card.webp' }
  ] as const;

  for (const fixture of fixtures) {
    const result = await inspectImageBuffer(fixture.buffer, {
      allowedMimeTypes: staticImageMimeTypes,
      declaredMimeType: fixture.mime,
      originalName: fixture.name
    });
    assert.equal(result.mime, fixture.mime);
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);
    assert.equal(result.frames, 1);
  }
});

test('rejects MIME and extension mismatches instead of trusting upload headers', async () => {
  const png = pngFixture();
  await assert.rejects(
    inspectImageBuffer(png, { declaredMimeType: 'image/jpeg', originalName: 'card.png' }),
    /não corresponde/
  );
  await assert.rejects(
    inspectImageBuffer(png, { declaredMimeType: 'image/png', originalName: 'card.jpg' }),
    /extensão/
  );
});

test('rejects GIFs for card media while retaining GIF animation metadata for banners', async () => {
  const gif = gifFixture([5, 5]);
  await assert.rejects(
    inspectImageBuffer(gif, { allowedMimeTypes: staticImageMimeTypes, originalName: 'banner.gif' }),
    /não é permitido/
  );

  const result = await inspectImageBuffer(gif, {
    allowedMimeTypes: ['image/gif'],
    declaredMimeType: 'image/gif',
    originalName: 'banner.gif'
  });
  assert.equal(result.frames, 2);
  assert.equal(result.durationMs, 100);
});

test('rejects corrupt PNG data and truncated GIF blocks', async () => {
  const corruptPng = pngFixture();
  corruptPng[corruptPng.length - 13] = (corruptPng[corruptPng.length - 13] ?? 0) ^ 0xff;
  await assert.rejects(inspectImageBuffer(corruptPng), /integridade|dados comprimidos|dimensões/);
  await assert.rejects(inspectImageBuffer(gifFixture([5]).subarray(0, -2)), /incompleto|inválida/);
});

test('rejects oversized GIF animations and files', async () => {
  await assert.rejects(inspectImageBuffer(gifFixture(Array(121).fill(1))), /quadros/);
  await assert.rejects(inspectImageBuffer(gifFixture(Array(20).fill(100))), /segundos/);
  await assert.rejects(inspectImageBuffer(pngFixture(), { maxBytes: 16 }), /tamanho máximo/);
});

function pngFixture(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type, 'ascii');
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
    return Buffer.concat([header, typeBuffer, data, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function jpegFixture(): Buffer {
  const segment = (marker: number, data: Buffer) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(data.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, data]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x00, 0xff, 0xd9])
  ]);
}

function webpFixture(): Buffer {
  const image = Buffer.alloc(10);
  image[3] = 0x9d;
  image[4] = 0x01;
  image[5] = 0x2a;
  image.writeUInt16LE(1, 6);
  image.writeUInt16LE(1, 8);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(image.length);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(22);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBPVP8 '), size, image]);
}

function gifFixture(delays: number[]): Buffer {
  const frames = delays.flatMap((delay) => [
    Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 0xff, delay >>> 8, 0x00, 0x00]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0])
  ]);
  return Buffer.concat([
    Buffer.from('GIF89a'),
    Buffer.from([1, 0, 1, 0, 0x80, 0, 0]),
    Buffer.from([0, 0, 0, 255, 255, 255]),
    ...frames,
    Buffer.from([0x3b])
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
