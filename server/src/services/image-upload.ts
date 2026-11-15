import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export const staticImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const allImageMimeTypes = [...staticImageMimeTypes, 'image/gif'] as const;
export type ImageMimeType = typeof allImageMimeTypes[number];

const imageDirectory = fileURLToPath(new URL('../../uploads/', import.meta.url));
const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

export interface UploadedImageMetadata {
  filename: string;
  imagePath: string;
  mime: ImageMimeType;
  bytes: number;
  width: number;
  height: number;
  frames: number;
  durationMs: number;
}

interface ImageInspectionOptions {
  allowedMimeTypes?: readonly ImageMimeType[];
  declaredMimeType?: string;
  originalName?: string;
  maxBytes?: number;
}

const uploadForImages = (allowedMimeTypes: readonly ImageMimeType[]) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype as ImageMimeType)) {
      const formats = allowedMimeTypes.includes('image/gif')
        ? 'PNG, JPG, WebP ou GIF'
        : 'PNG, JPG ou WebP';
      callback(new AppError(`Formato inválido. Use ${formats}.`, 400));
      return;
    }
    callback(null, true);
  }
});

export const imageUpload = uploadForImages(allImageMimeTypes);
export const cardImageUpload = uploadForImages(staticImageMimeTypes);
export const bannerImageUpload = uploadForImages(allImageMimeTypes);

export async function inspectImageBuffer(
  buffer: Buffer,
  options: ImageInspectionOptions = {}
): Promise<Omit<UploadedImageMetadata, 'filename' | 'imagePath' | 'bytes'> & { mime: ImageMimeType; extension: string }> {
  const allowedMimeTypes = options.allowedMimeTypes ?? allImageMimeTypes;
  const maxBytes = options.maxBytes ?? config.UPLOAD_MAX_BYTES;
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new AppError('O arquivo está vazio ou excede o tamanho máximo permitido.', 400);
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !allImageMimeTypes.includes(detected.mime as ImageMimeType)) {
    throw new AppError('O conteúdo do arquivo não corresponde a uma imagem permitida.', 400);
  }
  if (!allowedMimeTypes.includes(detected.mime as ImageMimeType)) {
    throw new AppError('Este formato de imagem não é permitido para este cadastro.', 400);
  }
  if (options.declaredMimeType && options.declaredMimeType !== detected.mime) {
    throw new AppError('O tipo informado não corresponde ao conteúdo real do arquivo.', 400);
  }
  if (options.originalName) {
    const extension = path.extname(options.originalName).toLowerCase();
    const acceptedExtensions: Record<ImageMimeType, string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif']
    };
    if (!acceptedExtensions[detected.mime as ImageMimeType].includes(extension)) {
      throw new AppError('A extensão do arquivo não corresponde ao formato da imagem.', 400);
    }
  }

  const mime = detected.mime as ImageMimeType;
  const dimensions = mime === 'image/png'
    ? inspectPng(buffer)
    : mime === 'image/jpeg'
      ? inspectJpeg(buffer)
      : mime === 'image/webp'
        ? inspectWebp(buffer)
        : inspectGif(buffer);
  assertImageDimensions(dimensions.width, dimensions.height);

  if (mime === 'image/gif') {
    if (dimensions.frames > config.BANNER_GIF_MAX_FRAMES) {
      throw new AppError(`O GIF excede o limite de ${config.BANNER_GIF_MAX_FRAMES} quadros.`, 400);
    }
    if (dimensions.durationMs > config.BANNER_GIF_MAX_DURATION_MS) {
      throw new AppError(`A animação do GIF excede o limite de ${config.BANNER_GIF_MAX_DURATION_MS / 1000} segundos.`, 400);
    }
  }

  return { ...dimensions, mime, extension: detected.ext };
}

