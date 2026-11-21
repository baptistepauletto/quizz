// Spectrogram PNGs for eyeballing renders (log frequency 40 Hz–16 kHz, waveform strip on top).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SR, type Track } from './dsp';

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi, xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(b: Buffer) {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function color(v: number): [number, number, number] {
  const stops: Array<[number, number, number]> = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  const x = Math.min(0.9999, Math.max(0, v)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  return [0, 1, 2].map((c) => Math.round(stops[i][c] * (1 - f) + stops[i + 1][c] * f)) as [number, number, number];
}

export function writeSpectrogram(file: string, t: Track, pxPerSec = 160, height = 220) {
  const m = t.mono();
  const N = 2048;
  const width = Math.max(64, Math.round((m.length / SR) * pxPerSec));
  const wave = 50;
  const H = height + wave;
  const rgb = Buffer.alloc(width * H * 3);
  const hop = m.length / width;
  const fLo = Math.log(40), fHi = Math.log(16000);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let x = 0; x < width; x++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    const c = Math.round(x * hop);
    for (let i = 0; i < N; i++) re[i] = (m[c - N / 2 + i] ?? 0) * win[i];
    fft(re, im);
    for (let y = 0; y < height; y++) {
      const f = Math.exp(fLo + ((height - 1 - y) / (height - 1)) * (fHi - fLo));
      const bin = Math.min(N / 2 - 1, Math.round((f / SR) * N));
      const mag = Math.hypot(re[bin], im[bin]) / (N / 4);
      const dB = 20 * Math.log10(mag + 1e-9);
      const [r, g, b] = color((dB + 90) / 85);
      const o = ((y + wave) * width + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
    let lo = 0, hi = 0;
    for (let i = Math.round(x * hop); i < Math.round((x + 1) * hop) && i < m.length; i++) {
      lo = Math.min(lo, m[i]);
      hi = Math.max(hi, m[i]);
    }
    for (let y = 0; y < wave; y++) {
      const v = 1 - (2 * y) / (wave - 1);
      const on = v <= hi && v >= lo;
      const clip = Math.abs(v) > 0.97 && on;
      const o = (y * width + x) * 3;
      rgb[o] = clip ? 255 : on ? 120 : 16; rgb[o + 1] = clip ? 40 : on ? 200 : 16; rgb[o + 2] = clip ? 40 : on ? 255 : 24;
    }
  }
  const raw = Buffer.alloc((width * 3 + 1) * H);
  for (let y = 0; y < H; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
