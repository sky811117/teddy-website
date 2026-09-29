/*!
 * sd-lookup.js — 台中國中小學區判定（地址 → 里鄰 → 學校＋燈號）
 *
 * 搭配 /js/tc-addr.js（地址 → 區/里/鄰）使用；資料在 /data/school-district/（scripts/build-school-district.py 產生）：
 *   lookup_gs.json / lookup_jh.json  「區|里」→ {all:[校id], lin:{鄰:[校id]}, free?:{校id:'all'|[鄰]},
 *                                              fr?:{鄰|'all':[{s:[校id], c:'條件文字', co?:1, f?:[校id], q?:{校id:'註記原文'}}]}}
 *                                     q＝學區表註記「可選…就讀」的原文（例：太平區頭汴里「頭汴11、12鄰可選坪林國小就讀」），
 *                                       原文沒寫「共同學區」→ 不叫共同學區，照原文引用（kind 'choice'）
 *                                     fr＝學區表原文拆出的片段（同一鄰出現好幾次：單獨的一段、共同學區的一段、依路段分校…）
 *                                     另有 "_dist_wide":{區:[{school, free_zone, co_zone, raw, info?:{text,url}}]}（整區學區）
 *   school_info.json                 {gs:{校id:{name, dist, addr, lat, lng, phone, lis, raw, status?}}, jh:{…}}
 *   meta.json                        學年度、來源、官方查詢連結
 *
 * 用法（不需打包）：
 *   <script is:inline src="/js/tc-addr.js"></script>
 *   <script is:inline src="/js/sd-lookup.js"></script>
 *   SchoolDistrict.config({ v: '2026-09-29' });               // 選用：資料版本（meta.json 的 built），加在網址 ?v= 破快取
 *   const info = await SchoolDistrict.loadInfo();             // 只要學校清單（畫學校點）：meta + school_info
 *   const data = await SchoolDistrict.load();                 // 查地址要的全部 4 個 JSON（約 490KB，gzip 約 80KB）
 *   const r = await TcAddr.lookup('北屯區崇德路三段200號');
 *   if (r.ok) { const res = SchoolDistrict.resolve(r, data); … }
 *
 * resolve(r, data) →
 *   { basis: { dist, li, lin, precision, precisionText, label, note, estimated, needNumber, bracketed, inferred,
 *              pairs:[{li, lin, no?, side?, count?, alt?}], user?:{li, lin} },
 *     //   exact：pairs = 該門牌的里鄰（同一門牌也登記在別的里鄰時，alt:true 的也列進來）；
 *     //   near-number：pairs = 前後鄰近門牌的里鄰（no=門牌號、side=lower/upper/same）；
 *     //   lane/road：pairs = 該巷／路段所有門牌涵蓋的里鄰（count=門牌數）。li/lin 是定位點那一戶，僅供地圖標點。
 *     gs: LevelResult, jh: LevelResult, officialQuery:{name,url} }
 *   LevelResult = { status:'green'|'yellow'|'none', reason, label（燈號＋一句話，直接顯示）, message（完整一句）,
 *                   note?（需要多講一句時才有）, frags?:[{cond, names:[校名], co}]（reason=split 時：學區表怎麼依路段分）,
 *                   user?:{li, lin, names:[校名]}（reason=user-lin：使用者自己寫的里鄰對到的學校）,
 *                   schools:[{id, name, cond?, conds?:[{li, lin, c, co}], free?, via:[{li, lin}], count?, hint?}],
 *                     cond＝學區表條件（好幾個里鄰時每一段前面標里鄰，共同學區那段後面標（共同學區））；conds＝逐段明細
 *                   wide:[{id, name, free, co, note, info?:{text,url}}] }
 *     reason：'single' 單一學校｜'co-zone' 學區表寫明共同學區｜'choice' 學區表註記「可選…就讀」（原文沒寫共同學區，照原文引用）
 *            ｜'multi' 學區表同一鄰列了好幾校（這幾列都沒標共同學區）
 *            ｜'split' 同一鄰依路段／條件分屬不同學校（看 frags）｜'cond' 單一學校但有附帶條件｜'free' 自由學區
 *            ｜'neighbors' 查無此號、前後門牌對到不同學校｜'neighbors-none' 查無此號、有一邊的里鄰學區表查無
 *            ｜'edge' 查無此號且超出門牌範圍｜'alts' 同一門牌登記在不同里鄰、對到不同學校
 *            ｜'range' 只打到路／巷｜'wide-free' 只有整區自由學區（和平國中）｜'wide-extra' 有指定學校、但整區另列自由學區或共同學區
 *            ｜'guess' 行政區是依門牌號推測的｜'guess-sec' 段別是依門牌號推測的｜'guess-road' 路名是推測的（打的路沒有這個門牌、改用別條路的）
 *            ｜'amb-no' 門牌寫法有兩種讀法、門牌資料裡都有
 *            ｜'user-lin' 使用者自己寫的里鄰和門牌資料不同、對到不同學校｜'none' 官方學區表查無
 *
 * 燈號規則（綠燈只給「確定只有一所」的情況）：
 *   exact：1 校、沒條件 → green；同一門牌登記在不同里鄰且對到不同學校 → yellow(alts)；其餘 yellow；0 校 → none
 *          「113號之15樓」兩種讀法（113之1號、113之15號）門牌資料都有 → 一律 yellow(amb-no)，兩個都列
 *   near-number：候選門牌＝同一號的其他門牌（之號、臨3號這類同號特殊門牌）＋前一號＋後一號（tc-addr 的 neighbors），
 *                前後被同側門牌夾住（或同一號有門牌），而且全部對到同 1 校、沒條件 → green（estimated，一定要顯示「推估」）；
 *                ⛔ 同一號有之號也要連前後號一起對（同一號的之號常跨到別的學區）；
 *                任一邊的里鄰學區表查無 → yellow(neighbors-none)；前後門牌對到不同學校 → yellow(neighbors)；超出範圍 → yellow(edge)
 *   lane / road：一律 yellow，列出涵蓋的所有學校
 *   行政區是推測的（使用者沒寫區，r.inferred 含 dist）→ 最多 yellow(guess)；段別是推測的（含 sec）→ 最多 yellow(guess-sec)；
 *   路名是推測的（'road'：打的路名存在但沒有這個門牌，改用別條路名的門牌）→ 最多 yellow(guess-road)
 *   該區另有整區自由學區（和平區：和平國中）或整區共同學區（西屯區、大雅區：中科實中國小部）而原本是 green → yellow(wide-extra)
 *
 * liSummary(data, dist, li, lin?) → 只打里名／里鄰時，學區表上這個里列的學校（不給燈號），格式見函式說明。
 *   使用者自己寫了里鄰、跟門牌資料不同、對到不同學校 → yellow(user-lin)，兩邊都列
 */