export async function saveUploadedImage(
  buffer: Buffer,
  profileOwnerId?: string,
  options: ImageInspectionOptions = {}
): Promise<UploadedImageMetadata> {
  const metadata = await inspectImageBuffer(buffer, options);
  const filename = `${randomUUID()}.${metadata.extension}`;
  const directory = profileOwnerId
    ? path.join(imageDirectory, 'profiles', profileOwnerId)
    : imageDirectory;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), buffer, { flag: 'wx' });

  return {
    filename,
    imagePath: profileOwnerId
      ? `/uploads/profiles/${profileOwnerId}/${filename}`
      : `/uploads/${filename}`,
    mime: metadata.mime,
    bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    frames: metadata.frames,
    durationMs: metadata.durationMs
  };
}

export async function inspectSavedImage(
  imagePath: string,
  allowedMimeTypes: readonly ImageMimeType[]
): Promise<UploadedImageMetadata> {
  const match = /^\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/i.exec(imagePath);
  if (!match) throw new AppError('O caminho da imagem enviada não é válido.', 400);

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(imageDirectory, match[1]!));
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      throw new AppError('A imagem enviada não foi encontrada no armazenamento.', 400);
    }
    throw cause;
  }
  const metadata = await inspectImageBuffer(buffer, {
    allowedMimeTypes,
    originalName: match[1]
  });
  return {
    filename: match[1]!,
    imagePath,
    mime: metadata.mime,
    bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    frames: metadata.frames,
    durationMs: metadata.durationMs
  };
}

function assertImageDimensions(width: number, height: number): void {
  if (
    width < 1
    || height < 1
    || width > config.UPLOAD_MAX_DIMENSION
    || height > config.UPLOAD_MAX_DIMENSION
    || width * height > config.UPLOAD_MAX_PIXELS
  ) {
    throw new AppError(
      `A imagem deve ter no máximo ${config.UPLOAD_MAX_DIMENSION}px por lado e ${config.UPLOAD_MAX_PIXELS.toLocaleString('pt-BR')} pixels.`,
      400
    );
  }
}

function inspectPng(buffer: Buffer): { width: number; height: number; frames: number; durationMs: number } {
  if (buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new AppError('O arquivo PNG está incompleto ou malformado.', 400);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  let hasEnd = false;
  let channels = 0;
  let bitDepth = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > buffer.length) throw new AppError('O arquivo PNG está incompleto ou malformado.', 400);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + chunkLength);
    const actualCrc = crc32(buffer.subarray(offset + 4, offset + 8 + chunkLength));
    if (expectedCrc !== actualCrc) throw new AppError('A integridade do arquivo PNG não foi confirmada.', 400);

    if (offset === 8) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) throw new AppError('O cabeçalho PNG é inválido.', 400);
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      bitDepth = buffer[offset + 16]!;
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[buffer[offset + 17]!] ?? 0;
      interlace = buffer[offset + 20]!;
      if (
        channels === 0
        || !validPngBitDepth(buffer[offset + 17]!, bitDepth)
        || buffer[offset + 18] !== 0
        || buffer[offset + 19] !== 0
        || interlace > 1
      ) {
        throw new AppError('Os parâmetros do cabeçalho PNG são inválidos.', 400);
      }
    } else if (chunkType === 'IHDR') {
      throw new AppError('O arquivo PNG contém mais de um cabeçalho.', 400);
    }
    if (chunkType === 'IDAT' && chunkLength > 0) {
      hasImageData = true;
      imageData.push(buffer.subarray(offset + 8, offset + 8 + chunkLength));
    }
    offset = chunkEnd;
    if (chunkType === 'IEND') {
      if (chunkLength !== 0 || offset !== buffer.length) throw new AppError('O final do arquivo PNG é inválido.', 400);
      hasEnd = true;
      break;
    }
  }
  if (!hasEnd || !hasImageData) throw new AppError('O arquivo PNG não contém uma imagem completa.', 400);
  assertImageDimensions(width, height);
  const expectedLength = pngRawDataLength(width, height, channels, bitDepth, interlace);
  let rawData: Buffer;
  try {
    rawData = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedLength });
  } catch {
    throw new AppError('Os dados comprimidos do PNG são inválidos ou excedem as dimensões declaradas.', 400);
  }
  if (rawData.length !== expectedLength) throw new AppError('Os dados do PNG não correspondem às dimensões declaradas.', 400);
  validatePngFilters(rawData, width, height, channels, bitDepth, interlace);
  return { width, height, frames: 1, durationMs: 0 };
}

