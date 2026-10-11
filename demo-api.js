(()=>{'use strict';
/**
 * Creabra 2.0 冲刺本地 mock server（D0-D5 契约兜底数据源）
 *
 * 依据: docs/api/creabra-sprint-d0d5.openapi.yaml (v1.0.0)
 * 用法: node mock/mock-server.mjs  （默认端口 8001，可用 MOCK_PORT 覆盖）
 * 接线: frontend/.env.local 里 ENGINE_API_URL=http://localhost:8001，vite 代理会把 /api/v1 转过来
 *
 * 特性:
 * - 任务有真实生命周期: queued(6s,带排队位) → generating(四阶段约20s) → succeeded/failed
 * - prompt 含「失败/fail」→ 任务失败 GEN_PROVIDER_TIMEOUT(retryable)  → 演示 A3-04 一键重试
 * - 新生图与重试固定一张；保留历史多张记录用于展示
 * - 验证码: 任意6位可通过；000000→AUTH_CODE_INVALID；111111→AUTH_CODE_EXPIRED
 * - 留资: 同一手机号第二次提交 → 429 RATE_LIMITED + retry_after_seconds  → 演示防刷倒计时
 * - 图片全部用内联 SVG data URI，不依赖外网
 */
let demoHandler; const http={createServer(fn){demoHandler=fn;return {listen(){}};}};

const PORT = 8001;
const now = () => new Date().toISOString();
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

// ────────────────────────── 假数据 ──────────────────────────
// 假图生成器（9/30 用户要求：生图/项目库默认给「像衣服」的占位图，方便调 UI）
// kind: model=模特图 flat=平铺图 pattern=纸样 mood=情绪板 fabric=面料 swatch=色卡
const PALETTES = [
  { bg: '#f1ece3', cloth: '#cdbb9c', shade: '#b7a281', ink: '#6b5f4c' },  // 燕麦米
  { bg: '#e9eef1', cloth: '#8ba2b0', shade: '#74909f', ink: '#435962' },  // 雾蓝
  { bg: '#f0e9e6', cloth: '#b08272', shade: '#9c6e5e', ink: '#5f4038' },  // 陶土棕
  { bg: '#ecefe8', cloth: '#93a687', shade: '#7f9471', ink: '#4b5a42' },  // 苔绿
  { bg: '#efedf2', cloth: '#9a8fa8', shade: '#867a96', ink: '#524860' },  // 灰紫
  { bg: '#f2efe9', cloth: '#c2b49e', shade: '#ab9c82', ink: '#635747' },  // 暖驼
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function garmentSvg(kind, palette, label) {
  const p = PALETTES[palette % PALETTES.length];
  const c = p.cloth, s = p.shade, ink = p.ink;
  // 通用部件
  const shadow = `<ellipse cx="200" cy="492" rx="110" ry="14" fill="rgba(0,0,0,.07)"/>`;
  const body = (w, h, x = 200 - w / 2, y = 150, r = 18) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/><rect x="${x + w - 26}" y="${y}" width="26" height="${h}" rx="${r}" fill="${s}" opacity=".45"/>`;
  const sleeves = (len = 190) =>
    `<rect x="96" y="152" width="52" height="${len}" rx="26" fill="${s}"/><rect x="252" y="152" width="52" height="${len}" rx="26" fill="${s}"/>`;
  const caption = label
    ? `<rect x="132" y="520" width="136" height="22" rx="11" fill="${ink}" opacity=".82"/><text x="200" y="535" font-family="Arial, sans-serif" font-size="11" letter-spacing="2" fill="#ffffff" text-anchor="middle">${esc(label)}</text>`
    : '';
  let art = '';
  if (kind === 'model') {
    // 模特图：头+颈+oversize 上衣/连衣裙
    art = `${shadow}
      <circle cx="200" cy="96" r="26" fill="#d9c4ae"/><rect x="192" y="118" width="16" height="22" fill="#cbb096"/>
      ${sleeves(170)}
      <path d="M148,168 Q200,142 252,168 L262,300 Q264,318 250,322 L226,326 L226,470 Q226,486 210,486 L190,486 Q174,486 174,470 L174,326 L150,322 Q136,318 138,300 Z" fill="${c}"/>
      <path d="M174,326 L226,326 L226,470 Q226,486 210,486 L190,486 Q174,486 174,470 Z" fill="${s}" opacity=".5"/>
      <path d="M186,152 L200,190 L214,152" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  } else if (kind === 'flat') {
    // 平铺图：对称款式图+虚线缝迹
    art = `${shadow}${sleeves(168)}
      <path d="M148,160 L200,140 L252,160 L260,320 L226,326 L226,478 L174,478 L174,326 L140,320 Z" fill="${c}"/>
      <path d="M200,140 L200,478" stroke="${ink}" stroke-width="2.5" stroke-dasharray="7 6" opacity=".65"/>
      <path d="M148,160 L200,184 L252,160" fill="none" stroke="${ink}" stroke-width="3"/>
      <circle cx="200" cy="222" r="5" fill="${ink}"/><circle cx="200" cy="258" r="5" fill="${ink}"/><circle cx="200" cy="294" r="5" fill="${ink}"/>`;
  } else if (kind === 'pattern') {
    // 纸样：白底+格网+裁片轮廓
    const grid = Array.from({ length: 8 }, (_, i) =>
      `<line x1="${40 + i * 46}" y1="60" x2="${40 + i * 46}" y2="500" stroke="${ink}" stroke-width=".6" opacity=".18"/>`).join('') +
      Array.from({ length: 10 }, (_, i) =>
      `<line x1="40" y1="${60 + i * 46}" x2="360" y2="${60 + i * 46}" stroke="${ink}" stroke-width=".6" opacity=".18"/>`).join('');
    art = `<rect x="28" y="48" width="344" height="464" rx="10" fill="#fbfaf7" stroke="${ink}" stroke-opacity=".25"/>${grid}
      <path d="M96,150 L180,150 L196,196 L236,196 L252,150 L312,170 L300,268 L268,262 L268,432 L124,432 L124,268 L92,274 Z" fill="none" stroke="${ink}" stroke-width="3"/>
      <path d="M196,196 L236,196" stroke="${ink}" stroke-width="2" stroke-dasharray="6 5"/>
      <path d="M124,300 L268,300" stroke="${ink}" stroke-width="1.6" stroke-dasharray="10 6" opacity=".7"/>
      <text x="196" y="176" font-family="Arial" font-size="12" fill="${ink}" text-anchor="middle">FRONT</text>`;
  } else if (kind === 'mood') {
    // 情绪板：三张错位小卡
    art = `<rect x="70" y="110" width="140" height="190" rx="10" fill="${c}" transform="rotate(-6 140 205)"/>
      <rect x="180" y="150" width="150" height="200" rx="10" fill="${s}" transform="rotate(4 255 250)"/>
      <rect x="110" y="270" width="170" height="140" rx="10" fill="${ink}" opacity=".85" transform="rotate(-3 195 340)"/>
      <circle cx="300" cy="130" r="34" fill="${c}" opacity=".9"/>`;
  } else if (kind === 'fabric') {
    // 面料：织纹斜线+毛羽
    const weave = Array.from({ length: 14 }, (_, i) =>
      `<line x1="${-40 + i * 36}" y1="560" x2="${180 + i * 36}" y2="0" stroke="${s}" stroke-width="7" opacity=".5"/>`).join('');
    art = `<rect x="40" y="90" width="320" height="380" rx="16" fill="${c}"/>${weave}
      <rect x="40" y="90" width="320" height="380" rx="16" fill="none" stroke="${ink}" stroke-opacity=".2" stroke-width="2"/>`;
  } else {
    // swatch 色卡
    art = `<rect x="90" y="120" width="220" height="300" rx="14" fill="${c}"/>
      <rect x="90" y="356" width="220" height="64" rx="14" fill="${s}"/>
      <circle cx="200" cy="230" r="44" fill="#ffffff" opacity=".28"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560"><rect width="400" height="560" fill="${p.bg}"/>${art}${caption}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const garmentImage = (kind, palette, label) => garmentSvg(kind, palette, label);
// 旧调用点兼容：SVG(bg, label) → 色卡占位
const SVG = (bg, label) => {
  const idx = Math.max(0, PALETTES.findIndex((p) => p.bg === bg));
  return garmentSvg('swatch', idx >= 0 ? idx : 0, label);
};
const IMG = {
  model1: garmentSvg('model', 0, 'MODEL · V2'), model2: garmentSvg('model', 0, 'MODEL · BACK'),
  flat: garmentSvg('flat', 0, 'FLAT SKETCH'), pattern: garmentSvg('pattern', 0, 'PATTERN LAYOUT'),
  mood: garmentSvg('mood', 1, 'MOODBOARD'), fabric: garmentSvg('fabric', 0, 'FABRIC'),
  cover: garmentSvg('model', 1, 'COLLECTION'),
};
// 生成结果假图：按张轮换配色
const lookImage = (n) => garmentSvg('model', (n - 1) % PALETTES.length, `LOOK ${n}`);

const user = {
  id: 'usr_mock001', email: null, phone: null, role: 1, language: 'zh',
  membership_expires_at: '2026-12-31T00:00:00Z',
};
const userProfile = {
  ...user,
  has_active_membership: true,
  current_subscription_plan_code: 'pro_monthly',
  company: { id: 'com_mock01', name: 'Mock 服饰工作室', website: null, region: 'CN' },
  credit: {
    balance: 128, total_recharged: 500, total_consumed: 372,
    // 🧪 活动积分拆分（9/30 用户定）：契约暂无此二字段，mock 先行；68+60=128
    base_balance: 68, activity_balance: 60,
    nearest_expiry: { amount: 60, expires_at: '2026-10-06T00:00:00Z', days_left: 7 },
  },
  unread_count: 2,
};
const creditBalance = {
  balance: 128, total_recharged: 500, total_consumed: 372,
  base_balance: 68, activity_balance: 60, // 🧪 同上，契约采纳前进契约再转正
  monthly_credit_granted: false, recurring_credits_expired: 60, // granted=true 会每次登录都弹「每月赠送10积分」
};
const priceList = {
  version: '2026-09-29.1',
  items: [
    { task_type: 'design_images', unit_price: 1, unit: 'per_image', updated_at: '2026-09-29T00:00:00Z' },
    { task_type: 'design_refine', unit_price: 1, unit: 'per_task', updated_at: '2026-09-29T00:00:00Z' },
    { task_type: 'image_edit', unit_price: 1, unit: 'per_task', updated_at: '2026-09-29T00:00:00Z' },
  ],
};

// ── 演示账号体系（9/29 用户定：四组正确凭据 + 错误输入要真的报错）──
// 手机登录：13800138000 + 短信码 123456（图形验证码固定 3861）
// 邮箱验证码登录：demo@creabra.com + 邮箱码 123456
// 邮箱密码登录：demo@creabra.com + creabra123
// 忘记密码：demo@creabra.com → 邮箱码 123456 → 新密码≥8位 → 重设成功自动登录
const DEMO_CODE = '123456'; // 唯一有效验证码（debug_code 自动填的就是它）
const registeredEmails = new Set(['demo@creabra.com']);
const emailPasswords = new Map([['demo@creabra.com', 'creabra123']]);
const registeredPhones = new Set(['+8613800138000']);
const codeCooldowns = new Map();
const leadsByPhone = new Map();
// 演示暗号：13812345678 启动即预置为「已提交」→ 该号提交留资必吃 429（约 60 分钟）；换任意别的号 = 201 成功
leadsByPhone.set('13812345678', Date.now());

const transactions = [
  { id: uid('txn'), type: 'consume', amount: -4, balance_after: 128, remark: '设计出图×4', task_id: 'task_seed_01',
    snapshot: { task_type: 'design_images', quantity: 4, unit_price: 1, unit: 'per_image', price_version: '2026-09-29.1', charged_credits: 4, rule_id: 'AI_GENERATION_PRICES' },
    created_at: '2026-09-28T10:12:00Z' },
  { id: uid('txn'), type: 'refund', amount: 1, balance_after: 132, remark: '部分成功：4 张中 1 张生成失败', task_id: 'task_seed_01',
    snapshot: { task_type: 'design_images', quantity: 1, unit_price: 1, unit: 'per_image', price_version: '2026-09-29.1', charged_credits: 1, rule_id: 'AI_GENERATION_PRICES' },
    created_at: '2026-09-28T10:15:00Z' },
  { id: uid('txn'), type: 'grant', amount: 100, balance_after: 133, remark: '月度积分发放', task_id: null, snapshot: null,
    created_at: '2026-09-28T00:00:00Z' },
  { id: uid('txn'), type: 'expire', amount: -30, balance_after: 33, remark: '30天积分到期清零', task_id: null, snapshot: null,
    created_at: '2026-09-20T00:00:00Z' },
];
// 历史流水补充种子（A2-02）：把总数顶过 20，让「加载更多」分页可实测
{
  let bal = 33;
  for (let i = 0; i < 24; i++) {
    const day = 27 - Math.floor(i / 4);
    const hour = 9 + (i % 4) * 3;
    const kind = i % 8 === 3 ? 'adjust' : 'consume';
    const amt = kind === 'adjust' ? 5 : -(1 + (i % 3));
    bal -= amt; // 往回走时间，余额越早越多，读起来像真实历史
    transactions.push({
      id: uid('txn'), type: kind, amount: amt, balance_after: bal,
      remark: kind === 'adjust' ? '客服补偿调整' : `设计出图×${-amt}`,
      task_id: kind === 'adjust' ? null : `task_seed_h${i}`,
      snapshot: kind === 'adjust' ? null : { task_type: 'design_images', quantity: -amt, unit_price: 1, unit: 'per_image', price_version: '2026-09-22.1', charged_credits: -amt, rule_id: 'AI_GENERATION_PRICES' },
      created_at: `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:30:00Z`,
    });
  }
}

const notifications = [
  { id: uid('ntf'), type: 'credit_expiry_reminder', title: '您有 60 积分将于 7 天后清零',
    body: '10月6日前使用，过期自动清零。清零不提醒，我们怕你心疼。', task_id: null, link: '/account', read: false,
    created_at: '2026-09-29T08:00:00Z' },
  { id: uid('ntf'), type: 'task_completed', title: '您的设计已生成完成',
    body: '「秋季针织系列 · 4 张」已生成，点击查看结果。', task_id: 'task_seed_01', link: '/collections/col_mock01', read: false,
    created_at: '2026-09-28T10:15:00Z' },
  { id: uid('ntf'), type: 'task_failed', title: '一个任务失败了',
    body: '生成超时，积分已退回，可一键重试。', task_id: 'task_seed_02', link: null, read: true,
    created_at: '2026-09-27T16:40:00Z' },
];

// ── 系列 / 单品 / 项目 假数据（9/30：让项目管理、系列页、单款编辑器都能点进去调 UI）──
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// GarmentData 造数器（结构对齐 frontend/types.ts GarmentData）
const garmentData = (name, over = {}) => ({
  name,
  basic: { gender: 'Women', category: 'Knitwear', season: 'Fall/Winter', audience: ['25-35 都市通勤'], market: ['国内电商', '跨境电商'] },
  design: {
    style: ['复古学院风', '极简'], tone: ['温暖', '安静'], scene: ['通勤', '日常'],
    color: { description: ['燕麦米'], hex: ['#CDBB9C'] },
    silhouette: ['落肩 oversize'], length: '60cm', shoulder: '落肩',
  },
  production: {
    target_cost: 86.5,
    details: { collar: ['V领'], sleeve: ['落肩长袖'], closure: ['贝壳扣门襟'] },
    hardware: ['天然贝壳扣 18mm'],
    fabric: { main: ['绵羊毛混纺'], texture: ['粗针罗纹'] },
    craft: ['成衣水洗'],
    fit: 'Oversize',
  },
  ...over,
});

// 单品模板：id/名字/类别/配色/是否带 BOM
const GARMENT_SEEDS = [
  { id: 'gar_mock01', collection: 'col_mock01', name: '落肩oversize针织开衫', category: 'Knitwear', fit: 'Oversize', palette: 0, versions: 3, hasBom: true },
  { id: 'gar_mock02', collection: 'col_mock01', name: '高领短款套头毛衣', category: 'Knitwear', fit: 'Loose', palette: 5, versions: 2, hasBom: true },
  { id: 'gar_mock03', collection: 'col_mock02', name: '醋酸缎面吊带裙', category: 'One-piece', fit: 'Slim Fit', palette: 2, versions: 2, hasBom: false },
  { id: 'gar_mock04', collection: 'col_mock02', name: '法式泡泡袖衬衫', category: 'Tops', fit: 'Slim Fit', palette: 1, versions: 2, hasBom: true },
  { id: 'gar_mock05', collection: 'col_mock02', name: '机能风拼接冲锋衣', category: 'Outerwear', fit: 'Loose', palette: 3, versions: 1, hasBom: false },
];
const garmentSeedById = (id) => GARMENT_SEEDS.find((g) => g.id === id);
const seedVersionId = (g, n) => `ver_${g.id.slice(4)}_v${n}`;

// B2-01 合同：GET /garments/{id}/detail
const garmentDetails = new Map(GARMENT_SEEDS.map((g) => {
  const vLatest = seedVersionId(g, g.versions);
  const cost = { Knitwear: '￥86.50', 'One-piece': '￥128.00', Tops: '￥64.80', Outerwear: '￥215.00' }[g.category] || '￥99.00';
  return [g.id, {
    garment_id: g.id, collection_id: g.collection, name: g.name,
    current_version_id: vLatest,
    images: {
      model: [garmentSvg('model', g.palette, 'MODEL · FRONT'), garmentSvg('model', g.palette, 'MODEL · BACK')],
      flat: [garmentSvg('flat', g.palette, 'FLAT SKETCH')],
    },
    pattern: g.hasBom
      ? { blueprint_image_url: garmentSvg('pattern', g.palette, 'PATTERN LAYOUT'), blueprint_text: '前后片+袖片，1/1罗纹下摆，肩部落肩加放7cm' }
      : null,
    bom: {
      fabric_composition: g.category === 'Knitwear' ? '面：52%绵羊毛 45%腈纶 3%氨纶' : '面：100%聚酯纤维',
      estimated_cost: `${cost} / 件`,
      pantone_colors: ['PANTONE 16-1430 TPM', 'PANTONE 11-0602 TPM'],
      items: [
        { item_no: '01', category: '面料', description: g.category === 'Knitwear' ? '粗针羊毛混纺平纹布' : '主面料', material: g.category === 'Knitwear' ? '绵羊毛/腈纶' : '聚酯纤维', composition: g.category === 'Knitwear' ? '52/45/3' : '100%', color: '主色', quantity: '1.35m', notes: '克重420gsm' },
        { item_no: '02', category: '里料', description: '—', material: g.category === 'Outerwear' ? '聚酯纤维里布' : '无里料', composition: g.category === 'Outerwear' ? '100%' : '—', color: '—', quantity: g.category === 'Outerwear' ? '1.1m' : '—', notes: g.category === 'Outerwear' ? '—' : '本款不挂里' },
        { item_no: '03', category: '纽扣', description: '天然贝壳扣 18mm', material: '贝壳', composition: '100%', color: '本白', quantity: '5粒', notes: 'X字车缝' },
        { item_no: '04', category: '拉链', description: '—', material: '—', composition: '—', color: '—', quantity: '—', notes: '本款无拉链' },
        { item_no: '05', category: '缝纫线', description: '涤纶包芯线 402', material: '涤纶', composition: '100%', color: '同面色', quantity: '约80m', notes: '—' },
      ],
    },
    spec_sheet: [
      { point: '胸围', base_size: '160/84A', sizes: { S: '104', M: '108', L: '112' }, tolerance: '±1.5', notes: '放量测' },
      { point: '衣长', base_size: '160/84A', sizes: { S: '58', M: '60', L: '62' }, tolerance: '±1', notes: '含罗纹' },
      { point: '袖长', base_size: '160/84A', sizes: { S: '52', M: '53.5', L: '55' }, tolerance: '±1', notes: '后中量' },
    ],
    construction: [
      { component: '肩缝', detail: '四线包缝后双针绷缝固定', seam_type: '四线包缝', stitch_type: '401链式', spi: '10-12', notes: '前后片对格' },
      { component: '下摆', detail: '1/1罗纹双针绷缝，宽6cm', seam_type: '绷缝', stitch_type: '401链式', spi: '10-12', notes: '—' },
      { component: '门襟', detail: '明贴边，扣眼锁边5个', seam_type: '平缝', stitch_type: '301锁式', spi: '12-14', notes: '扣眼纵向' },
    ],
    special_processes: {
      washing: ['成衣水洗（轻柔，30℃）', '低温滚筒烘干至八成干'],
      quality_standards: ['色牢度≥4级', '起球等级≥3-4级（GB/T 4802.1）', '缩水率≤3%'],
      testing: ['GB 18401 B类全项', '纤维含量检测', 'pH值 4.0-7.5'],
    },
    packing: {
      folding: ['衬衫折法，肩宽对折', '拷贝纸衬隔'],
      carton: ['小箱20件 / 大箱120件', '箱体防潮袋'],
      shipping_marks: ['款号/颜色/尺码比例', '正唛+侧唛'],
    },
  }];
}));

// B2-01 合同：GET /collections/{id}/results（系列→单品树）
const COLLECTION_SEEDS = [
  { id: 'col_mock01', name: '2026 秋季针织胶囊系列', season: '2026 秋季', audience: '25-35 都市通勤女性', palettes: [0, 5] },
  { id: 'col_mock02', name: '2026 春夏度假系列', season: '2026 春夏', audience: '轻度假 25-40 女性', palettes: [2, 1, 3] },
];
const collectionTrees = new Map(COLLECTION_SEEDS.map((c) => {
  const garments = GARMENT_SEEDS.filter((g) => g.collection === c.id);
  return [c.id, {
    collection_id: c.id, name: c.name, status: 'completed',
    cover_image_url: garmentSvg('model', c.palettes[0], 'COLLECTION'),
    garment_count: garments.length,
    garments: garments.map((g, i) => ({
      garment_id: g.id, name: g.name,
      thumbnail_url: garmentSvg('flat', g.palette, g.name.slice(0, 6)),
      model_image_url: garmentSvg('model', g.palette, `LOOK ${i + 1}`),
      flat_image_url: garmentSvg('flat', g.palette, 'FLAT'),
      image_count: 4 + g.versions, version_count: g.versions,
      has_pattern: g.hasBom, has_bom: g.hasBom,
      updated_at: ago(6 + i * 3),
    })),
  }];
}));

// 1.0 旧端点：GET /collections、GET /collections/{id}（一键多款系列页 Home → getCollection 用）
const legacyCollections = new Map(COLLECTION_SEEDS.map((c) => {
  const garments = GARMENT_SEEDS.filter((g) => g.collection === c.id);
  const products = garments.map((g, i) => ({
    id: g.id, spu: `SPU${i + 1}`, name: g.name,
    designData: garmentData(g.name, {
      basic: { gender: 'Women', category: g.category, season: c.season, audience: [c.audience], market: ['国内电商', '跨境电商'] },
      production: {
        target_cost: 99,
        details: { collar: ['圆领'], sleeve: ['长袖'], closure: ['套头'] },
        hardware: [], fabric: { main: ['主面料'], texture: ['平纹'] }, craft: ['成衣水洗'], fit: g.fit,
      },
    }),
    images: {
      model: garmentSvg('model', g.palette, `LOOK ${i + 1}`),
      flats: [garmentSvg('flat', g.palette, 'FLAT'), garmentSvg('flat', g.palette, 'BACK')],
      blueprint: garmentSvg('pattern', g.palette, 'BLUEPRINT'),
    },
    status: 'completed', order: i, createdAt: new Date(`2026-09-2${8 - c.palettes.length + i}T09:00:00Z`).getTime(),
  }));
  return [c.id, {
    id: c.id, name: c.name, status: 'completed',
    thumbnail_url: garmentSvg('model', c.palettes[0], 'COLLECTION'),
    product_count: products.length, target_product_count: products.length,
    download_unlocked: false,
    key_params_json: { gender: 'Women', season: c.season, audience: c.audience },
    confirmed_brief_json: {
      rawRequirement: `${c.season} ${c.audience} 胶囊系列，5 个 look，主打通勤+轻场景`,
      normalizedDirection: '极简廓形 × 天然材质 × 中性色',
      styleDirection: 'Quiet luxury / 复古学院', season: c.season, targetAudience: c.audience,
      marketPositioning: '轻中端', priceRange: '￥399-1299', gender: 'Women',
    },
    research_status: 'completed',
    research_json: {
      status: 'completed',
      sections: [
        { id: 'r1', title: '市场与趋势', content: `## 市场概览\n${c.season}${c.name.slice(-4)}赛道保持温和增长，「安静奢华」与户外机能持续外溢。\n\n- 关键色：燕麦米、雾蓝、陶土棕\n- 关键廓形：落肩 oversize、短款高腰`, order: 1 },
        { id: 'r2', title: '竞品动态', content: '## 竞品\n三个头部品牌均推出针织胶囊线，均价带￥600-1500，主打材质叙事。', order: 2 },
        { id: 'r3', title: '面料与工艺', content: '## 面料\n粗针羊毛混纺为主力，辅以醋酸缎面做晚装层次。', order: 3 },
      ],
    },
    concepts_status: 'completed',
    concepts_json: {
      status: 'completed',
      moodBoardImage: garmentSvg('mood', c.palettes[0], 'MOODBOARD'),
      sections: [
        { id: 'c1', title: '系列概念', content: `## 一句话概念\n「${c.name}」——用天然的褶皱与安静的颜色，装下整季的通勤与假日。`, order: 1 },
        { id: 'c2', title: '色彩方案', content: '## 色彩\n燕麦米 / 雾蓝 / 陶土棕，三个主色贯穿全系列。', order: 2 },
      ],
    },
    products_json: products,
    blueprints_status: 'completed',
    blueprints_json: {
      status: 'completed',
      items: products.map((p, i) => ({
        id: `bp_${p.id}`, spu: p.spu, productName: p.name,
        blueprintImage: garmentSvg('pattern', garments[i].palette, 'BLUEPRINT'),
        blueprintText: '前后片+袖片，缝份1cm，下摆罗纹另计', status: 'completed', order: i,
      })),
    },
    marketing_status: 'completed',
    marketing_json: { status: 'completed', items: [] },
    created_at: '2026-09-26T09:00:00Z', updated_at: ago(6),
  }];
}));

