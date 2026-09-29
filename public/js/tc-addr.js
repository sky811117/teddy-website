/*!
 * tc-addr.js — 台中門牌地址定位（全程在瀏覽器本機比對，不打任何外部地理編碼服務）
 *
 * 資料：/data/tc-addr/index.json（約 95KB，gzip 約 21KB）+ /data/tc-addr/s/<區代碼>-<片號>.json（69 片，每片 ≤180KB，gzip ≤65KB）
 *   由 scripts/build-tc-addr.py 從臺中市政府資料開放平臺
 *   「臺中市空間資訊建物及門牌號碼位置新版本資料」（臺中市政府數位發展局，政府資料開放授權條款-第1版）產生。
 *   版本見 index.json 的 ver（目前 115年1月，762,160 個門牌，已去掉樓層分戶；「50號之7」這種寫法算 50之7號）。
 *   第一次查詢只下載 index.json + 1 個分片；同名路沒寫區時最多再多抓 8 片來比對門牌號。
 *
 * 用法（不需打包）：<script src="/js/tc-addr.js"></script> → window.TcAddr
 *
 *   TcAddr.parse(raw) → 同步，不需資料：
 *     {dist:'西屯區', road:'文心路', sec:3, lane:'12', alley:'5', no:'3', sub:'1', suf:'',
 *      floor:'5樓之3', zip:'407', li:'惠來里', lin:12, roadKey:'文心路三段', street:'文心路3段12巷5弄', input:'...'}
 *     lane/alley 不含「巷」「弄」字；no 是主號、sub 是之號（'3-2' = 之3之2）；樓層不影響門牌，緊接在號後面的「號之N」算之號。
 *     「113號之15樓」這種之號和樓層黏在一起的：sub 放第一種讀法（'1'），另回 subAmb:['1','15']、ambRaw:'之15樓'。
 *
 *   TcAddr.lookup(raw [, {dist:'西屯區', exactRoad:true}]) → Promise：
 *     exactRoad：只照打的路名查（路名在這區存在時，不改用別條路名的門牌；給 choices 裡「打的那條路」用）
 *     成功 {ok:true, dist, li, lin(數字), lat, lng(小數 5 位), label:'臺中市西屯區文心路三段12巷5號',
 *           precision, note, road, lane:'12巷5弄', no:'5', ver:'115年1月', parsed,
 *           lis?:[{li,count}]（lane/road 精度才有：這段經過哪些里）, requestedNo?, gap?（near-number 才有）,
 *           neighbors?（near-number 才有）:[{no, li, lin, side:'same'|'lower'|'upper', gap, parity:'same'|'other', prefixed?:true}]
 *             查無此號時的候選門牌＝同一號的其他門牌（之號不同）＋前一號＋後一號（前後號連同它們的之號；優先同側單雙號），
 *             ⛔ 同一號有之號時也一樣要看前後號（同一號的之號常在別的鄰、別的學區）。
 *             里鄰不同的各列一筆 → 學區查詢要把這些里鄰全部對一遍，對到不同學校就不能只挑一間。
 *             主號相同、但號前帶地名或帶英文字母的門牌（臨3號、雪山一村6號、東興市場一樓42號）一律列成 side:'same', prefixed:true。
 *           prefixed?（near-number 才有）:[{no, label, li, lin, query}]：上面那種同號特殊門牌，頁面可問「是不是這個？」、點 query 直接改查
 *           ambNo?：{input:'113號之15樓', options:[{no:'113-1', floor:'5樓', found, li?, lin?, alts?}, {no:'113-15', floor:'', found}]}
 *             之號和樓層分不開時才有；exact＝只有一種讀法在門牌資料裡（note 會寫），兩種以上都在 → 學區頁要列出全部、亮黃燈
 *           cover?（lane/road 精度才有）:[{li, count, lins:[鄰...], linCounts:[門牌數...]}]，coverScope:'lane'|'road+lanes'
 *             該巷弄（或整條路段含巷弄）所有門牌涵蓋的里與鄰。
 *           alts?:[{li, lin, count}], pairCount?（同一門牌含各樓層也登記在別的里鄰時才有；li/lin 是列數最多的那組）
 *           inferred?:'dist'|'sec'|'dist-bracket'|'sec-bracket'|'road'（行政區／段別是從門牌號推的，使用者沒寫；
 *             'road'＝使用者打的路名在這區存在、但沒有這個門牌，改用別條路名的同號門牌（例：三村路合作新村60號 → 三村路60號））
 *             ⛔ 使用者打的路名在這區存在、只是沒有這個門牌時，改用別條路名（X路 → X路N段）的完全吻合門牌也一律標 inferred
 *             （'sec'／'road'／換到別區 'dist'），學區頁最多黃燈；打的那條路有這個巷弄、只是沒這個號 → 不換路，照前後門牌推估
 *           choices?:[{dist, road, label, query, opts?}]（inferred 時才有：第一個是這次用的，其餘讓使用者改選；
 *             opts 有值時重查要一起帶：TcAddr.lookup(query, opts)）}
 *     「12號之1」「12號-1」＝12之1號；「12號5樓之3」＝12號（樓層不影響門牌）。
 *     沒寫區/段、各區都沒有這個號時，若只有一條的同側門牌號碼把它夾在中間，就用那一條（note 會寫「推估」）。
 *       precision：'exact' 完全吻合｜'near-number' 同路同巷找最接近的號定位（優先同一號的之號、再來同側單雙號；學區看 neighbors）
 *                  ｜'lane' 只定位到巷弄中段｜'road' 只定位到路段中間（里鄰只能當參考，note 會寫）
 *     ⛔ 使用者寫了區、這區沒有這條路：不會自動換到別區（回 road-not-found，candidates＝別區的同名路，wrongDist:true）。
 *     沒寫段（例：北屯區崇德路46號）：本身不分段的同名路＋同名各段一起當候選，不會跳到別區的「崇德路」。
 *     失敗 {ok:false, reason, message, parsed?, candidates?:[{dist, road, label, query}]}
 *       reason：'empty'｜'no-road'（只打里名／里鄰時另回 liOnly:{li, lin, dist, dists:[區...]}；dist＝只有一區有這個里時才有）
 *              ｜'road-not-found'（candidates=相近路名，含只差一個字的；
 *              已改名的舊路名另回 renamed:{from, to, src:{name, org, date, url}}、不給建議）｜'ambiguous'（同名路跨區/沒寫段；candidates 照行政區、段別排）
 *              ｜'not-taichung'（外縣市地址，例：台北市信義區市府路1號）
 *       → 讓使用者從 candidates 選一個，再呼叫 TcAddr.lookup(candidate.query)。
 *     讀檔失敗（離線等）→ Promise reject。
 *
 *   TcAddr.ready() → Promise<{ver, src, srcUrl, lic, count}>（頁面打開先叫，順便預載索引、拿來源文字）
 *   TcAddr.normalize(raw)（全形轉半形、簡體轉正體、台→臺…）、TcAddr.districts（29 區名）
 *   TcAddr.config({base, fetch, v})：v＝版本字樣，index.json 網址會加 ?v=（/data/* 瀏覽器快取 1 天，頁面用檔案雜湊當版本號）
 *
 * ⚠️ 正規化規則必須與 scripts/build-tc-addr.py 一致（路名台→臺、括號拿掉、段用國字、巷弄純國字轉數字、之→-）。
 */
