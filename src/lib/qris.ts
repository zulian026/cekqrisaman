/**
 * QRIS / EMVCo payload parser + CRC validation + rule-based risk engine.
 * Pure TypeScript, no dependencies — runs entirely in the visitor's browser.
 *
 * EMV TLV layout: [2-digit tag][2-digit length][value], nested templates for
 * merchant account information (tags 26–51), additional data (62), etc.
 */

export interface EmvField {
  tag: string;
  value: string;
  children?: EmvField[];
}

const TEMPLATE_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(26 + i)), // 26–51 merchant account templates
  '62', // additional data field template
  '64', // merchant information — language template
  '65', '66', '67', '68', '69', '70', '71', '72', '73', '74', '75', '76', '77', '78', '79', // RFU templates
]);

export function parseTlv(data: string): EmvField[] {
  const fields: EmvField[] = [];
  let i = 0;
  while (i + 4 <= data.length) {
    const tag = data.slice(i, i + 2);
    const lenStr = data.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) {
      throw new Error(`Struktur EMV rusak pada posisi ${i}`);
    }
    const len = Number(lenStr);
    const value = data.slice(i + 4, i + 4 + len);
    if (value.length < len) throw new Error(`Nilai tag ${tag} terpotong`);
    const field: EmvField = { tag, value };
    if (TEMPLATE_TAGS.has(tag)) {
      try {
        field.children = parseTlv(value);
      } catch {
        /* keep raw value if sub-structure is not valid TLV */
      }
    }
    fields.push(field);
    i += 4 + len;
  }
  if (i !== data.length) throw new Error('Payload memiliki sisa byte yang tidak terbaca');
  return fields;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000. */
export function crc16Ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function get(fields: EmvField[] | undefined, tag: string): string | undefined {
  return fields?.find((f) => f.tag === tag)?.value;
}

function getField(fields: EmvField[] | undefined, tag: string): EmvField | undefined {
  return fields?.find((f) => f.tag === tag);
}

export interface MerchantAccount {
  templateTag: string;
  globalId?: string;
  merchantPan?: string;
  merchantId?: string;
  merchantCategory?: string;
  raw: string;
}

export interface QrisData {
  raw: string;
  fields: EmvField[];
  payloadFormat?: string;
  /** 11 = static QR, 12 = dynamic QR */
  pointOfInitiation?: string;
  isDynamic: boolean;
  merchantAccounts: MerchantAccount[];
  qrisAccount?: MerchantAccount;
  merchantCategoryCode?: string;
  currencyCode?: string;
  amount?: string;
  tipIndicator?: string;
  countryCode?: string;
  merchantName?: string;
  merchantCity?: string;
  postalCode?: string;
  additionalData: Record<string, string>;
  crcValue?: string;
  crcExpected?: string;
  crcValid: boolean;
}

export function parseQris(rawInput: string): QrisData {
  const raw = rawInput.trim();
  const fields = parseTlv(raw);

  const merchantAccounts: MerchantAccount[] = [];
  for (let t = 26; t <= 51; t++) {
    const f = getField(fields, String(t));
    if (!f) continue;
    merchantAccounts.push({
      templateTag: String(t),
      globalId: get(f.children, '00'),
      merchantPan: get(f.children, '01'),
      merchantId: get(f.children, '02'),
      merchantCategory: get(f.children, '03'),
      raw: f.value,
    });
  }
  const qrisAccount =
    merchantAccounts.find((a) => (a.globalId ?? '').toUpperCase().includes('QRIS')) ??
    merchantAccounts.find((a) => (a.globalId ?? '').toUpperCase().startsWith('ID.CO'));

  const addField = getField(fields, '62');
  const additionalData: Record<string, string> = {};
  for (const child of addField?.children ?? []) additionalData[child.tag] = child.value;

  const crcValue = get(fields, '63');
  let crcExpected: string | undefined;
  let crcValid = false;
  const crcIdx = raw.toUpperCase().lastIndexOf('6304');
  if (crcIdx >= 0 && crcValue && crcValue.length === 4) {
    crcExpected = crc16Ccitt(raw.slice(0, crcIdx + 4));
    crcValid = crcExpected === crcValue.toUpperCase();
  }

  const poi = get(fields, '01');
  return {
    raw,
    fields,
    payloadFormat: get(fields, '00'),
    pointOfInitiation: poi,
    isDynamic: poi === '12',
    merchantAccounts,
    qrisAccount,
    merchantCategoryCode: get(fields, '52'),
    currencyCode: get(fields, '53'),
    amount: get(fields, '54'),
    tipIndicator: get(fields, '55'),
    countryCode: get(fields, '58'),
    merchantName: get(fields, '59'),
    merchantCity: get(fields, '60'),
    postalCode: get(fields, '61'),
    additionalData,
    crcValue,
    crcExpected,
    crcValid,
  };
}