function validPngBitDepth(colorType: number, bitDepth: number): boolean {
  const allowed: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  return allowed[colorType]?.includes(bitDepth) ?? false;
}

function pngRawDataLength(width: number, height: number, channels: number, bitDepth: number, interlace: number): number {
  const passes = interlace === 1
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  return passes.reduce((total, [startX, startY, stepX, stepY]) => {
    const passWidth = width > startX! ? Math.ceil((width - startX!) / stepX!) : 0;
    const passHeight = height > startY! ? Math.ceil((height - startY!) / stepY!) : 0;
    if (passWidth === 0 || passHeight === 0) return total;
    return total + Math.ceil(passWidth * channels * bitDepth / 8 + 1) * passHeight;
  }, 0);
}

function validatePngFilters(
  rawData: Buffer,
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
  interlace: number
): void {
  const passes = interlace === 1
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let offset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width > startX! ? Math.ceil((width - startX!) / stepX!) : 0;
    const passHeight = height > startY! ? Math.ceil((height - startY!) / stepY!) : 0;
    if (passWidth === 0 || passHeight === 0) continue;
    const rowLength = Math.ceil(passWidth * channels * bitDepth / 8) + 1;
    for (let row = 0; row < passHeight; row += 1) {
      if (rawData[offset]! > 4) throw new AppError('O PNG contém um filtro de linha inválido.', 400);
      offset += rowLength;
    }
  }
}

function inspectJpeg(buffer: Buffer): { width: number; height: number; frames: number; durationMs: number } {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new AppError('O arquivo JPEG está incompleto ou malformado.', 400);
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let hasEnd = false;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new AppError('A estrutura do arquivo JPEG é inválida.', 400);
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined) break;
    if (marker === 0xd9) {
      hasEnd = offset === buffer.length;
      break;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw new AppError('O arquivo JPEG está incompleto ou malformado.', 400);
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new AppError('O arquivo JPEG está incompleto ou malformado.', 400);
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) throw new AppError('O quadro JPEG é inválido.', 400);
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }
    offset += segmentLength;
    if (marker === 0xda) {
      while (offset + 1 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let next = offset + 1;
        while (buffer[next] === 0xff) next += 1;
        const nextMarker = buffer[next];
        if (nextMarker === 0x00 || (nextMarker !== undefined && nextMarker >= 0xd0 && nextMarker <= 0xd7)) {
          offset = next + 1;
          continue;
        }
        break;
      }
    }
  }
  if (!hasEnd || width === 0 || height === 0) throw new AppError('O arquivo JPEG não contém uma imagem completa.', 400);
  return { width, height, frames: 1, durationMs: 0 };
}