(function (root) {
  'use strict';

  var BASE = '/data/tc-addr/';
  var fetchFn = null;

  var DISTS = ['中區', '東區', '南區', '西區', '北區', '西屯區', '南屯區', '北屯區', '豐原區', '東勢區',
    '大甲區', '清水區', '沙鹿區', '梧棲區', '后里區', '神岡區', '潭子區', '大雅區', '新社區', '石岡區',
    '外埔區', '大安區', '烏日區', '大肚區', '龍井區', '霧峰區', '太平區', '大里區', '和平區'];
  var DISTS_BY_LEN = DISTS.slice().sort(function (a, b) { return b.length - a.length; });

  var CN = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_RE = /^[零〇一二兩三四五六七八九十百千]+$/;

  function cn2int(s) {
    if (!s || !CN_RE.test(s)) return null;
    var total = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch in CN) cur = CN[ch];
      else { total += (cur || 1) * (ch === '十' ? 10 : ch === '百' ? 100 : 1000); cur = 0; }
    }
    return total + cur;
  }
  function int2cn(n) {
    var d = '零一二三四五六七八九';
    if (n < 10) return d.charAt(n);
    if (n < 20) return '十' + (n > 10 ? d.charAt(n - 10) : '');
    return d.charAt(Math.floor(n / 10)) + '十' + (n % 10 ? d.charAt(n % 10) : '');
  }
  function toInt(s) {
    if (s == null || s === '') return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return cn2int(s);
  }
  // 門牌號用：「一二三」「二〇〇」「二00」逐位轉（123、200），有十百千才照單位算（一百二十三、五十）
  var CN_DIGIT_ONLY = /^[0-9零〇一二兩三四五六七八九]+$/;
  function noToInt(s) {
    if (s == null || s === '') return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (CN_DIGIT_ONLY.test(s)) {
      var t = '';
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        t += /\d/.test(ch) ? ch : String(CN[ch]);
      }
      return parseInt(t, 10);
    }
    return cn2int(s);   // 有十百千：一百二十三、五十；國字、數字混著又有單位的轉不了 → null
  }

  // 非臺中市的縣市開頭（外縣市地址不要硬對到臺中同名路）
  var OTHER_CITY = /^(?:臺灣省?)?(臺北|新北|桃園|新竹|苗栗|彰化|南投|雲林|嘉義|臺南|高雄|屏東|宜蘭|花蓮|臺東|澎湖|金門|連江|基隆)(市|縣)/;

  // 簡體字 → 正體（從對岸網站、簡體輸入法貼上的地址：「西屯区福星路123号5楼」）。
  // 只收「門牌資料的路名、里名、區名裡從沒出現過」的簡體字，所以不會把本來就這樣寫的路名改壞
  // （台、后、庄、里、双、干、横、脚、谷 臺中本來就在用，不轉；升、沈、范、划 正體也常用，不轉）。
  // 最後兩組是臺灣常見異體字：光啟路→光啓路、文匯街→文滙街（門牌資料用的是後者）。
  // 表是用 OpenCC t2s 對 index.json（115年1月版）全部路名、里名算出來的；換月版後若出現新字，要重算一次。
  var S2T_PAIRS = '万萬业業东東两兩丰豐临臨丽麗义義乌烏乐樂乔喬乡鄉云雲亚亞亿億仪儀会會伟偉伦倫侨僑兰蘭关關兴興养養内內冈岡' +
    '军軍农農凤鳳凯凱势勢区區华華协協卫衛厂廠县縣发發号號启啓吴吳员員园園国國圆圓圣聖场場复復头頭妈媽学學宁寧宝寶寿壽' +
    '层層岗崗岛島岭嶺师師广廣庆慶库庫庙廟开開张張弹彈强強怀懷护護旧舊昆崑晋晉术術权權条條来來杨楊枫楓柜櫃树樹栖棲桥橋' +
    '楼樓樱櫻气氣汇滙汉漢沟溝泽澤浊濁济濟涂塗渔漁温溫游遊湾灣满滿滨濱澜瀾灵靈热熱爱愛狮獅环環现現电電礼禮积積窑窯笃篤' +
    '筑築简簡粤粵纬緯纸紙纺紡线線练練经經统統绥綏继繼维維绿綠联聯肃肅胜勝艺藝芦蘆苎苧荣榮莱萊营營蒋蔣蓝藍补補观觀诏詔' +
    '诒詒诚誠贞貞贤賢贵貴贸貿赖賴车車轮輪辉輝辽遼达達过過进進远遠连連邻鄰铁鐵铜銅银銀锦錦镇鎮镰鎌长長门門间間阳陽际際' +
    '陈陳陕陝雾霧顶頂顺順风風马馬驼駝鳌鰲鸣鳴鹏鵬黄黃齐齊龄齡龙龍龟龜馆館啟啓匯滙';
  var S2T = {};
  for (var s2i = 0; s2i + 1 < S2T_PAIRS.length; s2i += 2) S2T[S2T_PAIRS.charAt(s2i)] = S2T_PAIRS.charAt(s2i + 1);
  var S2T_RE = new RegExp('[' + Object.keys(S2T).join('') + ']', 'g');
  function s2t(s) { return s.replace(S2T_RE, function (c) { return S2T[c]; }); }

  /** 全形→半形、去空白、簡體轉正體、統一破折號與「臺」 */
  function normalize(raw) {
    var s = s2t(String(raw == null ? '' : raw));
    s = s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
    s = s.replace(/[\s　]+/g, '');
    s = s.replace(/[‐-―−─－﹣~～]/g, '-');
    s = s.replace(/ㄧ/g, '一').replace(/台/g, '臺');
    s = s.replace(/[○◯]/g, '〇');   // 很多人用圓圈符號打國字零：「二○○號」＝200 號
    s = s.replace(/[(（\[【][^)）\]】]*[)）\]】]/g, '');
    s = s.replace(/[,，、。:;"'「」]/g, '');
    return s;
  }

  // 路名 key：段一律國字
  function roadKeyOf(road, sec) {
    return road + (sec ? int2cn(sec) + '段' : '');
  }
  // 巷/弄 key：純國字數字轉阿拉伯、之→-
  function segKey(t, suffix) {
    if (!t) return '';
    t = t.replace(/之/g, '-');
    var n = cn2int(t);
    if (n != null) t = String(n);
    return t + suffix;
  }

  var ROAD_MARK = /[路街段道]/;
  function lastRoadMark(s) {
    for (var i = s.length - 1; i >= 0; i--) if (ROAD_MARK.test(s.charAt(i))) return i;
    return -1;
  }

  /** 路巷弄字串 → {road, sec, lane, alley}（lane/alley 不含「巷」「弄」字尾） */
  function splitStreet(st) {
    var lane = '', alley = '', i;
    st = st.replace(/(\d+)段/g, function (m, d) { return int2cn(parseInt(d, 10)) + '段'; });
    if (/弄$/.test(st)) {
      i = Math.max(st.lastIndexOf('巷', st.length - 2), lastRoadMark(st.slice(0, -1)));
      alley = st.slice(i + 1, -1);
      st = st.slice(0, i + 1);
    }
    if (/巷$/.test(st)) {
      i = lastRoadMark(st.slice(0, -1));
      // 巷名本身含「路」字（例：東勢區粵寧街「中路巷」）→ 往前找下一個路/街/段
      while (i >= 0 && i === st.length - 2) i = lastRoadMark(st.slice(0, i));
      if (i >= 0) { lane = st.slice(i + 1, -1); st = st.slice(0, i + 1); }
      // 沒有路/街/段在前面：這個「XX巷」本身就是路名（例：西屯區福上巷）
    }
    var road = st, sec = 0;
    var m = road.match(/^(.+?)([一二三四五六七八九十]+)段$/);
    if (m) { road = m[1]; sec = cn2int(m[2]); }
    lane = lane.replace(/之/g, '-'); alley = alley.replace(/之/g, '-');
    var nl = cn2int(lane); if (nl != null) lane = String(nl);
    var na = cn2int(alley); if (na != null) alley = String(na);
    return { road: road, sec: sec, lane: lane, alley: alley };
  }

  // 「12號之1」「12號-1」（之N 緊接在號後面，後面是空白、逗號、結尾，或國字樓層「三樓」、地下室「地下1樓」「B1」）＝ 12之1號；
  // 「12號5樓之3」「12號之1 5樓」的樓層部分照舊丟掉。要在拿掉空白之前判斷（「12號之1 5樓」拿掉空白會變「之15樓」）。
  // 「12號之15樓」這種之N 後面緊接阿拉伯數字＋樓的寫法分不出來（12之1號5樓？12之15號？）→ parse 標 subAmb，
  // lookup 兩種讀法都去門牌資料找（見 ambReadings / matchInRoad），⛔ 不默默當成 12 號。
  function subAfterHao(raw) {
    var s = s2t(String(raw == null ? '' : raw)).replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
    s = s.replace(/號[\s　]*((?:[之-][\s　]*(?:\d+|[一二三四五六七八九十]+))+)(?=[\s　,，、;；(（\[【]|$|[一二三四五六七八九十]+[樓層]|地下|[Bb]\d)/, function (m, subs) {
      return subs.replace(/[\s　]/g, '').replace(/-/g, '之') + '號';
    });
    // 沒寫「號」：「12之1 5樓」空白分開的，之號跟樓層分得開 → 補上號（拿掉空白後就分不開了）
    if (s.indexOf('號') < 0) {
      s = s.replace(/(\d)([之-]\d+)[\s　,，、]+(?=(?:\d+|[一二三四五六七八九十]+)[樓Ff層])/, '$1$2號');
    }
    return s;
  }
  // 「之15樓」的 15 可以怎麼切成「之號＋樓層」：['1'(之1、5樓), '15'(之15)]；樓層只接受 1–99、不以 0 開頭
  function ambReadings(D) {
    var out = [];
    for (var i = 1; i < D.length; i++) {
      var a = D.slice(0, i), b = D.slice(i);
      if (a.charAt(0) === '0' || b.charAt(0) === '0' || +b > 99) continue;
      out.push(a);
    }
    if (D.charAt(0) !== '0') out.push(D);
    return out;
  }

  function parse(raw) {
    var s = normalize(subAfterHao(raw));
    var out = { dist: '', road: '', sec: 0, lane: '', alley: '', no: '', sub: '', suf: '', floor: '', zip: '', li: '', lin: 0, roadKey: '', street: '', input: s };
    var m;
    function stripZip() {
      var z = s.match(/^(\d{3,6})(?=\D)/);
      if (z) { out.zip = out.zip || z[1]; s = s.slice(z[1].length); }
    }
    stripZip();
    s = s.replace(/^中華民國/, '');
    m = s.match(OTHER_CITY);
    if (m) out.foreign = m[1] + m[2];
    s = s.replace(/^臺灣省?(?=臺中)/, '');   // ⚠️ 不能無條件拿掉「臺灣」：會吃掉「臺灣大道」
    stripZip();
    s = s.replace(/^臺中(市|縣)/, '');
    stripZip();
    for (var i = 0; i < DISTS_BY_LEN.length; i++) {
      if (s.indexOf(DISTS_BY_LEN[i]) === 0) { out.dist = DISTS_BY_LEN[i]; s = s.slice(out.dist.length); break; }
    }
    if (!out.dist) {  // 舊縣轄寫法：大里市、大雅鄉、清水鎮
      m = s.match(/^(..)(鄉|鎮|市)/);
      if (m && DISTS.indexOf(m[1] + '區') >= 0) { out.dist = m[1] + '區'; s = s.slice(3); }
    }
    // 開頭像「板橋區」「竹北市」「員林鎮」但不是臺中的區 → 先記下來，lookup 時確認不是路名開頭（例：工業區一路）再判外縣市
    if (!out.dist && !out.foreign) {
      m = s.match(/^([^\d路街巷弄號段道里鄰]{2})(區|鎮|市)|^([^\d路街巷弄號段道里鄰]{2,3})鄉/);
      if (m) out.distRaw = m[0];
    }
    // 里鄰：「惠來里12鄰」
    m = s.match(/^([^\d路街巷弄號段]{1,4}?[里村])?(\d+|[一二三四五六七八九十]+)鄰/);
    if (m) { out.li = (m[1] || '').replace(/村$/, '里'); out.lin = toInt(m[2]) || 0; s = s.slice(m[0].length); }

    // 門牌號：取第一個「號」之前，之後的樓層全部不看（緊接在號後面的「號之N」已由 subAfterHao 改成之號）
    var head = s, tail = '';
    var k = s.indexOf('號');
    var ambD = '', ambUnit = '';   // 「號之15樓」「12之15樓」：之號和樓層黏在一起、分不開的數字
    if (k >= 0) {
      head = s.slice(0, k); tail = s.slice(k + 1);
      var am = tail.match(/^之(\d+)(樓|F|f|層)/);
      if (am) { ambD = am[1]; ambUnit = am[2]; }
    }
    else {
      var am2 = head.match(/\d之(\d+)(樓|F|f|層)$/);
      var fm = head.match(/(?:地下|B|b)?(?:\d+|[一二三四五六七八九十]+)(?:樓|F|f|層)(?:之?-?\d+)?$/);
      if (am2) {
        ambD = am2[1]; ambUnit = am2[2];
        tail = '之' + ambD + ambUnit;
        head = head.slice(0, head.length - tail.length);
      } else if (fm && fm.index > 0) { tail = fm[0]; head = head.slice(0, fm.index); }
      head = head.replace(/-$/, '');
    }
    out.floor = tail;
    var nm = k >= 0
      ? head.match(/([0-9零〇一二兩三四五六七八九十百千]+)((?:[-之](?:[0-9零〇一二兩三四五六七八九十]+))*)([A-Za-z]?)$/)
      : head.match(/(\d+)((?:[-之]\d+)*)([A-Za-z]?)$/);
    // 「崇德路三段二00號」這種國字、數字混寫：號碼那段整段拿來轉；轉不了（例：二百3）就當成沒寫號
    if (nm && k >= 0 && noToInt(nm[1]) == null) nm = null;
    var street = head;
    if (nm && nm.index > 0) {
      out.no = String(noToInt(nm[1]));
      if (nm[2]) {
        out.sub = nm[2].split(/[-之]/).filter(Boolean).map(function (x) { var v = noToInt(x); return String(v == null ? x : v); }).join('-');
      }
      out.suf = (nm[3] || '').toUpperCase();   // 東海路13之5A號 這類帶英文字母的門牌
      street = head.slice(0, nm.index);
      if (/臨$/.test(street)) { out.no = '臨' + out.no; street = street.slice(0, -1); }
      // 「113號之15樓」：可能是 113之1號 5樓，也可能是 113之15號 → sub 先放第一種讀法，subAmb 列出全部讓 lookup 逐一比對
      if (ambD && !out.sub) {
        var rd = ambReadings(ambD);
        if (rd.length) out.sub = rd[0];
        if (rd.length > 1) { out.subAmb = rd; out.ambRaw = '之' + ambD + ambUnit; }
      }
    }
    street = street.replace(/[-之]$/, '');
    out.street = street;
    var sp = splitStreet(street);
    out.road = sp.road; out.sec = sp.sec; out.lane = sp.lane; out.alley = sp.alley;
    out.roadKey = roadKeyOf(sp.road, sp.sec);
    return out;
  }

  // ---------------------------------------------------------------- 資料載入
  var idxPromise = null, IX = null, KEYS_BY_LEN = null;
  var shardCache = {}, groupCache = {}, altCache = {};
  var IDX_VER = '';   // TcAddr.config({v}) 給的版本字樣：index.json 網址加 ?v=，換月份版時瀏覽器不會拿快取裡的舊索引

  function getFetch() {
    var f = fetchFn || root.fetch;
    if (!f) throw new Error('TcAddr: 找不到 fetch');
    return f;
  }
  function getJSON(path) {
    return getFetch()(BASE + path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return r.json();
    });
  }
  function loadIndex() {
    if (!idxPromise) {
      idxPromise = getJSON('index.json' + (IDX_VER ? '?v=' + encodeURIComponent(IDX_VER) : '')).then(function (ix) {
        IX = ix;
        KEYS_BY_LEN = Object.keys(ix.r).concat(Object.keys(ix.a || {})).sort(function (a, b) { return b.length - a.length; });
        ix.dn = ix.d.map(function (x) { return x[1]; });
        return ix;
      }, function (e) { idxPromise = null; throw e; });
    }
    return idxPromise;
  }
  function loadShard(di, sn) {
    var fn = 's/' + IX.d[di][0] + '-' + sn + '.json';
    if (!shardCache[fn]) {
      // ?v=版本（index.json 的 v）：只是讓瀏覽器把新月版的分片當成新網址，不拿它快取的舊檔。
      // Cloudflare Pages 回靜態檔時不看 query string（?v= 換什麼都回同一個檔，也就是目前部署的那一份），版本號不會讓伺服器挑版本。
      // public/_headers.txt 讓 /data/* 在瀏覽器快取 1 天：index.json 要靠頁面呼叫 TcAddr.config({v}) 帶版本才會立刻換新；
      // 沒帶的話，瀏覽器最多約 1 天還拿舊索引、舊版本號；分片網址也是舊的，快取裡沒有就會向伺服器拿到新分片，
      // 舊索引配新分片時門牌可能對不到（查無這條路）。所以用 tc-addr.js 的頁面一定要帶 v（學區頁、垃圾車頁都有帶）。
      shardCache[fn] = getJSON(fn + '?v=' + IX.v).catch(function (e) { delete shardCache[fn]; throw e; });
    }
    return shardCache[fn];
  }
  // index.r 的值 "5:2,7:0+1" → [{di:5, sns:[2]}, {di:7, sns:[0,1]}]
  function entriesOf(key) {
    var k = IX.r[key] ? key : (IX.a && IX.a[key]);
    if (!k || !IX.r[k]) return [];
    return IX.r[k].split(',').map(function (x) {
      var p = x.split(':');
      return { key: k, di: parseInt(p[0], 10), sns: p[1].split('+').map(Number) };
    });
  }
  // 讀出一條路（跨片合併 g）
  function loadRoad(ent) {
    return Promise.all(ent.sns.map(function (sn) { return loadShard(ent.di, sn); })).then(function (shs) {
      var ro = null;
      shs.forEach(function (sh) {
        var r = sh.r[ent.key];
        if (!r) return;
        if (!ro) ro = { n: r.n, m: r.m, L: r.L, c: r.c, g: {}, x: {} };
        for (var gk in r.g) ro.g[gk] = r.g[gk];
        if (r.x) for (var xk in r.x) ro.x[xk] = r.x[xk];
      });
      if (ro) ro.id = ent.di + '|' + ent.key;
      return ro;
    });
  }

  var O_LAT, O_LNG, SC;
  // 分片的 x：同一門牌（含各樓層）也登記在別的里鄰 → {號: {pc: 主要里鄰列數, alts: [{li(索引), lin, count}]}}
  function decodeAlts(ro, gk) {
    var id = ro.id + '|' + gk;
    if (altCache[id]) return altCache[id];
    var out = {}, str = ro.x && ro.x[gk];
    if (str) {
      str.split(';').forEach(function (part) {
        var eq = part.indexOf('=');
        if (eq < 0) return;
        var segs = part.slice(eq + 1).split('|');
        out[part.slice(0, eq)] = {
          pc: +segs[0] || 0,
          alts: segs.slice(1).map(function (a) { var t = a.split(':'); return { li: +t[0], lin: +t[1], count: +t[2] || 0 }; })
        };
      });
    }
    altCache[id] = out;
    return out;
  }
  function decodeGroup(ro, gk) {
    var id = ro.id + '|' + gk;
    if (groupCache[id]) return groupCache[id];
    var str = ro.g[gk];
    if (str == null) return null;
    var alts = decodeAlts(ro, gk);
    var out = [], li = 0, lin = 0, la = 0, ln = 0, first = true;
    var parts = str.split(';');
    for (var i = 0; i < parts.length; i++) {
      var f = parts[i].split(',');
      if (f[1] !== '') li = +f[1];
      if (f[2] !== '') lin = +f[2];
      if (first) { la = +f[3]; ln = +f[4]; first = false; } else { la += +f[3]; ln += +f[4]; }
      var mm = f[0].match(/^(\d+)((?:-\d+)*)$/);
      var rec = {
        no: f[0], li: li, lin: lin, la: la, ln: ln, gk: gk,
        main: mm ? +mm[1] : (parseInt((f[0].match(/\d+/) || ['0'])[0], 10)),
        nsub: mm ? (mm[2] ? mm[2].split('-').length - 1 : 0) : 99,
        special: !mm
      };
      if (alts[f[0]]) { rec.alts = alts[f[0]].alts; rec.pc = alts[f[0]].pc; }
      out.push(rec);
    }
    groupCache[id] = out;
    return out;
  }

  // ---------------------------------------------------------------- 比對
  function noLabel(no) { return no ? no.replace(/-/g, '之') + '號' : ''; }
  function gkLabel(gk) { return gk.replace(/(\d)-(\d)/g, '$1之$2'); }
  function round5(v) { return Math.round(v * 1e5) / 1e5; }

  function result(di, ro, rec, precision, note, extra) {
    var dist = IX.dn[di];
    var roadName = ro.n || ro.key;
    var r = {
      ok: true,
      dist: dist,
      li: IX.li[di][rec.li],
      lin: rec.lin,
      lat: round5(rec.la / SC + O_LAT),
      lng: round5(rec.ln / SC + O_LNG),
      label: '臺中市' + dist + roadName + gkLabel(rec.gk) + noLabel(rec.no),
      precision: precision,
      note: note || '',
      road: roadName,
      lane: rec.gk,
      no: rec.no,
      ver: IX.ver
    };
    // 同一門牌（含各樓層）也登記在別的里鄰：alts 列出其他里鄰（li/lin 是列數最多的那組），pairCount＝主要里鄰的列數
    if (rec.alts && rec.alts.length) {
      r.alts = rec.alts.map(function (a) { return { li: IX.li[di][a.li], lin: a.lin, count: a.count }; });
      r.pairCount = rec.pc || 0;
    }
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function liDist(di, counts) {
    return counts.map(function (x) { return { li: IX.li[di][x[0]], count: x[1] }; });
  }
  // 一堆門牌的代表點：最接近平均位置那一筆
  function medoid(recs) {
    var cy = 0, cx = 0, i;
    for (i = 0; i < recs.length; i++) { cy += recs[i].la; cx += recs[i].ln; }
    cy /= recs.length; cx /= recs.length;
    var best = null, bd = Infinity;
    for (i = 0; i < recs.length; i++) {
      var dy = recs[i].la - cy, dx = (recs[i].ln - cx) * 0.913;
      var d = dy * dy + dx * dx;
      if (d < bd) { bd = d; best = recs[i]; }
    }
    return best;
  }
  // 可比號碼的門牌池。prefix：門牌號前面帶地名的（例：三民路三段「一心市場36號」），先在同前綴的門牌裡找
  function numPool(recs, prefix) {
    var pool = [];
    if (prefix) recs.forEach(function (r) {
      if (r.no.indexOf(prefix) !== 0) return;
      var mm = r.no.slice(prefix.length).match(/^(\d+)((?:-\d+)*)$/);
      if (mm) pool.push({ rec: r, main: +mm[1], nsub: mm[2] ? mm[2].split('-').length - 1 : 0 });
    });
    if (!pool.length) recs.forEach(function (r) { if (!r.special) pool.push({ rec: r, main: r.main, nsub: r.nsub }); });
    if (!pool.length) recs.forEach(function (r) { pool.push({ rec: r, main: r.main, nsub: r.nsub }); });
    return pool;
  }
  // 號碼池以外、主號相同的特殊門牌：號前帶地名（臨3、雪山一村6、東興市場一樓42）或帶英文字母（13之5A）。
  // 使用者照一般寫法省略前綴時，這些是「同一個號」的門牌，⛔ 不能略過（它們常在別的里鄰）。
  function specialSame(recs, main, pool) {
    var inPool = [];
    pool.forEach(function (x) { inPool.push(x.rec); });
    return recs.filter(function (r) { return r.special && r.main === main && inPool.indexOf(r) < 0; })
      .sort(function (a, b) { return a.no.length - b.no.length || (a.no < b.no ? -1 : 1); });
  }
  // 找最接近的門牌：同一號（之號不同）→ 同一號的特殊門牌（臨3號…）→ 同側（單/雙號）最近 → 任一側最近
  function nearestNo(recs, main, prefix) {
    var pool = numPool(recs, prefix);
    var same = pool.filter(function (x) { return x.main === main; });
    if (same.length) {
      same.sort(function (a, b) { return a.nsub - b.nsub; });
      return { rec: same[0].rec, side: 'same' };
    }
    var sp = specialSame(recs, main, pool);
    if (sp.length) return { rec: sp[0], side: 'same', prefixed: true, diff: 0 };
    var par = pool.filter(function (x) { return x.main % 2 === main % 2; });
    var cand = par.length ? par : pool;
    var best = null, bd = Infinity;
    for (var i = 0; i < cand.length; i++) {
      var d = Math.abs(cand[i].main - main);
      if (d < bd) { bd = d; best = cand[i].rec; }
    }
    return { rec: best, side: par.length ? 'parity' : 'any', diff: bd };
  }

  // 查無此號時的候選門牌（學區頁拿這些里鄰去對學校，對到不只一所就不給綠燈）：
  //   同一號的其他門牌（之號不同；主號相同的特殊門牌 臨3號、雪山一村6號… 以 side:'same', prefixed:true 加進來）
  //   ＋前一號、後一號，連同它們的之號（優先同側單雙號，那一側沒有同側號碼才用另一側）。
  // ⛔ 同一號有之號時也一定要看前後號：同一號的之號常在別的鄰、別的學區
  //   （例：北屯路 200 號查無，200之1 在三光里 6 鄰〔文昌國小〕，前一號 198 在 5 鄰〔北屯國小〕）。
  // 同一門牌登記在好幾個里鄰的，每一組都列；同一側里鄰相同的只列一筆。
  // → [{no, li, lin, side:'same'|'lower'|'upper', gap, parity:'same'|'other', prefixed?:true}]
  function neighborsOf(di, recs, main, prefix) {
    var pool = numPool(recs, prefix), out = [], seen = {};
    function addRec(rec, side, gap, par, pre) {
      // 同一門牌登記在好幾個里鄰的，每一組都列
      [{ li: rec.li, lin: rec.lin }].concat(rec.alts || []).forEach(function (pr) {
        var k = side + '|' + (pre ? rec.no : '') + '|' + pr.li + '|' + pr.lin;
        if (seen[k]) return;
        seen[k] = 1;
        var o = { no: rec.no, li: IX.li[di][pr.li], lin: pr.lin, side: side, gap: gap, parity: par };
        if (pre) o.prefixed = true;
        out.push(o);
      });
    }
    function addMain(m, side, par) {
      pool.forEach(function (x) { if (x.main === m) addRec(x.rec, side, Math.abs(m - main), par, false); });
    }
    addMain(main, 'same', 'same');
    specialSame(recs, main, pool).forEach(function (r) { addRec(r, 'same', 0, 'same', true); });
    function nearest(dir, sameParity) {
      var best = null;
      pool.forEach(function (x) {
        if (sameParity && x.main % 2 !== main % 2) return;
        if (dir < 0 ? (x.main < main && (best === null || x.main > best)) : (x.main > main && (best === null || x.main < best))) best = x.main;
      });
      return best;
    }
    [-1, 1].forEach(function (dir) {
      var m = nearest(dir, true), par = 'same';
      if (m === null) { m = nearest(dir, false); par = 'other'; }
      if (m !== null) addMain(m, dir < 0 ? 'lower' : 'upper', par);
    });
    return out;
  }
  // 號碼有沒有被同側（單雙號）的前後門牌夾住（沒寫區/段時用來判斷是哪一條）
  function bracketed(recs, main, prefix) {
    var lo = false, hi = false;
    numPool(recs, prefix).forEach(function (x) {
      if (x.main % 2 !== main % 2) return;
      if (x.main < main) lo = true;
      if (x.main > main) hi = true;
    });
    return lo && hi;
  }
  // 一堆門牌涵蓋哪些里、鄰 → [{li, count, lins:[鄰...], linCounts:[門牌數...]}]（門牌多的里排前面）
  function coverOf(di, recs) {
    var m = {}, order = [];
    function add(li, lin) {
      if (!m[li]) { m[li] = { li: IX.li[di][li], count: 0, c: {} }; order.push(li); }
      m[li].count++;
      m[li].c[lin] = (m[li].c[lin] || 0) + 1;
    }
    recs.forEach(function (r) {
      add(r.li, r.lin);
      (r.alts || []).forEach(function (a) { add(a.li, a.lin); });   // 同一門牌也登記在別的里鄰
    });
    return order.map(function (k) {
      var o = m[k];
      var lins = Object.keys(o.c).map(Number).sort(function (a, b) { return a - b; });
      return { li: o.li, count: o.count, lins: lins, linCounts: lins.map(function (l) { return o.c[l]; }) };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function wantNoOf(p) {
    return p.no ? (p.noPrefix || '') + p.no + (p.sub ? '-' + p.sub : '') + (p.suf || '') : '';
  }

  // 在已載入的路裡找門牌；回傳 result 或 null（只在 exactOnly 時會回 null）
  function matchInRoad(di, ro, p, exactOnly) {
    var gk = segKey(p.lane, '巷') + segKey(p.alley, '弄');
    var want = wantNoOf(p);
    var recs = ro.g[gk] != null ? decodeGroup(ro, gk) : null;
    if (want && recs) {
      var i;
      var findNo = function (w) {
        for (var j = 0; j < recs.length; j++) if (recs[j].no === w) return recs[j];
        return null;
      };
      var amb = null;
      if (p.subAmb && p.subAmb.length > 1) {
        // 「113號之15樓」：每一種讀法（113之1號、113之15號）都去找；只有一個存在就用它，好幾個都存在 → ambNo 全列（學區頁亮黃燈）
        var D = (p.ambRaw.match(/\d+/) || [''])[0], unit = p.ambRaw.slice(-1);
        amb = { input: noLabel((p.noPrefix || '') + p.no) + p.ambRaw, options: [] };
        p.subAmb.forEach(function (s) {
          var w = (p.noPrefix || '') + p.no + '-' + s + (p.suf || '');
          var rec = findNo(w);
          var fl = D.slice(s.length);
          var o = { no: w, floor: fl ? fl + unit : '', found: !!rec };
          if (rec) { o.li = IX.li[di][rec.li]; o.lin = rec.lin; if (rec.alts) o.alts = rec.alts.map(function (a) { return { li: IX.li[di][a.li], lin: a.lin, count: a.count }; }); o.rec = rec; }
          amb.options.push(o);
        });
        var readTxt = amb.options.map(function (o) { return '「' + noLabel(o.no) + (o.floor ? ' ' + o.floor : '') + '」'; }).join('或');
        var hitsA = amb.options.filter(function (o) { return o.found; });
        amb.note = '「' + amb.input + '」可以讀成' + readTxt;
        var hitRecs = hitsA.map(function (o) { return o.rec; });
        amb.options.forEach(function (o) { delete o.rec; });
        if (hitRecs.length === 1) {
          return result(di, ro, hitRecs[0], 'exact', amb.note + '；門牌資料只有「' + noLabel(hitRecs[0].no) + '」，就用它', { ambNo: amb });
        }
        if (hitRecs.length > 1) {
          return result(di, ro, hitRecs[0], 'exact', amb.note + '；門牌資料裡都有，請確認是哪一個', { ambNo: amb });
        }
        if (exactOnly) return null;
      } else {
        var hit = findNo(want);
        if (hit) return result(di, ro, hit, 'exact');
        if (p.noPrefix) {   // 號前面多的字不是門牌的一部分（例：大樓名）→ 不含那段再找一次
          var plain = want.slice(p.noPrefix.length);
          // ⛔ 「路名＋號前的字」本身是另一條路名（例：三村路＋合作新村＝路名「三村路合作新村」）時，那段字就是路名的一部分，
          //    不能說「不是門牌的一部分」；改用「三村路」的同號是推測（attempt 會標 inferred:'road'，學區頁最多黃燈）
          var longRoad = (ro.key || '') + p.noPrefix;
          var isRoadName = entriesOf(longRoad).length > 0;
          for (i = 0; i < recs.length; i++) {
            if (recs[i].no === plain) {
              return result(di, ro, recs[i], 'exact', isRoadName
                ? '路名是推測的：門牌資料的「' + longRoad + '」沒有「' + noLabel(plain) + '」，「' + (ro.n || ro.key) + '」有，推測是「' + (ro.n || ro.key) + gkLabel(gk) + noLabel(plain) + '」，請確認'
                : '門牌號前的「' + p.noPrefix + '」不是門牌的一部分，已忽略', isRoadName ? { viaPlain: true, viaRoadName: longRoad } : { viaPlain: true });
            }
          }
        }
        if (exactOnly) return null;
      }
      var main = parseInt(String(p.no).replace(/^\D+/, ''), 10);
      var nn = nearestNo(recs, main, p.noPrefix || '');
      if (nn.rec) {
        var askLabel = amb ? '「' + amb.options.map(function (o) { return noLabel(o.no); }).join('」、「') + '」' : '「' + noLabel(want) + '」';
        var gotLabel = noLabel(nn.rec.no);
        var how = nn.prefixed ? '門牌資料裡同一號的' : nn.side === 'same' ? '同一號的' : (nn.side === 'parity' ? '同一側（' + (main % 2 ? '單號' : '雙號') + '）最接近的' : '最接近的');
        var nb = neighborsOf(di, recs, main, p.noPrefix || '');
        var extra = { requestedNo: want, gap: nn.side === 'same' ? 0 : nn.diff, neighbors: nb };
        if (amb) extra.ambNo = amb;
        // 同一號的特殊門牌（臨3號、雪山一村6號）：讓頁面問「是不是這個？」並能直接改查
        var pre = nb.filter(function (n) { return n.prefixed; });
        if (pre.length) {
          var seenP = {};
          extra.prefixed = [];
          pre.forEach(function (n) {
            if (seenP[n.no]) return;
            seenP[n.no] = 1;
            extra.prefixed.push({ no: n.no, li: n.li, lin: n.lin, label: noLabel(n.no),
              query: '臺中市' + IX.dn[di] + (ro.n || ro.key) + gkLabel(gk) + noLabel(n.no) });
          });
        }
        return result(di, ro, nn.rec, 'near-number',
          (amb ? amb.note + '，門牌資料都沒有；' : '') +
          '查無' + askLabel + '，改用' + how + '「' + gotLabel + '」定位' +
            (nn.side !== 'same' && nn.diff > 20 ? '（差了 ' + nn.diff + ' 號，位置可能差很多）' : '') + '；里鄰可能不同，請再確認。',
          extra);
      }
    }
    if (exactOnly) return null;
    // 只定位到巷弄
    var laneK = segKey(p.lane, '巷'), alleyK = segKey(p.alley, '弄');
    var pool = [];
    // 有寫弄 → 就是那條弄；只寫到巷 → 巷本身＋巷裡所有的弄（使用者可能住在弄裡，只是沒寫）
    if (gk && recs && (alleyK || !laneK)) pool = recs;
    else if (laneK) {
      for (var g in ro.g) if (g.indexOf(laneK) === 0) pool = pool.concat(decodeGroup(ro, g));
    }
    var gkMissing = !!gk && ro.g[gk] == null;
    if (pool.length) {
      var md = medoid(pool);
      var cnt = {};
      pool.forEach(function (r) { cnt[r.li] = (cnt[r.li] || 0) + 1; });
      var lis = Object.keys(cnt).map(function (k) { return [+k, cnt[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
      var at = gkLabel(gkMissing ? laneK : gk);
      var note = (gkMissing && alleyK ? '查無「' + gkLabel(gk) + '」，' : '') +
        (gkMissing && !alleyK && want ? '「' + at + '」的門牌都在弄裡，請補上弄；' : '') +
        '只定位到「' + at + '」中段；' +
        (lis.length > 1 ? '這條巷弄跨 ' + lis.length + ' 個里，請補上門牌號。' : '整條巷弄在同一個里，鄰別只能當參考。');
      var rr = result(di, ro, md, 'lane', note, { lis: liDist(di, lis), cover: coverOf(di, pool), coverScope: 'lane' });
      rr.label = '臺中市' + IX.dn[di] + (ro.n || ro.key) + at;
      rr.lane = gkMissing ? laneK : gk; rr.no = '';
      return rr;
    }
    // 只定位到路段
    var m = ro.m;
    var mrec = { li: m[2], lin: m[3], la: m[0], ln: m[1], gk: m[4], no: m[5] };
    var why = gkMissing ? '查無「' + gkLabel(laneK || gk) + '」，' : (want ? '這條路本身（不在巷弄內）查無門牌號，' : '');
    var r2 = result(di, ro, mrec, 'road',
      why + '只定位到「' + (ro.n || ro.key) + '」路段中間；' +
      (ro.L.length > 1 ? '這條路經過 ' + ro.L.length + ' 個里，請輸入完整門牌。' : '整條路都在「' + IX.li[di][ro.L[0][0]] + '」，鄰別只能當參考。'),
      { lis: liDist(di, ro.L) });
    // 路段涵蓋的里鄰：路上本身＋所有巷弄的門牌（只打路名的人也可能住在巷子裡，學校要列齊）
    var allr = [];
    for (var g2 in ro.g) allr = allr.concat(decodeGroup(ro, g2));
    r2.cover = coverOf(di, allr); r2.coverScope = 'road+lanes';
    r2.label = '臺中市' + IX.dn[di] + (ro.n || ro.key);
    r2.lane = ''; r2.no = '';
    return r2;
  }

  // 從字串前綴猜行政區（「西屯惠來里」→ 西屯區）
  function distHintFrom(prefix) {
    if (!prefix) return -1;
    var hits = {};
    IX.dn.forEach(function (dn, di) { if (prefix.indexOf(dn) >= 0) hits[di] = 1; });
    var full = Object.keys(hits);
    if (full.length === 1) return +full[0];
    hits = {};
    IX.dn.forEach(function (dn, di) {
      var stem = dn.slice(0, -1);
      if ((stem.length >= 2 && prefix.indexOf(stem) >= 0) || prefix === stem) hits[di] = 1;
    });
    IX.li.forEach(function (lst, di) {
      for (var i = 0; i < lst.length; i++) if (lst[i] && prefix.indexOf(lst[i]) >= 0) { hits[di] = (hits[di] || 0) + 1; break; }
    });
    var ks = Object.keys(hits);
    return ks.length === 1 ? +ks[0] : -1;
  }

  var LANE_REST = /^(?:([^巷弄]+)巷)?(?:([^巷弄]+)弄)?$/;
  var SEC_RE = /^(.+?)([一二三四五六七八九十]+)段$/;

  function segName(x) {
    x = (x || '').replace(/之/g, '-');
    var n = cn2int(x);
    return n != null ? String(n) : x;
  }
  function secNorm(st) {
    return st.replace(/(\d+)段/g, function (m, d) { return int2cn(parseInt(d, 10)) + '段'; });
  }

  // 同名各段：「崇德路」→ 崇德路一段、二段、三段…的 entries
  function secEntries(road) {
    var secs = [];
    if (!road) return secs;
    Object.keys(IX.r).forEach(function (K) {
      if (K.indexOf(road) === 0 && /^[一二三四五六七八九十]+段$/.test(K.slice(road.length))) secs = secs.concat(entriesOf(K));
    });
    return secs;
  }
  // 沒寫段的路名（例：崇德路）→ 本身這條（神岡區崇德路）＋同名各段（北屯區崇德路二段…）全部當候選
  function entsNoSec(key) {
    var ents = entriesOf(key).slice();
    var seen = {};
    ents.forEach(function (e) { seen[e.di + '|' + e.key] = 1; });
    secEntries(key).forEach(function (e) { if (!seen[e.di + '|' + e.key]) { seen[e.di + '|' + e.key] = 1; ents.push(e); } });
    return ents;
  }
  var BASES = null;   // 有分段的路去掉段：[崇德路, 文心路, …]（字串裡只寫「文心路」時也找得到）
  function baseKeys() {
    if (BASES) return BASES;
    BASES = [];
    var seen = {};
    Object.keys(IX.r).forEach(function (K) {
      var m = K.match(SEC_RE);
      if (m && !seen[m[1]] && !IX.r[m[1]]) { seen[m[1]] = 1; BASES.push(m[1]); }
    });
    return BASES;
  }

  // 列出「路名 key ＋ 巷弄」的所有可能切法，第一個最可能：
  //   1. parse 的切法剛好是已知路名（exact）；沒寫段時連同名各段一起當候選（nosec）
  //      ⚠️ 沒寫段一律要把各段放進候選：只看「本身不分段的同名路」會跳到別區（北屯區崇德路46號 ≠ 神岡區崇德路）
  //   2. 字串裡含已知路名、後面剩的是巷弄（contains；前面多的字當里名/區名線索）
  //   lit：這種切法把使用者打的字「整串照原樣」拆成路名＋巷弄＋號（字串開頭就是路名），只是跟 parse 的拆法不同
  //        （例：「本街一巷」可以是 本街＋1巷，也可以是路名「本街一巷」；「三村路合作新村6號」可以是 三村路＋「合作新村6號」）
  //        → 不忽略任何字就完全吻合時不算推測（忽略號前的字才吻合的，viaPlain，仍算推測）
  function findSplits(p) {
    var out = [], seen = {};
    function add(ents, key, lane, alley, prefix, how, noPrefix, lit) {
      var id = how + '|' + key + '|' + lane + '|' + alley + '|' + (noPrefix || '');
      if (seen[id] || !ents.length) return;
      seen[id] = 1;
      var h = distHintFrom(prefix);
      out.push({ ents: ents, key: how === 'nosec' ? '' : key, road: key, lane: lane, alley: alley, how: how, hint: h >= 0 ? IX.dn[h] : '', noPrefix: noPrefix || '', lit: !!lit });
    }
    if (p.road) {
      var ex = entriesOf(p.roadKey);
      if (!p.sec) {
        var ne = entsNoSec(p.roadKey);
        var inDist = function (e) { return IX.dn[e.di] === p.dist; };
        if (p.dist && ex.some(inDist) && ne.length > ex.length) {
          // 同一區裡「公安路」和「公安路一段」都有：使用者寫的就是「公安路」→ 先找這條，找不到這個號再看各段
          add(ex, p.roadKey, p.lane, p.alley, '', 'exact');
          add(ne.filter(function (e) { return e.key !== p.roadKey; }), p.roadKey, p.lane, p.alley, '', 'nosec');
        } else {
          add(ne, p.roadKey, p.lane, p.alley, '', ne.length > ex.length ? 'nosec' : 'exact');
        }
      } else {
        add(ex, p.roadKey, p.lane, p.alley, '', 'exact');
      }
    }
    var st = secNorm(p.street), found = [];
    var keys = KEYS_BY_LEN.concat(baseKeys());
    for (var i = 0; i < keys.length; i++) {
      var K = keys[i];
      if (K.length < 2) continue;
      var pos = st.indexOf(K);
      if (pos < 0) continue;
      var rest = st.slice(pos + K.length);
      var lm = rest.match(LANE_REST);
      if (lm) found.push({ pos: pos, K: K, lane: segName(lm[1]), alley: segName(lm[2]), np: '' });
      else if (p.no && rest.length <= 10 && !/[巷弄路街段道]/.test(rest)) found.push({ pos: pos, K: K, lane: '', alley: '', np: rest.replace(/之/g, '-') });
    }
    // 路名越前面越可能是真的路（後面的通常是市場/大樓名），同位置取長的
    found.sort(function (a, b) { return a.pos - b.pos || b.K.length - a.K.length || (a.np ? 1 : 0) - (b.np ? 1 : 0); });
    var hasExact = out.length > 0;
    for (var j = 0; j < found.length && out.length < 6; j++) {
      var f = found[j];
      // 已經有完全吻合的路名時，不再試「砍掉前面幾個字」的路名（例：后里區「三豐東路」≠ 豐原區「豐東路」）
      if (hasExact && f.pos > 0) continue;
      var sectioned = SEC_RE.test(f.K);
      var ents = sectioned ? entriesOf(f.K) : entsNoSec(f.K);
      var how = !sectioned && ents.length > entriesOf(f.K).length ? 'nosec' : 'contains';
      add(ents, f.K, f.lane, f.alley, st.slice(0, f.pos), how, f.np, f.pos === 0);
    }
    return out;
  }

  function applySplit(p, sp) {
    var q = {};
    for (var k in p) q[k] = p[k];
    var key = sp.key || sp.road;
    if (key) {
      q.roadKey = key; q.road = key; q.sec = 0;
      var mm = key.match(SEC_RE);
      if (mm) { q.road = mm[1]; q.sec = cn2int(mm[2]); }
    }
    q.lane = sp.lane; q.alley = sp.alley; q.noPrefix = sp.noPrefix || '';
    if (sp.hint && !q.dist) q.distHint = sp.hint;
    return q;
  }

  function candOf(p, e) {
    var dn = IX.dn[e.di];
    var gk = gkLabel(segKey(p.lane, '巷') + segKey(p.alley, '弄'));
    // 「113號之15樓」這種有兩種讀法的，改選行政區時照原寫法帶過去（不要偷偷變成 113之1號）
    var no = p.ambRaw ? noLabel((p.noPrefix || '') + p.no) + p.ambRaw : noLabel(wantNoOf(p));
    return {
      dist: dn, road: e.key, label: dn + e.key,
      query: '臺中市' + dn + e.key + gk + no
    };
  }
  // 排序：行政區照 DISTS 的順序，同一區再照段別（不分段、一段、二段…）
  function entOrder(a, b) {
    var sa = a.key.match(SEC_RE), sb = b.key.match(SEC_RE);
    return a.di - b.di || (sa ? cn2int(sa[2]) : 0) - (sb ? cn2int(sb[2]) : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  // 候選清單：先列 first（例：有這個門牌號的），再列其他；兩組各自照行政區、段別排
  function candList(p, first, all) {
    var out = [], seen = {};
    first.slice().sort(entOrder).concat(all.slice().sort(entOrder)).forEach(function (e) {
      var k = e.di + '|' + e.key;
      if (seen[k]) return;
      seen[k] = 1;
      out.push(candOf(p, e));
    });
    return out;
  }

  // 用某一種切法去查。exactOnly：只接受「剛好一處完全吻合」，否則回 null（給備用切法用）
  // typed（只給備用切法用）：使用者打的路名在這區確實存在（第一種切法查得到路、只是沒有這個門牌）→ {r: 第一次的結果, q: 第一次的 q, key: 打的路名 key}
  //   這時改用別條路名（X路 → X路N段、三村路合作新村 → 三村路）的完全吻合門牌是「推測」：
  //   ⛔ 一律標 inferred（'sec'／'road'；換到別區是 'dist'），學區頁最多黃燈，choices＝[這次用的, 打的那條路（opts.exactRoad）]；
  //   ⛔ 打的那條路有這個巷弄、只是沒這個號（near-number）→ 不換路，照「查無此號看前後門牌」
  //   只是同一串字的另一種拆法（lit，例：本街一巷＝本街＋1巷）且完全吻合 → 不算推測
  function attempt(q, sp, exactOnly, typed) {
    var ents = sp.ents;
    var wantDist = q.dist || q.distHint || '';
    var pool = ents;
    var what = sp.how === 'nosec' ? q.road : q.roadKey;
    if (wantDist) {
      var f = ents.filter(function (e) { return IX.dn[e.di] === wantDist; });
      if (f.length) pool = f;
      else if (q.dist) {
        // 使用者寫的區沒有這條路：⛔ 不自動換到別區（同名路在別區是另一條路，學區完全不同），列出來讓使用者自己選
        if (exactOnly) return Promise.resolve(null);
        return Promise.resolve({
          ok: false, reason: 'road-not-found', parsed: q, wrongDist: true,
          candidates: candList(q, [], ents).slice(0, 12),
          message: '在' + q.dist + '找不到「' + what + '」這條路。' + (ents.length ? '別的區有同名的路，是不是寫錯區？' : '')
        });
      }
    }
    var want = wantNoOf(q);
    var multiDist = !pool.every(function (e) { return e.di === pool[0].di; });
    function one(e, extraNote, inferred, first) {
      return loadRoad(e).then(function (ro) {
        ro.key = e.key;
        var r = matchInRoad(e.di, ro, q, false);
        var ns = [];
        if (extraNote) ns.push(extraNote);
        if (r.note) ns.push(r.note);
        r.note = ns.join('；');
        r.parsed = q;
        // 「三村路合作新村2號」→ 三村路2號：號前的字是另一條路名的一部分 → 路名是推測的
        if (r.viaRoadName && !inferred) inferred = 'road';
        // inferred：區或段是從門牌號推的（使用者沒寫）→ 學區頁要降成黃燈，choices 讓使用者改選
        if (inferred) {
          r.inferred = inferred;
          // 改選時照選的那條路查（exactRoad），不要又被推測到別條路
          r.choices = candList(q, [e].concat(first || []), pool).map(function (c) { c.opts = { exactRoad: true }; return c; });
        }
        return r;
      });
    }
    // → [{e, plain}]（plain＝忽略號前的字才吻合）
    function exactHitsRaw() {
      return Promise.all(pool.map(function (e) {
        return loadRoad(e).then(function (ro) {
          if (!ro) return null;
          ro.key = e.key;
          var m = matchInRoad(e.di, ro, q, true);
          return m ? { e: e, plain: !!m.viaPlain } : null;
        });
      })).then(function (hits) {
        hits = hits.filter(Boolean);
        // 「號前帶地名」完全吻合的優先於「忽略地名後」吻合的
        var strict = hits.filter(function (h) { return !h.plain; });
        return strict.length ? strict : hits;
      });
    }
    function exactHits() {
      return exactHitsRaw().then(function (hits) { return hits.map(function (h) { return h.e; }); });
    }
    function multiKeyOf(h) { return !pool.every(function (e) { return e.key === h.key; }); }
    function inferOf(h) { return multiDist ? 'dist' : (multiKeyOf(h) ? 'sec' : ''); }
    function whyOf(h) {
      if (pool.length === 1) return sp.how === 'nosec' ? '沒寫段別，這條路只有「' + h.key + '」' : '';
      var multiKey = multiKeyOf(h);
      if (multiKey && multiDist) return '沒寫行政區和段別，依門牌號推測為「' + IX.dn[h.di] + h.key + '」，請確認';
      if (multiKey) return '沒寫段別，依門牌號比對為「' + h.key + '」';
      return '沒寫行政區，依門牌號推測為「' + IX.dn[h.di] + '」，請確認';
    }
    // 打的路名存在、改用別條路名的完全吻合門牌（見函式上方說明）
    function typedJump(h) {
      var e = h.e, tr = typed.r;
      var tdi = IX.dn.indexOf(tr.dist);
      var literal = sp.lit && !h.plain && e.key === sp.road;
      if (literal) {
        // 同一串字的另一種拆法、完全吻合：不算推測（沒寫區、又落在別區才算推測行政區）
        return e.di === tdi ? one(e, '', '') : one(e, '沒寫行政區，依門牌號推測為「' + IX.dn[e.di] + '」，請確認', 'dist');
      }
      if (tr.precision === 'near-number') return Promise.resolve(null);
      var sm = e.key.match(SEC_RE);
      var kind = e.di !== tdi ? 'dist' : h.plain ? 'road' : (sm && sm[1] === typed.key ? 'sec' : 'road');
      return loadRoad(e).then(function (ro) {
        ro.key = e.key;
        var r = matchInRoad(e.di, ro, q, false);
        var gkT = gkLabel(segKey(typed.q.lane, '巷') + segKey(typed.q.alley, '弄'));
        var askNo = gkT + noLabel(wantNoOf(typed.q));
        var got = (ro.n || ro.key);
        var gotAt = got + gkLabel(r.lane) + noLabel(r.no);
        var why;
        if (kind === 'sec') why = '沒寫段別：' + tr.dist + '「' + tr.road + '」沒有「' + askNo + '」這個門牌，「' + got + '」有，推測是「' + gotAt + '」，請確認';
        else if (kind === 'dist') why = '沒寫行政區：' + tr.dist + '「' + tr.road + '」沒有「' + askNo + '」這個門牌，' + IX.dn[e.di] + '「' + got + '」有，推測是「' + IX.dn[e.di] + gotAt + '」，請確認';
        else why = '路名是推測的：門牌資料的「' + tr.road + '」沒有「' + askNo + '」這個門牌，「' + got + '」有，推測是「' + gotAt + '」，請確認';
        // 忽略號前的字才吻合的，matchInRoad 的說明（「不是門牌的一部分」或另一種推測說法）不要再講一次；之號兩種讀法的說明要留
        r.note = [why].concat(!h.plain && r.note ? [r.note] : []).join('；');
        r.parsed = q;
        r.inferred = kind;
        r.choices = [
          { dist: IX.dn[e.di], road: e.key, label: IX.dn[e.di] + got, query: r.label },
          // 打的那條路：帶 opts.exactRoad，重查時不再改用別條路名
          (function () { var c = candOf(typed.q, { di: tdi, key: typed.key }); c.label = tr.dist + tr.road; c.opts = { exactRoad: true }; return c; })()
        ];
        return r;
      });
    }
    if (exactOnly) {
      if (!want || pool.length > 8) return Promise.resolve(null);
      return exactHitsRaw().then(function (hits) {
        if (hits.length !== 1) return null;
        if (typed) return typedJump(hits[0]);
        return one(hits[0].e, whyOf(hits[0].e), inferOf(hits[0].e));
      });
    }
    if (pool.length === 1) return one(pool[0], whyOf(pool[0]));
    // 多個候選（同名路跨區 / 沒寫段別）：有門牌號就逐一比對，剛好一個完全吻合就用它
    var ask = '請選' + (sp.how === 'nosec' ? '段別／' : '') + '行政區。';
    // 都沒有完全吻合：看哪一條（區/段）的同側門牌號碼把這個號夾在中間，剛好一條就用它
    function bracketHits() {
      var main = parseInt(String(q.no).replace(/^\D+/, ''), 10);
      if (isNaN(main)) return Promise.resolve([]);
      var gk = segKey(q.lane, '巷') + segKey(q.alley, '弄');
      return Promise.all(pool.map(function (e) {
        return loadRoad(e).then(function (ro) {
          if (!ro || ro.g[gk] == null) return null;
          return bracketed(decodeGroup(ro, gk), main, q.noPrefix || '') ? e : null;
        });
      })).then(function (xs) { return xs.filter(Boolean); });
    }
    function whyBracket(h) {
      var multiKey = multiKeyOf(h);
      var w = multiKey && multiDist ? IX.dn[h.di] + h.key : (multiKey ? h.key : IX.dn[h.di]);
      // 「查無這個號」由 matchInRoad 的 note 接著講，這裡只講區／段是怎麼推的（卡片上不要講兩次）
      return (multiDist ? '沒寫行政區' : '沒寫段別') + '，依門牌號碼範圍推估為「' + w + '」，請確認';
    }
    if (want && pool.length <= 8) {
      return exactHits().then(function (hits) {
        if (hits.length === 1) return one(hits[0], whyOf(hits[0]), inferOf(hits[0]));
        if (!hits.length) {
          return bracketHits().then(function (bh) {
            if (bh.length === 1) return one(bh[0], whyBracket(bh[0]), (multiDist ? 'dist' : 'sec') + '-bracket');
            return {
              ok: false, reason: 'ambiguous', parsed: q,
              candidates: candList(q, bh, pool),
              message: '「' + what + '」在好幾個地方都有，' + ask
            };
          });
        }
        return {
          ok: false, reason: 'ambiguous', parsed: q,
          candidates: candList(q, hits, pool),
          message: '有 ' + hits.length + ' 個地方都有「' + what + noLabel(want) + '」，' + ask
        };
      });
    }
    return Promise.resolve({
      ok: false, reason: 'ambiguous', parsed: q,
      candidates: candList(q, [], pool),
      message: '「' + what + '」在好幾個地方都有，' + ask
    });
  }

  // 已改名的路：臺中港路（中港路）、中區／西區的中正路 → 臺灣大道（門牌資料只有新路名）
  // 出處：臺中市政府民政局〈本市臺灣大道門牌整編新舊對照表〉（2013-01-01，2026-09-30 查閱）：
  //   「本市中正路、臺中港路及中棲路統一道路名稱為臺灣大道」，道路更名 101年7月1日生效，門牌整編 102年1月1日生效。
  //   中棲路只有一部分改名（門牌資料裡還有中棲路、中棲路一段），所以不列。
  var RENAMED_SRC = {
    org: '臺中市政府民政局', name: '本市臺灣大道門牌整編新舊對照表', date: '2013-01-01',
    url: 'https://www.civil.taichung.gov.tw/92069/post'
  };
  var RENAMED = [
    { from: '中港路', to: '臺灣大道', official: '臺中港路' },   // 公告原文是「臺中港路」，「中港路」是常見簡稱
    { from: '臺中港路', to: '臺灣大道' },
    { from: '中正路', to: '臺灣大道一段', dists: ['中區', '西區'] }
  ];

  // 里名異體字：輸入的「台」會先被 normalize 成「臺」，但門牌資料是「富台里」「丁台里」；寫「公館里」，資料是「公舘里」；舊寫法「XX村」＝「XX里」
  var LI_VARIANTS = [['臺', '台'], ['台', '臺'], ['館', '舘'], ['雙', '双'], ['壩', '埧'], ['殼', '壳'], ['村', '里']];
  // 門牌資料裡有這個里名的行政區 → [{dist, li}]（dist 有給就只看那一區）
  function liHits(li, dist) {
    if (!li || !/[里村]$/.test(li)) return [];
    var names = [li];
    LI_VARIANTS.forEach(function (v) { var x = li.split(v[0]).join(v[1]); if (names.indexOf(x) < 0) names.push(x); });
    var out = [];
    IX.li.forEach(function (lst, di) {
      if (dist && IX.dn[di] !== dist) return;
      for (var i = 0; i < names.length; i++) if (lst.indexOf(names[i]) >= 0) { out.push({ dist: IX.dn[di], li: names[i] }); return; }
    });
    return out;
  }
  // 只打了里名或里鄰、沒有路名（「太平區黃竹里」「大里區瑞城里4鄰」）→ 說明要打路名和門牌號；
  // liOnly 讓頁面可以直接列這個里的學校。不是門牌資料裡的里名 → null（照原本的路名查無處理）
  function liOnlyFail(p, li, lin) {
    var hits = liHits(li, p.dist), elsewhere = false;
    if (!hits.length && p.dist) { hits = liHits(li, ''); elsewhere = hits.length > 0; }
    if (!hits.length) return null;
    var dists = hits.map(function (h) { return h.dist; });
    var what = '「' + li + (lin ? ' ' + lin + ' 鄰' : '') + '」';
    var msg;
    if (elsewhere) msg = '門牌資料裡，' + p.dist + '沒有' + '「' + li + '」，' + dists.join('、') + '才有。請輸入行政區、路名和門牌號碼再查一次。';
    else if (hits.length > 1) msg = '「' + li + '」是里名，' + dists.join('、') + '都有這個里。請輸入行政區、路名和門牌號碼再查一次。';
    else msg = (lin ? '只寫到' + what : what + '是里名') + '，看不出路名。請輸入路名和門牌號碼再查一次。';
    var lo = { li: hits[0].li, lin: lin || 0, dists: dists };
    if (hits.length === 1 && !elsewhere) lo.dist = hits[0].dist;
    return { ok: false, reason: 'no-road', parsed: p, liOnly: lo, message: msg };
  }

  // 只差一個字的路名（公義路 → 公益路）
  function near1(a, b) {
    if (!a || a.length !== b.length || a === b) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a.charAt(i) !== b.charAt(i) && ++d > 1) return false;
    return d === 1;
  }
  function suggestRoads(p) {
    var near = [], pre = [], seen = {};
    function push(arr, K) {
      entriesOf(K).forEach(function (e) {
        if (p.dist && IX.dn[e.di] !== p.dist) return;
        var k = e.di + '|' + e.key;
        if (seen[k]) return;
        seen[k] = 1;
        arr.push(candOf(p, e));
      });
    }
    Object.keys(IX.r).forEach(function (K) {
      var m = K.match(SEC_RE);
      if (near1(p.roadKey, K) || (!p.sec && m && near1(p.road, m[1]))) push(near, K);
    });
    var stem = (p.road || '').slice(0, 2);
    if (stem.length === 2) Object.keys(IX.r).forEach(function (K) { if (K.indexOf(stem) === 0) push(pre, K); });
    return near.slice(0, 6).concat(pre).slice(0, 12);
  }
  function startsLikeRoad(tok) {
    if (!tok) return false;
    for (var i = 0; i < KEYS_BY_LEN.length; i++) if (KEYS_BY_LEN[i].indexOf(tok) === 0) return true;
    return false;
  }

  function lookup(raw, opts) {
    opts = opts || {};
    return loadIndex().then(function (ix) {
      O_LAT = ix.o[0]; O_LNG = ix.o[1]; SC = ix.o[2];
      var p = parse(raw);
      if (opts.dist) {
        var od = normalize(opts.dist);
        if (ix.dn.indexOf(od) < 0 && ix.dn.indexOf(od + '區') >= 0) od += '區';
        p.dist = od;
      }
      if (!p.input) return { ok: false, reason: 'empty', message: '請輸入地址。' };
      // 外縣市：不要硬對到臺中同名路（台北市信義區市府路 ≠ 臺中市西區市府路）
      if (!p.dist && (p.foreign || (p.distRaw && !startsLikeRoad(p.distRaw)))) {
        return {
          ok: false, reason: 'not-taichung', parsed: p,
          message: '這個工具只查臺中市的地址' + (p.foreign ? '（你輸入的是' + p.foreign + '）' : '（「' + p.distRaw + '」不是臺中市的行政區）') + '。'
        };
      }
      if (!p.street) {
        return (p.li && liOnlyFail(p, p.li, p.lin)) || { ok: false, reason: 'no-road', message: '看不出路名，請輸入「路/街＋門牌號」。', parsed: p };
      }
      // 已改名的路（舊地址）：⛔ 不給「只差一個字」的建議（中港路 → 中清路 是完全不同的地方），也不自動換算門牌
      for (var ri = 0; ri < RENAMED.length; ri++) {
        var rn = RENAMED[ri];
        if (p.road !== rn.from) continue;
        if (rn.dists && rn.dists.indexOf(p.dist) < 0) continue;
        if (entriesOf(p.roadKey).concat(entriesOf(p.road)).some(function (e) { return !rn.dists || rn.dists.indexOf(IX.dn[e.di]) >= 0; })) continue;
        return {
          ok: false, reason: 'road-not-found', parsed: p, candidates: [],
          renamed: { from: rn.from, to: rn.to, src: RENAMED_SRC },
          message: '依' + RENAMED_SRC.org + '公告，「' + (rn.official || rn.from) + '」' + (rn.official ? '（常簡稱「' + rn.from + '」）' : '') +
            (rn.dists ? '（' + rn.dists.join('、') + '）' : '') +
            '在 2012 年 7 月 1 日改名為「臺灣大道」，門牌在 2013 年 1 月 1 日重新編號，段別和號碼都可能跟舊地址不同，工具沒辦法自動換算。' +
            '請改用新地址（戶口名簿、房屋稅單上的地址）再查一次。'
        };
      }
      var splits = findSplits(p);
      if (!splits.length) {
        // 「太平區黃竹里」：打的是里名，不是路名
        return liOnlyFail(p, p.street, 0) ||
          { ok: false, reason: 'road-not-found', message: '在' + (p.dist || '臺中市') + '找不到「' + (p.roadKey || p.street) + '」這條路。', parsed: p, candidates: suggestRoads(p) };
      }
      var want = wantNoOf(p);
      var q0 = applySplit(p, splits[0]);
      return attempt(q0, splits[0], false).then(function (r) {
        if (!want || (r.ok && r.precision === 'exact') || splits.length < 2) return r;
        // 使用者打的路名在這區確實存在（只是沒有這個門牌）→ 改用別條路名的門牌都算推測（見 attempt 的 typed）
        var typed = splits[0].how === 'exact' && r.ok ? { r: r, q: q0, key: splits[0].road } : null;
        // 使用者從「改選」點了自己打的那條路：照這條路查，不再改用別條路名
        if (typed && opts.exactRoad) return r;
        // 第一種切法沒有完全吻合 → 看其他切法有沒有（例：巷名含「路」字）
        var i = 1;
        function next() {
          if (i >= splits.length) return r;
          var sp = splits[i++];
          // 使用者寫的路名（例：北屯區「中清路」）在這區真的有、只是沒有這個號 → 照「同路找最接近的號」，
          // 不要跳到同名的其他段（中清路二段36號是另一個地方）
          if (sp.how === 'nosec' && typed && r.precision === 'near-number') return next();
          return attempt(applySplit(p, sp), sp, true, typed).then(function (r2) { return r2 || next(); });
        }
        return next();
      });
    });
  }

  var TcAddr = {
    parse: parse,
    lookup: lookup,
    normalize: normalize,
    districts: DISTS.slice(),
    /** 預先載入索引（頁面一打開就可以先叫，第一次查詢更快）→ Promise<{ver, src, srcUrl, lic, count}> */
    ready: function () {
      return loadIndex().then(function (ix) { return { ver: ix.ver, src: ix.src, srcUrl: ix.srcUrl, lic: ix.lic, count: ix.n }; });
    },
    /** 設定：{base:'/data/tc-addr/', fetch: fn（測試用）, v: 版本字樣（index.json 網址加 ?v=）} */
    config: function (o) {
      if (o && o.base) BASE = o.base.replace(/\/?$/, '/');
      if (o && o.fetch) fetchFn = o.fetch;
      if (o && o.v != null) IDX_VER = String(o.v);
      idxPromise = null; IX = null; KEYS_BY_LEN = null; BASES = null; shardCache = {}; groupCache = {}; altCache = {};
      return TcAddr;
    }
  };
  root.TcAddr = TcAddr;
  if (typeof module !== 'undefined' && module.exports) module.exports = TcAddr;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