(function (root) {
  'use strict';

  var BASE = '/data/school-district/';
  var VER = '';          // 資料版本（meta.json 的 built），會加在網址 ?v=，換資料時瀏覽器／CDN 不會拿到舊快取
  var fetchFn = null;
  var loading = null, loadingInfo = null;

  var PREC_TEXT = {
    'exact': '門牌完全吻合',
    'near-number': '門牌資料查無此號，依附近門牌推估',
    'lane': '只定位到巷弄',
    'road': '只定位到路段'
  };

  function getJSON(path) {
    var f = fetchFn || root.fetch;
    return f(BASE + path + (VER ? '?v=' + encodeURIComponent(VER) : '')).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return r.json();
    });
  }

  /** 只載學校清單（畫學校點、校名搜尋用）→ {meta, info} */
  function loadInfo() {
    if (!loadingInfo) {
      loadingInfo = Promise.all(['meta.json', 'school_info.json'].map(getJSON))
        .then(function (a) { return { meta: a[0], info: a[1] }; },
          function (e) { loadingInfo = null; throw e; });
    }
    return loadingInfo;
  }
  /** 查地址要的全部資料 → {meta, gs, jh, info} */
  function load() {
    if (!loading) {
      loading = Promise.all([loadInfo(), getJSON('lookup_gs.json'), getJSON('lookup_jh.json')])
        .then(function (a) { return { meta: a[0].meta, info: a[0].info, gs: a[1], jh: a[2] }; },
          function (e) { loading = null; throw e; });
    }
    return loading;
  }

  // 里名異體字：使用者寫「公館里」，門牌資料是「公舘里」
  var LI_VARIANTS = [['臺', '台'], ['台', '臺'], ['館', '舘'], ['雙', '双'], ['壩', '埧'], ['殼', '壳'], ['村', '里']];
  function liKey(lk, dist, li) {
    if (!li) return '';
    if (lk[dist + '|' + li]) return li;
    for (var i = 0; i < LI_VARIANTS.length; i++) {
      var v = li.split(LI_VARIANTS[i][0]).join(LI_VARIANTS[i][1]);
      if (v !== li && lk[dist + '|' + v]) return v;
    }
    return li;
  }

  function idsAt(e, lin) {
    if (!e) return [];
    var out = (e.all || []).slice();
    ((e.lin || {})[String(lin)] || []).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  // 某里某鄰的學區表片段；fr 沒列到的學校補一個「沒條件」的片段
  function fragsAt(lk, dist, li, lin) {
    var e = lk[dist + '|' + li];
    if (!e) return [];
    var fr = e.fr || {};
    var list = (fr[String(lin)] || []).concat(fr.all || []).map(function (f) {
      return { s: f.s.slice(), c: f.c || '', co: !!f.co, f: f.f || [], q: f.q || null };
    });
    var have = {};
    list.forEach(function (f) { f.s.forEach(function (id) { have[id] = 1; }); });
    idsAt(e, lin).forEach(function (id) { if (!have[id]) list.push({ s: [id], c: '', co: false, f: [], q: null }); });
    return list;
  }
  function isFree(e, id, lin) {
    var fr = e && e.free && e.free[id];
    return !!fr && (fr === 'all' || (fr.indexOf && fr.indexOf(+lin) >= 0));
  }

  // 一個里鄰 → {ids, frags, kind}
  var KIND_RANK = { none: 0, single: 1, cond: 2, 'wide-free': 3, free: 3, multi: 4, 'co-zone': 5, choice: 5, split: 6 };
  // ⛔ 一定先看學校數：只有一校就是 single／cond，不看 co（上游有些「全里」片段把整列的共同學區註記套到只有一校的鄰）
  function classify(lk, dist, li, lin) {
    var e = lk[dist + '|' + li];
    var frags = fragsAt(lk, dist, li, lin);
    var ids = [];
    frags.forEach(function (f) { f.s.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    var freeIds = ids.filter(function (id) { return isFree(e, id, lin) || frags.some(function (f) { return f.f.indexOf(id) >= 0; }); });
    var free = freeIds.length > 0;
    var anyCond = frags.some(function (f) { return !!f.c; });
    var kind, mixed = null;
    if (!ids.length) kind = 'none';
    else if (free) {
      kind = 'free';
      // 同一鄰，一校那一列寫【自由學區】、另一校那一列寫【共同學區】（大里區瑞城里第 4 鄰：瑞城國小／美群國小）→ 兩邊都講
      if (ids.length > 1) {
        var coIds = [];
        frags.forEach(function (f) { if (f.co) f.s.forEach(function (id) { if (freeIds.indexOf(id) < 0 && coIds.indexOf(id) < 0) coIds.push(id); }); });
        if (coIds.length) mixed = { free: freeIds, co: coIds };
      }
    }
    else if (ids.length === 1) kind = anyCond ? 'cond' : 'single';
    else if (anyCond && !(frags.length === 1 && frags[0].co)) kind = 'split';
    else if (frags.every(function (f) { return f.co; }) || frags.some(function (f) { return f.co && f.s.length === ids.length; })) kind = 'co-zone';
    else kind = 'multi';
    // 「可選…就讀」註記（原文沒寫共同學區）：共同學區片段全部帶 q → 照原文引用
    if (kind === 'co-zone' && frags.filter(function (f) { return f.co; }).every(function (f) { return f.q; })) kind = 'choice';
    return { ids: ids, frags: frags, kind: kind, e: e, mixed: mixed };
  }
  // 「可選…就讀」註記原文 → [{id, text}]（依片段順序，同一校只列一次）
  function quotesOf(frags) {
    var out = [], seen = {};
    frags.forEach(function (f) {
      if (!f.co || !f.q) return;
      Object.keys(f.q).forEach(function (id) { if (!seen[id]) { seen[id] = 1; out.push({ id: id, text: f.q[id] }); } });
    });
    return out;
  }

  // 某區某里某鄰 → [{id, cond, free}]（不含整區學區；cond＝這校在這一鄰的學區表條件）
  function schoolsAt(lk, dist, li, lin) {
    var c = classify(lk, dist, li, lin);
    return c.ids.map(function (id) {
      var conds = [];
      c.frags.forEach(function (f) { if (f.s.indexOf(id) >= 0 && f.c && conds.indexOf(f.c) < 0) conds.push(f.c); });
      return { id: id, cond: conds.join('；'), free: isFree(c.e, id, lin) || c.frags.some(function (f) { return f.f.indexOf(id) >= 0; }) };
    });
  }

  function nameOf(info, id) { return (info[id] && info[id].name) || id; }
  function sigOf(ids) { return ids.slice().sort().join('|'); }
  function pairText(p) { return p.li + (p.lin ? ' ' + p.lin + ' 鄰' : ''); }

  function wideOf(lk, dist, info) {
    return ((lk._dist_wide || {})[dist] || []).map(function (w) {
      return {
        id: w.school, name: nameOf(info, w.school),
        free: !!w.free_zone, co: !!w.co_zone,
        // 照學區表原文轉述（和平國中那一列：行政區寫「和平區」，里鄰只寫【自由學區】；原文沒有「全區」兩個字）
        note: w.free_zone ? '學區表在' + nameOf(info, w.school) + '那一列，行政區寫「' + dist + '」，里鄰寫【自由學區】'
          : '學區表寫「' + String(w.raw || dist + '為共同學區').replace(/。$/, '') + '」',
        info: w.info || null
      };
    });
  }

  function normRoad(s) { return String(s || '').replace(/台/g, '臺').replace(/\s+/g, ''); }

  var LABEL = {
    single: '綠燈：只有一所',
    'single-est': '綠燈：前後門牌都屬同一學區（推估）',
    'single-same-nb': '綠燈：同一號和前後門牌都屬同一學區（推估）',
    'single-same': '綠燈：同一號的門牌都在這個學區（推估）',
    'co-zone': '黃燈：學區表列為共同學區',
    choice: '黃燈：學區表另有「可選…就讀」註記',
    'free-co': '黃燈：學區表寫自由學區／共同學區',
    multi: '黃燈：學區表這一鄰列了好幾所',
    split: '黃燈：同一鄰依路段分屬不同學校',
    cond: '黃燈：學區表另有條件',
    free: '黃燈：學區表列為自由學區',
    'wide-free': '黃燈：學區表列為自由學區',
    neighbors: '黃燈：附近門牌分屬不同學區',
    'neighbors-none': '黃燈：附近有門牌在學區表查無',
    edge: '黃燈：號碼超出現有門牌範圍',
    alts: '黃燈：這個號登記在不同里鄰',
    range: '黃燈：只查到路段或巷弄',
    guess: '黃燈：行政區是推測的',
    'guess-sec': '黃燈：段別是推測的',
    'guess-road': '黃燈：路名是推測的',
    'amb-no': '黃燈：門牌有兩種讀法',
    'wide-extra': '黃燈：整區另列自由學區',
    'user-lin': '黃燈：你寫的里鄰和門牌資料不同',
    none: '查無：學區表沒有這個里鄰'
  };

  function levelResult(lk, info, basis, r) {
    var dist = basis.dist;
    var map = {}, order = [], per = [];
    var wide = wideOf(lk, dist, info);
    var wfIds = wide.filter(function (w) { return w.free; }).map(function (w) { return w.id; });
    basis.pairs.forEach(function (p) {
      var c = classify(lk, dist, p.li, p.lin);
      // 這個里鄰一般學區表沒列、但整區是自由學區（和平區的國中＝和平國中）→ 當成那所學校
      if (!c.ids.length && wfIds.length) c = { ids: wfIds.slice(), frags: [{ s: wfIds.slice(), c: '', co: false, f: wfIds.slice() }], kind: 'wide-free', e: null };
      per.push({ p: p, c: c });
      c.ids.forEach(function (id) {
        if (!map[id]) {
          map[id] = { id: id, name: nameOf(info, id), conds: [], cw: [], free: false, via: [], count: 0 };
          order.push(id);
        }
        var m = map[id];
        c.frags.forEach(function (f) {
          if (f.s.indexOf(id) < 0 || !f.c) return;
          if (m.conds.indexOf(f.c) < 0) m.conds.push(f.c);
          var co = !!f.co && f.s.length > 1;
          var k = p.li + '|' + p.lin + '|' + f.c + '|' + co;
          if (!m.cw.some(function (x) { return x.k === k; })) m.cw.push({ k: k, li: p.li, lin: p.lin, c: f.c, co: co });
        });
        if (isFree(c.e, id, p.lin) || c.frags.some(function (f) { return f.f.indexOf(id) >= 0; })) m.free = true;
        m.via.push({ li: p.li, lin: p.lin });
        m.count += p.count || 0;
      });
    });
    // 條件前面要不要標里鄰：判斷依據有好幾個里鄰（查無此號看前後門牌、同一門牌登記在不同里鄰）時才標
    var manyPairs = basis.pairs.length > 1;
    var schools = order.map(function (id) {
      var m = map[id];
      var o = { id: id, name: m.name, via: m.via };
      if (m.conds.length) {
        o.conds = m.cw.map(function (x) { return { li: x.li, lin: x.lin, c: x.c, co: x.co }; });
        o.cond = manyPairs
          ? o.conds.map(function (x) { return pairText(x) + '：' + x.c + (x.co ? '（共同學區）' : ''); }).join('；')
          : m.cw.map(function (x) { return x.c + (x.co ? '（共同學區）' : ''); }).filter(function (t, i, a) { return a.indexOf(t) === i; }).join('；');
        o.condRaw = m.conds.join('；');
      }
      if (m.free) o.free = true;
      if (m.count) o.count = m.count;
      return o;
    });
    if (basis.precision === 'lane' || basis.precision === 'road') schools.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    wide = wide.filter(function (w) { return !map[w.id]; });
    var names = schools.map(function (s) { return s.name; }).join('、');
    var res = { status: 'none', reason: 'none', label: LABEL.none, message: '', schools: schools, wide: wide };
    function set(status, reason, message, note, label) {
      res.status = status; res.reason = reason; res.message = message;
      res.label = label || LABEL[reason] || res.label;
      if (note) res.note = note; else delete res.note;
    }

    // 條件文字提到使用者的路名、而且只有一校提到 → 標 hint（僅供參考，不改燈號）
    var road = normRoad(r.road);
    if (road && schools.length > 1) {
      var hits = schools.filter(function (s) { return s.condRaw && !/^除/.test(s.condRaw) && normRoad(s.condRaw).indexOf(road) >= 0; });
      if (hits.length === 1) hits[0].hint = '條件文字提到「' + r.road + '」';
    }

    var emptyPairs = per.filter(function (x) { return !x.c.ids.length; }).map(function (x) { return x.p; });
    var sigs = {};
    per.forEach(function (x) { sigs[sigOf(x.c.ids)] = 1; });
    var nSig = Object.keys(sigs).length;
    var worst = per.reduce(function (w, x) { return KIND_RANK[x.c.kind] > KIND_RANK[w.c.kind] ? x : w; }, per[0] || { c: { kind: 'none', frags: [] } });

    function byKind(x, estimated) {
      var k = x.c.kind;
      if (k === 'single') {
        // 推估：同一號的門牌（side same）＋前後號（lower/upper）全部對到這一所才會走到這裡
        var hasSame = basis.pairs.some(function (p) { return p.side === 'same'; });
        var hasNb = basis.pairs.some(function (p) { return p.side === 'lower' || p.side === 'upper'; });
        set('green', 'single', '學區為「' + names + '」。', '',
          estimated ? LABEL[hasSame ? (hasNb ? 'single-same-nb' : 'single-same') : 'single-est'] : LABEL.single);
      } else if (k === 'split') {
        // 條件文字一字不差的片段併成一筆（例：清水區中社里第 15 鄰，大秀、槺榔兩校同一段條件）
        var byCond = {}, fl = [];
        per.forEach(function (y) {
          if (y.c.kind !== 'split') return;
          y.c.frags.forEach(function (f) {
            var cond = f.c || '不分路段';
            var key = cond + '|' + (f.co ? 1 : 0);
            if (!byCond[key]) { byCond[key] = { cond: cond, names: [], co: !!f.co }; fl.push(byCond[key]); }
            f.s.forEach(function (id) {
              var n = nameOf(info, id);
              if (byCond[key].names.indexOf(n) < 0) byCond[key].names.push(n);
            });
          });
        });
        res.frags = fl;
        set('yellow', 'split', '這一鄰學區表依路段分屬不同學校：' + fl.map(function (f) { return f.cond + '：' + f.names.join('、') + (f.co ? '（共同學區）' : ''); }).join('；') + '。',
          '學區表怎麼分：');
      } else if (k === 'co-zone') {
        set('yellow', 'co-zone', '學區表列為共同學區：' + names + '。', '學區表寫明這一鄰是共同學區。');
      } else if (k === 'choice') {
        // 原文沒寫「共同學區」：照學區表註記原文引用（太平區頭汴里 11、12 鄰）
        var qs = [];
        per.forEach(function (y) { if (y.c.kind === 'choice') quotesOf(y.c.frags).forEach(function (q) { if (!qs.some(function (z) { return z.id === q.id; })) qs.push(q); }); });
        var qtxt = qs.map(function (q) { return nameOf(info, q.id) + '那一列寫「' + q.text + '」'; }).join('；');
        set('yellow', 'choice', '學區表註記：' + qtxt + '。', '學區表原文：' + qtxt + '。');
      } else if (k === 'multi') {
        set('yellow', 'multi', '學區表這一鄰同時列在：' + names + '。', '學區表把這一鄰同時列在這幾所，請看學區表原文或向學校確認。');
      } else if (k === 'wide-free') {
        var wn = wideOf(lk, dist, info).filter(function (w) { return w.free; })[0];
        set('yellow', 'wide-free', (wn ? wn.note : '學區表列為自由學區') + '：' + names + '。', (wn ? wn.note : '學區表列為自由學區') + '。');
      } else if (k === 'free') {
        var mx = null;
        per.forEach(function (y) { if (!mx && y.c.kind === 'free' && y.c.mixed) mx = y.c.mixed; });
        if (mx) {
          // 大里區瑞城里第 4 鄰：瑞城國小那一列寫【自由學區】、美群國小那一列寫【共同學區】→ 兩邊照原文都講
          var mtxt = mx.free.map(function (id) { return nameOf(info, id); }).join('、') + '那一列寫【自由學區】，' +
            mx.co.map(function (id) { return nameOf(info, id); }).join('、') + '那一列寫【共同學區】';
          set('yellow', 'free', '學區表這一鄰，' + mtxt + '：' + names + '。', '學區表這一鄰，' + mtxt + '。', LABEL['free-co']);
        } else {
          set('yellow', 'free', '學區表把這一鄰列為自由學區：' + names + '。', '學區表把這一鄰列為自由學區。');
        }
      } else if (k === 'cond') {
        set('yellow', 'cond', '學區為「' + names + '」，學區表另有條件：' + (schools[0].cond || '') + '。', '學區表條件：' + (schools[0].cond || ''));
      }
    }

    if (!schools.length) {
      var wf = wide.filter(function (w) { return w.free; });
      if (wf.length) {
        res.schools = wf.map(function (w) { return { id: w.id, name: w.name, free: true, via: [] }; });
        res.wide = wide.filter(function (w) { return !w.free; });
        set('yellow', 'wide-free', wf[0].note + '：' + wf[0].name + '。', wf[0].note + '。');
      } else {
        var where = emptyPairs.length ? emptyPairs.map(pairText).join('、') : pairText(basis);
        set('none', 'none', '官方學區表查無「' + where + '」的學區。',
          '官方學區表沒有列到「' + where + '」。');
      }
    } else if (basis.precision === 'lane' || basis.precision === 'road') {
      set('yellow', 'range', '只查到' + (basis.precision === 'lane' ? '巷弄' : '路段') + '，涵蓋的學校：' + names + '。', '',
        schools.length > 1 ? LABEL.range + '，列出可能的學校' : LABEL.range);
    } else if (basis.precision === 'near-number') {
      if (emptyPairs.length) {
        set('yellow', 'neighbors-none', '附近門牌「' + emptyPairs.map(pairText).join('、') + '」在官方學區表查無；另一邊是：' + names + '。',
          '附近門牌所在的「' + emptyPairs.map(pairText).join('、') + '」，官方學區表查無。');
      } else if (nSig > 1) {
        set('yellow', 'neighbors', '附近門牌分屬不同學區，可能是：' + names + '。', '');
      } else if (worst.c.kind === 'single' && !basis.bracketed) {
        set('yellow', 'edge', '號碼超出這條路（巷）現有門牌的範圍，依最接近的門牌推估為「' + names + '」。', '');
      } else {
        byKind(worst, true);
      }
    } else {
      // exact
      if (basis.ambMulti) {
        set('yellow', 'amb-no', '「' + basis.ambMulti.input + '」可能是' + basis.ambMulti.nos.join('或') + '，對到：' + names + '。',
          schools.length === 1 ? '兩種讀法對到的都是這一所。' : '');
      } else if (basis.pairs.length > 1 && (emptyPairs.length || nSig > 1)) {
        set('yellow', 'alts', '門牌資料裡這個號登記在不同里鄰，對到的學校不同：' + names + '。', '');
      } else {
        byKind(worst, false);
      }
    }

    // 使用者自己寫了里鄰：跟門牌資料不同、而且對到不同學校 → 黃燈，兩邊都列
    if (basis.user) {
      var u = basis.user;
      var ue = lk[dist + '|' + u.li];
      var uids = u.lin ? idsAt(ue, u.lin) : (ue ? (function () {
        var s = (ue.all || []).slice();
        Object.keys(ue.lin || {}).forEach(function (k) { ue.lin[k].forEach(function (id) { if (s.indexOf(id) < 0) s.push(id); }); });
        return s;
      })() : []);
      var same = sigOf(uids) === sigOf(schools.map(function (s) { return s.id; }));
      var unames = uids.map(function (id) { return nameOf(info, id); });
      res.user = { li: u.li, lin: u.lin, names: unames };
      if (!same) {
        var ut = u.li + (u.lin ? ' ' + u.lin + ' 鄰' : '');
        set('yellow', 'user-lin', '你輸入的' + ut + '對到：' + (unames.join('、') || '學區表查無') + '；門牌資料對到：' + (names || '學區表查無') + '。',
          '你輸入的「' + ut + '」對到：' + (unames.join('、') || '學區表查無') + '。學區表看的是里鄰，請以戶口名簿上的里鄰為準，向學校確認。');
      }
    }
    // 行政區／段別是工具依門牌號推測的 → 不給綠燈
    if (res.status === 'green' && /dist/.test(basis.inferred || '')) {
      set('yellow', 'guess', '沒寫行政區，依門牌號推測為' + dist + '，學區為「' + names + '」。', '');
    } else if (res.status === 'green' && /sec/.test(basis.inferred || '')) {
      set('yellow', 'guess-sec', '沒寫段別，依門牌號推測為「' + (r.road || '') + '」，學區為「' + names + '」。', '');
    } else if (res.status === 'green' && /road/.test(basis.inferred || '')) {
      // 打的路名存在、但沒有這個門牌，改用別條路名的同號門牌（三村路合作新村2號 → 三村路2號）
      set('yellow', 'guess-road', '路名是推測的，依門牌號推測為「' + (r.road || '') + '」，學區為「' + names + '」。', '');
    }
    // 有指定學校，但這一區整區另列某校為自由學區（和平區：和平國中）或共同學區
    // （西屯區、大雅區：國立中科實驗高級中學國小部，學區表原文「大雅區及西屯區皆為共同學區」）
    // → 不給綠燈、不說「只有一所」，兩所都讓人看到（整區那所的學區表原文和招生出處，結果卡用 wide 顯示）
    if (res.status === 'green') {
      var wfx = res.wide.filter(function (w) { return w.free || w.co; });
      if (wfx.length) {
        var wNames = wfx.map(function (w) { return w.name; }).join('、');
        var wKind = wfx.every(function (w) { return w.free; }) ? '自由學區' : wfx.every(function (w) { return w.co; }) ? '共同學區' : '自由學區或共同學區';
        set('yellow', 'wide-extra', '學區為「' + names + '」；' + wfx.map(function (w) { return w.note; }).join('；') + '（' + wNames + '）。', '',
          '黃燈：整區另列' + wNames + '為' + wKind);
      }
    }
    return res;
  }

  /** 從 TcAddr.lookup 的結果整理出「判定依據的里鄰」 */
  function basisOf(r, lk) {
    var b = {
      dist: r.dist, li: r.li, lin: r.lin, precision: r.precision,
      precisionText: PREC_TEXT[r.precision] || r.precision,
      label: r.label, note: r.note || '', estimated: r.precision !== 'exact',
      needNumber: r.precision === 'lane' || r.precision === 'road',
      bracketed: false, inferred: r.inferred || '', pairs: []
    };
    var seen = {};
    function add(p) {
      var k = p.li + '|' + p.lin;
      if (seen[k]) { if (p.count) seen[k].count = (seen[k].count || 0) + p.count; return; }
      seen[k] = p;
      b.pairs.push(p);
    }
    if (r.precision === 'near-number' && r.neighbors && r.neighbors.length) {
      var lo = false, hi = false, same = false;
      r.neighbors.forEach(function (n) {
        add({ li: n.li, lin: n.lin, no: n.no, side: n.side });
        if (n.side === 'same') same = true;
        if (n.side === 'lower' && n.parity === 'same') lo = true;
        if (n.side === 'upper' && n.parity === 'same') hi = true;
      });
      b.bracketed = same || (lo && hi);
    } else if ((r.precision === 'lane' || r.precision === 'road') && r.cover && r.cover.length) {
      r.cover.forEach(function (c) {
        c.lins.forEach(function (l, i) { add({ li: c.li, lin: l, count: c.linCounts ? c.linCounts[i] : 0 }); });
      });
    } else if (r.precision === 'exact' && r.ambNo && r.ambNo.options.filter(function (o) { return o.found; }).length > 1) {
      // 「113號之15樓」兩種讀法門牌資料都有 → 兩個門牌的里鄰都要對
      var found = r.ambNo.options.filter(function (o) { return o.found; });
      found.forEach(function (o) {
        add({ li: o.li, lin: o.lin, no: o.no, side: 'amb' });
        (o.alts || []).forEach(function (a) { add({ li: a.li, lin: a.lin, no: o.no, side: 'amb', alt: true }); });
      });
      b.ambMulti = { input: r.ambNo.input, nos: found.map(function (o) { return '「' + String(o.no).replace(/-/g, '之') + '號」'; }) };
      b.bracketed = true;
    } else {
      add({ li: r.li, lin: r.lin, count: r.alts ? (r.pairCount || 0) : 0 });
      (r.alts || []).forEach(function (a) { add({ li: a.li, lin: a.lin, count: a.count || 0, alt: true }); });
      b.bracketed = r.precision === 'exact';
    }
    // 使用者自己寫的里鄰（例：從戶口名簿抄的「賴興里18鄰」）
    var p = r.parsed || {};
    if (p.li || p.lin) {
      var uli = p.li ? (lk ? liKey(lk, r.dist, p.li) : p.li) : r.li;
      var ulin = p.lin || 0;
      var inPairs = b.pairs.some(function (x) { return x.li === uli && (!ulin || x.lin === ulin); });
      if (!inPairs) b.user = { li: uli, lin: ulin };
    }
    return b;
  }

  function resolve(r, data) {
    if (!r || !r.ok) return null;
    var basis = basisOf(r, data.gs);
    return {
      basis: basis,
      gs: levelResult(data.gs, data.info.gs || {}, basis, r),
      jh: levelResult(data.jh, data.info.jh || {}, basis, r),
      officialQuery: (data.meta && data.meta.officialQuery) || null
    };
  }

  /**
   * 只知道里（和鄰）、沒有門牌時（「太平區黃竹里」「大里區瑞城里4鄰」）：學區表上這個里列了哪些學校
   * → {dist, li, gs:{groups, wide}, jh:{groups, wide}}
   *   groups：[{lins:[鄰...], rest, all, ids, names, kind, detail}]
   *     lins＝學區表逐鄰列出、對到這組學校的鄰；rest:true＝「其他鄰」（整里列的學校）；all:true＝整個里都是這組
   *     kind 同 classify（single/cond/co-zone/multi/split/free）；detail＝條件、共同學區這類要多講的一句（沒有就空字串；
   *     split 是「條件：校名；條件：校名（共同學區）」，同樣內容逐段放在 parts:[...]）
   *   wide：整區學區（和平國中、中科實中國小部），格式同 LevelResult.wide
   * 只當參考、不給燈號：還沒對到門牌，不知道住的是哪一鄰（有寫鄰時也只是照使用者寫的鄰）。
   */
  function liSummary(data, dist, li, lin) {
    var liName = li;
    function detailOf(c, info) {
      var k = c.kind;
      if (k === 'cond') {
        var cs = [];
        c.frags.forEach(function (f) { if (f.c && cs.indexOf(f.c) < 0) cs.push(f.c); });
        return '學區表條件：' + cs.join('；');
      }
      if (k === 'co-zone') return '共同學區';
      if (k === 'choice') return '學區表註記：' + quotesOf(c.frags).map(function (q) { return nameOf(info, q.id) + '那一列寫「' + q.text + '」'; }).join('；');
      if (k === 'free') {
        if (c.mixed) return c.mixed.free.map(function (id) { return nameOf(info, id); }).join('、') + '那一列寫自由學區，' +
          c.mixed.co.map(function (id) { return nameOf(info, id); }).join('、') + '那一列寫共同學區';
        return '自由學區';
      }
      if (k === 'multi') return '學區表同一鄰列了這幾所';
      if (k === 'split') {
        var byCond = {}, fl = [];
        c.frags.forEach(function (f) {
          var key = (f.c || '不分路段') + '|' + (f.co ? 1 : 0);
          if (!byCond[key]) { byCond[key] = { cond: f.c || '不分路段', names: [], co: !!f.co }; fl.push(byCond[key]); }
          f.s.forEach(function (id) { var n = nameOf(info, id); if (byCond[key].names.indexOf(n) < 0) byCond[key].names.push(n); });
        });
        c.parts = fl.map(function (f) { return f.cond + '：' + f.names.join('、') + (f.co ? '（共同學區）' : ''); });
        return c.parts.join('；');
      }
      return '';
    }
    function one(lk, info) {
      var key = liKey(lk, dist, li);
      var e = lk[dist + '|' + key];
      var out = { groups: [], wide: wideOf(lk, dist, info) };
      if (!e) return out;
      liName = key;
      function mk(c) {
        if (!c.ids.length) return null;
        var detail = detailOf(c, info);
        return {
          lins: [], rest: false, all: false, ids: c.ids.slice(),
          names: c.ids.map(function (id) { return nameOf(info, id); }),
          kind: c.kind, detail: detail, parts: c.parts || [], sig: c.kind + '#' + detail + '#' + sigOf(c.ids)
        };
      }
      // 「其他鄰」：學區表整里列的學校（用不存在的鄰號 -1 去分類，只會拿到整里的片段）
      var rest = lin ? null : mk(classify(lk, dist, key, -1));
      var listed = {};
      Object.keys(e.lin || {}).forEach(function (k) { listed[k] = 1; });
      Object.keys(e.fr || {}).forEach(function (k) { if (k !== 'all') listed[k] = 1; });
      var list = lin ? [+lin] : Object.keys(listed).map(Number).sort(function (a, b) { return a - b; });
      var bySig = {};
      list.forEach(function (l) {
        var g = mk(classify(lk, dist, key, l));
        if (!g) return;
        if (rest && g.sig === rest.sig) return;            // 跟整里列的一樣，算在「其他鄰」
        if (bySig[g.sig]) { bySig[g.sig].lins.push(l); return; }
        g.lins = [l];
        bySig[g.sig] = g;
        out.groups.push(g);
      });
      if (rest) {
        if (out.groups.length) rest.rest = true; else rest.all = true;
        out.groups.push(rest);
      }
      out.groups.forEach(function (g) { delete g.sig; });
      return out;
    }
    var gs = one(data.gs, data.info.gs || {});
    var jh = one(data.jh, data.info.jh || {});
    return { dist: dist, li: liName, lin: lin || 0, gs: gs, jh: jh };
  }

  /** 鄰號陣列 → 「1-3、5鄰」 */
  function linsText(ns) {
    ns = ns.slice().sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < ns.length) {
      var j = i;
      while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      out.push(j > i + 1 ? ns[i] + '-' + ns[j] : (j === i + 1 ? ns[i] + '、' + ns[j] : String(ns[i])));
      i = j + 1;
    }
    return out.join('、') + '鄰';
  }

  var SchoolDistrict = {
    load: load,
    loadInfo: loadInfo,
    resolve: resolve,
    basisOf: basisOf,
    liSummary: liSummary,
    schoolsAt: function (data, level, dist, li, lin) { return schoolsAt(data[level], dist, li, lin); },
    classify: function (data, level, dist, li, lin) { var c = classify(data[level], dist, li, lin); return { ids: c.ids, kind: c.kind, frags: c.frags, mixed: c.mixed }; },
    linsText: linsText,
    config: function (o) {
      if (o && o.base) BASE = o.base.replace(/\/?$/, '/');
      if (o && o.fetch) fetchFn = o.fetch;
      if (o && o.v != null) VER = String(o.v);
      loading = null; loadingInfo = null;
      return SchoolDistrict;
    }
  };
  root.SchoolDistrict = SchoolDistrict;
  if (typeof module !== 'undefined' && module.exports) module.exports = SchoolDistrict;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