// ── 项目库（单款）：GET /projects + GET /projects/{id}，点开即进有内容的单款编辑器 ──
const versionPrompt = (g, n) => `${g.name}，${g.fit}版型，第 ${n} 版：整体廓形再放大一点，罗纹质感更明显`;
const projectVersions = (g) => Array.from({ length: g.versions }, (_, i) => {
  const n = i + 1;
  const v = {
    versionId: seedVersionId(g, n),
    timestamp: new Date(`2026-09-2${8 - g.versions + i}T1${i}:30:00Z`).getTime(),
    data: garmentData(g.name, {
      basic: { gender: 'Women', category: g.category, season: 'Fall/Winter', audience: ['25-35 都市通勤'], market: ['国内电商'] },
      production: {
        target_cost: 86.5,
        details: { collar: ['V领'], sleeve: ['落肩长袖'], closure: ['贝壳扣门襟'] },
        hardware: ['天然贝壳扣 18mm'],
        fabric: { main: ['绵羊毛混纺'], texture: ['粗针罗纹'] },
        craft: ['成衣水洗'], fit: g.fit,
      },
    }),
    modelImages: [garmentSvg('model', g.palette, `MODEL · V${n}`)],
    flatImages: n > 1 ? [garmentSvg('flat', g.palette, `FLAT · V${n}`)] : [],
    prompt: versionPrompt(g, n),
    depth: i, branchIndex: 0,
  };
  if (n === g.versions && g.hasBom) {
    const detail = garmentDetails.get(g.id);
    v.bom = detail.bom;
    v.bom.tech_pack_structured = {
      cover: { style_name: g.name, style_number: `CR26-${g.id.slice(-4).toUpperCase()}`, season: '2026 秋季', market: '国内电商', product_type: g.category, construction_level: '基础款', fabric_type: '针织', colorway: '燕麦米', estimated_cost: detail.bom.estimated_cost, pantone_colors: detail.bom.pantone_colors },
      flat_sketch_notes: { overall_description: '落肩 oversize 廓形，V领贝壳扣门襟', views: [{ name: '正面', details: ['V领', '五粒贝壳扣'] }, { name: '背面', details: ['整片无分割'] }] },
      bom: detail.bom.items, spec_sheet: detail.spec_sheet, construction: detail.construction,
      special_processes: detail.special_processes, packing: detail.packing,
    };
  }
  if (n === g.versions && !g.hasBom) {
    // 无 BOM 单品给 fabricData，验证「生成工艺单」按钮入口
    v.fabricData = { id: `fab_${g.id}`, type: 'woven', weight: '210g/m²', composition: '100%聚酯纤维', drape: 'soft', texture: 'plain', description: '哑光缎面，垂坠感强', color: '陶土棕', hex: '#B08272' };
    v.fabricImage = garmentSvg('fabric', g.palette, 'FABRIC');
  }
  return v;
});
// 项目会话快照：结构 = SavedProject.sessionState（types.ts DesignSession）
const projectSessionState = (g) => {
  const versions = projectVersions(g);
  const last = versions[versions.length - 1];
  return {
    step: 'editor', viewMode: 'simple',
    uploadedRef: null, uploadedRefs: [],
    textPrompt: versionPrompt(g, 1),
    garments: [{ id: g.id, downloadUnlocked: false, currentVersionIndex: versions.length - 1, versions }],
    pendingGarmentData: null,
    selectedGarmentId: g.id, selectedVersionId: last.versionId,
    isProcessing: false,
    messages: [
      { id: '1', role: 'user', content: versionPrompt(g, 1), imageAttachment: null },
      { id: '2', role: 'ai', content: `已完成「${g.name}」出图，共 ${g.versions} 个版本。可以直接改细节、生成工艺单或平铺图。` },
    ],
    isModified: false,
  };
};
const projects = new Map();
const demoProjects = [
  ...GARMENT_SEEDS.map((g, i) => ({
    id: `prj_mock0${i + 1}`, garment: g, name: g.name, collection_name: g.collection === 'col_mock01' ? '2026 秋季针织胶囊系列' : '2026 春夏度假系列',
  })),
  { id: 'prj_mock06', garment: null, name: '未命名设计', collection_name: null }, // 空草稿：验证项目空态
];
for (const dp of demoProjects) {
  const sessionState = dp.garment ? projectSessionState(dp.garment) : {
    step: 'landing', viewMode: 'simple', uploadedRef: null, uploadedRefs: [], textPrompt: '',
    garments: [], pendingGarmentData: null, selectedGarmentId: null, selectedVersionId: null,
    isProcessing: false, messages: [], isModified: false,
  };
  const g = dp.garment;
  projects.set(dp.id, {
    id: dp.id, user_id: user.id, name: dp.name,
    thumbnail_url: g ? garmentSvg('model', g.palette, 'COVER') : null,
    status: g ? 'draft' : 'draft', source_type: 'manual',
    collection_id: g ? g.collection : null, collection_name: dp.collection_name,
    garment_count: g ? 1 : 0, is_unlocked: false,
    session_state_json: sessionState,
    created_at: '2026-09-27T09:00:00Z',
    last_modified_at: g ? ago(3 + GARMENT_SEEDS.indexOf(g) * 5) : ago(1),
    updated_at: g ? ago(3 + GARMENT_SEEDS.indexOf(g) * 5) : ago(1),
  });
}
// B1-03 静态演示：prj_mock01 最后一版预置「4 张出图、3 成功 1 失败」的批量结果——
// 主图下宫格缩略条（3 张可点择优 + 1 个红虚线失败占位带 tooltip）不真生成也能看
{
  const p = projects.get('prj_mock01');
  const versions = p.session_state_json.garments[0].versions;
  const last = versions[versions.length - 1];
  last.modelImages = [last.modelImages[0], lookImage(2), lookImage(3)];
  last.batch = { requested: 4, failed: [{ index: 3, error_code: 'GEN_PROVIDER_TIMEOUT', error_message: '该张生成超时' }] };
}
const projectSummary = (p) => ({
  primary_image_confirmed: (p.session_state_json?.garments?.[0]?.versions?.length > 0 && !p.session_state_json.garments[0].versions.some(v => v.origin === 'refine' || (p.session_state_json.garments[0].versions.length > 1 && !v.origin)) && p.session_state_json?.garments?.[0]?.primaryImage?.versionCount !== -1 && !p.session_state_json?.primaryImageRequiresConfirmation) || (p.session_state_json?.primaryImageConfirmed ?? (
    !!p.session_state_json?.garments?.[0]?.primaryImage?.versionId &&
    p.session_state_json.garments[0].primaryImage.versionCount === p.session_state_json.garments[0].versions?.length
  )),
  id: p.id, user_id: p.user_id, name: p.name, thumbnail_url: p.thumbnail_url, status: p.status,
  source_type: p.source_type, collection_id: p.collection_id, collection_name: p.collection_name,
  garment_count: p.garment_count, is_unlocked: p.is_unlocked, session_state_json: null,
  created_at: p.created_at, last_modified_at: p.last_modified_at, updated_at: p.updated_at,
});