export const MCC_LABELS: Record<string, string> = {
  '5411': 'Toko kelontong / supermarket',
  '5499': 'Toko makanan serba ada',
  '5812': 'Tempat makan / restoran',
  '5814': 'Restoran cepat saji',
  '5912': 'Apotek',
  '5999': 'Ritel lain-lain',
  '4900': 'Utilitas (listrik/air/gas)',
  '4814': 'Telekomunikasi',
  '6011': 'Layanan keuangan',
  '8011': 'Praktik dokter',
  '8062': 'Rumah sakit',
  '8211': 'Sekolah',
  '9399': 'Layanan pemerintah',
  '0000': 'Tidak dikategorikan',
};

export const ADDITIONAL_DATA_LABELS: Record<string, string> = {
  '01': 'Nomor tagihan / invoice',
  '02': 'Nomor ponsel konsumen',
  '03': 'Label toko',
  '04': 'Nomor loyalitas',
  '05': 'Label referensi',
  '06': 'Label konsumen',
  '07': 'Label terminal',
  '08': 'Tujuan transaksi',
  '09': 'Permintaan data konsumen',
};

/* ------------------------------ Risk engine ------------------------------ */

export type SignalLevel = 'danger' | 'warn' | 'ok' | 'info';

export interface RiskSignal {
  level: SignalLevel;
  title: string;
  detail: string;
}

export type Verdict = 'BUKAN_QRIS' | 'BERISIKO_TINGGI' | 'PERIKSA_LAGI' | 'SESUAI_STRUKTUR';

export interface RiskReport {
  verdict: Verdict;
  score: number; // 0 = bersih, 100 = sangat berisiko
  signals: RiskSignal[];
  data?: QrisData;
  parseError?: string;
}

const URL_RE = /https?:\/\/|www\.|\.com\b|\.id\b|\.xyz\b|\.top\b|\.link\b/i;

