import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  TrendingUp, TrendingDown, Save, Plus, Wallet, LineChart as LineIcon, ChevronDown,
  Target, Activity, RefreshCw,
} from 'lucide-react';

/* =========================================================================================
   DEPOLAMA KATMANI
   Bu uygulama Claude.ai artifact ortamı dışında (Netlify'da) çalıştığı için window.storage
   yerine tarayıcının localStorage'ını aynı arayüzle (get/set/delete) sarmalıyoruz.
   ========================================================================================= */
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix) {
      const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
      return { keys };
    },
  };
}

/* =========================================================================================
   CANLI PİYASA VERİSİ — sunucu fonksiyonu YOK, tarayıcı doğrudan 3 ücretsiz kaynağa gider:
   - Hisseler: Finnhub (VITE_FINNHUB_API_KEY ortam değişkeninden, build sırasında gömülür)
   - Döviz kuru (USD/TRY, EUR/TRY): Frankfurter — api.frankfurter.dev/v1/latest (ESKİ .app/latest
     adresi 403/CORS sorunu veriyordu, API .dev alan adına ve /v1/ yol yapısına taşınmış — DÜZELTİLDİ)
   - Altın (XAU/USD): Gold-API — api.gold-api.com/price/XAU
   ========================================================================================= */
const ALL_SYMBOLS = ['NVDA', 'TSLA', 'GOOGL', 'META', 'SPCX', 'RKLB', 'MU', 'ASTS', 'PLTR', 'AAOI', 'SKHY', 'EOSE'];