// ────────────────────────── 任务状态机 ──────────────────────────
const tasks = new Map();
const STAGES = ['understand', 'compose', 'draw', 'refine'];

function seedTask(id, patch) {
  const t = {
    id, user_id: user.id, task_type: 'design_images', biz_type: null, biz_id: null,
    status: 'queued', phase: 'queued', queue_position: 1, estimated_wait_seconds: 8, queue_name: 'default',
    attempt_count: 1, max_attempts: 3, progress_stage: null, progress_message: null,
    result_json: null, error_message: null, error_code: null, retryable: null, last_error: null,
    idempotency_key: uid('idem'), next_run_at: new Date(Date.now() + 6000).toISOString(),
    started_at: null, finished_at: null, created_at: now(), _count: 1, _prompt: '', ...patch,
  };
  tasks.set(id, t);
  return t;
}
seedTask('task_seed_01', { status: 'completed', phase: 'succeeded', progress_stage: 'completed',
  created_at: ago(2), started_at: ago(2), finished_at: ago(1.95), _count: 4,
  result_json: { items: [
    { index: 0, status: 'succeeded', image_url: IMG.model1, garment_id: 'gar_mock01' },
    { index: 1, status: 'succeeded', image_url: lookImage(2), garment_id: null },
    { index: 2, status: 'succeeded', image_url: lookImage(3), garment_id: null },
    { index: 3, status: 'failed', image_url: null, garment_id: null, error_code: 'GEN_PROVIDER_TIMEOUT', error_message: '该张生成超时' },
  ], partial: true, refund: { credits: 1, reason: '部分成功：4 张中 1 张生成失败' } } });