function isJpegStartOfFrame(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function inspectWebp(buffer: Buffer): { width: number; height: number; frames: number; durationMs: number } {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
    || buffer.readUInt32LE(4) + 8 !== buffer.length
  ) {
    throw new AppError('O arquivo WebP está incompleto ou malformado.', 400);
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let hasImageChunk = false;
  let animated = false;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + chunkLength + (chunkLength % 2);
    if (chunkEnd > buffer.length) throw new AppError('O arquivo WebP está incompleto ou malformado.', 400);
    if (chunkType === 'VP8X' && chunkLength >= 10) {
      width = readUInt24LE(buffer, dataStart + 4) + 1;
      height = readUInt24LE(buffer, dataStart + 7) + 1;
    } else if (chunkType === 'VP8 ' && chunkLength >= 10) {
      if (buffer[dataStart + 3] !== 0x9d || buffer[dataStart + 4] !== 0x01 || buffer[dataStart + 5] !== 0x2a) {
        throw new AppError('O quadro WebP é inválido.', 400);
      }
      width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      hasImageChunk = true;
    } else if (chunkType === 'VP8L' && chunkLength >= 5) {
      if (buffer[dataStart] !== 0x2f) throw new AppError('O quadro WebP é inválido.', 400);
      const bits = buffer.readUInt32LE(dataStart + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasImageChunk = true;
    } else if (chunkType === 'ANMF') {
      hasImageChunk = true;
      animated = true;
    } else if (chunkType === 'ANIM') {
      animated = true;
    }
    offset = chunkEnd;
  }
  if (offset !== buffer.length || !hasImageChunk || animated || width === 0 || height === 0) {
    throw new AppError('O arquivo WebP não contém uma imagem completa.', 400);
  }
  return { width, height, frames: 1, durationMs: 0 };
}

function inspectGif(buffer: Buffer): { width: number; height: number; frames: number; durationMs: number } {
  const signature = buffer.toString('ascii', 0, 6);
  if (buffer.length < 14 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
    throw new AppError('O arquivo GIF está incompleto ou malformado.', 400);
  }
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10]!;
  let offset = 13;
  if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
  if (offset > buffer.length) throw new AppError('O cabeçalho GIF está incompleto.', 400);

  let frames = 0;
  let durationMs = 0;
  let frameDelay = 0;
  let hasEnd = false;
  while (offset < buffer.length) {
    const block = buffer[offset]!;
    offset += 1;
    if (block === 0x3b) {
      hasEnd = offset === buffer.length;
      break;
    }
    if (block === 0x21) {
      const label = buffer[offset];
      offset += 1;
      if (label === 0xf9) {
        if (buffer[offset] !== 4 || offset + 6 > buffer.length) {
          throw new AppError('O controle de quadros GIF é inválido.', 400);
        }
        frameDelay = buffer.readUInt16LE(offset + 2);
        if (buffer[offset + 5] !== 0) throw new AppError('A extensão GIF está incompleta.', 400);
        offset += 6;
      } else {
        offset = skipGifSubBlocks(buffer, offset);
      }
      continue;
    }
    if (block !== 0x2c || offset + 9 > buffer.length) {
      throw new AppError('A estrutura do arquivo GIF é inválida.', 400);
    }
    const left = buffer.readUInt16LE(offset);
    const top = buffer.readUInt16LE(offset + 2);
    const frameWidth = buffer.readUInt16LE(offset + 4);
    const frameHeight = buffer.readUInt16LE(offset + 6);
    const imagePacked = buffer[offset + 8]!;
    if (frameWidth === 0 || frameHeight === 0 || left + frameWidth > width || top + frameHeight > height) {
      throw new AppError('As dimensões de um quadro GIF são inválidas.', 400);
    }
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
    if (offset >= buffer.length || buffer[offset]! < 2 || buffer[offset]! > 8) {
      throw new AppError('A codificação do quadro GIF é inválida.', 400);
    }
    offset = skipGifSubBlocks(buffer, offset + 1);
    frames += 1;
    durationMs += Math.max(frameDelay * 10, 10);
    frameDelay = 0;
  }
  if (!hasEnd || frames === 0) throw new AppError('O arquivo GIF não contém uma animação completa.', 400);
  return { width, height, frames, durationMs };
}

function skipGifSubBlocks(buffer: Buffer, start: number): number {
  let offset = start;
  while (offset < buffer.length) {
    const length = buffer[offset]!;
    offset += 1;
    if (length === 0) return offset;
    offset += length;
    if (offset > buffer.length) break;
  }
  throw new AppError('O arquivo GIF contém dados incompletos.', 400);
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ pngCrcTable[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}