// symbols verilmezse varsayılan listeyi kullanır; verilirse (örn. kullanıcının eklediği yeni hisseler dahil
// güncel pozisyon listesi) onu kullanır — böylece sonradan eklenen hisseler de fiyat güncellemesine dahil olur.
async function fetchLiveMarketData(symbols = ALL_SYMBOLS) {
  const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY;
  const prices = {};

  if (finnhubKey) {
    const stockResults = await Promise.all(
      symbols.map(async (sym) => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`);
          if (!res.ok) return [sym, null];
          const data = await res.json();
          return [sym, typeof data.c === 'number' && data.c > 0 ? data.c : null];
        } catch (e) {
          return [sym, null];
        }
      })
    );
    stockResults.forEach(([sym, price]) => { if (price) prices[sym] = price; });
  }

  let usdTry = null, usdEur = null, eurTry = null;
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR');
    const fx = await res.json();
    usdTry = fx?.rates?.TRY ?? null;
    usdEur = fx?.rates?.EUR ?? null;
    eurTry = usdTry && usdEur ? usdTry / usdEur : null;
  } catch (e) { /* kur alınamazsa null döner, çağıran taraf statik yedeği kullanır */ }

  let gramAltinTry = null;
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU');
    const gold = await res.json();
    const xauUsd = typeof gold?.price === 'number' ? gold.price : null;
    if (xauUsd && usdTry) gramAltinTry = (xauUsd / 31.1035) * usdTry;
  } catch (e) { /* altın alınamazsa null döner */ }

  const payload = { updatedAt: new Date().toISOString(), usdTry, usdEur, eurTry, gramAltinTry, prices };

  // Anlık gösterim için son başarılı sonucu localStorage'a da yedekle
  try {
    if (Object.keys(prices).length > 0 || usdTry || gramAltinTry) {
      localStorage.setItem('market_data_cache', JSON.stringify(payload));
    }
  } catch (e) { /* depolama dolu/erişilemezse sorun değil */ }

  return payload;
}

function loadCachedMarketDataSync() {
  try {
    const raw = localStorage.getItem('market_data_cache');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Kullanıcı yeni bir hisse eklerken sadece sembolü (örn. "EOSE") yazdığında, Finnhub'ın şirket
// profili uç noktasından tam şirket adını ("Eos Energy Enterprises" gibi) otomatik çeker.
// Bulunamazsa ya da key yoksa, sembolü olduğu gibi isim olarak kullanır (arayüz bozulmaz).
async function resolveStockName(symbol) {
  const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY;
  if (!finnhubKey) return symbol;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${finnhubKey}`);
    if (!res.ok) return symbol;
    const data = await res.json();
    return (data && data.name) ? data.name : symbol;
  } catch (e) {
    return symbol;
  }
}

/* =========================================================================================
   ORTAK RENK / BİÇİM YARDIMCILARI
   ========================================================================================= */
const INK = '#22322E';
const PARCHMENT = '#F7F3EA';
const CARD = '#FFFFFF';
const SAGE = '#6E8B74';
const COPPER = '#B8783F';
const RUST = '#A24936';
const MUTED = '#8A8578';
const GOLD = '#C9A94A';
const PALETTE = ['#6E8B74', '#B8783F', '#5B7A99', '#A24936', '#C9A94A', '#7C6A93'];

const fmtTL = (n) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n || 0)) + ' TL';
const fmtUSD = (n) => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtEUR = (n) => '€' + new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtPct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
const parseNum = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(',', '.').trim();
  if (cleaned === '' || cleaned === '-' || cleaned.endsWith('.')) {
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

/* =========================================================================================
   PORTFÖY PANOSU
   ========================================================================================= */
const MARKET_DATA = {
  lastUpdated: '2026-08-19 (Trade Republic resmi Vermögensübersicht ekstresi)',
  usdTry: 47.88,
  usdEur: 0.8638,
  eurTry: 55.43,
  indices: {
    sp500: 7691.76,
    sp500Chg: -0.69,
    nasdaq: 26289.71,
    nasdaqChg: -1.33,
  },
  prices: {
    NVDA: 220.27,
    TSLA: 311.21,
    GOOGL: 362.09,
    META: 592.10,
    SPCX: 138.46,
    RKLB: 75.71,
    MU: 939.25,
    ASTS: 65.87,
    PLTR: 175.03,
    AAOI: 125.53,
    SKHY: 159.81,
    BTC: 65000,
    ETH: 1911,
    XAU: 4097.50,
    GRAM_ALTIN_TRY: 6737.19,
  },
};

const STOCK_META = {
  NVDA: { name: 'Nvidia' },
  TSLA: { name: 'Tesla' },
  GOOGL: { name: 'Alphabet (Google)' },
  META: { name: 'Meta' },
  SPCX: { name: 'SpaceX' },
  RKLB: { name: 'Rocket Lab' },
  MU: { name: 'Micron' },
  ASTS: { name: 'AST SpaceMobile' },
  PLTR: { name: 'Palantir' },
  AAOI: { name: 'Applied Optoelectronics' },
  SKHY: { name: 'SK Hynix (ADR)' },
  EOSE: { name: 'Eos Energy Enterprises' },
};

const TIER_PLANS = {
  NVDA: { tiers: [{ threshold: 0.5, sell: 0.15 }, { threshold: 1.0, sell: 0.20 }, { threshold: 1.5, sell: 0.20 }, { threshold: 2.5, sell: 0.15 }], core: 0.30 },
  TSLA: { tiers: [{ threshold: 0.4, sell: 0.20 }, { threshold: 0.8, sell: 0.20 }, { threshold: 1.5, sell: 0.20 }, { threshold: 3.0, sell: 0.15 }], core: 0.25 },
  SPCX: { tiers: [{ threshold: 0.3, sell: 0.25 }, { threshold: 0.6, sell: 0.20 }, { threshold: 1.0, sell: 0.20 }, { threshold: 2.0, sell: 0.10 }], core: 0.25 },
  RKLB: { tiers: [{ threshold: 0.4, sell: 0.20 }, { threshold: 0.8, sell: 0.20 }, { threshold: 1.5, sell: 0.20 }, { threshold: 2.5, sell: 0.15 }], core: 0.25 },
};

// Sahip olunan ama TIER_PLANS'ta özel ayarı olmayan hisseler için genel varsayılan kâr alma planı
// (örn. GOOGL, META, MU, ASTS, PLTR ileride pozisyon açılırsa otomatik plan alsın)
const DEFAULT_TIER_PLAN = {
  tiers: [{ threshold: 0.5, sell: 0.20 }, { threshold: 1.0, sell: 0.20 }, { threshold: 1.5, sell: 0.20 }, { threshold: 2.5, sell: 0.15 }],
  core: 0.25,
};

const DEFAULT_POSITIONS = {
  eurCash: { name: 'EUR Nakit', amount: 10000 },
  // Hisse satışından gelen, tekrar hisseye yatırılmak üzere bekleyen nakit — genel EUR Nakit'ten ayrı, ABD Hisseleri bölümünde gösterilir.
  stockCash: { name: 'Hisse Satış Nakdi (yeniden yatırılacak)', amount: 741.76 },
  // Kapatılan pozisyonlardan realize edilen kâr/zarar geçmişi — kalıcı bir kayıt, hisseler silinse de burada kalır.
  realizedGains: [
    { symbol: 'AAOI', date: '17 Ağustos 2026', amount: 26.32 },
    { symbol: 'SKHY', date: '17 Ağustos 2026', amount: 12.14 },
    { symbol: 'RKLB', date: '20 Ağustos 2026 (zarar kes)', amount: -104.96 },
    { symbol: 'ASTS', date: '20 Ağustos 2026 (zarar kes)', amount: -64.34 },
    { symbol: 'SPCX', date: '20 Ağustos 2026 (zarar kes)', amount: 8.74 },
    { symbol: 'AAOI', date: '20 Ağustos 2026 (zarar kes)', amount: -6.84 },
  ],
  altin: { name: 'Altın', qty: 13, unit: 'gram', costTotal: 81500 },
  stocks: [
    { symbol: 'SPCX', qty: 5, cost: 132.72, broker: 'Trade Republic (Einstandskurs €114,66)' },
    { symbol: 'RKLB', qty: 15, cost: 72.31, broker: 'Trade Republic (Einstandskurs €62,47)' },
    { symbol: 'ASTS', qty: 10, cost: 64.36, broker: 'Trade Republic (Einstandskurs €55,60)' },
    { symbol: 'EOSE', qty: 20, cost: 3.44, broker: 'Trade Republic (Einstandskurs €2,97)', name: 'Eos Energy Enterprises' },
    { symbol: 'NVDA', qty: 0, cost: 0, broker: '' },
    { symbol: 'TSLA', qty: 0, cost: 0, broker: '' },
    { symbol: 'GOOGL', qty: 0, cost: 0, broker: '' },
    { symbol: 'META', qty: 0, cost: 0, broker: '' },
    { symbol: 'MU', qty: 0, cost: 0, broker: '' },
    { symbol: 'PLTR', qty: 0, cost: 0, broker: '' },
    { symbol: 'AAOI', qty: 0, cost: 0, broker: 'Kapatıldı — $128,81\'den zarar-kes satışı, -$7,92 (-%5,4) zarar, 20 Ağustos' },
    { symbol: 'SKHY', qty: 0, cost: 0, broker: 'Kapatıldı — €151,00\'den satıldı, net €61,53 alındı, gerçek kâr +€12,14 (+%22,48), 17 Ağustos' },
  ],
};

let LIVE_RATES = { usdTry: null, usdEur: null, eurTry: null };
const getRates = () => ({
  usdTry: LIVE_RATES.usdTry || MARKET_DATA.usdTry,
  usdEur: LIVE_RATES.usdEur || MARKET_DATA.usdEur,
  eurTry: LIVE_RATES.eurTry || MARKET_DATA.eurTry,
});
const usdToEurDisplay = (n) => fmtEUR((n || 0) * getRates().usdEur);
const tlToEurDisplay = (n) => fmtEUR((n || 0) / getRates().eurTry);

// Son 30 günün kapanış fiyatlarından basit bir SVG çizgi grafiği çizer (kütüphane gerekmez)
function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const w = 64, h = 24, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function PortfolioDashboard() {
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [expandedTiers, setExpandedTiers] = useState({});

  const [expandedChart, setExpandedChart] = useState({});

  const [showEur, setShowEur] = useState(false);

  const [livePrices, setLivePrices] = useState({});
  const [ratesTick, setRatesTick] = useState(0);
  const [ratesLive, setRatesLive] = useState(false);
  const [liveGramAltin, setLiveGramAltin] = useState(null);
  const [liveRatings, setLiveRatings] = useState({});
  const [assetAnalysis, setAssetAnalysis] = useState({});
  const [analysisLoading, setAnalysisLoading] = useState({});
  const [analysisError, setAnalysisError] = useState({});
  const [claudeRefreshing, setClaudeRefreshing] = useState(false);
  const [claudeRefreshMsg, setClaudeRefreshMsg] = useState('');

  // Yeni hisse ekleme (sembol → otomatik isim çözümleme + arama önerileri)
  const [newStockSymbol, setNewStockSymbol] = useState('');
  const [newStockQty, setNewStockQty] = useState('');
  const [newStockCost, setNewStockCost] = useState('');
  const [stockSuggestions, setStockSuggestions] = useState([]);
  const [addingStock, setAddingStock] = useState(false);
  const [addStockMsg, setAddStockMsg] = useState('');

  // Sırayı hedef pozisyona taşımak için her satırda gösterilen küçük "şu sıraya git" kutusu
  const [moveToInput, setMoveToInput] = useState({});

  // Sparkline (son 30 gün mini fiyat eğrisi) — sembol başına bir kere çekilip önbelleğe alınır
  const [sparklines, setSparklines] = useState({});

  // Yedekten geri yükleme için gizli dosya seçici referansı
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    (async () => {
      const hasStorage = typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function';
      if (!hasStorage) { setLoading(false); return; }
      try {
        const pos = await window.storage.get('positions_v2', false);
        if (pos && pos.value) setPositions(JSON.parse(pos.value));
      } catch (e) { /* no saved positions yet, keep defaults */ }
      try {
        const hist = await window.storage.get('history', false);
        if (hist && hist.value) setHistory(JSON.parse(hist.value));
      } catch (e) { /* no saved history yet */ }
      setLoading(false);
    })();
  }, []);

  const savePositions = async (next) => {
    setPositions(next);
    const hasStorage = typeof window !== 'undefined' && window.storage && typeof window.storage.set === 'function';
    if (!hasStorage) {
      setSaveMsg('Bu ortamda kalıcı kayıt yok, değişiklik sadece bu oturumda geçerli');
      setTimeout(() => setSaveMsg(''), 2500);
      return;
    }
    try {
      const result = await window.storage.set('positions_v2', JSON.stringify(next), false);
      if (!result) throw new Error('boş yanıt');
      setSaveMsg('Kaydedildi');
      setTimeout(() => setSaveMsg(''), 1500);
    } catch (e) {
      console.error('Storage save error:', e);
      setSaveMsg('Kaydetme hatası, tekrar deniyorum...');
      try {
        await window.storage.set('positions_v2', JSON.stringify(next), false);
        setSaveMsg('Kaydedildi');
      } catch (e2) {
        console.error('Storage retry failed:', e2);
        setSaveMsg('Kaydedilemedi — değişiklik bu oturumda geçerli, sayfa yenilenirse kaybolabilir');
      }
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  /* ===== Hisse ekleme: sembol yazınca Finnhub'dan otomatik isim önerisi ===== */
  const searchStockSuggestions = async (query) => {
    const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY;
    if (!finnhubKey || !query || query.trim().length < 1) { setStockSuggestions([]); return; }
    try {
      const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${finnhubKey}`);
      const data = await res.json();
      const results = (data?.result || [])
        .filter(r => r.type === 'Common Stock' || !r.type)
        .slice(0, 6)
        .map(r => ({ symbol: r.symbol, name: r.description }));
      setStockSuggestions(results);
    } catch (e) {
      setStockSuggestions([]);
    }
  };

  const addNewStock = async (forcedSymbol, forcedName) => {
    const sym = (forcedSymbol || newStockSymbol).trim().toUpperCase();
    if (!sym) return;
    setAddingStock(true);
    setAddStockMsg('');
    const existing = positions.stocks.find(s => s.symbol === sym);
    let next;
    if (existing) {
      next = {
        ...positions,
        stocks: positions.stocks.map(s => s.symbol === sym
          ? { ...s, qty: newStockQty || s.qty, cost: newStockCost || s.cost }
          : s),
      };
    } else {
      next = {
        ...positions,
        stocks: [...positions.stocks, { symbol: sym, qty: newStockQty || 0, cost: newStockCost || 0, broker: '', name: forcedName || sym }],
      };
    }
    await savePositions(next);
    setNewStockSymbol(''); setNewStockQty(''); setNewStockCost(''); setStockSuggestions([]);
    setAddingStock(false);
    setAddStockMsg(`${sym} listeye eklendi`);
    setTimeout(() => setAddStockMsg(''), 2500);

    if (!forcedName) {
      const resolvedName = await resolveStockName(sym);
      setPositions(prev => {
        const updated = { ...prev, stocks: prev.stocks.map(s => s.symbol === sym ? { ...s, name: resolvedName } : s) };
        window.storage?.set('positions_v2', JSON.stringify(updated), false).catch(() => {});
        return updated;
      });
    }
    fetchAllViaClaude();
  };

  const removeStock = (symbol) => {
    const next = { ...positions, stocks: positions.stocks.filter(s => s.symbol !== symbol) };
    savePositions(next);
  };

  /* ===== Sıralama: yukarı/aşağı taşı + belirli bir sıraya götür + otomatik sırala ===== */
  const moveStock = (index, direction) => {
    const arr = [...positions.stocks];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= arr.length) return;
    [arr[index], arr[targetIndex]] = [arr[targetIndex], arr[index]];
    savePositions({ ...positions, stocks: arr });
  };

  const moveStockToPosition = (fromIndex, toPosition1Based) => {
    const toIndex = Math.min(Math.max(0, toPosition1Based - 1), positions.stocks.length - 1);
    if (isNaN(toIndex) || toIndex === fromIndex) return;
    const arr = [...positions.stocks];
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
    savePositions({ ...positions, stocks: arr });
  };

  const sortStocksBy = (mode) => {
    const arr = [...positions.stocks];
    if (mode === 'az') {
      arr.sort((a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol));
    } else if (mode === 'value') {
      arr.sort((a, b) => {
        const va = parseNum(a.qty) * (livePrices[a.symbol] || MARKET_DATA.prices[a.symbol] || 0);
        const vb = parseNum(b.qty) * (livePrices[b.symbol] || MARKET_DATA.prices[b.symbol] || 0);
        return vb - va;
      });
    } else if (mode === 'pnl') {
      arr.sort((a, b) => {
        const pa = parseNum(a.cost) > 0 ? (((livePrices[a.symbol] || MARKET_DATA.prices[a.symbol] || 0) - parseNum(a.cost)) / parseNum(a.cost)) : -Infinity;
        const pb = parseNum(b.cost) > 0 ? (((livePrices[b.symbol] || MARKET_DATA.prices[b.symbol] || 0) - parseNum(b.cost)) / parseNum(b.cost)) : -Infinity;
        return pb - pa;
      });
    }
    savePositions({ ...positions, stocks: arr });
  };

  /* ===== Yedekleme / Geri Yükleme ===== */
  const exportBackup = async () => {
    const historyRaw = await window.storage?.get('history', false).catch(() => null);
    const actualsRaw = await window.storage?.get('projection_actuals', false).catch(() => null);
    const backup = {
      exportedAt: new Date().toISOString(),
      positions,
      history: historyRaw?.value ? JSON.parse(historyRaw.value) : [],
      projectionActuals: actualsRaw?.value ? JSON.parse(actualsRaw.value) : [],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finans-merkezi-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file) => {
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (backup.positions) await savePositions(backup.positions);
      if (backup.history) await window.storage?.set('history', JSON.stringify(backup.history), false);
      if (backup.projectionActuals) await window.storage?.set('projection_actuals', JSON.stringify(backup.projectionActuals), false);
      setSaveMsg('Yedek geri yüklendi, sayfayı yenile');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (e) {
      setSaveMsg('Yedek dosyası okunamadı — geçerli bir JSON mu?');
      setTimeout(() => setSaveMsg(''), 4000);
    }
  };

  /* ===== Sparkline: son 30 günün mini fiyat eğrisi (Finnhub candle, sembol başına bir kere) ===== */
  const fetchSparkline = async (symbol) => {
    const finnhubKey = import.meta.env.VITE_FINNHUB_API_KEY;
    if (!finnhubKey || sparklines[symbol]) return;
    try {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 30 * 24 * 60 * 60;
      const res = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${finnhubKey}`);
      const data = await res.json();
      if (data.s === 'ok' && Array.isArray(data.c) && data.c.length > 1) {
        setSparklines(prev => ({ ...prev, [symbol]: data.c }));
      } else {
        setSparklines(prev => ({ ...prev, [symbol]: null }));
      }
    } catch (e) {
      setSparklines(prev => ({ ...prev, [symbol]: null }));
    }
  };

  const toggleChart = (symbol, displayName) => {
    const willOpen = !expandedChart[symbol];
    setExpandedChart(prev => ({ ...prev, [symbol]: willOpen }));
    if (willOpen && !assetAnalysis[symbol] && !analysisLoading[symbol]) {
      fetchAssetAnalysis(symbol, displayName || symbol);
    }
  };

  // Uygulama her açıldığında ve "Güncelle" butonunda çağrılır — Netlify Functions YOK,
  // tarayıcı doğrudan Finnhub/Frankfurter/Gold-API'ye gidiyor.
  const applyMarketData = (parsed) => {
    if (parsed.prices && Object.keys(parsed.prices).length > 0) {
      setLivePrices(prev => ({ ...prev, ...parsed.prices }));
    }
    if (parsed.usdTry && parsed.eurTry) {
      LIVE_RATES = { usdTry: parsed.usdTry, usdEur: parsed.usdTry / parsed.eurTry, eurTry: parsed.eurTry };
      setRatesLive(true);
      setRatesTick(t => t + 1);
    }
    if (parsed.gramAltinTry) setLiveGramAltin(parsed.gramAltinTry);
  };

  useEffect(() => {
    const cached = loadCachedMarketDataSync();
    if (cached) applyMarketData(cached);
    fetchAllViaClaude();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllViaClaude = async () => {
    setClaudeRefreshing(true);
    setClaudeRefreshMsg('');
    try {
      const ownedSymbols = Array.from(new Set([...ALL_SYMBOLS, ...positions.stocks.map(s => s.symbol)]));
      const parsed = await fetchLiveMarketData(ownedSymbols);
      const gotStocks = parsed.prices && Object.keys(parsed.prices).length > 0;
      const gotFx = !!parsed.usdTry;
      const gotGold = !!parsed.gramAltinTry;
      applyMarketData(parsed);
      if (!gotStocks && !gotFx && !gotGold) {
        throw new Error('Hiçbir veri alınamadı');
      }
      const missing = [];
      if (!gotStocks) missing.push('hisseler (Finnhub key eksik/hatalı olabilir)');
      if (!gotFx) missing.push('kur');
      if (!gotGold) missing.push('altın');
      setClaudeRefreshMsg(missing.length === 0 ? 'Hisseler, kurlar ve altın güncellendi.' : `Güncellendi, ama şunlar alınamadı: ${missing.join(', ')}.`);
    } catch (e) {
      setClaudeRefreshMsg('Güncelleme başarısız — tekrar dene.');
    } finally {
      setClaudeRefreshing(false);
      setTimeout(() => setClaudeRefreshMsg(''), 4500);
    }
  };

  // Bir varlık (hisse veya altın) için güncel değerlendirme + varsa son bilanço verisini
  // Netlify'daki analyze.js fonksiyonu üzerinden (Anthropic key sunucuda gizli) çeker.
  const fetchAssetAnalysis = async (key, displayName) => {
    setAnalysisLoading(prev => ({ ...prev, [key]: true }));
    setAnalysisError(prev => ({ ...prev, [key]: null }));
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) throw new Error(`API hatası: ${response.status}`);
      const result = await response.json();
      const text = (result.text || '').trim();
      if (!text) throw new Error('Boş yanıt');
      setAssetAnalysis(prev => ({ ...prev, [key]: { text, fetchedAt: new Date().toISOString() } }));
    } catch (e) {
      setAnalysisError(prev => ({ ...prev, [key]: 'Değerlendirme alınamadı — ANTHROPIC_API_KEY tanımlı olmayabilir, ya da tekrar dene.' }));
    } finally {
      setAnalysisLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const computed = useMemo(() => {
    const stocks = positions.stocks.map((s) => {
      const qty = parseNum(s.qty);
      const cost = parseNum(s.cost);
      const price = livePrices[s.symbol] || MARKET_DATA.prices[s.symbol] || 0;
      const valueUSD = qty * price;
      const costUSD = qty * cost;
      const pnlPct = cost > 0 ? (price - cost) / cost : 0;
      const plan = TIER_PLANS[s.symbol] || (qty > 0 ? DEFAULT_TIER_PLAN : null);
      let tierRows = [];
      if (plan && cost > 0) {
        let remaining = qty;
        tierRows = plan.tiers.map((t, i) => {
          const targetPrice = cost * (1 + t.threshold);
          const sellQty = Math.round(qty * t.sell * 100) / 100;
          remaining = Math.round((remaining - sellQty) * 100) / 100;
          const reached = price >= targetPrice;
          return { idx: i + 1, threshold: t.threshold, targetPrice, sellQty, remaining, reached };
        });
      }
      const coreQty = plan ? Math.round(qty * plan.core * 100) / 100 : null;
      return {
        ...s,
        name: s.name || (STOCK_META[s.symbol] && STOCK_META[s.symbol].name) || s.symbol,
        qty, cost,
        rawQty: s.qty, rawCost: s.cost,
        price, valueUSD, costUSD, pnlPct, plan, tierRows, coreQty,
      };
    });
    const stocksTotalUSD = stocks.reduce((a, s) => a + s.valueUSD, 0);
    const stocksCostUSD = stocks.reduce((a, s) => a + s.costUSD, 0);
    const stocksPnlPct = stocksCostUSD > 0 ? (stocksTotalUSD - stocksCostUSD) / stocksCostUSD : 0;

    const eurCashAmount = parseNum(positions.eurCash?.amount);
    const stockCashEUR = parseNum(positions.stockCash?.amount);
    const realizedGains = positions.realizedGains || [];
    const realizedGainsTotal = realizedGains.reduce((acc, g) => acc + parseNum(g.amount), 0);
    const altinQty = parseNum(positions.altin?.qty);
    const altinCostTotal = parseNum(positions.altin?.costTotal);
    const altinGramPrice = liveGramAltin || MARKET_DATA.prices.GRAM_ALTIN_TRY;
    const altinGramPriceEur = altinGramPrice / getRates().eurTry;
    const altinCurrentValue = altinQty * altinGramPrice;
    const altinPnl = altinCurrentValue - altinCostTotal;
    const altinPnlPct = altinCostTotal > 0 ? altinPnl / altinCostTotal : 0;
    const altin = {
      ...positions.altin,
      qty: altinQty,
      rawQty: positions.altin?.qty,
      costTotal: altinCostTotal,
      rawCostTotal: positions.altin?.costTotal,
      gramPrice: altinGramPrice,
      gramPriceEur: altinGramPriceEur,
      currentValue: altinCurrentValue,
      pnl: altinPnl,
      pnlPct: altinPnlPct,
    };

    return {
      stocks, stocksTotalUSD, stocksCostUSD, stocksPnlPct,
      eurCashAmount, stockCashEUR, realizedGains, realizedGainsTotal, altin,
    };
  }, [positions, livePrices, liveGramAltin]);

  // Sahip olunan hisseler için mini fiyat eğrilerini (sparkline) önceden, sessizce çeker
  useEffect(() => {
    if (loading) return;
    positions.stocks.filter(s => parseNum(s.qty) > 0).forEach(s => fetchSparkline(s.symbol));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, positions.stocks.length]);

  const allocationDataUSD = useMemo(() => {
    return computed.stocks.filter(s => s.qty > 0).map(s => ({ name: s.name, value: s.valueUSD }));
  }, [computed]);

  const saveSnapshot = async () => {
    const entry = {
      date: new Date().toISOString().slice(0, 10),
      eurCash: Math.round(computed.eurCashAmount),
      altinTotal: Math.round(computed.altin.currentValue),
      usdTotal: Math.round(computed.stocksTotalUSD),
    };
    const next = [...history.filter(h => h.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date));
    setHistory(next);
    const hasStorage = typeof window !== 'undefined' && window.storage && typeof window.storage.set === 'function';
    if (!hasStorage) {
      setSaveMsg('Bu ortamda kalıcı kayıt yok');
      setTimeout(() => setSaveMsg(''), 2000);
      return;
    }
    try {
      await window.storage.set('history', JSON.stringify(next), false);
      setSaveMsg('Bugünün değeri kaydedildi');
    } catch (e) {
      console.error('History save error:', e);
      setSaveMsg('Kaydetme hatası');
    }
    setTimeout(() => setSaveMsg(''), 2500);
  };

  const updateStockField = (listKey, symbol, field, value) => {
    const next = {
      ...positions,
      [listKey]: positions[listKey].map(s => s.symbol === symbol ? { ...s, [field]: value } : s)
    };
    setPositions(next);
  };

  const updateAltin = (field, value) => {
    setPositions({ ...positions, altin: { ...positions.altin, [field]: value } });
  };

  const toggleTiers = (symbol) => {
    setExpandedTiers(prev => ({ ...prev, [symbol]: !prev[symbol] }));
  };

  if (loading) {
    return <div style={{ background: PARCHMENT, minHeight: '60vh' }} className="flex items-center justify-center">
      <div className="animate-pulse text-sm" style={{ color: MUTED }}>Yükleniyor...</div>
    </div>;
  }

  return (
    <div style={{ background: PARCHMENT, fontFamily: 'ui-sans-serif, system-ui' }} className="pb-16">
      <div style={{ background: INK }} className="px-5 pt-7 pb-8 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p style={{ color: '#B9C4B4' }} className="text-xs tracking-widest uppercase mb-1">Portföy Panosu</p>
            <h1 style={{ color: PARCHMENT }} className="text-2xl font-serif">Deniz Şaşkın</h1>
          </div>
          <button
            onClick={fetchAllViaClaude}
            disabled={claudeRefreshing}
            className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold"
            style={{ background: claudeRefreshing ? '#3A463F' : SAGE, color: '#fff' }}
          >
            <RefreshCw size={13} style={{ animation: claudeRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {claudeRefreshing ? 'Güncelleniyor...' : 'Güncelle'}
          </button>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
        {claudeRefreshMsg && <p className="text-[11px] mt-2" style={{ color: '#9CC49F' }}>{claudeRefreshMsg}</p>}
        <div className="mt-5 flex gap-6 flex-wrap">
          <div>
            <p style={{ color: '#8FA592' }} className="text-xs mb-1">EUR Nakit</p>
            <p style={{ color: '#FFFFFF' }} className="text-2xl font-serif tabular-nums">{fmtEUR(computed.eurCashAmount)}</p>
          </div>
          <div>
            <p style={{ color: '#8FA592' }} className="text-xs mb-1">Altın</p>
            <p style={{ color: '#FFFFFF' }} className="text-2xl font-serif tabular-nums">{computed.altin.qty} {computed.altin.unit}</p>
            <p style={{ color: '#8FA592' }} className="text-xs tabular-nums">{fmtTL(computed.altin.currentValue)} (≈ {tlToEurDisplay(computed.altin.currentValue)})</p>
            <p style={{ color: '#8FA592' }} className="text-[11px] tabular-nums">Gram: {fmtTL(computed.altin.gramPrice)} · {fmtEUR(computed.altin.gramPriceEur)}</p>
            <p style={{ color: computed.altin.pnl >= 0 ? SAGE : '#E8A87C' }} className="text-xs tabular-nums font-medium">
              {computed.altin.pnl >= 0 ? '+' : '\u2212'}{fmtTL(Math.abs(computed.altin.pnl))} ({fmtPct(computed.altin.pnlPct)})
            </p>
          </div>
          <div>
            <p style={{ color: '#8FA592' }} className="text-xs mb-1">ABD Hisseleri</p>
            <p style={{ color: '#FFFFFF' }} className="text-2xl font-serif tabular-nums">{fmtUSD(computed.stocksTotalUSD)}</p>
            <p style={{ color: '#8FA592' }} className="text-xs tabular-nums">≈ {usdToEurDisplay(computed.stocksTotalUSD)}</p>
            {computed.stocksCostUSD > 0 && (
              <p style={{ color: computed.stocksPnlPct >= 0 ? '#9CC49F' : '#E8A87C' }} className="text-xs tabular-nums font-medium">
                {computed.stocksTotalUSD - computed.stocksCostUSD >= 0 ? '+' : '\u2212'}{fmtUSD(Math.abs(computed.stocksTotalUSD - computed.stocksCostUSD))}
                {' '}(≈{usdToEurDisplay(Math.abs(computed.stocksTotalUSD - computed.stocksCostUSD))}, {fmtPct(computed.stocksPnlPct)})
              </p>
            )}
          </div>
        </div>
        <p style={{ color: '#8FA592' }} className="text-[11px] mt-2 italic">Üç varlık sınıfı ayrı tutulur, birleştirilmez.</p>
        <div className="flex gap-4 mt-4 text-xs flex-wrap" style={{ color: '#B9C4B4' }}>
          <span>Hisse fiyatları: {MARKET_DATA.lastUpdated}</span>
          <span>EUR/TRY: {getRates().eurTry.toFixed(2)}</span>
          <span>USD/EUR: {getRates().usdEur.toFixed(4)}</span>
          {ratesLive && <span style={{ color: SAGE }}>● kurlar canlı</span>}
        </div>
      </div>

      <div className="px-5 -mt-4">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm">
            <p style={{ color: MUTED }} className="text-xs mb-1">EUR Nakit</p>
            <p style={{ color: INK }} className="text-lg font-semibold tabular-nums">{fmtEUR(computed.eurCashAmount)}</p>
            <p style={{ color: MUTED }} className="text-xs mt-1">Kur riski yok</p>
          </div>
          <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm">
            <p style={{ color: MUTED }} className="text-xs mb-1">Altın</p>
            <p style={{ color: INK }} className="text-lg font-semibold tabular-nums">{computed.altin.qty} {computed.altin.unit}</p>
            <p style={{ color: MUTED }} className="text-xs tabular-nums">{fmtTL(computed.altin.currentValue)} (≈ {tlToEurDisplay(computed.altin.currentValue)})</p>
            <p style={{ color: MUTED }} className="text-[11px] tabular-nums">Gram: {fmtTL(computed.altin.gramPrice)} · {fmtEUR(computed.altin.gramPriceEur)}</p>
            <p style={{ color: computed.altin.pnl >= 0 ? SAGE : RUST }} className="text-xs mt-1 font-medium tabular-nums">
              {computed.altin.pnl >= 0 ? '+' : '\u2212'}{fmtTL(Math.abs(computed.altin.pnl))} ({fmtPct(computed.altin.pnlPct)})
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 mb-4">
          <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm">
            <p style={{ color: MUTED }} className="text-xs mb-1">ABD Hisseleri</p>
            <p style={{ color: INK }} className="text-lg font-semibold tabular-nums">{fmtUSD(computed.stocksTotalUSD)}</p>
            <p style={{ color: MUTED }} className="text-xs tabular-nums">≈ {usdToEurDisplay(computed.stocksTotalUSD)}</p>
            <p style={{ color: computed.stocksPnlPct >= 0 ? SAGE : RUST }} className="text-xs mt-1 font-medium tabular-nums">
              {computed.stocksCostUSD > 0
                ? `${computed.stocksTotalUSD - computed.stocksCostUSD >= 0 ? '+' : '\u2212'}${fmtUSD(Math.abs(computed.stocksTotalUSD - computed.stocksCostUSD))} (≈${usdToEurDisplay(Math.abs(computed.stocksTotalUSD - computed.stocksCostUSD))}, ${fmtPct(computed.stocksPnlPct)})`
                : 'Pozisyon yok'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-4">
          {allocationDataUSD.length > 0 && (
            <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm">
              <p style={{ color: INK }} className="text-sm font-semibold mb-2">ABD Hisse Dağılımı (USD)</p>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={allocationDataUSD} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65} paddingAngle={2}>
                    {allocationDataUSD.map((_, i) => <Cell key={i} fill={PALETTE[(i + 2) % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtUSD(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 justify-center">
                {allocationDataUSD.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: PALETTE[(i + 2) % PALETTE.length], display: 'inline-block' }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p style={{ color: INK }} className="text-sm font-semibold">ABD Hisseleri</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEur(!showEur)}
                className="flex items-center rounded-full p-0.5"
                style={{ background: showEur ? SAGE : '#E4DECB', width: 62 }}
                aria-label="USD / EUR gösterimini değiştir"
              >
                <span className="flex-1 text-center text-[10px] font-semibold py-1" style={{ color: showEur ? 'rgba(255,255,255,0.6)' : INK }}>USD</span>
                <span className="flex-1 text-center text-[10px] font-semibold py-1" style={{ color: showEur ? '#fff' : MUTED }}>EUR</span>
              </button>
              <button onClick={() => setEditMode(!editMode)} className="text-xs px-2 py-1 rounded-lg" style={{ background: editMode ? SAGE : PARCHMENT, color: editMode ? '#fff' : MUTED }}>
                {editMode ? 'Bitti' : 'Düzenle'}
              </button>
            </div>
          </div>
          {showEur && (
            <p className="text-[11px] mb-2" style={{ color: MUTED }}>
              EUR fiyatları güncel USD/EUR kuruyla ({getRates().usdEur.toFixed(4)}) anlık çevrilir, sadece görüntü — hesaplamalar hep USD üzerinden.
            </p>
          )}
          {(computed.stockCashEUR > 0 || editMode) && (
            <div className="rounded-xl p-3 mb-3 flex items-center justify-between" style={{ background: '#F3EAD6', border: `1px dashed ${COPPER}` }}>
              <div>
                <p style={{ color: INK }} className="text-xs font-semibold">{positions.stockCash.name}</p>
                <p style={{ color: MUTED }} className="text-[10px] mt-0.5">Henüz pozisyona dönüşmedi, hisseye ayrılmış bekliyor</p>
              </div>
              {editMode ? (
                <input type="text" inputMode="decimal" value={positions.stockCash.amount}
                  onChange={e => setPositions({ ...positions, stockCash: { ...positions.stockCash, amount: e.target.value } })}
                  className="w-24 text-sm rounded-lg px-2 py-1 border text-right" style={{ borderColor: '#DDD5C2' }} />
              ) : (
                <p style={{ color: INK }} className="text-sm font-bold tabular-nums">{fmtEUR(computed.stockCashEUR)}</p>
              )}
            </div>
          )}
          {computed.realizedGains.length > 0 && (
            <div className="rounded-xl p-3 mb-3" style={{ background: computed.realizedGainsTotal >= 0 ? '#E7EEE3' : '#F5E4DF' }}>
              <div className="flex items-center justify-between mb-1.5">
                <p style={{ color: INK }} className="text-xs font-semibold">Realize Edilmiş Kâr/Zarar (satılan pozisyonlar)</p>
                <p style={{ color: computed.realizedGainsTotal >= 0 ? SAGE : RUST }} className="text-sm font-bold tabular-nums">
                  {computed.realizedGainsTotal >= 0 ? '+' : '\u2212'}{fmtEUR(Math.abs(computed.realizedGainsTotal))}
                </p>
              </div>
              <div className="space-y-1">
                {computed.realizedGains.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]" style={{ color: MUTED }}>
                    <span>{g.symbol} · {g.date}</span>
                    <span style={{ color: g.amount >= 0 ? SAGE : RUST }} className="font-medium tabular-nums">
                      {g.amount >= 0 ? '+' : '\u2212'}{fmtEUR(Math.abs(g.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sıralama ve toplu işlemler */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <button onClick={() => sortStocksBy('value')} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: PARCHMENT, color: COPPER }}>Değere göre</button>
            <button onClick={() => sortStocksBy('pnl')} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: PARCHMENT, color: COPPER }}>Kâr/Zarara göre</button>
            <button onClick={() => sortStocksBy('az')} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: PARCHMENT, color: COPPER }}>A-Z</button>
            <button onClick={exportBackup} className="text-[11px] px-2 py-1 rounded-lg font-medium ml-auto" style={{ background: PARCHMENT, color: SAGE }}>Yedekle</button>
            <button onClick={() => fileInputRef.current?.click()} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: PARCHMENT, color: SAGE }}>Geri Yükle</button>
            <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) importBackup(e.target.files[0]); e.target.value = ''; }} />
          </div>

          {editMode && (
            <div className="rounded-xl p-3 mb-3" style={{ background: PARCHMENT, border: `1px dashed ${SAGE}` }}>
              <p style={{ color: INK }} className="text-xs font-semibold mb-2">Yeni Hisse Ekle</p>
              <div className="relative mb-2">
                <input type="text" value={newStockSymbol}
                  onChange={e => { const v = e.target.value.toUpperCase(); setNewStockSymbol(v); searchStockSuggestions(v); }}
                  placeholder="Sembol (örn. EOSE) ya da şirket adı yaz"
                  className="w-full text-sm rounded-lg px-2 py-1.5 border" style={{ borderColor: '#DDD5C2' }} />
                {stockSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 rounded-lg shadow-md z-10" style={{ background: CARD, border: '1px solid #DDD5C2' }}>
                    {stockSuggestions.map(sug => (
                      <button key={sug.symbol} onClick={() => { setNewStockSymbol(sug.symbol); setStockSuggestions([]); }}
                        className="w-full text-left px-2 py-1.5 text-xs" style={{ borderBottom: '1px solid #EEE8DA' }}>
                        <span style={{ color: INK, fontWeight: 600 }}>{sug.symbol}</span>
                        <span style={{ color: MUTED }}> — {sug.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mb-2">
                <input type="text" inputMode="decimal" value={newStockQty} onChange={e => setNewStockQty(e.target.value)}
                  placeholder="Adet" className="flex-1 text-sm rounded-lg px-2 py-1.5 border" style={{ borderColor: '#DDD5C2' }} />
                <input type="text" inputMode="decimal" value={newStockCost} onChange={e => setNewStockCost(e.target.value)}
                  placeholder="Maliyet ($)" className="flex-1 text-sm rounded-lg px-2 py-1.5 border" style={{ borderColor: '#DDD5C2' }} />
              </div>
              <button onClick={() => addNewStock()} disabled={addingStock || !newStockSymbol.trim()}
                className="w-full py-2 rounded-lg text-sm font-medium" style={{ background: SAGE, color: '#fff', opacity: addingStock ? 0.6 : 1 }}>
                {addingStock ? 'Ekleniyor...' : '+ Listeye Ekle'}
              </button>
              {addStockMsg && <p className="text-[11px] mt-1.5 text-center" style={{ color: SAGE }}>{addStockMsg}</p>}
            </div>
          )}

          <div className="space-y-3">
            {computed.stocks.map((s, sIndex) => {
              const hasPlan = !!s.plan && s.qty > 0 && s.cost > 0;
              const isOpen = !!expandedTiers[s.symbol];
              const isChartOpen = !!expandedChart[s.symbol];
              const nextTier = s.tierRows.find(t => !t.reached);
              return (
                <div key={s.symbol} className="pb-3" style={{ borderBottom: '1px solid #EEE8DA' }}>
                  {editMode && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <button onClick={() => moveStock(sIndex, -1)} disabled={sIndex === 0}
                        className="text-xs px-1.5 py-0.5 rounded" style={{ background: PARCHMENT, color: sIndex === 0 ? '#C9C2AE' : COPPER }}>▲</button>
                      <button onClick={() => moveStock(sIndex, 1)} disabled={sIndex === computed.stocks.length - 1}
                        className="text-xs px-1.5 py-0.5 rounded" style={{ background: PARCHMENT, color: sIndex === computed.stocks.length - 1 ? '#C9C2AE' : COPPER }}>▼</button>
                      <span className="text-[10px]" style={{ color: MUTED }}>sıra:</span>
                      <input type="text" inputMode="numeric" placeholder={String(sIndex + 1)}
                        value={moveToInput[s.symbol] ?? ''}
                        onChange={e => setMoveToInput(prev => ({ ...prev, [s.symbol]: e.target.value }))}
                        className="w-10 text-[11px] rounded px-1 py-0.5 border text-center" style={{ borderColor: '#DDD5C2' }} />
                      <button onClick={() => { moveStockToPosition(sIndex, parseInt(moveToInput[s.symbol], 10)); setMoveToInput(prev => ({ ...prev, [s.symbol]: '' })); }}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: SAGE, color: '#fff' }}>Git</button>
                      <button onClick={() => removeStock(s.symbol)}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium ml-auto" style={{ background: '#F5E4DF', color: RUST }}>Sil</button>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ color: INK }} className="text-sm font-medium flex items-center gap-1.5">
                      {s.name} <span style={{ color: MUTED }}>({s.symbol})</span>
                      {liveRatings[s.symbol] === 'Buy' && (
                        <span style={{ background: '#E7EEE3', color: '#4A6B4D', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 7px' }}>AL</span>
                      )}
                      {liveRatings[s.symbol] === 'Sell' && (
                        <span style={{ background: '#F5E4DF', color: '#A63D2F', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 7px' }}>SAT</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {sparklines[s.symbol] && <Sparkline data={sparklines[s.symbol]} color={s.pnlPct >= 0 ? SAGE : RUST} />}
                      {s.qty > 0 && (
                        <span style={{ color: s.pnlPct >= 0 ? SAGE : RUST }} className="text-xs font-semibold flex items-center gap-1">
                          {s.pnlPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {fmtPct(s.pnlPct)}
                          <span style={{ fontWeight: 500 }}>
                            ({s.valueUSD - s.costUSD >= 0 ? '+' : '\u2212'}{showEur ? usdToEurDisplay(Math.abs(s.valueUSD - s.costUSD)) : fmtUSD(Math.abs(s.valueUSD - s.costUSD))})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  {editMode ? (
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1">
                        <label className="text-[10px]" style={{ color: MUTED }}>Adet</label>
                        <input type="text" inputMode="decimal" value={s.rawQty} onChange={e => updateStockField('stocks', s.symbol, 'qty', e.target.value)}
                          className="w-full text-sm rounded-lg px-2 py-1 border" style={{ borderColor: '#DDD5C2' }} />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px]" style={{ color: MUTED }}>Maliyet ($)</label>
                        <input type="text" inputMode="decimal" value={s.rawCost} onChange={e => updateStockField('stocks', s.symbol, 'cost', e.target.value)}
                          className="w-full text-sm rounded-lg px-2 py-1 border" style={{ borderColor: '#DDD5C2' }} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between text-xs mt-1" style={{ color: MUTED }}>
                      <span>{s.qty} adet · maliyet {fmtUSD(s.cost)}</span>
                      <span className="tabular-nums">
                        {s.qty > 0 ? `${fmtUSD(s.valueUSD)} (≈ ${usdToEurDisplay(s.valueUSD)})` : '—'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1 flex-wrap gap-1">
                    <div className="text-xs" style={{ color: MUTED }}>
                      Güncel fiyat: {showEur ? usdToEurDisplay(s.price) : fmtUSD(s.price)}
                      {showEur && <span className="ml-1" style={{ color: '#B9B2A0' }}>({fmtUSD(s.price)})</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleChart(s.symbol, s.name)} className="flex items-center gap-1 text-xs font-medium" style={{ color: SAGE }}>
                        <Activity size={12} />
                        Değerlendirme &amp; Bilanço
                        <ChevronDown size={12} style={{ transform: isChartOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                      </button>
                      {hasPlan && (
                        <button onClick={() => toggleTiers(s.symbol)} className="flex items-center gap-1 text-xs font-medium" style={{ color: COPPER }}>
                          <Target size={12} />
                          Kâr Alma Planı
                          <ChevronDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isChartOpen && (
                    <div className="mt-2 rounded-xl p-3" style={{ background: PARCHMENT }}>
                      {analysisLoading[s.symbol] && (
                        <p className="text-xs" style={{ color: MUTED }}>Güncel değerlendirme ve bilanço verisi aranıyor...</p>
                      )}
                      {analysisError[s.symbol] && (
                        <p className="text-xs" style={{ color: RUST }}>{analysisError[s.symbol]}</p>
                      )}
                      {!analysisLoading[s.symbol] && assetAnalysis[s.symbol] && (
                        <p className="text-xs leading-relaxed" style={{ color: INK }}>{assetAnalysis[s.symbol].text}</p>
                      )}
                    </div>
                  )}

                  {hasPlan && isOpen && (
                    <div className="mt-2 rounded-xl p-3" style={{ background: PARCHMENT }}>
                      {nextTier ? (
                        <p className="text-xs mb-2" style={{ color: INK }}>
                          Sıradaki hedef: <span className="font-semibold">{fmtUSD(nextTier.targetPrice)}</span>
                          <span style={{ color: MUTED }}> (maliyetin +{Math.round(nextTier.threshold * 100)}%'i, {fmtUSD(nextTier.targetPrice - s.price)} kaldı)</span>
                        </p>
                      ) : (
                        <p className="text-xs mb-2 font-medium" style={{ color: SAGE }}>Tüm kademe hedefleri geçildi — sadece çekirdek pozisyon kaldı.</p>
                      )}
                      <div className="space-y-1.5">
                        {s.tierRows.map(t => (
                          <div key={t.idx} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span style={{
                                width: 6, height: 6, borderRadius: 3, display: 'inline-block',
                                background: t.reached ? SAGE : '#D9D2BE'
                              }} />
                              <span style={{ color: t.reached ? SAGE : INK, fontWeight: t.reached ? 600 : 400 }}>
                                +{Math.round(t.threshold * 100)}%
                              </span>
                              <span style={{ color: MUTED }}>→ {fmtUSD(t.targetPrice)}</span>
                            </div>
                            <span style={{ color: MUTED }} className="tabular-nums">{t.sellQty} adet sat</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-xs pt-1.5 mt-1" style={{ borderTop: '1px dashed #DDD5C2' }}>
                          <span style={{ color: GOLD, fontWeight: 600 }}>Çekirdek (satılmaz)</span>
                          <span style={{ color: MUTED }} className="tabular-nums">{s.coreQty} adet</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {editMode && (
            <button onClick={() => savePositions(positions)} className="mt-3 w-full py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2" style={{ background: SAGE, color: '#fff' }}>
              <Save size={14} /> Kaydet
            </button>
          )}
        </div>

        {/* EUR Nakit + Altın düzenleme */}
        <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-2">
            <p style={{ color: INK }} className="text-sm font-semibold">EUR Nakit &amp; Altın</p>
            <button onClick={() => setEditMode(!editMode)} className="text-xs px-2 py-1 rounded-lg" style={{ background: editMode ? SAGE : PARCHMENT, color: editMode ? '#fff' : MUTED }}>
              {editMode ? 'Bitti' : 'Düzenle'}
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #EEE8DA' }}>
              <span style={{ color: INK }} className="text-sm">{positions.eurCash.name}</span>
              {editMode ? (
                <input type="text" inputMode="decimal" value={positions.eurCash.amount}
                  onChange={e => setPositions({ ...positions, eurCash: { ...positions.eurCash, amount: e.target.value } })}
                  className="w-28 text-sm rounded-lg px-2 py-1 border text-right" style={{ borderColor: '#DDD5C2' }} />
              ) : (
                <span style={{ color: MUTED }} className="text-sm tabular-nums">{fmtEUR(computed.eurCashAmount)}</span>
              )}
            </div>
            <div className="pb-2" style={{ borderBottom: '1px solid #EEE8DA' }}>
              <div className="flex items-center justify-between">
                <span style={{ color: INK }} className="text-sm">{positions.altin.name}</span>
                {editMode ? (
                  <div className="flex gap-2">
                    <input type="text" inputMode="decimal" value={positions.altin.qty}
                      onChange={e => updateAltin('qty', e.target.value)}
                      placeholder="gram" className="w-16 text-sm rounded-lg px-2 py-1 border text-right" style={{ borderColor: '#DDD5C2' }} />
                    <input type="text" inputMode="decimal" value={computed.altin.rawCostTotal}
                      onChange={e => updateAltin('costTotal', e.target.value)}
                      placeholder="maliyet TL" className="w-24 text-sm rounded-lg px-2 py-1 border text-right" style={{ borderColor: '#DDD5C2' }} />
                  </div>
                ) : (
                  <span style={{ color: MUTED }} className="text-sm tabular-nums">{computed.altin.qty} {computed.altin.unit}</span>
                )}
              </div>
              {!editMode && (
                <div className="text-[11px] mt-1" style={{ color: MUTED }}>
                  Maliyet {fmtTL(computed.altin.costTotal)} · Güncel {fmtTL(computed.altin.gramPrice)}/gram ({fmtEUR(computed.altin.gramPriceEur)}/gram) · Değer {fmtTL(computed.altin.currentValue)} (≈ {tlToEurDisplay(computed.altin.currentValue)})
                  <span style={{ color: computed.altin.pnl >= 0 ? SAGE : RUST, fontWeight: 600 }}>
                    {' '}· {computed.altin.pnl >= 0 ? '+' : '\u2212'}{fmtTL(Math.abs(computed.altin.pnl))} ({fmtPct(computed.altin.pnlPct)})
                  </span>
                  <div className="mt-1.5">
                    <button onClick={() => toggleChart('altin', 'gram altın Türkiye')} className="flex items-center gap-1 text-xs font-medium" style={{ color: SAGE }}>
                      <Activity size={12} />
                      Değerlendirme
                      <ChevronDown size={12} style={{ transform: expandedChart['altin'] ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </button>
                  </div>
                  {expandedChart['altin'] && (
                    <div className="mt-2 rounded-xl p-3" style={{ background: CARD }}>
                      {analysisLoading['altin'] && <p className="text-xs" style={{ color: MUTED }}>Güncel değerlendirme aranıyor...</p>}
                      {analysisError['altin'] && <p className="text-xs" style={{ color: RUST }}>{analysisError['altin']}</p>}
                      {!analysisLoading['altin'] && assetAnalysis['altin'] && (
                        <p className="text-xs leading-relaxed" style={{ color: INK }}>{assetAnalysis['altin'].text}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {editMode && (
            <button onClick={() => savePositions(positions)} className="mt-3 w-full py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2" style={{ background: SAGE, color: '#fff' }}>
              <Save size={14} /> Kaydet
            </button>
          )}
        </div>

        <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-2">
            <p style={{ color: INK }} className="text-sm font-semibold flex items-center gap-1"><LineIcon size={14} /> Portföy Geçmişi</p>
            <button onClick={saveSnapshot} className="text-xs px-2 py-1 rounded-lg flex items-center gap-1" style={{ background: PARCHMENT, color: COPPER }}>
              <Plus size={12} /> Bugünü kaydet
            </button>
          </div>
          {saveMsg && <p className="text-[11px] mb-2 font-medium" style={{ color: SAGE }}>{saveMsg}</p>}
          {history.length > 1 ? (
            <>
              <p style={{ color: MUTED }} className="text-xs mb-1">Altın (TRY)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={history}>
                  <CartesianGrid stroke="#EEE8DA" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: MUTED }} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'} />
                  <Tooltip formatter={(v) => fmtTL(v)} />
                  <Line type="monotone" dataKey="altinTotal" stroke={GOLD} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              <p style={{ color: MUTED }} className="text-xs mb-1 mt-3">EUR Nakit</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={history}>
                  <CartesianGrid stroke="#EEE8DA" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: MUTED }} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => '€' + v} />
                  <Tooltip formatter={(v) => fmtEUR(v)} />
                  <Line type="monotone" dataKey="eurCash" stroke="#5B7A99" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              <p style={{ color: MUTED }} className="text-xs mb-1 mt-3">ABD Hisseleri (USD)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={history}>
                  <CartesianGrid stroke="#EEE8DA" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: MUTED }} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} tickFormatter={(v) => '$' + v} />
                  <Tooltip formatter={(v) => fmtUSD(v)} />
                  <Line type="monotone" dataKey="usdTotal" stroke={COPPER} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : history.length === 1 ? (
            <p style={{ color: MUTED }} className="text-xs">İlk kayıt alındı ({history[0].date}). Trend grafiği için en az bir gün daha "Bugünü kaydet" ile kayıt eklemen gerekiyor.</p>
          ) : (
            <p style={{ color: MUTED }} className="text-xs">Trend görmek için birkaç kayıt birikince grafik burada belirir. "Bugünü kaydet" ile başla.</p>
          )}
        </div>

        <div className="text-center text-xs" style={{ color: MUTED }}>
          Fiyatları güncellemek için sohbette "güncelle" yaz — Claude güncel verilerle bu panoyu yeniler.
        </div>
        {saveMsg && <div className="text-center text-xs mt-2 font-medium" style={{ color: SAGE }}>{saveMsg}</div>}
      </div>
    </div>
  );
}


/* =========================================================================================
   YATIRIM PROJEKSİYON MOTORU
   ========================================================================================= */

// 3 aylık katkı tutarı, HER BİRİ 3 farklı yıllık büyüme oranıyla (matris olarak) gösterilir.
const MONTHLY_AMOUNTS = [250, 400, 600];
const RATES = [
  { key: 'r8', rate: 0.08, label: '%8', color: '#5B7A99' },
  { key: 'r13', rate: 0.13, label: '%13', color: SAGE },
  { key: 'r20', rate: 0.20, label: '%20', color: COPPER },
];
const PROJECTION_START = new Date(2026, 8, 1); // Eylül 2026
const CONTRIB_MONTHS_PER_YEAR = 10; // yılda 2 ay katkı yapılamıyor (tatil vb.)
const HORIZON_YEARS = [1, 3, 5, 10];

// Aylık compounding, yılın ilk 10 ayında katkı ekleniyor, kalan 2 ay sadece büyüyor.
function simulateScenario(baseCapital, monthly, annualRate, totalMonths) {
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  let value = baseCapital;
  const series = [{ m: 0, value }];
  for (let m = 1; m <= totalMonths; m++) {
    value *= (1 + monthlyRate);
    if (((m - 1) % 12) < CONTRIB_MONTHS_PER_YEAR) value += monthly;
    series.push({ m, value });
  }
  return { finalValue: value, series };
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function ProjectionEngine() {
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [loading, setLoading] = useState(true);
  const [actuals, setActuals] = useState([]);
  const [newContribution, setNewContribution] = useState('');
  const [newTotalValue, setNewTotalValue] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [liveMarket, setLiveMarket] = useState(null);

  useEffect(() => {
    (async () => {
      const hasStorage = typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function';
      if (!hasStorage) { setLoading(false); return; }
      let loadedPositions = DEFAULT_POSITIONS;
      try {
        const pos = await window.storage.get('positions_v2', false);
        if (pos && pos.value) { loadedPositions = JSON.parse(pos.value); setPositions(loadedPositions); }
      } catch (e) { /* varsayılan pozisyonlar kullanılır */ }
      try {
        const act = await window.storage.get('projection_actuals', false);
        if (act && act.value) setActuals(JSON.parse(act.value));
      } catch (e) { /* henüz kayıt yok */ }
      const cached = loadCachedMarketDataSync();
      if (cached) setLiveMarket(cached);
      try {
        const ownedSymbols = Array.from(new Set([...ALL_SYMBOLS, ...loadedPositions.stocks.map(s => s.symbol)]));
        const fresh = await fetchLiveMarketData(ownedSymbols);
        setLiveMarket(fresh);
      } catch (e) { /* canlı veri alınamazsa statik yedek kullanılır */ }
      setLoading(false);
    })();
  }, []);

  const priceFor = (symbol) => (liveMarket?.prices?.[symbol]) || MARKET_DATA.prices[symbol] || 0;
  const gramAltinPrice = liveMarket?.gramAltinTry || MARKET_DATA.prices.GRAM_ALTIN_TRY;
  const liveEurTry = liveMarket?.eurTry || MARKET_DATA.eurTry;
  const liveUsdEur = (liveMarket?.usdTry && liveMarket?.eurTry) ? (liveMarket.usdTry / liveMarket.eurTry) : MARKET_DATA.usdEur;

  const saveActuals = async (next) => {
    setActuals(next);
    try {
      await window.storage.set('projection_actuals', JSON.stringify(next), false);
      setSaveMsg('Kaydedildi');
    } catch (e) {
      setSaveMsg('Kaydedilemedi — tekrar dene');
    }
    setTimeout(() => setSaveMsg(''), 2000);
  };

  // Base sermaye: Portföy panosundaki güncel pozisyonlardan EUR bazında hesaplanır.
  const baseCapital = useMemo(() => {
    const eurCash = parseNum(positions.eurCash?.amount);
    const stocksUSD = (positions.stocks || []).reduce((acc, s) => {
      const qty = parseNum(s.qty);
      const price = priceFor(s.symbol);
      return acc + qty * price;
    }, 0);
    const stocksEUR = stocksUSD * liveUsdEur;
    // Altın ikinci bir emre kadar projeksiyon hesabına dahil edilmiyor — büyüme senaryoları sadece nakit + hisseler üzerinden.
    const altinQty = parseNum(positions.altin?.qty);
    const altinTRY = altinQty * gramAltinPrice;
    const altinEUR = altinTRY / liveEurTry;
    return { total: eurCash + stocksEUR, eurCash, stocksEUR, altinEUR };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, liveMarket]);
  const baseCapitalEUR = baseCapital.total;

  // Matris: her aylık tutar (250/400/600) x her büyüme oranı (%8/%13/%20) x her ufuk (3/5/10 yıl)
  const projections = useMemo(() => {
    return MONTHLY_AMOUNTS.map(monthly => {
      const byRate = RATES.map(r => {
        const byHorizon = HORIZON_YEARS.map(years => {
          const months = years * 12;
          const { finalValue, series } = simulateScenario(baseCapitalEUR, monthly, r.rate, months);
          const contributed = monthly * CONTRIB_MONTHS_PER_YEAR * years;
          const gain = finalValue - baseCapitalEUR - contributed;
          return { years, finalValue, contributed, gain, series };
        });
        return { ...r, byHorizon };
      });
      return { monthly, byRate };
    });
  }, [baseCapitalEUR]);

  // Her aylık tutar için ayrı bir grafik verisi: 3 oran çizgisi, 10 yıl boyunca, 3 ayda bir örneklenir.
  const chartDataByMonthly = useMemo(() => {
    const months10 = HORIZON_YEARS[2] * 12;
    const result = {};
    MONTHLY_AMOUNTS.forEach(monthly => {
      const sims = RATES.map(r => simulateScenario(baseCapitalEUR, monthly, r.rate, months10).series);
      const points = [];
      for (let m = 0; m <= months10; m += 3) {
        const row = { m, label: `${Math.floor(m / 12)}y${m % 12 ? ' ' + (m % 12) + 'a' : ''}` };
        RATES.forEach((r, i) => { row[r.key] = Math.round(sims[i][m]?.value ?? sims[i][sims[i].length - 1].value); });
        points.push(row);
      }
      result[monthly] = points;
    });
    return result;
  }, [baseCapitalEUR]);

  // Gerçekleşen ilerleme: basit yıllıklandırılmış tahmini getiri (money-weighted değil, yaklaşık).
  const actualProgress = useMemo(() => {
    if (actuals.length === 0) return null;
    const sorted = [...actuals].sort((a, b) => a.date.localeCompare(b.date));
    const totalContributed = baseCapitalEUR + sorted.reduce((acc, a) => acc + parseNum(a.contribution), 0);
    const latest = sorted[sorted.length - 1];
    const latestValue = parseNum(latest.totalValue);
    const months = Math.max(1, monthsBetween(PROJECTION_START, new Date(latest.date)));
    const gain = latestValue - totalContributed;
    const approxAnnualReturn = totalContributed > 0 ? (gain / totalContributed) * (12 / months) : 0;
    return { totalContributed, latestValue, gain, months, approxAnnualReturn, latestDate: latest.date };
  }, [actuals, baseCapitalEUR]);

  const addActualEntry = () => {
    if (!newTotalValue) return;
    const entry = {
      date: new Date().toISOString().slice(0, 10),
      contribution: newContribution || '0',
      totalValue: newTotalValue,
    };
    const next = [...actuals.filter(a => a.date !== entry.date), entry];
    saveActuals(next);
    setNewContribution('');
    setNewTotalValue('');
  };

  const deleteActualEntry = (date) => {
    saveActuals(actuals.filter(a => a.date !== date));
  };

  // Hisse bazlı kâr kilitleme önerileri: sahip olunan ve kârda olan her hisse için,
  // ulaştığı en yüksek senaryo eşiğini (%8/%13/%20) kilitlemek için gereken satış miktarı.
  const lockInSuggestions = useMemo(() => {
    return (positions.stocks || [])
      .map(s => {
        const qty = parseNum(s.qty);
        const cost = parseNum(s.cost);
        if (qty <= 0 || cost <= 0) return null;
        const price = priceFor(s.symbol);
        const pnlPct = (price - cost) / cost;
        const crossed = RATES.filter(r => pnlPct > r.rate).sort((a, b) => b.rate - a.rate);
        if (crossed.length === 0) return null;
        const target = crossed[0];
        const sellShares = Math.min(qty, (target.rate * qty * cost) / (price - cost));
        const remaining = qty - sellShares;
        return { symbol: s.symbol, unit: 'adet', currency: 'USD', pnlPct, target, sellShares, remaining, qty, price, cost };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, liveMarket]);

  if (loading) {
    return <div style={{ background: PARCHMENT, minHeight: '60vh' }} className="flex items-center justify-center">
      <div className="animate-pulse text-sm" style={{ color: MUTED }}>Yükleniyor...</div>
    </div>;
  }

  return (
    <div style={{ background: PARCHMENT, fontFamily: 'ui-sans-serif, system-ui' }} className="pb-16">
      <div style={{ background: INK }} className="px-5 pt-7 pb-8 rounded-b-3xl">
        <p style={{ color: '#B9C4B4' }} className="text-xs tracking-widest uppercase mb-1">Projeksiyon Motoru</p>
        <h1 style={{ color: PARCHMENT }} className="text-2xl font-serif">Gelecek Görünüm</h1>
        <p style={{ color: '#8FA592' }} className="text-xs mt-2">Başlangıç: Eylül 2026 · Base sermaye: {fmtEUR(baseCapitalEUR)}</p>
        <p style={{ color: '#8FA592' }} className="text-[11px] mt-0.5">
          (Nakit {fmtEUR(baseCapital.eurCash)} + Hisseler {fmtEUR(baseCapital.stocksEUR)} — büyüme senaryoları bunlar üzerinden)
        </p>
        <p style={{ color: '#8FA592' }} className="text-[11px] mt-0.5 italic">
          Altın ({fmtEUR(baseCapital.altinEUR)}) ikinci bir emre kadar bu hesaba dahil değil.
        </p>
        <p style={{ color: '#8FA592' }} className="text-[11px] mt-1 italic">Yılda 10 ay katkı varsayılır (2 ay tatil/ara payı düşülür).</p>
      </div>

      <div className="px-5 -mt-4">
        {/* Aylık tutar kartları — her biri 3 büyüme oranı x 3 ufuk matrisiyle */}
        <div style={{ background: '#F3EAD6', border: '1px dashed ' + COPPER }} className="rounded-2xl p-3 mb-4">
          <p style={{ color: INK }} className="text-[11px] leading-relaxed">
            <strong>Aşağıdaki tüm tutarlar</strong> mevcut {fmtEUR(baseCapitalEUR)}'luk sermayeni (nakit + hisseler) başlangıç noktası olarak içerir — sıfırdan başlamıyor, üzerine inşa ediyor. Altın bu hesabın dışında tutuluyor.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 mb-4">
          {projections.map(mo => (
            <div key={mo.monthly} style={{ background: CARD, borderLeft: `4px solid ${COPPER}` }} className="rounded-2xl p-4 shadow-sm">
              <p style={{ color: INK }} className="text-sm font-semibold mb-3">{fmtEUR(mo.monthly)}/ay katkı</p>
              <div className="space-y-3">
                {mo.byRate.map(r => (
                  <div key={r.key}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block' }} />
                      <p style={{ color: INK }} className="text-xs font-semibold">Yıllık {r.label} büyüme</p>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {r.byHorizon.map(h => (
                        <div key={h.years} className="text-center rounded-xl p-1.5" style={{ background: PARCHMENT }}>
                          <p style={{ color: MUTED }} className="text-[9px] mb-0.5">{h.years} yıl</p>
                          <p style={{ color: INK }} className="text-[11px] font-bold tabular-nums leading-tight">{fmtEUR(h.finalValue)}</p>
                          <p style={{ color: SAGE }} className="text-[9px] tabular-nums">+{fmtEUR(h.gain)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Her aylık tutar için ayrı büyüme eğrisi grafiği (3 oran çizgisi) */}
        {MONTHLY_AMOUNTS.map(monthly => (
          <div key={monthly} style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
            <p style={{ color: INK }} className="text-sm font-semibold mb-2">{fmtEUR(monthly)}/ay — 10 Yıllık Büyüme Eğrisi</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartDataByMonthly[monthly]}>
                <CartesianGrid stroke="#EEE8DA" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: MUTED }} interval={7} />
                <YAxis tick={{ fontSize: 9, fill: MUTED }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'K'} />
                <Tooltip formatter={(v) => fmtEUR(v)} />
                {RATES.map(r => (
                  <Line key={r.key} type="monotone" dataKey={r.key} stroke={r.color} strokeWidth={2} dot={false} name={r.label} />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-2 justify-center flex-wrap">
              {RATES.map(r => (
                <div key={r.key} className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block' }} />
                  Yıllık {r.label}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Gerçekleşen ilerleme takibi */}
        <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
          <p style={{ color: INK }} className="text-sm font-semibold mb-1">Gerçekleşen İlerleme</p>
          <p style={{ color: MUTED }} className="text-[11px] mb-3">Her ay yaptığın katkıyı ve o anki toplam portföy değerini gir — hangi senaryoyla örtüştüğünü hesaplayayım.</p>

          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-[10px]" style={{ color: MUTED }}>Bu ay eklenen (€)</label>
              <input type="text" inputMode="decimal" value={newContribution} onChange={e => setNewContribution(e.target.value)}
                placeholder="örn. 400" className="w-full text-sm rounded-lg px-2 py-1 border" style={{ borderColor: '#DDD5C2' }} />
            </div>
            <div className="flex-1">
              <label className="text-[10px]" style={{ color: MUTED }}>Şu anki toplam değer (€)</label>
              <input type="text" inputMode="decimal" value={newTotalValue} onChange={e => setNewTotalValue(e.target.value)}
                placeholder="örn. 4200" className="w-full text-sm rounded-lg px-2 py-1 border" style={{ borderColor: '#DDD5C2' }} />
            </div>
          </div>
          <button onClick={addActualEntry} className="w-full py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2 mb-3" style={{ background: SAGE, color: '#fff' }}>
            <Plus size={14} /> Bu ayı kaydet
          </button>
          {saveMsg && <p className="text-[11px] mb-2 font-medium" style={{ color: SAGE }}>{saveMsg}</p>}

          {actualProgress && (
            <div className="rounded-xl p-3 mb-3" style={{ background: PARCHMENT }}>
              <p style={{ color: INK }} className="text-sm font-semibold mb-1">
                Tahmini yıllıklandırılmış getiri: <span style={{ color: actualProgress.approxAnnualReturn >= 0 ? SAGE : RUST }}>{fmtPct(actualProgress.approxAnnualReturn)}</span>
              </p>
              <p style={{ color: MUTED }} className="text-[11px]">
                Toplam katkı: {fmtEUR(actualProgress.totalContributed)} · Güncel değer: {fmtEUR(actualProgress.latestValue)} · Kazanç: {fmtEUR(actualProgress.gain)} · {actualProgress.months} ay geçti
              </p>
              <p style={{ color: MUTED }} className="text-[11px] mt-1 italic">Bu basit bir yaklaşık hesaptır (money-weighted/XIRR değil), yönelim fikri verir.</p>
              <div className="mt-2 text-xs font-medium">
                {actualProgress.approxAnnualReturn >= 0.20 && <span style={{ color: COPPER }}>🎯 Büyük Ölçek senaryosunu (%20) yakalıyorsun.</span>}
                {actualProgress.approxAnnualReturn >= 0.13 && actualProgress.approxAnnualReturn < 0.20 && <span style={{ color: SAGE }}>🎯 Orta Ölçek senaryosuyla (%13) paralel gidiyorsun.</span>}
                {actualProgress.approxAnnualReturn >= 0.08 && actualProgress.approxAnnualReturn < 0.13 && <span style={{ color: '#5B7A99' }}>🎯 Küçük Ölçek senaryosunu (%8) aşıyorsun.</span>}
                {actualProgress.approxAnnualReturn < 0.08 && <span style={{ color: RUST }}>⚠ Şu an en düşük senaryonun (%8) altındasın.</span>}
              </div>
            </div>
          )}

          {actuals.length > 0 && (
            <div className="space-y-1.5">
              {[...actuals].sort((a, b) => b.date.localeCompare(a.date)).map(a => (
                <div key={a.date} className="flex items-center justify-between text-xs pb-1.5" style={{ borderBottom: '1px solid #EEE8DA' }}>
                  <span style={{ color: MUTED }}>{a.date} · +{fmtEUR(parseNum(a.contribution))}</span>
                  <div className="flex items-center gap-2">
                    <span style={{ color: INK }} className="font-medium tabular-nums">{fmtEUR(parseNum(a.totalValue))}</span>
                    <button onClick={() => deleteActualEntry(a.date)} style={{ color: RUST }} className="text-[11px]">Sil</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hisse bazlı kâr kilitleme önerileri */}
        <div style={{ background: CARD }} className="rounded-2xl p-4 shadow-sm mb-4">
          <p style={{ color: INK }} className="text-sm font-semibold mb-1 flex items-center gap-1"><Target size={14} /> Kâr Kilitleme Önerileri</p>
          <p style={{ color: MUTED }} className="text-[11px] mb-3">Sahip olduğun tüm hisseler için geçerli: kazanç senaryo eşiklerinden (%8/%13/%20) birini geçtiğinde, o oranı garantilemek için ne kadar satman gerektiğini gösterir.</p>
          {lockInSuggestions.length === 0 ? (
            <p style={{ color: MUTED }} className="text-xs">Şu an hiçbir pozisyon %8 eşiğini geçmiş değil.</p>
          ) : (
            <div className="space-y-2">
              {lockInSuggestions.map(l => {
                const fmt = l.currency === 'TRY' ? fmtTL : fmtUSD;
                return (
                  <div key={l.symbol} className="rounded-xl p-3" style={{ background: PARCHMENT }}>
                    <p style={{ color: INK }} className="text-xs font-semibold">
                      {l.symbol} — {fmtPct(l.pnlPct)} kârda ({fmt(l.cost)} → {fmt(l.price)})
                    </p>
                    <p style={{ color: MUTED }} className="text-[11px] mt-1">
                      %{Math.round(l.target.rate * 100)} hedefini kilitlemek için <strong style={{ color: INK }}>{l.sellShares.toFixed(2)} {l.unit}</strong> sat,
                      kalan <strong style={{ color: INK }}>{l.remaining.toFixed(2)} {l.unit}</strong> yükseliş potansiyeli için elde kalır.
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-center text-xs" style={{ color: MUTED }}>
          Base sermaye Portföy sekmesindeki güncel verilerden otomatik hesaplanır.
        </div>
      </div>
    </div>
  );
}



/* =========================================================================================
   FİNANS MERKEZİ — PORTFÖY VE PROJEKSİYON MOTORUNU SEKMELERLE BİRLEŞTİRİR
   ========================================================================================= */
export default function FinansMerkezi() {
  const [tab, setTab] = useState('portfolio');

  return (
    <div style={{ minHeight: '100vh', background: PARCHMENT }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: INK, display: 'flex', borderBottom: `1px solid ${COPPER}` }}>
        <button
          onClick={() => setTab('portfolio')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '12px 8px', background: tab === 'portfolio' ? PARCHMENT : 'transparent',
            color: tab === 'portfolio' ? INK : '#B9C4B4', fontSize: 13, fontWeight: 700, border: 'none',
          }}
        >
          <Wallet size={15} /> Portföy
        </button>
        <button
          onClick={() => setTab('projection')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '12px 8px', background: tab === 'projection' ? PARCHMENT : 'transparent',
            color: tab === 'projection' ? INK : '#B9C4B4', fontSize: 13, fontWeight: 700, border: 'none',
          }}
        >
          <TrendingUp size={15} /> Projeksiyon
        </button>
      </div>
      {tab === 'portfolio' ? <PortfolioDashboard /> : <ProjectionEngine />}
    </div>
  );
}