export function assessPayload(rawInput: string): RiskReport {
  const raw = (rawInput ?? '').trim();
  const signals: RiskSignal[] = [];
  let score = 0;

  if (!raw) {
    return { verdict: 'BUKAN_QRIS', score: 100, signals: [{ level: 'danger', title: 'Tidak ada isi QR', detail: 'QR tidak berisi teks yang bisa dibaca.' }] };
  }

  // Quishing pattern: QR berisi URL / teks bebas, bukan payload EMV QRIS.
  if (/^https?:\/\//i.test(raw) || !raw.startsWith('000201')) {
    signals.push({
      level: 'danger',
      title: 'Bukan QRIS pembayaran',
      detail:
        'Isi QR ini bukan payload QRIS (tidak diawali format EMV 000201). QR pembayaran resmi selalu berisi payload EMV, bukan alamat web atau teks bebas. Pola ini dipakai pada penipuan quishing — jangan buka tautannya, jangan masukkan PIN atau OTP.',
    });
    if (URL_RE.test(raw)) {
      signals.push({ level: 'warn', title: 'Berisi alamat web', detail: `Tujuan yang terbaca: ${raw.slice(0, 120)}` });
    }
    return { verdict: 'BUKAN_QRIS', score: 100, signals };
  }

  let data: QrisData;
  try {
    data = parseQris(raw);
  } catch (e) {
    signals.push({
      level: 'danger',
      title: 'Struktur payload rusak',
      detail: `Payload diawali seperti QRIS tetapi strukturnya tidak valid: ${e instanceof Error ? e.message : String(e)}. QR resmi tidak pernah rusak strukturnya — kemungkinan QR tempelan atau hasil editan.`,
    });
    return { verdict: 'BERISIKO_TINGGI', score: 90, signals, parseError: e instanceof Error ? e.message : String(e) };
  }

  // CRC
  if (!data.crcValue) {
    score += 40;
    signals.push({ level: 'danger', title: 'Tidak ada checksum CRC', detail: 'Payload QRIS resmi selalu diakhiri tag 63 berisi CRC. Tanpa CRC, payload ini tidak sesuai standar EMV.' });
  } else if (!data.crcValid) {
    score += 45;
    signals.push({
      level: 'danger',
      title: 'Checksum CRC tidak cocok',
      detail: `CRC terbaca ${data.crcValue}, hasil hitung ulang ${data.crcExpected}. Isi QR telah berubah dari yang diterbitkan penerbitnya — ciri khas QR yang diedit atau ditempel ulang.`,
    });
  } else {
    signals.push({ level: 'ok', title: 'Checksum CRC cocok', detail: 'Isi payload utuh dan sesuai dengan yang diterbitkan penerbit QR.' });
  }

  // QRIS identity
  if (!data.qrisAccount) {
    score += 30;
    signals.push({ level: 'warn', title: 'Identitas QRIS tidak ditemukan', detail: 'Tidak ada akun merchant dengan identitas ID.CO.QRIS di dalam payload. Bisa jadi ini QR EMV dari negara atau skema lain.' });
  } else {
    signals.push({ level: 'ok', title: 'Identitas QRIS ditemukan', detail: `Penerbit: ${data.qrisAccount.globalId}. PAN merchant: ${data.qrisAccount.merchantPan ?? '-'}.` });
  }

  // Merchant name — the one check officials keep repeating.
  if (!data.merchantName) {
    score += 25;
    signals.push({ level: 'warn', title: 'Nama merchant kosong', detail: 'QRIS resmi selalu mencantumkan nama penerima. Nama kosong menyulitkan verifikasi dan tidak lazim pada QR terbitan bank atau PJSP.' });
  } else {
    signals.push({ level: 'ok', title: 'Nama penerima terbaca jelas', detail: `Pastikan nama "${data.merchantName}" sama dengan nama yang muncul di aplikasi pembayaran dan sesuai toko tempat Anda bertransaksi. Bila berbeda, batalkan.` });
  }

  // Currency
  if (data.currencyCode && data.currencyCode !== '360') {
    score += 20;
    signals.push({ level: 'warn', title: 'Mata uang bukan Rupiah', detail: `Kode mata uang terbaca ${data.currencyCode}, sedangkan QRIS memakai 360 (IDR).` });
  }

  // Country
  if (data.countryCode && data.countryCode !== 'ID') {
    score += 15;
    signals.push({ level: 'warn', title: 'Kode negara bukan ID', detail: `Kode negara terbaca ${data.countryCode}.` });
  }

  // Hidden URL inside payload
  if (URL_RE.test(raw) && !raw.includes('ID.CO.QRIS')) {
    score += 15;
    signals.push({ level: 'warn', title: 'Payload mengandung teks mirip alamat web', detail: 'Payload QRIS normal tidak memuat alamat web di luar identitas penerbit.' });
  }

  // Static vs dynamic guidance
  if (data.isDynamic) {
    if (data.amount) {
      signals.push({ level: 'info', title: 'QR dinamis, nominal sudah terkunci', detail: `Nominal di dalam QR: Rp${formatIdr(data.amount)}. Cocokkan dengan total belanja Anda sebelum membayar — nominal QR dinamis tidak bisa diubah di aplikasi.` });
    } else {
      signals.push({ level: 'info', title: 'QR dinamis tanpa nominal', detail: 'Nominal akan Anda isi sendiri di aplikasi pembayaran. Periksa nama penerima lebih dulu.' });
    }
  } else {
    signals.push({ level: 'info', title: 'QR statis (stiker/cetakan)', detail: 'Jenis QR yang ditempel permanen di meja kasir — persis jenis yang paling sering ditimpa stiker palsu. Cocokkan nama penerima di aplikasi dengan nama toko, bukan hanya logo pada stiker.' });
  }

  score = Math.min(100, score);
  const verdict: Verdict = score >= 40 ? 'BERISIKO_TINGGI' : score >= 15 ? 'PERIKSA_LAGI' : 'SESUAI_STRUKTUR';
  return { verdict, score, signals, data };
}

export function formatIdr(amount: string): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return amount;
  return num.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