seedTask('task_seed_02', { status: 'failed', phase: 'failed', progress_stage: 'failed',
  error_message: '生成超时，请重试', error_code: 'GEN_PROVIDER_TIMEOUT', retryable: true,
  attempt_count: 2, created_at: ago(26), started_at: ago(26), finished_at: ago(25.9), result_json: null });
seedTask('task_seed_03', { status: 'completed', phase: 'succeeded', progress_stage: 'completed',
  _count: 1, created_at: ago(5), started_at: ago(5), finished_at: ago(4.9),
  result_json: { items: [{ index: 0, status: 'succeeded', image_url: lookImage(1), garment_id: 'gar_mock03' }], partial: false, refund: null } });
seedTask('task_seed_04', { status: 'cancelled', phase: 'failed', progress_stage: 'cancelled',
  error_message: '任务已取消', error_code: 'TASK_CANCELLED', retryable: false,
  created_at: ago(49), started_at: ago(49), finished_at: ago(48.9), result_json: null });

function publicTask(t) {
  const { _count, _prompt, _timers, _demoResult, ...rest } = t;
  return rest;
}
function addNotification(type, title, body, taskId) {
  notifications.unshift({ id: uid('ntf'), type, title, body, task_id: taskId || null, link: null, read: false, created_at: now() });
}
function refundTxn(credits, reason, taskId) {
  transactions.unshift({ id: uid('txn'), type: 'refund', amount: credits, balance_after: (creditBalance.balance += credits),
    remark: reason, task_id: taskId, snapshot: { task_type: 'design_images', quantity: credits, unit_price: 1,
      unit: 'per_image', price_version: priceList.version, charged_credits: credits, rule_id: 'AI_GENERATION_PRICES' },
    created_at: now() });
}

