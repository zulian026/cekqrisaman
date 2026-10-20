import { describe, it, expect } from 'vitest';
import { parseQris, crc16Ccitt, assessPayload, compareWithReference } from '../src/lib/qris';

// Vectors generated and CRC-signed with an independent Python implementation
// of CRC-16/CCITT-FALSE — cross-checks the TypeScript implementation.
const STATIC_QRIS =
  '00020101021126610014ID.CO.QRIS.WWW01189360091534567890120210ML123456780303UMI5204541153033605802ID5916TOKO BERKAH JAYA6007JAKARTA61051011062200306TOKO010706KASIR16304C352';
const DYNAMIC_QRIS =
  '00020101021226610014ID.CO.QRIS.WWW01189360091534567890120210ML123456780303UMI5204541153033605405250005802ID5922WARUNG MAKAN SEDERHANA6007BANDUNG61051011062200306TOKO010706KASIR16304EC6E';
const TAMPERED_QRIS = STATIC_QRIS.replace('BERKAH', 'BERKAX');

describe('crc16Ccitt', () => {
  it('matches the independent vector for the static payload', () => {
    const body = STATIC_QRIS.slice(0, STATIC_QRIS.length - 4);
    expect(crc16Ccitt(body)).toBe('C352');
  });
  it('matches the independent vector for the dynamic payload', () => {
    const body = DYNAMIC_QRIS.slice(0, DYNAMIC_QRIS.length - 4);
    expect(crc16Ccitt(body)).toBe('EC6E');
  });
});

describe('parseQris — static', () => {
  const d = parseQris(STATIC_QRIS);
  it('reads merchant identity', () => {
    expect(d.merchantName).toBe('TOKO BERKAH JAYA');
    expect(d.merchantCity).toBe('JAKARTA');
    expect(d.qrisAccount?.globalId).toBe('ID.CO.QRIS.WWW');
    expect(d.qrisAccount?.merchantPan).toBe('936009153456789012');
    expect(d.qrisAccount?.merchantId).toBe('ML12345678');
  });
  it('reads classification fields', () => {
    expect(d.merchantCategoryCode).toBe('5411');
    expect(d.currencyCode).toBe('360');
    expect(d.countryCode).toBe('ID');
    expect(d.isDynamic).toBe(false);
    expect(d.amount).toBeUndefined();
  });
  it('reads additional data template', () => {
    expect(d.additionalData['03']).toBe('TOKO01');
    expect(d.additionalData['07']).toBe('KASIR1');
  });
  it('validates CRC', () => {
    expect(d.crcValue).toBe('C352');
    expect(d.crcValid).toBe(true);
  });
});

describe('parseQris — dynamic', () => {
  const d = parseQris(DYNAMIC_QRIS);
  it('detects dynamic QR and locked amount', () => {
    expect(d.isDynamic).toBe(true);
    expect(d.amount).toBe('25000');
    expect(d.merchantName).toBe('WARUNG MAKAN SEDERHANA');
    expect(d.crcValid).toBe(true);
  });
});

describe('assessPayload', () => {
  it('passes a valid static QRIS', () => {
    const r = assessPayload(STATIC_QRIS);
    expect(r.verdict).toBe('SESUAI_STRUKTUR');
    expect(r.score).toBe(0);
  });
  it('flags a tampered payload via CRC mismatch', () => {
    const r = assessPayload(TAMPERED_QRIS);
    expect(r.verdict).toBe('BERISIKO_TINGGI');
    expect(r.signals.some((s) => s.title.includes('CRC'))).toBe(true);
  });
  it('flags a URL as quishing, not QRIS', () => {
    const r = assessPayload('https://qris-palsu.example.com/bayar');
    expect(r.verdict).toBe('BUKAN_QRIS');
    expect(r.score).toBe(100);
  });
  it('flags plain text as not QRIS', () => {
    const r = assessPayload('transfer ke nomor ini ya');
    expect(r.verdict).toBe('BUKAN_QRIS');
  });
  it('flags a structurally broken EMV-looking payload', () => {
    const r = assessPayload('0002010102ZZZZ');
    expect(['BERISIKO_TINGGI', 'BUKAN_QRIS']).toContain(r.verdict);
  });
});

describe('compareWithReference', () => {
  it('reports an identical sticker as a perfect match', () => {
    const c = compareWithReference(STATIC_QRIS, STATIC_QRIS);
    expect(c.identical).toBe(true);
    expect(c.nameMatches).toBe(true);
    expect(c.diffs).toHaveLength(0);
  });
  it('detects a swapped merchant id (sticker replaced)', () => {
    const swapped = STATIC_QRIS.replace('ML12345678', 'ML87654321');
    const c = compareWithReference(STATIC_QRIS, swapped);
    expect(c.identical).toBe(false);
    expect(c.diffs.map((d) => d.field)).toContain('ID merchant');
  });
  it('detects a different merchant entirely', () => {
    const c = compareWithReference(STATIC_QRIS, DYNAMIC_QRIS);
    expect(c.identical).toBe(false);
    expect(c.nameMatches).toBe(false);
    expect(c.diffs.map((d) => d.field)).toContain('Nama merchant');
  });
  it('handles a non-QRIS scan without throwing', () => {
    const c = compareWithReference(STATIC_QRIS, 'https://qris-palsu.example.com/bayar');
    expect(c.identical).toBe(false);
    expect(c.nameMatches).toBe(false);
    expect(c.diffs.length).toBeGreaterThan(0);
  });
});
