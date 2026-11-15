// 핵심 순수 로직(명함 파싱, vCard, 표 열 정렬, Wi-Fi QR, PDF 생성, 사각형 볼록 검사 등) 검증
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  return {
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    prepend() {},
    append() {},
    before() {},
    remove() {},
    replaceChildren() {},
    setAttribute() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    getContext() {
      return {
        drawImage() {},
        fillRect() {},
        clearRect() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() {},
      };
    },
    value: 'eng',
    hidden: true,
    checked: true,
    textContent: '',
    innerHTML: '',
    width: 100,
    height: 100,
    clientWidth: 100,
    clientHeight: 100,
  };
}

const sandbox = {
  console,
  setTimeout: () => 1,
  clearTimeout() {},
  TextEncoder,
  Uint8Array,
  Uint8ClampedArray,
  Float32Array,
  Float64Array,
  Int32Array,
  Map,
  Set,
  Math,
  Date,
  Promise,
  Error,
  String,
  Number,
  Array,
  Object,
  RegExp,
  JSON,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  window: { addEventListener() {}, Capacitor: { Plugins: {} }, devicePixelRatio: 1 },
  document: {
    getElementById: () => makeEl(),
    createElement: () => makeEl(),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: {
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      insertAdjacentHTML() {},
      append() {},
    },
  },
  Tesseract: {
    createWorker: async () => ({
      setParameters: async () => {},
      recognize: async () => ({ data: { lines: [] } }),
      terminate: async () => {},
    }),
  },
  fetch: async () => ({ ok: true, json: async () => [[['안녕', 'hello']]] }),
};

vm.createContext(sandbox);
for (const f of ['app.js', 'features.js', 'bookflat.js', 'bookscan.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'www', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

// 1. parseCard & vcard
{
  const card = sandbox.parseCard([
    '주식회사 스냅리드',
    '홍길동 수석연구원',
    'Fax: 02-1234-5679',
    'Tel: 02-1234-5678',
    'Mobile: 010-9876-5432',
    'hong@snapread.io',
  ].join('\n'));
  assert.strictEqual(card.name, '홍길동');
  assert.strictEqual(card.role, '수석연구원');
  assert.strictEqual(card.company, '주식회사 스냅리드');
  assert.strictEqual(card.phone, '010-9876-5432');
  assert.strictEqual(card.email, 'hong@snapread.io');

  const vc = sandbox.vcard({ name: '홍길동', role: '대표;이사', company: '스냅,리드', phone: '010-1111-2222', email: 'a@b.com' });
  assert(vc.includes('FN;CHARSET=UTF-8:홍길동'));
  assert(vc.includes('TITLE;CHARSET=UTF-8:대표\\;이사'));
  assert(vc.includes('ORG;CHARSET=UTF-8:스냅\\,리드'));
}

// 2. tableRows: 빈 칸이 있는 행도 열 위치에 맞춰 정렬되는지 확인
{
  const data = {
    lines: [
      {
        bbox: { x0: 10, y0: 10, x1: 250, y1: 30 },
        words: [
          { text: '품목', confidence: 90, bbox: { x0: 10, y0: 10, x1: 40, y1: 30 } },
          { text: '수량', confidence: 90, bbox: { x0: 110, y0: 10, x1: 140, y1: 30 } },
          { text: '가격', confidence: 90, bbox: { x0: 210, y0: 10, x1: 240, y1: 30 } },
        ],
      },
      {
        bbox: { x0: 10, y0: 40, x1: 250, y1: 60 },
        words: [
          { text: '사과', confidence: 90, bbox: { x0: 12, y0: 40, x1: 42, y1: 60 } },
          // 가운데(수량) 칸이 비어 있고 가격 칸만 있는 행
          { text: '1000', confidence: 90, bbox: { x0: 212, y0: 40, x1: 248, y1: 60 } },
        ],
      },
    ],
  };
  const rows = sandbox.tableRows(data);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows)), [
    ['품목', '수량', '가격'],
    ['사과', '', '1000'],
  ]);
}

// 3. parseWifi
{
  const w = sandbox.parseWifi('WIFI:T:WPA;S:My\\;Home;P:p@ss\\:123;;');
  assert.strictEqual(w.ssid, 'My;Home');
  assert.strictEqual(w.pass, 'p@ss:123');
  assert.strictEqual(w.type, 'WPA');
}

// 4. isConvexQuad & solveHomography
{
  const convex = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 110 }, { x: 10, y: 110 }];
  const twisted = [{ x: 10, y: 10 }, { x: 110, y: 110 }, { x: 110, y: 10 }, { x: 10, y: 110 }];
  const tiny = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  assert.strictEqual(sandbox.isConvexQuad(convex), true);
  assert.strictEqual(sandbox.isConvexQuad(twisted), false);
  assert.strictEqual(sandbox.isConvexQuad(tiny), false);

  const H = sandbox.solveHomography(100, 100, convex);
  assert.strictEqual(H.length, 8);
  assert(Math.abs(H[0] - 1) < 1e-6 && Math.abs(H[2] - 10) < 1e-6);
}

// 5. makePdf & splitChunks
{
  const pdf = sandbox.makePdf([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 100, h: 200 }]);
  const str = Buffer.from(pdf).toString('latin1');
  assert(str.startsWith('%PDF-1.4'));
  assert(str.includes('%%EOF'));

  const chunks = sandbox.splitChunks('hello world\nfoo bar baz', 12);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(chunks)), ['hello world', 'foo bar baz']);
}

console.log('test: all assertions passed');