function runTask(t, opts = {}) {
  // queued → generating。默认 6s 排队 + 四阶段各 5s；extract 类任务走快速档
  const queueMs = opts.queueMs ?? 500;
  const stageMs = opts.stageMs ?? 900;
  const stages = opts.stages ?? STAGES;
  t._timers = setTimeout(() => {
    t.phase = 'generating'; t.status = 'running'; t.queue_position = null; t.estimated_wait_seconds = null;
    t.started_at = now(); t.progress_stage = stages[0]; t.progress_message = 'understanding brief';
    let i = 0;
    const stageTimer = setInterval(() => {
      i += 1;
      if (i < stages.length) { t.progress_stage = stages[i]; t.progress_message = `${stages[i]} stage`; return; }
      clearInterval(stageTimer);
      if(t.phase==='generating') finishTask(t);
    }, stageMs);
  }, queueMs);
}

function finishTask(t) { if(t._demoResult!==undefined){t.phase='succeeded';t.status='completed';t.progress_stage='completed';t.finished_at=now();t.result_json=t._demoResult;return;}
  t.finished_at = now();
  const prompt = t._prompt || '';
  const wantsFail = /失败|fail/i.test(prompt);
  const wantsPartial = /部分|partial/i.test(prompt);

  if (t._kind === 'extract') {
    // 需求解析任务：不涉及计费/退点，直接吐 garment 结构化 JSON
    t.phase = 'succeeded'; t.status = 'completed'; t.progress_stage = 'completed';
    t.result_json = garmentData(t._prompt.slice(0, 30) || '模拟设计');
    return;
  }

  if (wantsFail && t.attempt_count < 3 && t.id === 'task_fail_forever') {
    // 永远失败的演示任务不在此分支——普通失败任务重试后成功
  }
  if (wantsFail && !(t._retriedOnce)) {
    t.phase = 'failed'; t.status = 'failed'; t.progress_stage = 'failed';
    t.error_code = 'GEN_PROVIDER_TIMEOUT'; t.error_message = '生成超时，请重试'; t.retryable = true;
    addNotification('task_failed', '一个任务失败了', '生成超时，积分已退回，可一键重试。', t.id);
    transactions.unshift({ id: uid('txn'), type: 'refund', amount: t._count, balance_after: (creditBalance.balance += t._count),
      remark: '任务失败全额退点', task_id: t.id, snapshot: { task_type: t.task_type, quantity: t._count, unit_price: 1,
        unit: 'per_image', price_version: priceList.version, charged_credits: t._count, rule_id: 'AI_GENERATION_PRICES' },
      created_at: now() });
    return;
  }
  const n = t._count || 1;
  const items = [];
  let failedCount = 0;
  for (let i = 0; i < n; i++) {
    if (wantsPartial && n > 1 && i === n - 1) {
      items.push({ index: i, status: 'failed', image_url: null, garment_id: null,
        error_code: 'GEN_PROVIDER_TIMEOUT', error_message: '该张生成超时' });
      failedCount += 1;
    } else {
      items.push({ index: i, status: 'succeeded', image_url: lookImage(i + 1), garment_id: i === 0 ? 'gar_new01' : null });
    }
  }
  t.phase = 'succeeded'; t.status = 'completed'; t.progress_stage = 'completed';
  const refund = failedCount > 0 ? { credits: failedCount, reason: `部分成功：${n} 张中 ${failedCount} 张生成失败` } : null;
  t.result_json = { items, partial: failedCount > 0, refund };
  if (refund) refundTxn(refund.credits, refund.reason, t.id);
  addNotification('task_completed', '您的设计已生成完成', `「${(prompt || '设计出图').slice(0, 24)}」已生成，点击查看结果。`, t.id);
}

// ────────────────────────── HTTP 层 ──────────────────────────
function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}
const ok = (res, body) => send(res, 200, body);
const err = (res, code, detail, error_code, extra = {}) => send(res, code, { detail, error_code, ...extra });
const readBody = async(req) => req.bodyObj || {};
function codeSent(res) {
  ok(res, { detail: '验证码已发送', expires_in: 600, cooldown_seconds: 60, debug_code: '123456' });
}
function checkCode(code) {
  // 只有 123456 是「真的发出去」的码；111111 专门演示过期，其余一律错码
  if (code === DEMO_CODE) return null;
  if (code === '111111') return 'AUTH_CODE_EXPIRED';
  return 'AUTH_CODE_INVALID';
}
function tokenPair(email) {
  return {
    access_token: `mock_at_${uid('t')}`, refresh_token: `mock_rt_${uid('t')}`, token_type: 'bearer',
    user: { ...user, email: email ?? user.email },
    monthly_credit_granted: false,
  };
}
function last6(s) { return s.slice(-6); } // 已无调用方，保留占位防误删
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // 兼容 vite 代理：/api/v1 前缀会被原样转过来（proxy 无 rewrite）
  const path = url.pathname.replace(/^\/api\/v1/, '') || '/';
  const body = await readBody(req);
  const q = url.searchParams;

  try {
    // ── auth ──
    if (req.method === 'POST' && path === '/auth/captcha') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="56"><rect width="160" height="56" fill="#f3f4f6"/><text x="80" y="38" font-family="monospace" font-size="30" fill="#111" text-anchor="middle" letter-spacing="8">3861</text></svg>`;
      return ok(res, { captcha_id: uid('cap'), image_data_url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, expires_in: 300 });
    }
    if (req.method === 'POST' && path === '/auth/email/send-code') {
      const key = `email:${body.email}:${body.scene || 'register'}`;
      if ((codeCooldowns.get(key) || 0) > Date.now()) return err(res, 429, '发送太频繁，请稍后再试', 'AUTH_COOLDOWN', { retry_after_seconds: 30 });
      codeCooldowns.set(key, Date.now() + 20000); // mock 冷却 20s，方便演示
      return codeSent(res);
    }
    if (req.method === 'POST' && path === '/auth/email/register') {
      const bad = checkCode(body.code);
      if (bad === 'AUTH_CODE_INVALID') return err(res, 400, '验证码不正确', bad);
      if (bad === 'AUTH_CODE_EXPIRED') return err(res, 400, '验证码已过期，请重新获取', bad);
      if ((body.password || '').length < 8) return err(res, 400, '密码至少8位', 'GEN_INVALID_PARAMS');
      if (registeredEmails.has(body.email)) return err(res, 409, '该邮箱已注册', 'AUTH_EMAIL_EXISTS');
      registeredEmails.add(body.email);
      emailPasswords.set(body.email, body.password); // 注册即建档，密码登录/重设都围绕这份档案
      return ok(res, tokenPair(body.email));
    }
    if (req.method === 'POST' && path === '/auth/sms/register') {
      const bad = checkCode(body.code);
      if (bad === 'AUTH_CODE_INVALID') return err(res, 400, '验证码不正确', bad);
      if (bad === 'AUTH_CODE_EXPIRED') return err(res, 400, '验证码已过期，请重新获取', bad);
      if ((body.password || '').length < 8) return err(res, 400, '密码至少8位', 'GEN_INVALID_PARAMS');
      registeredPhones.add(body.phone);
      user.phone = body.phone;
      return ok(res, tokenPair(null));
    }
    if (req.method === 'POST' && path === '/auth/email/login') {
      const bad = checkCode(body.code);
      if (bad === 'AUTH_CODE_INVALID') return err(res, 400, '验证码不正确', bad);
      if (bad === 'AUTH_CODE_EXPIRED') return err(res, 400, '验证码已过期，请重新获取', bad);
      // 注册制：未注册邮箱 404（detail 含「尚未注册」→ 前端哨兵自动引导去注册页）
      if (!registeredEmails.has(body.email)) return err(res, 404, '该邮箱尚未注册', 'AUTH_EMAIL_NOT_REGISTERED');
      user.email = body.email; // 登录身份回写 profile（A2-01 用户中心展示用）
      return ok(res, tokenPair(body.email));
    }
    if (req.method === 'POST' && path === '/auth/password/forgot') {
      return codeSent(res); // 防枚举：永远 200
    }
    if (req.method === 'POST' && path === '/auth/password/reset') {
      const bad = checkCode(body.code);
      if (bad === 'AUTH_CODE_INVALID') return err(res, 400, '验证码不正确', bad);
      if (bad === 'AUTH_CODE_EXPIRED') return err(res, 400, '验证码已过期，请重新获取', bad);
      if ((body.new_password || '').length < 8) return err(res, 400, '密码至少8位', 'GEN_INVALID_PARAMS');
      registeredEmails.add(body.email);
      emailPasswords.set(body.email, body.new_password); // 重设即改档
      return ok(res, tokenPair(body.email));
    }
    if (req.method === 'POST' && path === '/auth/sms/send-code') return codeSent(res);
    if (req.method === 'POST' && path === '/auth/sms/login') {
      // 注册制：未注册手机 404（detail 含「尚未注册」→ 前端哨兵自动引导去注册页）
      if (!registeredPhones.has(body.phone)) return err(res, 404, '该手机号尚未注册', 'AUTH_PHONE_NOT_REGISTERED');
      const bad = checkCode(body.code);
      if (bad === 'AUTH_CODE_INVALID') return err(res, 400, '验证码不正确', bad);
      if (bad === 'AUTH_CODE_EXPIRED') return err(res, 400, '验证码已过期，请重新获取', bad);
      user.phone = body.phone; // 登录身份回写 profile（A2-01 用户中心展示用）
      return ok(res, tokenPair(null));
    }
    if (req.method === 'POST' && path === '/auth/login') {
      // 邮箱密码登录：查档案对密码，不再放行所有密码
      if (!registeredEmails.has(body.email)) return err(res, 404, '该邮箱尚未注册', 'AUTH_EMAIL_NOT_REGISTERED');
      if (emailPasswords.get(body.email) !== body.password) return err(res, 400, '密码不正确', 'AUTH_PASSWORD_MISMATCH');
      user.email = body.email;
      return ok(res, tokenPair(body.email));
    }
    if (req.method === 'POST' && path === '/auth/refresh') return ok(res, tokenPair(null));
    if (req.method === 'GET' && path === '/auth/me') return ok(res, { ...userProfile });

    // ── users / billing ──
    if (req.method === 'GET' && path === '/users/profile') {
      // credit/unread/email/phone 活聚合（契约 A2-01）：userProfile 是启动快照，登录回写的身份要从 user 活取
      return ok(res, {
        ...userProfile,
        email: user.email,
        phone: user.phone,
        credit: { ...userProfile.credit, balance: creditBalance.balance },
        unread_count: notifications.filter((n) => !n.read).length,
      });
    }
    if (req.method === 'PATCH' && path === '/users/language') { user.language = body.language; return ok(res, userProfile); }
    if (req.method === 'GET' && path === '/billing/credits') return ok(res, creditBalance);
    if (req.method === 'GET' && path === '/billing/prices') return ok(res, priceList);
    if (req.method === 'GET' && path === '/billing/transactions') {
      let items = transactions;
      const type = q.get('type');
      if (type) items = items.filter((t) => t.type === type);
      const limit = Math.min(Number(q.get('limit') || 20), 100);
      const offset = Number(q.get('offset') || 0);
      return ok(res, { items: items.slice(offset, offset + limit), total: items.length, limit, offset });
    }

    // ── generation ──
    // 需求解析（非契约旧端点，初始生成链路第一步；快速生命周期，不扣点）
    if (req.method === 'POST' && path === '/garments/extract-data') {
      const t = seedTask(uid('task'), { task_type: 'garment_extract', _count: 0, _prompt: body.prompt || '', _kind: 'extract' });
      runTask(t, { queueMs: 1000, stageMs: 1500, stages: ['understand'] });
      return send(res, 202, { task: publicTask(t) });
    }
    // 解析结果落库成单品（非契约旧端点，链路第二步）
    if (req.method === 'POST' && path === '/garments/from-task') {
      const src = tasks.get(body.task_id || '');
      const designData = src?.result_json || { basic: {}, design: {}, production: {} };
      return ok(res, {
        project_id: body.project_id || 'prj_mock01',
        garment: { id: 'gar_new01', project_id: body.project_id || 'prj_mock01' },
        version: { id: `ver_${uid('v')}`, design_data_json: body.design_data_json || designData },
      });
    }
    if (req.method === 'POST' && path === '/ai/design-images' || req.method === 'POST' && path === '/ai/design-refine' || req.method === 'POST' && path === '/ai/image-edit') {
      // 预览与实际生图入口一致：每次固定生成一张。
      const count = 1;
      const credits = path === '/ai/design-images' ? count : 1;
      if (creditBalance.balance < credits) return err(res, 409, '积分不足，请先充值', 'BILLING_INSUFFICIENT_CREDITS');
      creditBalance.balance -= credits;
      transactions.unshift({ id: uid('txn'), type: 'consume', amount: -credits, balance_after: creditBalance.balance,
        remark: '设计出图', task_id: null, snapshot: { task_type: 'design_images', quantity: credits, unit_price: 1,
          unit: 'per_image', price_version: priceList.version, charged_credits: credits, rule_id: 'AI_GENERATION_PRICES' },
        created_at: now() });
      const t = seedTask(uid('task'), { _count: count, _prompt: body.prompt || '' });
      runTask(t);
      return send(res, 202, { task: publicTask(t) });
    }

    // ── tasks ──
    if (req.method === 'GET' && path === '/tasks') {
      let list = [...tasks.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const phase = q.get('phase');
      const bizType = q.get('biz_type');
      const bizId = q.get('biz_id');
      if (bizType) list = list.filter((t) => t.biz_type === bizType); // 项目/系列恢复任务用；种子任务无归属，不串台
      if (bizId) list = list.filter((t) => t.biz_id === bizId);
      if (q.get('active') === 'true') list = list.filter((t) => ['queued', 'generating'].includes(t.phase));
      else if (phase) list = list.filter((t) => t.phase === phase);
      const limit = Math.min(Number(q.get('limit') || 50), 200);
      return ok(res, list.slice(0, limit).map(publicTask));
    }
    let m = path.match(/^\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const t = tasks.get(m[1]);
      return t ? ok(res, publicTask(t)) : err(res, 404, '任务不存在', 'TASK_NOT_FOUND');
    }
    m = path.match(/^\/tasks\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && m) {
      const t = tasks.get(m[1]);
      if (!t) return err(res, 404, '任务不存在', 'TASK_NOT_FOUND');
      if (['succeeded', 'failed'].includes(t.phase)) return err(res, 409, '任务已结束，无法取消', 'TASK_ALREADY_FINISHED');
      t.phase = 'failed'; t.status = 'cancelled'; t.progress_stage = 'cancelled'; t.finished_at = now();
      t.error_code = 'TASK_CANCELLED'; t.error_message = '任务已取消'; t.retryable = false;
      return ok(res, publicTask(t));
    }
    m = path.match(/^\/tasks\/([^/]+)\/retry$/);
    if (req.method === 'POST' && m) {
      const t = tasks.get(m[1]);
      if (!t) return err(res, 404, '任务不存在', 'TASK_NOT_FOUND');
      if (t.phase !== 'failed' || !t.retryable) return err(res, 409, '当前状态不可重试', 'TASK_RETRY_NOT_ALLOWED');
      if (t.attempt_count >= (t.max_attempts || 3)) return err(res, 409, '已达到最大重试次数', 'TASK_RETRY_NOT_ALLOWED');
      t.phase = 'queued'; t.status = 'queued'; t.progress_stage = null; t.attempt_count += 1;
      t._retriedOnce = true; t.error_code = null; t.error_message = null; t.retryable = null;
      if (t.task_type === 'design_images') t._count = 1;
      t.result_json = null; t.next_run_at = new Date(Date.now() + 3000).toISOString();
      t.estimated_wait_seconds = 6; t.queue_position = 1;
      runTask(t);
      return ok(res, publicTask(t));
    }

    // ── notifications ──
    if (req.method === 'GET' && path === '/notifications') {
      let items = notifications;
      if (q.get('unread_only') === 'true') items = items.filter((n) => !n.read);
      const type = q.get('type');
      if (type) items = items.filter((n) => n.type === type);
      const limit = Math.min(Number(q.get('limit') || 20), 50);
      const offset = Number(q.get('offset') || 0);
      return ok(res, { items: items.slice(offset, offset + limit), total: items.length,
        unread_count: notifications.filter((n) => !n.read).length });
    }
    if (req.method === 'GET' && path === '/notifications/unread-count') {
      return ok(res, { unread_count: notifications.filter((n) => !n.read).length });
    }
    m = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (req.method === 'POST' && m) {
      const n = notifications.find((x) => x.id === m[1]);
      if (!n) return err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
      n.read = true;
      return ok(res, n);
    }
    if (req.method === 'POST' && path === '/notifications/read-all') {
      const updated = notifications.filter((n) => !n.read).length;
      notifications.forEach((n) => (n.read = true));
      return ok(res, { updated });
    }

    // ── 项目库（现网旧端点，非本契约）：列表+详情快照，点开即进有内容的单款编辑器 ──
    if (req.method === 'GET' && path === '/projects') {
      const list = [...projects.values()].sort((a, b) => String(b.last_modified_at).localeCompare(String(a.last_modified_at)));
      return ok(res, list.map(projectSummary));
    }
    if (req.method === 'POST' && path === '/projects') {
      const id = uid('prj');
      const p = {
        id, user_id: user.id, name: body.name || '未命名设计',
        thumbnail_url: body.thumbnail_url || null, status: body.status || 'draft',
        source_type: body.source_type || 'manual', collection_id: body.collection_id || null,
        collection_name: body.collection_name || null, garment_count: body.garment_count || 0,
        is_unlocked: false, session_state_json: body.session_state_json || null,
        created_at: now(), last_modified_at: body.last_modified_at || now(), updated_at: now(),
      };
      projects.set(id, p);
      return send(res, 201, projectSummary(p));
    }
    m = path.match(/^\/projects\/([^/]+)\/snapshot$/);
    if (req.method === 'PUT' && m) {
      const p = projects.get(m[1]) || {
        id: m[1], user_id: user.id, status: 'draft', source_type: 'manual', collection_id: null,
        collection_name: null, garment_count: 0, is_unlocked: false, created_at: now(),
      };
      p.name = body.name || p.name;
      p.thumbnail_url = body.thumbnail_url ?? p.thumbnail_url;
      p.collection_name = body.collection_name ?? p.collection_name;
      p.garment_count = body.garment_count ?? p.garment_count;
      p.last_modified_at = body.last_modified_at || now();
      p.updated_at = now();
      if (body.session_state_json !== undefined) p.session_state_json = body.session_state_json; // 快照回存，重开项目内容不丢
      projects.set(m[1], p);
      return ok(res, projectSummary(p));
    }
    m = path.match(/^\/projects\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const p = projects.get(m[1]);
      return p ? ok(res, { ...projectSummary(p), session_state_json: p.session_state_json }) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }
    if (req.method === 'DELETE' && m) {
      return projects.delete(m[1]) ? ok(res, { detail: 'deleted' }) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }

    // ── 系列（1.0 旧端点：列表+详情给系列页；/results 是 B2-01 合同树）──
    if (req.method === 'GET' && path === '/collections') {
      return ok(res, [...legacyCollections.values()]);
    }
    if (req.method === 'POST' && path === '/collections') {
      const id = uid('col');
      const c = {
        id, name: body.name || '未命名系列', status: 'draft',
        thumbnail_url: null, product_count: 0, target_product_count: body.target_product_count || 3,
        download_unlocked: false, key_params_json: body.key_params_json || null,
        confirmed_brief_json: body.confirmed_brief_json || null, research_status: 'pending', research_json: null,
        concepts_status: 'pending', concepts_json: null, products_json: [], blueprints_status: 'pending',
        blueprints_json: null, marketing_status: null, marketing_json: null,
        created_at: now(), updated_at: now(),
      };
      legacyCollections.set(id, c);
      return send(res, 201, c);
    }
    m = path.match(/^\/collections\/([^/]+)\/results$/);
    if (req.method === 'GET' && m) {
      const c = collectionTrees.get(m[1]);
      return c ? ok(res, c) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }
    m = path.match(/^\/collections\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const c = legacyCollections.get(m[1]);
      return c ? ok(res, c) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }
    if (req.method === 'DELETE' && m) {
      return legacyCollections.delete(m[1]) ? ok(res, { detail: 'deleted' }) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }
    m = path.match(/^\/garments\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const seed = garmentSeedById(m[1]);
      return ok(res, { garment: { id: m[1], download_unlocked: false, has_files: Boolean(seed) } });
    }
    m = path.match(/^\/garments\/([^/]+)\/detail$/);
    if (req.method === 'GET' && m) {
      const g = garmentDetails.get(m[1]);
      return g ? ok(res, g) : err(res, 404, '资源不存在', 'TASK_NOT_FOUND');
    }

    // ── knowledge（非契约旧端点，用户中心-知识库用）──
    if (req.method === 'GET' && path === '/knowledge/sources') {
      return ok(res, [
        { id: 'knw_01', source_type: 'file', name: '2026SS 面料采购清单.xlsx', file_size: 48213, status: 'ready', content_status: 'parsed', created_at: '2026-09-25T10:00:00Z' },
        { id: 'knw_02', source_type: 'file', name: '品牌手册_BrandBook_v3.pdf', file_size: 3582341, status: 'ready', content_status: 'parsed', created_at: '2026-09-24T15:30:00Z' },
        { id: 'knw_03', source_type: 'link', name: 'https://www.example-brand.com/collections', file_size: null, status: 'ready', content_status: 'parsed', created_at: '2026-09-22T09:12:00Z' },
      ]);
    }
    if (req.method === 'GET' && path === '/knowledge/company-research/reports') {
      return ok(res, [{
        id: 'crr_mock01', company_name: 'Mock 服饰工作室', company_website: 'https://example.com',
        roi_goal: '缩短开品周期：从 3 周压到 3 天，单季省 40% 打样费', status: 'completed',
        strategy_title: '小单快反 × 安静奢华：2026 品类扩张策略',
        strategy_report_markdown: '## 摘要\n以针织+衬衫为核心品类，先做 3 个胶囊系列试水，再用数据回流决定扩款。',
        company_profile_json: {
          region: 'CN', target_audience: ['25-35 都市通勤女性', '轻度假家庭客'],
          core_categories: ['针织开衫', '衬衫', '连衣裙'], design_style: ['极简', '复古学院'],
          price_strategy: '轻中端 ￥399-1299', competitors: ['品牌A', '品牌B'],
          brand_summary: '主打「安静奢华」的通勤基本款，材质叙事为核心卖点。',
        },
        company_dna_json: { tags: ['小单快反', '材质叙事', '基础款扩张'] },
        concept_images_json: null, error_message: null,
      }]);
    }

    // ── leads / meta ──
    if (req.method === 'GET' && path === '/meta/next-step-buttons') {
      return ok(res, { context: 'result_page', buttons: [
        { action: 'edit_image', label: '改图', enabled: true, config: null },
        { action: 'regenerate', label: '再来一张', enabled: true, config: { default_count: 1 } },
        { action: 'consult', label: '咨询下单', enabled: true, config: { modal_title: '留下联系方式，买手顾问 1 个工作日内联系你' } },
      ] });
    }
    if (req.method === 'POST' && path === '/leads') {
      const phone = body.phone || '';
      if (leadsByPhone.get(phone) && Date.now() - leadsByPhone.get(phone) < 86400_000) {
        return err(res, 429, '提交太频繁，请稍后再试', 'RATE_LIMITED', { retry_after_seconds: 3600 });
      }
      leadsByPhone.set(phone, Date.now());
      if (!body.name || !phone) return err(res, 422, '姓名和手机号为必填', 'GEN_INVALID_PARAMS');
      return send(res, 201, { id: uid('lead'), status: 'received', created_at: now() });
    }

    return err(res, 404, `mock 未实现: ${req.method} ${path}`, null);
  } catch (e) {
    return err(res, 500, `mock 内部错误: ${e.message}`, 'INTERNAL_ERROR');
  }
});


// Independent browser-local API simulation. No upstream API calls or model keys.
const F = window.CREABRA_DEMO_FIXTURES;
F.brief_finalizer={...F.brief_finalizer,season:'2026 秋冬',targetAudience:'25-35 岁都市女性',marketPositioning:'中端通勤',normalizedDirection:'燕麦米色针织通勤胶囊系列',mustHave:['舒适针织','易搭配'],shouldAvoid:['复杂装饰'],researchFocus:['通勤需求','材质与成本'],customRequirements:[]};
F.collection_concept.colorScheme={concept:'低饱和都市配色',colors:[{name:'燕麦米',pantone:'Warm Oat',hex:'#CDBB9C',reason:'柔和基础色'},{name:'雾蓝',pantone:'Mist Blue',hex:'#8BA2B0',reason:'点缀色'}]};
F.collection_concept.styleAndTone.atmosphere='温暖、安静的都市通勤';
const nativeFetch = window.fetch.bind(window);
const storageKey = 'creabra_share_demo_v1';
const originalProjects=new Map([...projects].map(([k,v])=>[k,JSON.stringify(v)]));
const originalCollections=new Map([...legacyCollections].map(([k,v])=>[k,JSON.stringify(v)]));
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved) {
    saved.projects.forEach(([k,v]) => projects.set(k,v));
    saved.collections.forEach(([k,v]) => legacyCollections.set(k,v));
    (saved.deletedProjects||[]).forEach(k=>projects.delete(k));
    (saved.deletedCollections||[]).forEach(k=>legacyCollections.delete(k));
  }
} catch { /* Seed data is the recovery path for unavailable browser storage. */ }
user.email = 'demo@creabra.com';
userProfile.email = user.email;
function persistDemo() {
  const changed=(map,original)=>[...map].filter(([k,v])=>original.get(k)!==JSON.stringify(v));
  try { localStorage.setItem(storageKey, JSON.stringify({projects:changed(projects,originalProjects),collections:changed(legacyCollections,originalCollections),deletedProjects:[...originalProjects.keys()].filter(k=>!projects.has(k)),deletedCollections:[...originalCollections.keys()].filter(k=>!legacyCollections.has(k))})); }
  catch { const label=document.querySelector?.('#creabra-demo-notice span');if(label)label.textContent='演示版 · 浏览器存储已满，当前内容仅本次有效'; }
}
try { localStorage.setItem('creabrea_engine_auth', JSON.stringify(tokenPair(user.email))); } catch {}
function schemaValue(schema, name = '', depth = 0) {
  if (!schema || depth > 10) return null;
  if (schema.enum?.length) return schema.enum[0];
  if ('default' in schema) return schema.default;
  const type = String(schema.type || (schema.properties ? 'object' : 'string')).toLowerCase();
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key,s]) => [key,schemaValue(s,key,depth+1)]));
  if (type === 'array') return Array.from({length:Math.min(schema.minItems || 2, 6)}, () => schemaValue(schema.items || {type:'string'},name,depth+1));
  if (type === 'boolean') return true;
  if (type === 'number' || type === 'integer') return schema.minimum || 10;
  if (/hex|colorCode/i.test(name)) return '#CDBB9C';
  if (/url|image/i.test(name)) return IMG.model1;
  if (/gender/i.test(name)) return 'Women';
  if (/category/i.test(name)) return 'Knitwear';
  if (/name|title/i.test(name)) return '都市通勤针织 · 模拟示例';
  return '模拟示例：燕麦米、落肩版型、羊毛混纺';
}
function geminiResult(request = {}) {
  const blob = JSON.stringify(request).toLowerCase();
  const config = request.config || request.generationConfig || {};
  if (config.imageConfig || config.responseModalities?.includes('IMAGE')) {
    // Generate a PNG in the browser so existing image decoders can consume it.
    const canvas = document.createElement('canvas'); canvas.width=768; canvas.height=1024;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#eee9df';ctx.fillRect(0,0,768,1024);
    ctx.fillStyle='#ccb997';ctx.beginPath();ctx.moveTo(250,230);ctx.lineTo(150,330);ctx.lineTo(100,590);ctx.lineTo(200,620);ctx.lineTo(240,400);ctx.lineTo(225,800);ctx.lineTo(543,800);ctx.lineTo(528,400);ctx.lineTo(568,620);ctx.lineTo(668,590);ctx.lineTo(618,330);ctx.lineTo(518,230);ctx.closePath();ctx.fill();
    ctx.fillStyle='#645b4e';ctx.font='24px sans-serif';ctx.fillText('CREABRA · 模拟生成示意图',190,940);
    return {candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:canvas.toDataURL().split(',')[1]}}]}}]};
  }
  const schema=config.responseJsonSchema || config.responseSchema;
  let value;
  const matched=F.json_rules.find(([,markers])=>markers.some(m=>blob.includes(m)));
  if (matched) value=F[matched[0]];
  else if (schema) value=schemaValue(schema);
  else if (config.responseMimeType==='application/json') value=garmentData('模拟设计');
  const textMatch=F.text_rules.find(([,markers])=>markers.some(m=>blob.includes(m)));
  const text=value!==undefined?JSON.stringify(value):textMatch?F.texts[textMatch[0]]:'模拟生成完成。这是用于体验页面与交互流程的示例内容。';
  return {text,candidates:[{content:{parts:[{text}]}}]};
}
function generatedResult(path, body) {
  const image=lookImage(1+Math.floor(Math.random()*6));
  if(path==='/ai/gemini/generate-content') return geminiResult(body.request);
  if(path==='/ai/route-intent') return {intent:/tech.?pack|工艺|规格/i.test(body.prompt||'')?'TECHPACK':'DESIGN'};
  if(path==='/ai/execution-plan') return F.execution_plan;
  if(path==='/ai/brief-clarifier/plan') return {summary:body.raw_requirement||'都市通勤系列',collection_name_suggestion:F.brief_finalizer.collectionName,questions:F.brief_clarifier.questions||[]};
  if(path==='/ai/brief-clarifier/finalize') return {brief:F.brief_finalizer};
  if(path==='/ai/design-images' && !/失败|fail/i.test(body.prompt||'')) return {model_image:image,flat_image:body.generate_flat?IMG.flat:''};
  if(path==='/ai/design-refine') return {updated_data:body.current_data||garmentData('修改后的模拟设计'),model_images:[image]};
  if(path==='/ai/image-edit') return {image};
  if(path==='/ai/tech-pack') return {tech_pack_text:F.texts.tech_pack_text,flat_image:IMG.flat,pattern_image:IMG.pattern,structured_data:{garmentName:'模拟针织',fabric:[],measurements:{},construction:[],pattern:[]}};
  if(path==='/ai/fabric') return {fabric_image:IMG.fabric,fabric_data:body.fabric_data||{id:uid('fab'),type:'羊毛混纺',composition:'70% 羊毛 30% 棉',weight:'260gsm',drape:'柔软',texture:'罗纹',description:'用于页面体验的模拟面料',alternatives:['棉混纺罗纹']},image:IMG.fabric};
  if(path==='/ai/marketing') return {plan:F.marketing_plan,materials:{prompts:F.marketing_prompts,images:[image,IMG.flat]}};
  if(path==='/ai/search-opportunities') return F.search_opportunities.map(x=>({...x,image_url:image}));
  if(path==='/ai/market-research') return {report:F.texts.deep_research};
  if(path==='/ai/tavily-search') return {formatted_results:'模拟搜索结果：通勤针织与低饱和配色示例，未执行实时网络搜索。'};
  if(path==='/ai/crawl-link') return {url:body.url,title:'模拟网页内容',content:'演示版未读取外部网站。以下为示例内容。',markdown:'## 模拟商品资料\n燕麦米针织开衫，落肩设计。',images:[image],products:[]};
  if(path==='/ai/fetch-remote-image') return {data_url:image};
  if(path==='/ai/collection/research') return {full_report:F.texts.deep_research,sections:[],summary:F.research_summary};
  if(path==='/ai/collection/concept') return {collection_name:body.collection_name,concept:F.collection_concept,mood_board_image:IMG.mood};
  if(path==='/ai/collection/products') return {products:F.collection_products.products.map((p,i)=>({id:uid('product'),spu:`SPU${i+1}`,name:p.productName,designData:garmentData(p.productName),images:{model:lookImage(i+1),flats:[IMG.flat],fabric:IMG.fabric},status:'completed',order:i,belongsToLook:p.belongsToLook})).slice(0,body.product_count||3)};
  if(path==='/ai/collection/blueprints') return {items:(body.products||[]).map((p,i)=>({id:uid('blue'),spu:p.spu,productName:p.name,blueprintImage:IMG.pattern,blueprintText:'模拟纸样示意，仅供界面体验。',status:'completed',order:i}))};
  if(path==='/ai/collection/marketing') return {items:(body.products||[]).map((p,i)=>({id:uid('mark'),spu:p.spu,productName:p.name,plan:F.marketing_plan,materials:{prompts:F.marketing_prompts,images:[image,IMG.flat]},status:'completed',order:i}))};
  return undefined;
}
function syncCollection(path,body,result) {
  const c=legacyCollections.get(body.collection_id);if(!c)return;
  const stage=path.split('/').pop();
  if(stage==='research'){c.research_status='completed';c.research_json={status:'completed',fullText:result.full_report,sections:result.sections,summary:result.summary};}
  if(stage==='concept'){c.concepts_status='completed';c.concepts_json={status:'completed',sections:[],collectionConcept:result.concept,moodBoardImage:result.mood_board_image};c.thumbnail_url=result.mood_board_image;}
  if(stage==='products'){c.products_json=result.products;c.product_count=result.products.length;}
  if(stage==='blueprints'){c.blueprints_status='completed';c.blueprints_json={...result,status:'completed'};}
  if(stage==='marketing'){c.marketing_status='completed';c.marketing_json={...result,status:'completed'};c.status='completed';}
  c.updated_at=now();persistDemo();
}
window.fetch=async function(input,init={}) {
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin!==location.origin || !url.pathname.startsWith('/api/v1/')) return nativeFetch(input,init);
  const path=url.pathname.slice('/api/v1'.length);
  const method=(init.method || input.method || 'GET').toUpperCase();
  let body={};
  try {body=typeof init.body==='string'?JSON.parse(init.body):{};}catch{}
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if (/^\/(payments|recharge|subscriptions|patterns|embroidery)(\/|$)/.test(path) && method!=='GET') return response({detail:'演示版仅供查看与模拟生成，不执行付款或生产文件交付。',error_code:'DEMO_ONLY'},422);
  if(path==='/auth/logout')return response({detail:'已退出演示账号'});
  if(path==='/assets/upload'){
    const file=init.body instanceof FormData?init.body.get('file'):null;
    const data=file?await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(file);}):IMG.model1;
    return response({id:uid('asset'),url:data,storage_url:data,public_url:data,file_name:file?.name||'demo.svg'});
  }
  if(path.startsWith('/ai/')&&method==='POST'){
    const result=generatedResult(path,body);
    if(result!==undefined){
      const t=seedTask(uid('task'),{task_type:path.slice(4).replaceAll('/','_'),biz_type:body.collection_id?'collection':body.project_id?'project':null,biz_id:body.collection_id||body.project_id||null,_demoResult:result});
      runTask(t);setTimeout(()=>syncCollection(path,body,result),4300);return response({task:publicTask(t)},202);
    }
  }
  if(method==='PATCH'&&/^\/collections\/[^/]+$/.test(path)){
    const c=legacyCollections.get(path.split('/').pop());if(!c)return response({detail:'系列不存在'},404);
    Object.assign(c,body,{updated_at:now()});persistDemo();return response(c);
  }
  if(method==='GET'&&path.includes('/collections/')&&path.endsWith('/garments'))return response([]);
  if(method==='GET'&&/\/(recharge|subscriptions|billing\/packages)/.test(path))return response([]);
  return await new Promise((resolve,reject)=>{
    let status=200;const headers={};
    const res={writeHead(s,h){status=s;Object.assign(headers,h);},end(text){persistDemo();resolve(new Response(text,{status,headers}));}};
    Promise.resolve(demoHandler({url:url.pathname+url.search,method,bodyObj:body},res)).catch(reject);
  });
};
function mountNotice(){
  const bar=document.createElement('div');bar.id='creabra-demo-notice';
  bar.style.cssText='position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#18181b;color:white;padding:10px 16px;border-radius:24px;font:12px sans-serif;box-shadow:0 4px 20px #0002;display:flex;align-items:center;gap:12px;max-width:94vw;';
  const label=document.createElement('span');label.textContent='演示版 · 模拟生成 · 无需模型 Token';bar.append(label);
  const info=document.createElement('button');info.textContent='体验说明';info.style.cssText='color:white;text-decoration:underline;white-space:nowrap;';
  info.onclick=()=>alert('这是 Creabra v0.2.0 的独立演示网站。\n\n可体验：示例项目、新建单款、模拟出图、修改设计、系列开品、任务中心。\n生成图片与报告都是示例，不代表真实 AI 效果。\n数据仅保存在当前浏览器，刷新后已保存项目可恢复。\n演示账号：demo@creabra.com / creabra123，验证码：123456。\n不执行真实付款、短信、网页抓取或生产文件交付。');bar.append(info);
  const reset=document.createElement('button');reset.textContent='重置演示';reset.style.cssText=info.style.cssText;
  reset.onclick=()=>{if(confirm('清除当前浏览器保存的演示项目，恢复初始示例？')){localStorage.removeItem(storageKey);localStorage.removeItem('creabrea_engine_auth');location.reload();}};bar.append(reset);
  document.body.append(bar);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountNotice);else mountNotice();

})();