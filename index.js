var http = require('http');
var fetch = require('node-fetch');
var cheerio = require('cheerio');
var fs = require('fs');

// ===================== PERSISTENT CACHE =====================
var CACHE_FILE = './tmdb_cache.json';
var TMDB_CACHE = {};
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      TMDB_CACHE = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log('[Cache] Loaded', Object.keys(TMDB_CACHE).length, 'entries');
    }
  } catch(e) { TMDB_CACHE = {}; }
}
function saveCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(TMDB_CACHE)); } catch(e) {}
}
loadCache();
setInterval(saveCache, 5 * 60 * 1000);
process.on('SIGINT', function() { saveCache(); process.exit(0); });
process.on('SIGTERM', function() { saveCache(); process.exit(0); });

// ===================== CONSTANTS =====================
var JAC_RED_DOMAINS = {
  'jac.red':        'https://jac.red/api/v1.0/torrents',
  'jac-red.ru':     'https://jac-red.ru/api/v1.0/torrents',
  'jr.maxvol.pro':  'https://jr.maxvol.pro/api/v1.0/torrents',
  'ru.jacred.pro':  'https://ru.jacred.pro/api/v1.0/torrents',
  'jacred.stream':  'https://jacred.stream/api/v1.0/torrents'
};
var DEFAULT_JACRED_DOMAIN = 'jac.red';
var TMDB_API_KEY = '6979c8ec101ed849f44d197c86582644';
var PORT = process.env.PORT || 7000;
var KNABEN_BASE_URL = 'https://knaben.org/search/';
var MAGNETZ_BASE_URL = 'https://magnetz.eu/search';

// ===================== JACRED DOMAIN STATUS =====================
var JACRED_DOMAIN_STATUS = {};
Object.keys(JAC_RED_DOMAINS).forEach(function(key) {
  JACRED_DOMAIN_STATUS[key] = { ok: null, lastCheck: 0, latency: null, errors: 0 };
});

function checkJacredDomain(domainKey) {
  var url = JAC_RED_DOMAINS[domainKey];
  if (!url) return Promise.resolve(false);
  var start = Date.now();
  return fetch(url + '?search=test', { timeout: 8000 })
    .then(function(r) {
      var latency = Date.now() - start;
      var ok = r.ok || r.status === 200;
      JACRED_DOMAIN_STATUS[domainKey] = { ok: ok, lastCheck: Date.now(), latency: latency, errors: ok ? 0 : (JACRED_DOMAIN_STATUS[domainKey].errors || 0) + 1 };
      return ok;
    })
    .catch(function(e) {
      JACRED_DOMAIN_STATUS[domainKey] = { ok: false, lastCheck: Date.now(), latency: Date.now() - start, errors: (JACRED_DOMAIN_STATUS[domainKey].errors || 0) + 1 };
      return false;
    });
}

function checkAllJacredDomains() {
  return Promise.all(Object.keys(JAC_RED_DOMAINS).map(checkJacredDomain));
}
checkAllJacredDomains();
setInterval(checkAllJacredDomains, 10 * 60 * 1000);

function getBestJacredDomain(preferredDomain) {
  var preferred = preferredDomain || DEFAULT_JACRED_DOMAIN;
  var preferredStatus = JACRED_DOMAIN_STATUS[preferred];
  if (preferredStatus && preferredStatus.ok !== false) return preferred;
  var bestDomain = null, bestLatency = Infinity;
  Object.keys(JAC_RED_DOMAINS).forEach(function(key) {
    if (key === preferred) return;
    var st = JACRED_DOMAIN_STATUS[key];
    if (st && st.ok === true && (st.latency || 9999) < bestLatency) {
      bestLatency = st.latency; bestDomain = key;
    }
  });
  return bestDomain || preferred;
}

function fetchJacredWithFallback(preferredDomain, queryParam) {
  var best = getBestJacredDomain(preferredDomain);
  var domainOrder = [best].concat(
    Object.keys(JAC_RED_DOMAINS)
      .filter(function(k) { return k !== best; })
      .sort(function(a, b) {
        return ((JACRED_DOMAIN_STATUS[a] && JACRED_DOMAIN_STATUS[a].latency) || 9999) -
               ((JACRED_DOMAIN_STATUS[b] && JACRED_DOMAIN_STATUS[b].latency) || 9999);
      })
  );

  function tryNext(idx) {
    if (idx >= domainOrder.length) return Promise.resolve({ data: [], usedDomain: null });
    var domainKey = domainOrder[idx];
    var start = Date.now();
    return fetch(JAC_RED_DOMAINS[domainKey] + '?' + queryParam, { timeout: 15000 })
      .then(function(r) {
        var latency = Date.now() - start;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        JACRED_DOMAIN_STATUS[domainKey] = { ok: true, lastCheck: Date.now(), latency: latency, errors: 0 };
        return r.json();
      })
      .then(function(data) {
        if (!Array.isArray(data)) throw new Error('Invalid response');
        return { data: data, usedDomain: domainKey };
      })
      .catch(function(e) {
        var latency = Date.now() - start;
        JACRED_DOMAIN_STATUS[domainKey] = { ok: false, lastCheck: Date.now(), latency: latency, errors: (JACRED_DOMAIN_STATUS[domainKey].errors || 0) + 1 };
        return tryNext(idx + 1);
      });
  }
  return tryNext(0);
}

// ===================== DEFAULT CONFIG =====================
var DEFAULT_TORRENTIO_CONFIG = {
  providers: ['yts','eztv','rarbg','1337x','thepiratebay','kickasstorrents','torrentgalaxy','magnetdl','horriblesubs','nyaasi','tokyotosho','anidex','nekobt','rutor','rutracker','torrent9','ilcorsaronero','mejortorrent','wolfmax4k','cinecalidad','besttorrents'],
  sortBy: 'size',
  language: 'russian,ukrainian',
  qualityfilter: []
};

var DEFAULT_CONFIG = {
  torrServerUrl: '',
  jacredEnabled: true,
  torrentioEnabled: true,
  knabenEnabled: true,
  magnetzEnabled: true,
  maxResults: 30,
  jacredDomain: DEFAULT_JACRED_DOMAIN,
  jacredFallback: true,
  animeMode: false,
  preferPack: true,
  commonSortBy: 'size',
  commonQualityFilter: [],
  sizeMinGB: 0,
  sizeMaxGB: 100,
  uiLang: 'en',
  providers: DEFAULT_TORRENTIO_CONFIG.providers,
  sortBy: DEFAULT_TORRENTIO_CONFIG.sortBy,
  language: DEFAULT_TORRENTIO_CONFIG.language,
  qualityfilter: DEFAULT_TORRENTIO_CONFIG.qualityfilter
};

// ===================== CONFIG =====================
function decodeConfig(str) {
  try {
    var parts = str.split('/').filter(Boolean);
    var configPart = parts[0];
    if (!configPart || ['manifest.json','stream','configure','api','play','status'].indexOf(configPart) !== -1) return null;
    var b64 = configPart.replace(/-/g,'+').replace(/_/g,'/');
    while (b64.length % 4) b64 += '=';
    var decoded = JSON.parse(Buffer.from(b64,'base64').toString('utf8'));
    return Object.assign({}, DEFAULT_CONFIG, decoded);
  } catch(e) { return null; }
}

var KEYWORDS = ['manifest.json','stream','configure','api','play','status'];

function parseUrl(reqUrl, host) {
  try {
    var url = new URL(reqUrl, 'http://' + host);
    var pathname = url.pathname;
    var parts = pathname.split('/').filter(Boolean);
    if (parts.length > 0 && KEYWORDS.indexOf(parts[0]) === -1) {
      var cfg = decodeConfig(parts[0]);
      if (cfg) return { userConfig: cfg, configStr: parts[0], rest: '/' + parts.slice(1).join('/') };
    }
    return { userConfig: null, configStr: null, rest: pathname };
  } catch(e) {
    return { userConfig: null, configStr: null, rest: reqUrl };
  }
}

function parseQuery(reqUrl, host) {
  try {
    var url = new URL(reqUrl, 'http://' + host);
    return Object.fromEntries(url.searchParams.entries());
  } catch(e) { return {}; }
}

function parseSize(sn) {
  if (!sn) return 0;
  var s = parseFloat(sn) || 0;
  var up = String(sn).toUpperCase();
  if (up.includes('GB')) return s;
  if (up.includes('MB')) return s / 1024;
  if (s > 100) return s / 1024;
  return s;
}

function decodeUnicode(str) {
  try {
    return str.replace(/\\u[\dA-F]{4}/gi, function(m) {
      return String.fromCharCode(parseInt(m.replace(/\\u/,''), 16));
    });
  } catch(e) { return str; }
}

// ===================== FIX HTTPS =====================
function getPublicUrlFromReq(req) {
  var host = req.headers['x-forwarded-host'] || req.headers['host'] || ('localhost:' + PORT);
  var proto = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-scheme'] || req.headers['x-scheme'] || 'http';
  if (proto.indexOf(',') !== -1) proto = proto.split(',')[0].trim();
  if (host.indexOf(',') !== -1) host = host.split(',')[0].trim();
  if (host.indexOf('://') !== -1) return host.replace(/\/$/, '');
  var isLocal = /^localhost(:\d+)?$/.test(host) || /^127\./.test(host) || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!isLocal) proto = 'https';
  return (proto + '://' + host).replace(/\/$/, '');
}

function buildTorrentioBase(cfg) {
  var opts = [];
  if (cfg.providers && cfg.providers.length) opts.push('providers=' + cfg.providers.join(','));
  opts.push('sort=' + (cfg.sortBy || 'size'));
  if (cfg.language) opts.push('language=' + cfg.language);
  if (cfg.qualityfilter && cfg.qualityfilter.length) opts.push('qualityfilter=' + cfg.qualityfilter.join(','));
  return 'https://torrentio.strem.fun/' + opts.join('|');
}

function buildManifest(cfg, configStr, pub) {
  return {
    id: 'com.hybrid.addon',
    version: '8.0.0',
    name: 'Hybrid Addon',
    description: 'TorrServer · JacRed · Knaben · Magnetz · Torrentio',
    resources: ['stream'],
    types: ['movie','series'],
    idPrefixes: ['tt'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      configurationURL: pub + (configStr ? '/'+configStr : '') + '/configure'
    }
  };
}

// ===================== TMDB =====================
function getTMDbInfo(imdbId, type) {
  var cacheKey = imdbId + '_info';
  if (TMDB_CACHE[cacheKey]) return Promise.resolve(TMDB_CACHE[cacheKey]);
  var metaType = (type === 'series') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id', { timeout: 12000 })
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(data) {
      var results = data[metaType + '_results'] || [];
      if (!results.length) return null;
      var item = results[0];
      var tmdbId = item.id;
      var releaseDate = item.release_date || item.first_air_date || '';
      var year = releaseDate ? releaseDate.substring(0, 4) : '';
      var origTitle = item.title || item.name || '';
      return fetch('https://api.themoviedb.org/3/' + metaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=ru', { timeout: 12000 })
        .then(function(r) { return r.ok ? r.json() : {}; })
        .then(function(d) {
          var ruTitle = (d.title || d.name || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
          var info = { origTitle: origTitle, ruTitle: ruTitle || null, year: year };
          TMDB_CACHE[cacheKey] = info;
          return info;
        });
    })
    .catch(function() { return null; });
}

// ===================== TORRSERVER =====================
var torrServerCache = {}, CACHE_TTL = 30 * 60 * 1000;

function getTorrServerFiles(tsUrl, magnet, title) {
  return fetch(tsUrl + '/torrents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', link: magnet, title: title, poster: '', save_to_db: false }),
    timeout: 12000
  })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data || !data.hash) return null;
    if (data.file_stats && data.file_stats.length > 0) return { hash: data.hash, files: data.file_stats };
    return new Promise(function(resolve) {
      var attempts = 0;
      function tryGet() {
        attempts++;
        setTimeout(function() {
          fetch(tsUrl + '/torrents', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get', hash: data.hash }), timeout: 12000
          })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(d) {
            if (d && d.file_stats && d.file_stats.length > 0) resolve({ hash: data.hash, files: d.file_stats });
            else if (attempts < 12) tryGet();
            else resolve({ hash: data.hash, files: [] });
          })
          .catch(function() { if (attempts < 12) tryGet(); else resolve({ hash: data.hash, files: [] }); });
        }, 3000);
      }
      tryGet();
    });
  })
  .catch(function() { return null; });
}

function getCachedFiles(ts, magnet, title) {
  var hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
  var cacheKey = hashMatch ? hashMatch[1].toLowerCase() : null;
  if (cacheKey && torrServerCache[cacheKey] && (Date.now() - torrServerCache[cacheKey].timestamp) < CACHE_TTL) {
    return Promise.resolve({ hash: cacheKey, files: torrServerCache[cacheKey].files });
  }
  return getTorrServerFiles(ts, magnet, title).then(function(result) {
    if (result && result.files.length > 0 && cacheKey) torrServerCache[cacheKey] = { files: result.files, timestamp: Date.now() };
    return result;
  });
}

setInterval(function() {
  var now = Date.now();
  Object.keys(torrServerCache).forEach(function(k) {
    if (now - torrServerCache[k].timestamp > CACHE_TTL) delete torrServerCache[k];
  });
}, 10 * 60 * 1000);

// ===================== FILE FINDING =====================
function findAnimeEpisodeFile(files, season, episode) {
  if (!files || !files.length) return null;
  var videoExts = ['.mkv','.mp4','.avi','.mov','.wmv','.m4v','.ts'];
  var allFiles = files.map(function(f, idx) { return Object.assign({}, f, { _realIndex: f.id != null ? Number(f.id) : idx }); });
  var videoFiles = allFiles.filter(function(f) { return videoExts.some(function(ex) { return (f.path||'').toLowerCase().endsWith(ex); }); });
  var excludeKw = ['sample','trailer','opening','ending','preview','ncop','nced','creditless','menu','extra','bonus','sp','ova','special'];
  var episodeFiles = videoFiles.filter(function(f) {
    var p = (f.path||'').toLowerCase();
    if ((f.length||0) < 500*1024*1024) return false;
    return !excludeKw.some(function(kw) { return p.indexOf(kw) !== -1; });
  });
  if (!episodeFiles.length) return null;
  episodeFiles.sort(function(a,b) { return (a.path||'').localeCompare(b.path||''); });
  if (episode > 0 && episode <= episodeFiles.length) return episodeFiles[episode - 1];
  return null;
}

function findEpisodeFile(files, season, episode) {
  if (!files || !files.length) return null;
  var s = String(season).padStart(2,'0'), e = String(episode).padStart(2,'0');
  var videoExts = ['.mkv','.mp4','.avi','.mov','.wmv','.m4v','.ts'];
  var allFiles = files.map(function(f, idx) { return Object.assign({}, f, { _realIndex: f.id != null ? Number(f.id) : idx }); });
  var videoFiles = allFiles.filter(function(f) { return videoExts.some(function(ex) { return (f.path||'').toLowerCase().endsWith(ex); }); });
  var excludeKw = ['sample','trailer','opening','ending','preview','ncop','nced','creditless','menu','extra','bonus'];
  var episodeFiles = videoFiles.filter(function(f) {
    var p = (f.path||'').toLowerCase();
    return !excludeKw.some(function(kw) { return p.indexOf(kw) !== -1; });
  });
  if (!episodeFiles.length) return null;

  var hasSeasonMeta = episodeFiles.some(function(f) { return f.season !== undefined; });
  if (hasSeasonMeta) {
    for (var i = 0; i < episodeFiles.length; i++) {
      var f = episodeFiles[i];
      if (String(f.season) === String(season) && String(f.episode) === String(episode)) return f;
    }
  }

  var patterns = [
    new RegExp('s0*' + season + 'e0*' + episode + '(?:\\D|$)', 'i'),
    new RegExp('(?:^|\\D)0*' + episode + '(?:\\D|$)'),
    new RegExp('ep\\s*0*' + episode + '(?:\\D|$)', 'i')
  ];
  for (var i = 0; i < episodeFiles.length; i++) {
    var basename = (episodeFiles[i].path||'').split('/').pop().toLowerCase();
    for (var j = 0; j < patterns.length; j++) {
      if (patterns[j].test(basename)) return episodeFiles[i];
    }
  }

  var seasonFiles = episodeFiles.filter(function(f) {
    var fp = (f.path||'').toLowerCase();
    return fp.indexOf('s' + s) !== -1 || fp.indexOf('season' + season) !== -1 || fp.indexOf('season_' + season) !== -1;
  });
  var targetFiles = seasonFiles.length > 0 ? seasonFiles : episodeFiles;
  targetFiles.sort(function(a,b) { return (a.path||'').localeCompare(b.path||''); });
  if (episode > 0 && episode <= targetFiles.length) return targetFiles[episode - 1];
  return null;
}

// ===================== PLAY =====================
function handlePlay(query, cfg, res) {
  var magnet = query.magnet || '';
  var season = parseInt(query.s) || 0;
  var episode = parseInt(query.e) || 0;
  var title = query.title || 'video';
  var ts = query.ts || cfg.torrServerUrl || '';
  if (ts && !ts.match(/^https?:\/\//)) ts = 'http://' + ts;
  if (!magnet || !ts) { res.writeHead(400); res.end('Missing magnet or TorrServer URL'); return; }
  if (!season || !episode) {
    res.writeHead(302, { 'Location': ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(magnet) + '&index=0&play' });
    res.end(); return;
  }
  getCachedFiles(ts, magnet, title).then(function(result) {
    if (!result || !result.files) { res.writeHead(404); res.end('Torrent not found'); return; }
    var found = cfg.animeMode ? findAnimeEpisodeFile(result.files, season, episode) : findEpisodeFile(result.files, season, episode);
    if (found) {
      res.writeHead(302, { 'Location': ts + '/stream/' + encodeURIComponent(title) + '?link=' + result.hash + '&index=' + found._realIndex + '&play' });
      res.end();
    } else { res.writeHead(404); res.end('Episode not found: S' + season + 'E' + episode); }
  }).catch(function() { res.writeHead(500); res.end('Server error'); });
}

// ===================== KNABEN =====================
function classifyKnabenTorrent(title) {
  if (/\bS(\d{1,2})E(\d{1,3})\s*[-–]\s*E?(\d{1,3})\b/i.test(title)) return 'pack';
  if (/\b(complete|full.?series|all.?season|season.?\d+.?\d+)\b/i.test(title)) return 'pack';
  if (/\bS(\d{1,2})E(\d{1,3})\b(?!\s*[-–]\s*E?\d)/i.test(title)) return 'episode';
  if (/\bS(\d{1,2})\b(?!\s*E\d)/i.test(title)) return 'pack';
  return 'pack';
}

function extractSeasonsFromTitle(title) {
  var seasons = [];
  var add = function(n) { if (seasons.indexOf(n) === -1) seasons.push(n); };
  var m;
  m = title.match(/S(\d{1,2})E\d/gi);
  if (m) m.forEach(function(x) { var n = x.match(/\d+/); if (n) add(parseInt(n[0])); });
  m = title.match(/Season\s*(\d{1,2})/gi);
  if (m) m.forEach(function(x) { var n = x.match(/\d+/); if (n) add(parseInt(n[0])); });
  m = title.match(/\bS(\d{1,2})\b(?!\s*E\d)/gi);
  if (m) m.forEach(function(x) { var n = x.match(/\d+/); if (n) add(parseInt(n[0])); });
  return seasons;
}

function searchKnaben(query, year, maxResults, type) {
  var filterSegment = type === 'movie' ? '3000000/1/bytes' : '2000000/1/bytes';
  var searchQuery = year ? query + ' ' + year : query;
  var url = KNABEN_BASE_URL + encodeURIComponent(searchQuery) + '/' + filterSegment;
  console.log('[Knaben] URL:', url);
  return fetch(url, { timeout: 12000 })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var $ = cheerio.load(html);
      var results = [], seen = new Map();
      $('table tbody tr').each(function(i, row) {
        if (results.length >= maxResults) return false;
        var cols = $(row).find('td');
        if (cols.length < 4) return;
        var magnet = null;
        $(row).find('a').each(function(j, a) {
          var href = $(a).attr('href');
          if (href && href.indexOf('magnet:') === 0) { magnet = href; return false; }
        });
        if (!magnet) return;
        var title = $(cols[1]).text().trim();
        var sizeStr = $(cols[2]).text().trim();
        var seeds = parseInt($(cols[4]).text().trim()) || 0;
        var hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
        var key = hashMatch ? hashMatch[1].toLowerCase() : magnet;
        if (seen.has(key)) return;
        seen.set(key, true);
        results.push({ title: title, magnet: magnet, sizeGB: parseSize(sizeStr), seeds: seeds, source: 'knaben' });
      });
      console.log('[Knaben] Found', results.length, 'for "' + searchQuery + '"');
      return results;
    })
    .catch(function(e) { console.error('[Knaben] Error:', e.message); return []; });
}

// ===================== MAGNETZ =====================
function searchMagnetz(query, year, maxResults, type, sortBy) {
  var searchQuery = year ? query + ' ' + year : query;
  var sortParam = "size";
  if (sortBy === "seeds") sortParam = "seeders";
  else if (sortBy === "date") sortParam = "date";
  var baseUrl = MAGNETZ_BASE_URL + "?query=" + encodeURIComponent(searchQuery) + "&sort=" + sortParam;
  maxResults = maxResults || 30;
  
  function fetchPage(page) {
    var url = baseUrl + "&page=" + page;
    console.log('[Magnetz] Page', page, ':', url);
    return fetch(url, { 
      timeout: 15000, 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      } 
    })
    .then(function(r) { 
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text(); 
    })
    .then(function(html) {
      var $ = cheerio.load(html);
      var pageResults = [];
      
      $('article.result-card').each(function(i, card) {
        var title = $(card).find('.result-card__name a').first().text().trim();
        var magnet = $(card).find('button[data-magnet]').attr('data-magnet');
        if (!title || !magnet) return;
        
        var fullText = $(card).text();
        var sizeMatch = fullText.match(/([\d.]+)\s*(GB|MB|TB|KB)/i);
        var sizeStr = sizeMatch ? sizeMatch[0] : '';
        var seedMatch = fullText.match(/([\d,]+)\s*(?:seed|seeder)/i);
        var seeds = seedMatch ? parseInt(seedMatch[1].replace(/,/g,'')) : 0;
        
        pageResults.push({
          title: title,
          magnet: magnet,
          sizeGB: parseSize(sizeStr),
          seeds: seeds,
          source: 'magnetz'
        });
      });
      
      var hasNext = $('a[rel="next"], a:contains("Next")').length > 0 || pageResults.length === 25;
      return { results: pageResults, hasNext: hasNext };
    });
  }
  
  var allResults = [];
  var seen = new Map();
  var currentPage = 1;
  var maxPages = Math.ceil(maxResults / 25);
  
  function fetchAllPages() {
    if (currentPage > maxPages) return Promise.resolve();
    return fetchPage(currentPage).then(function(data) {
      var newCount = 0;
      data.results.forEach(function(item) {
        var hashMatch = item.magnet.match(/btih:([a-fA-F0-9]{40})/i);
        var key = hashMatch ? hashMatch[1].toLowerCase() : item.magnet;
        if (!seen.has(key)) {
          seen.set(key, true);
          allResults.push(item);
          newCount++;
        }
      });
      console.log('[Magnetz] Page', currentPage, '+', newCount, 'unique (total:', allResults.length + ')');
      
      if (allResults.length >= maxResults || !data.hasNext) return Promise.resolve();
      currentPage++;
      return fetchAllPages();
    });
  }
  
  return fetchAllPages()
    .then(function() {
      console.log('[Magnetz] Total found:', allResults.length);
      return allResults.slice(0, maxResults);
    })
    .catch(function(e) { 
      console.error('[Magnetz] Error:', e.message); 
      return allResults.length > 0 ? allResults.slice(0, maxResults) : []; 
    });
}

// ===================== JAC.RED =====================
function searchJacred(imdbId, type, tmdbInfo, maxResults, sortBy, preferredDomain, useFallback) {
  var ruTitle = tmdbInfo && tmdbInfo.ruTitle;
  var year = tmdbInfo && tmdbInfo.year;
  var expectedYear = year ? parseInt(year) : 0;
  var seen = new Map(), unique = [];

  function addResults(arr, sourceName) {
    if (!arr || !arr.length) return 0;
    var newCount = 0;
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i];
      if (!t.magnet) continue;
      var hashMatch = t.magnet.match(/btih:([a-fA-F0-9]{40})/i);
      var key = hashMatch ? hashMatch[1].toLowerCase() : t.magnet;
      if (seen.has(key)) continue;
      var types = t.types || [], seasons = t.seasons || [];
      var yearNum = parseInt(t.relased || t.released || '0') || 0;
      if (type === 'movie' && (types.includes('series') || seasons.length > 0)) continue;
      if (type === 'series' && types.includes('movie') && seasons.length === 0) continue;
      if (expectedYear && yearNum > 1900 && Math.abs(yearNum - expectedYear) > 2) continue;
      seen.set(key, true);
      var qualityText = t.quality === 2160 ? '4K' : t.quality === 1080 ? '1080p' : t.quality === 720 ? '720p' : t.quality === 480 ? '480p' : t.quality ? t.quality + 'p' : '';
      var videoType = '';
      if (t.videotype) { var vt = t.videotype.toLowerCase(); if (vt.includes('hdr') || vt.includes('dolby')) videoType = 'HDR'; }
      var audio = (t.voice && Array.isArray(t.voice)) ? t.voice.filter(Boolean).join('/') : '';
      unique.push({
        title: decodeUnicode(t.title || ''),
        sizeGB: parseSize(t.sizeName || t.size),
        date: t.createdTime ? new Date(t.createdTime).getTime() : 0,
        sid: t.sid || t.seeds || 0,
        tracker: t.tracker || 'Unknown',
        magnet: t.magnet,
        quality: qualityText,
        videoType: videoType,
        audio: audio,
        year: yearNum
      });
      newCount++;
    }
    console.log('[JacRed]', sourceName, '+', newCount, 'unique');
    return newCount;
  }

  function fetchQuery(queryParam) {
    if (useFallback !== false) {
      return fetchJacredWithFallback(preferredDomain, queryParam).then(function(r) { return r.data || []; });
    }
    var apiUrl = JAC_RED_DOMAINS[preferredDomain] || JAC_RED_DOMAINS[DEFAULT_JACRED_DOMAIN];
    return fetch(apiUrl + '?' + queryParam, { timeout: 12000 }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; });
  }

  var promises = [];
  if (ruTitle) promises.push(fetchQuery('search=' + encodeURIComponent(ruTitle)).then(function(arr) { addResults(arr, 'RU'); }));
  promises.push(fetchQuery('search=' + encodeURIComponent(imdbId)).then(function(arr) { addResults(arr, 'IMDb'); }));

  return Promise.all(promises).then(function() {
    unique.sort(function(a, b) {
      if (sortBy === 'seeds') return b.sid - a.sid;
      if (sortBy === 'date') return b.date - a.date;
      return b.sizeGB - a.sizeGB;
    });
    return unique.slice(0, maxResults || 30);
  });
}

// ===================== STREAM =====================
function handleStream(type, id, cfg, res, pub) {
  var ts = cfg.torrServerUrl || '';
  if (ts && !ts.match(/^https?:\/\//)) ts = 'http://' + ts;
  var idClean = decodeURIComponent(id);
  var parts = idClean.split(':');
  var imdbId = parts[0];
  var season = parseInt(parts[1]) || 0;
  var episode = parseInt(parts[2]) || 0;
  var streams = [];

  var total = (cfg.jacredEnabled ? 1 : 0) + (cfg.torrentioEnabled ? 1 : 0) + (cfg.knabenEnabled ? 1 : 0) + (cfg.magnetzEnabled ? 1 : 0);
  if (!total) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ streams: [] })); return; }

  var completed = 0;
  function sendResponse() {
    if (++completed >= total) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ streams: streams }));
    }
  }

  var commonSort = cfg.commonSortBy || 'size';
  var minSize = parseFloat(cfg.sizeMinGB) || 0;
  var maxSize = parseFloat(cfg.sizeMaxGB) || 100;

  var tmdbInfoPromise = getTMDbInfo(imdbId, type);

  // KNABEN
  if (cfg.knabenEnabled) {
    tmdbInfoPromise.then(function(info) {
      var query = (info && info.origTitle) || imdbId;
      var year  = (info && info.year) || '';
      return searchKnaben(query, year, cfg.maxResults || 30, type);
    }).catch(function() {
      return searchKnaben(imdbId, '', cfg.maxResults || 30, type);
    }).then(function(results) {
      sortResults(results, commonSort);
      results.forEach(function(item) {
        if (!item.magnet || item.sizeGB < minSize || (maxSize < 100 && item.sizeGB > maxSize)) return;
        var torrentType = classifyKnabenTorrent(item.title);
        var isPack = torrentType === 'pack';
        if (type === 'series' && season > 0) {
          var titleSeasons = extractSeasonsFromTitle(item.title);
          if (titleSeasons.length > 0 && titleSeasons.indexOf(season) === -1) return;
          if (cfg.preferPack && !isPack) return;
          if (!cfg.preferPack && isPack) return;
        }
        var badge = type === 'series' ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
        var displayTitle = badge + item.title + '\n' + item.sizeGB.toFixed(2) + ' GB | 🌱 ' + item.seeds + '\n📡 Knaben';
        streams.push({
          name: 'Knaben',
          title: displayTitle,
          url: buildStreamUrl(type, isPack, ts, pub, item, season, episode),
          behaviorHints: { notWebReady: true, bingeGroup: 'knaben-' + idClean }
        });
      });
      sendResponse();
    }).catch(function(e) { console.error('[Knaben]', e.message); sendResponse(); });
  }

  // MAGNETZ
  if (cfg.magnetzEnabled) {
    tmdbInfoPromise.then(function(info) {
      var query = (info && info.origTitle) || imdbId;
      var year  = (info && info.year) || '';
      return searchMagnetz(query, year, cfg.maxResults || 30, type, commonSort);
    }).catch(function() {
      return searchMagnetz(imdbId, '', cfg.maxResults || 30, type, commonSort);
    }).then(function(results) {
      sortResults(results, commonSort);
      results.forEach(function(item) {
        if (!item.magnet || item.sizeGB < minSize || (maxSize < 100 && item.sizeGB > maxSize)) return;
        var torrentType = classifyKnabenTorrent(item.title);
        var isPack = torrentType === 'pack';
        if (type === 'series' && season > 0) {
          var titleSeasons = extractSeasonsFromTitle(item.title);
          if (titleSeasons.length > 0 && titleSeasons.indexOf(season) === -1) return;
          if (cfg.preferPack && !isPack) return;
          if (!cfg.preferPack && isPack) return;
        }
        var badge = type === 'series' ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
        var displayTitle = badge + item.title + '\n' + item.sizeGB.toFixed(2) + ' GB | 🌱 ' + item.seeds + '\n📡 Magnetz';
        streams.push({
          name: 'Magnetz',
          title: displayTitle,
          url: buildStreamUrl(type, isPack, ts, pub, item, season, episode),
          behaviorHints: { notWebReady: true, bingeGroup: 'magnetz-' + idClean }
        });
      });
      sendResponse();
    }).catch(function(e) { console.error('[Magnetz]', e.message); sendResponse(); });
  }

  // JACRED
  if (cfg.jacredEnabled) {
    tmdbInfoPromise.then(function(info) {
      return searchJacred(imdbId, type, info, cfg.maxResults || 30, commonSort, cfg.jacredDomain, cfg.jacredFallback !== false);
    }).then(function(results) {
      results.forEach(function(item) {
        if (!item.magnet || item.sizeGB < minSize || (maxSize < 100 && item.sizeGB > maxSize)) return;
        if (type === 'series' && season > 0) {
          var title = item.title;
          var sPad = String(season).padStart(2,'0');
          var completePackPattern = /S\d{1,2}[-~]S?\d{1,2}|Season\s*\d+\s*[-~]\s*\d+|Complete/i;
          if (!completePackPattern.test(title)) {
            var singleSeasonRx = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)', 'i');
            if (!singleSeasonRx.test(title) && /S\d{1,2}|Season\s*\d/.test(title)) return;
          }
        }
        var trackerDisplay = item.tracker.charAt(0).toUpperCase() + item.tracker.slice(1);
        var streamTitle = item.title + '\n' + item.sizeGB.toFixed(2) + ' GB | 🌱 ' + item.sid;
        if (item.quality) streamTitle += ' | 🎬 ' + item.quality + (item.videoType ? ' ' + item.videoType : '');
        if (item.audio) streamTitle += ' | 🔊 ' + item.audio;
        streamTitle += '\n📡 ' + trackerDisplay;
        streams.push({
          name: 'JacRed ' + trackerDisplay,
          title: streamTitle,
          url: type === 'movie'
            ? ts + '/stream/' + encodeURIComponent(item.title) + '?link=' + encodeURIComponent(item.magnet) + '&index=0&play'
            : pub + '/play?magnet=' + encodeURIComponent(item.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(item.title) + '&ts=' + encodeURIComponent(ts),
          behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean }
        });
      });
      sendResponse();
    }).catch(function(e) { console.error('[JacRed]', e.message); sendResponse(); });
  }

  // TORRENTIO
  if (cfg.torrentioEnabled) {
    var tioUrl = buildTorrentioBase(cfg) + '/stream/' + type + '/' + idClean + '.json';
    fetch(tioUrl, { timeout: 12000 })
      .then(function(r) { return r.ok ? r.json() : { streams: [] }; })
      .then(function(data) {
        if (data.streams) {
          data.streams.filter(function(s) { return s.infoHash; }).forEach(function(s) {
            streams.push({
              name: 'Torrentio',
              title: '🎬 ' + s.title,
              url: ts + '/stream/' + encodeURIComponent(s.title || 'video') + '?link=' + s.infoHash + '&index=' + (s.fileIdx || 0) + '&play',
              behaviorHints: { notWebReady: true, bingeGroup: 'torrentio-' + s.infoHash }
            });
          });
        }
        sendResponse();
      }).catch(function(e) { console.error('[Torrentio]', e.message); sendResponse(); });
  }
}

function sortResults(results, sortBy) {
  results.sort(function(a, b) {
    if (sortBy === 'seeds') return (b.seeds || 0) - (a.seeds || 0);
    if (sortBy === 'date') return (b.date || 0) - (a.date || 0);
    return (b.sizeGB || 0) - (a.sizeGB || 0);
  });
}

function buildStreamUrl(type, isPack, ts, pub, item, season, episode) {
  if (type === 'movie') {
    return ts + '/stream/' + encodeURIComponent(item.title) + '?link=' + encodeURIComponent(item.magnet) + '&index=0&play';
  }
  if (isPack) {
    return pub + '/play?magnet=' + encodeURIComponent(item.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(item.title) + '&ts=' + encodeURIComponent(ts);
  }
  return ts + '/stream/' + encodeURIComponent(item.title) + '?link=' + encodeURIComponent(item.magnet) + '&index=0&play';
}

// ===================== CONFIG PAGE =====================
function buildConfigPage(cfg, configStr, pub) {
  var installUrl = pub + (configStr ? '/' + configStr : '') + '/manifest.json';
  var stremioUrl = 'stremio://' + installUrl.replace(/^https?:\/\//, '');
  var commonSort = cfg.commonSortBy || 'size';
  var jacredDomain = cfg.jacredDomain || DEFAULT_JACRED_DOMAIN;
  var jacredFallback = cfg.jacredFallback !== false;

  var domainOptions = '';
  Object.keys(JAC_RED_DOMAINS).forEach(function(key) {
    var st = JACRED_DOMAIN_STATUS[key] || {};
    var indicator = st.ok === true ? ' ✅' : st.ok === false ? ' ❌' : ' ⏳';
    var lat = (st.ok === true && st.latency) ? ' (' + st.latency + 'ms)' : '';
    domainOptions += '<option value="' + key + '"' + (jacredDomain === key ? ' selected' : '') + '>' + key + indicator + lat + '</option>';
  });

  var domainPills = '';
  Object.keys(JAC_RED_DOMAINS).forEach(function(key) {
    var st = JACRED_DOMAIN_STATUS[key] || {};
    var cls = st.ok === true ? 'pill-ok' : st.ok === false ? 'pill-err' : 'pill-wait';
    var icon = st.ok === true ? '✅' : st.ok === false ? '❌' : '⏳';
    var lat = (st.ok === true && st.latency) ? ' ' + st.latency + 'ms' : '';
    domainPills += '<span class="pill ' + cls + '">' + icon + ' ' + key + lat + '</span>';
  });

  var qualityBoxes = ['480p','720p','1080p','4K'].map(function(q) {
    var checked = cfg.commonQualityFilter && cfg.commonQualityFilter.includes(q);
    return '<label class="chip' + (checked ? ' chip-red' : '') + '">'
      + '<input type="checkbox" value="' + q + '" ' + (checked ? 'checked' : '') + ' onchange="toggleQf(this)">'
      + q + '</label>';
  }).join('');

  var html = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'<meta charset="UTF-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">' +
'<title>Hybrid Addon</title>' +
'<style>' +
':root{--bg:#07071a;--bg2:#0e0e24;--bg3:#13132e;--border:#1f1f45;--border2:#2a2a55;--text:#eeeef8;--text2:#8888b8;--text3:#44446a;--purple:#7c6df8;--purple2:#a89bff;--green:#00d4b4;--red:#ff6b9d;--yellow:#ffc46b;--blue:#6fb3ff;--orange:#ff8c52;}' +
'*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
'html,body{min-height:100vh;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5}' +
'.wrap{max-width:680px;margin:0 auto;padding:0 16px 80px}' +

/* HEADER */
'.header{text-align:center;padding:56px 16px 36px}' +
'.header-row{display:flex;align-items:center;justify-content:center;gap:22px;margin-bottom:24px}' +
'.header-logo{width:76px;height:76px;border-radius:20px;box-shadow:0 8px 32px rgba(124,109,248,.25);flex-shrink:0}' +
'.header-text{text-align:left}' +
'.header-text h1{font-size:30px;font-weight:900;letter-spacing:-.5px;background:linear-gradient(135deg,var(--purple2),var(--orange));-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1.1;margin-bottom:4px}' +
'.header-text .subtitle{color:var(--text2);font-size:13px;letter-spacing:.3px}' +

/* SECTIONS */
'.sec-label{font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin:24px 0 10px 2px;display:flex;align-items:center;gap:8px}' +
'.sec-label::after{content:"";flex:1;height:1px;background:var(--border)}' +
'.card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:10px}' +
'.card-body{padding:18px}' +
'.fg{margin-bottom:16px}' +
'.fg:last-child{margin-bottom:0}' +
'label.lbl{display:block;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}' +
'input[type=text],input[type=number],select,textarea{width:100%;padding:14px;background:var(--bg3);border:1.5px solid var(--border2);border-radius:10px;color:var(--text);font-size:15px;outline:none;transition:border-color .2s;-webkit-appearance:none}' +
'input:focus,select:focus,textarea:focus{border-color:var(--purple)}' +
'select{background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%238888b8\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px}' +
'textarea{resize:vertical;min-height:80px;font-family:monospace;font-size:13px}' +
'.trow{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--border);gap:12px}' +
'.trow:last-child{border:none;padding-bottom:0}' +
'.trow:first-child{padding-top:0}' +
'.trow-info{flex:1}' +
'.trow-name{font-size:15px;font-weight:600}' +
'.trow-sub{font-size:12px;color:var(--text3);margin-top:3px}' +
'.sw{position:relative;width:52px;height:30px;flex-shrink:0;cursor:pointer}' +
'.sw input{position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;z-index:2}' +
'.sw-track{position:absolute;inset:0;background:var(--border2);border-radius:30px;transition:.25s}' +
'.sw-thumb{position:absolute;width:24px;height:24px;top:3px;left:3px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 2px 6px rgba(0,0,0,.4)}' +
'.sw input:checked+.sw-track{background:var(--purple)}' +
'.sw input:checked+.sw-thumb{transform:translateX(22px)}' +
'.sort-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
'.sort-btn{padding:15px 6px;background:var(--bg3);border:2px solid var(--border2);border-radius:10px;color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all .18s;user-select:none}' +
'.sort-btn.on{border-color:var(--purple);background:rgba(124,109,248,.12);color:var(--purple2)}' +
'.sort-icon{font-size:24px;display:block;margin-bottom:6px}' +
'.chip-row{display:flex;flex-wrap:wrap;gap:8px}' +
'.chip{display:inline-flex;align-items:center;gap:5px;padding:10px 14px;background:var(--bg3);border:1.5px solid var(--border2);border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;user-select:none;color:var(--text2);transition:all .18s}' +
'.chip input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}' +
'.chip-on{background:rgba(124,109,248,.12);border-color:var(--purple);color:var(--purple2)}' +
'.chip-red{background:rgba(255,107,157,.1);border-color:var(--red);color:var(--red)}' +
'.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}' +
'.pill{font-size:11px;padding:5px 11px;border-radius:10px;font-weight:600}' +
'.pill-ok{background:rgba(0,212,180,.1);border:1px solid rgba(0,212,180,.25);color:var(--green)}' +
'.pill-err{background:rgba(255,107,157,.1);border:1px solid rgba(255,107,157,.25);color:var(--red)}' +
'.pill-wait{background:rgba(255,196,107,.08);border:1px solid rgba(255,196,107,.2);color:var(--yellow)}' +
'.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:14px 20px;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;transition:all .18s;user-select:none;white-space:nowrap}' +
'.btn:active{opacity:.75;transform:scale(.97)}' +
'.btn-ghost{background:var(--bg3);border:1.5px solid var(--border2);color:var(--text2)}' +
'.btn-purple{background:var(--purple);color:#fff}' +
'.btn-green{background:var(--green);color:#05050f;font-weight:800}' +
'.btn-full{width:100%}' +
'.btn-row{display:flex;gap:8px}' +
'.btn-row .btn{flex:1}' +
'.url-box{background:var(--bg3);border:1.5px solid var(--border2);border-radius:10px;padding:14px;font-family:monospace;font-size:12px;color:var(--blue);word-break:break-all;line-height:1.6;margin:14px 0;cursor:pointer;transition:border-color .2s}' +
'.warn{background:rgba(255,196,107,.06);border:1px solid rgba(255,196,107,.2);border-radius:10px;padding:14px;font-size:13px;color:#e8c060;line-height:1.6;margin-bottom:16px}' +
'.warn a{color:var(--blue);text-decoration:none}' +
'.test-box{margin-top:8px;padding:10px 13px;border-radius:10px;font-size:13px;display:none;line-height:1.5}' +
'.test-ok{display:block;background:rgba(0,212,180,.08);color:var(--green);border:1px solid rgba(0,212,180,.2)}' +
'.test-err{display:block;background:rgba(255,107,157,.08);color:var(--red);border:1px solid rgba(255,107,157,.2)}' +
'.test-load{display:block;background:rgba(124,109,248,.08);color:var(--purple2);border:1px solid rgba(124,109,248,.2)}' +
'.gen-btn{width:100%;padding:18px;border:none;border-radius:14px;font-size:17px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#7c6df8,#a89bff 50%,#ff6b9d);color:#fff;box-shadow:0 6px 28px rgba(124,109,248,.4);transition:all .2s;margin:18px 0}' +
'.gen-btn:active{transform:scale(.97)}' +
'.hint{font-size:12px;color:var(--text3);margin-top:8px;line-height:1.6}' +
'.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +

/* FOOTER */
'.footer{text-align:center;padding:32px 16px;color:var(--text3);font-size:13px;border-top:1px solid var(--border);margin-top:12px}' +
'.footer .madeby{display:inline-block;margin-top:8px;font-size:13px;background:linear-gradient(135deg,var(--purple2),var(--orange));-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;letter-spacing:.5px}' +
'</style>' +
'</head>' +
'<body>' +
'<div class="wrap">' +

/* HEADER */
'<div class="header">' +
'<div class="header-row">' +
'<img src="https://logo-835ec1.tiiny.site/logo.svg" class="header-logo" alt="Hybrid Addon" width="76" height="76">' +
'<div class="header-text">' +
'<h1>Hybrid Addon</h1>' +
'<p class="subtitle">TorrServer · JacRed · Knaben · Magnetz · Torrentio</p>' +
'</div>' +
'</div>' +
'</div>' +

/* TORRSERVER */
'<div class="sec-label"><span>🖥</span> TorrServer</div>' +
'<div class="card"><div class="card-body">' +
'<div class="warn">⚠️ This addon requires <strong>TorrServer</strong> to stream torrents.<br>' +
'📥 Download: <a href="https://github.com/YouROK/TorrServer/releases" target="_blank">github.com/YouROK/TorrServer</a><br>' +
'💡 Example: <code style="color:var(--yellow)">http://192.168.1.100:8090</code></div>' +
'<div class="fg">' +
'<label class="lbl">🌐 TorrServer URL</label>' +
'<input type="text" id="tsUrl" value="' + (cfg.torrServerUrl || '') + '" placeholder="http://192.168.1.x:8090">' +
'<div id="tsResult" class="test-box"></div>' +
'</div>' +
'<button class="btn btn-ghost btn-full" onclick="testTS()">🔍 Test Connection</button>' +
'</div></div>' +

/* NGUỒN STREAM */
'<div class="sec-label"><span>📡</span> Stream Sources</div>' +
'<div class="card"><div class="card-body">' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🎯 Torrentio</div><div class="trow-sub">YTS, EZTV, 1337x, TPB...</div></div><label class="sw"><input type="checkbox" id="torrentioEnabled"' + (cfg.torrentioEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🔍 Knaben</div><div class="trow-sub">Multi-source search engine</div></div><label class="sw"><input type="checkbox" id="knabenEnabled"' + (cfg.knabenEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🧲 Magnetz</div><div class="trow-sub">magnetz.eu — International torrents</div></div><label class="sw"><input type="checkbox" id="magnetzEnabled"' + (cfg.magnetzEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🇷🇺 JacRed</div><div class="trow-sub">Russian trackers — high quality</div></div><label class="sw"><input type="checkbox" id="jacredEnabled"' + (cfg.jacredEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'</div></div>' +

/* JACRED DOMAIN */
'<div class="sec-label"><span>🌐</span> JacRed Domain</div>' +
'<div class="card"><div class="card-body">' +
'<div class="fg">' +
'<label class="lbl">Preferred Domain</label>' +
'<select id="jacredDomain">' + domainOptions + '</select>' +
'<div class="pills">' + domainPills + '</div>' +
'</div>' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🔁 Auto Fallback</div><div class="trow-sub">Switch domain on failure</div></div><label class="sw"><input type="checkbox" id="jacredFallback"' + (jacredFallback ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'</div></div>' +

/* BỘ LỌC */
'<div class="sec-label"><span>⚙️</span> Filters</div>' +
'<div class="card"><div class="card-body">' +
'<div class="fg">' +
'<label class="lbl">Sort by</label>' +
'<div class="sort-row">' +
'<div class="sort-btn' + (commonSort === 'size' ? ' on' : '') + '" onclick="setSort(\'size\',this)"><span class="sort-icon">💾</span>Size</div>' +
'<div class="sort-btn' + (commonSort === 'seeds' ? ' on' : '') + '" onclick="setSort(\'seeds\',this)"><span class="sort-icon">👥</span>Seeds</div>' +
'<div class="sort-btn' + (commonSort === 'date' ? ' on' : '') + '" onclick="setSort(\'date\',this)"><span class="sort-icon">📅</span>Newest</div>' +
'</div>' +
'<input type="hidden" id="commonSort" value="' + commonSort + '">' +
'</div>' +
'<div class="two-col">' +
'<div class="fg"><label class="lbl">Max Results</label><input type="number" id="maxResults" value="' + (cfg.maxResults || 30) + '" min="5" max="100"></div>' +
'</div>' +
'<div class="two-col">' +
'<div class="fg"><label class="lbl">Min Size (GB)</label><input type="number" id="minSize" value="' + (cfg.sizeMinGB || '') + '" placeholder="0" step="0.5" min="0"></div>' +
'<div class="fg"><label class="lbl">Max Size (GB)</label><input type="number" id="maxSize" value="' + (cfg.sizeMaxGB || '') + '" placeholder="100" step="0.5" min="0"></div>' +
'</div>' +
'<div class="fg">' +
'<label class="lbl">Hide by Quality</label>' +
'<div class="chip-row">' + qualityBoxes + '</div>' +
'</div>' +
'</div></div>' +

/* TÙY CHỌN */
'<div class="sec-label"><span>🔍</span> Search Options</div>' +
'<div class="card"><div class="card-body">' +
'<div class="trow"><div class="trow-info"><div class="trow-name">📦 Prefer Pack</div><div class="trow-sub">Show full season packs instead of single episodes</div></div><label class="sw"><input type="checkbox" id="preferPack"' + (cfg.preferPack !== false ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'<div class="trow"><div class="trow-info"><div class="trow-name">🎌 Anime Mode</div><div class="trow-sub">Optimize episode selection for anime releases</div></div><label class="sw"><input type="checkbox" id="animeMode"' + (cfg.animeMode ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>' +
'</div></div>' +

/* TORRENTIO CONFIG */
'<div class="sec-label"><span>🎯</span> Torrentio Config</div>' +
'<div class="card"><div class="card-body">' +
'<div class="fg">' +
'<label class="lbl">Paste link from torrentio.strem.fun</label>' +
'<textarea id="configLink" placeholder="https://torrentio.strem.fun/providers=yts,eztv|sort=size|.../manifest.json"></textarea>' +
'</div>' +
'<button class="btn btn-purple btn-full" onclick="applyTIO()">✅ Apply Torrentio Link</button>' +
'</div></div>' +

/* INSTALL */
'<div class="sec-label"><span>📦</span> Install to Stremio</div>' +
'<div class="card"><div class="card-body">' +
'<label class="lbl">Manifest URL (click to copy)</label>' +
'<div class="url-box" id="iurl" onclick="copyUrl()">' + installUrl + '</div>' +
'<div class="btn-row">' +
'<button class="btn btn-ghost" onclick="copyUrl()">📋 Copy</button>' +
'<a class="btn btn-green" href="' + stremioUrl + '" id="slink">▶ Open in Stremio</a>' +
'</div>' +
'<p class="hint">💡 Copy URL → Stremio → Addons → Install from URL</p>' +
'</div></div>' +

'<button class="gen-btn" onclick="gen()">✨ Generate & Update</button>' +

/* FOOTER */
'<div class="footer">Hybrid Addon v8.0.0<br><span class="madeby">⚡ made by fatcatQN</span></div>' +

'</div>' +

'<script>' +
'var DEFAULT_TIO=' + JSON.stringify(DEFAULT_TORRENTIO_CONFIG) + ';' +
'function toggleQf(cb){var c=cb.parentElement;if(cb.checked)c.classList.add("chip-red");else c.classList.remove("chip-red")}' +
'function setSort(v,el){document.getElementById("commonSort").value=v;document.querySelectorAll(".sort-btn").forEach(function(b){b.classList.remove("on")});el.classList.add("on")}' +
'function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"")}' +
'function getCfg(){' +
'var qf=Array.from(document.querySelectorAll(".chip-row input:checked")).filter(function(c){return["480p","720p","1080p","4K"].indexOf(c.value)!==-1}).map(function(c){return c.value});' +
'return{' +
'torrServerUrl:document.getElementById("tsUrl").value.trim(),' +
'jacredEnabled:document.getElementById("jacredEnabled").checked,' +
'torrentioEnabled:document.getElementById("torrentioEnabled").checked,' +
'knabenEnabled:document.getElementById("knabenEnabled").checked,' +
'magnetzEnabled:document.getElementById("magnetzEnabled").checked,' +
'commonSortBy:document.getElementById("commonSort").value,' +
'maxResults:parseInt(document.getElementById("maxResults").value)||30,' +
'jacredDomain:document.getElementById("jacredDomain").value,' +
'jacredFallback:document.getElementById("jacredFallback").checked,' +
'animeMode:document.getElementById("animeMode").checked,' +
'preferPack:document.getElementById("preferPack").checked,' +
'commonQualityFilter:qf,' +
'sizeMinGB:parseFloat(document.getElementById("minSize").value)||0,' +
'sizeMaxGB:parseFloat(document.getElementById("maxSize").value)||100,' +
'uiLang:"en",' +
'providers:DEFAULT_TIO.providers,' +
'sortBy:"' + (cfg.sortBy || 'size') + '",' +
'language:"' + (cfg.language || 'russian,ukrainian') + '",' +
'qualityfilter:qf' +
'}}' +
'function gen(){var c=getCfg();var e=enc(c);var u=location.protocol+"//"+location.host+"/"+e+"/manifest.json";document.getElementById("iurl").textContent=u;document.getElementById("slink").href="stremio://"+u.replace(/^https?:\\/\\//,"")}' +
'function copyUrl(){var url=document.getElementById("iurl").textContent;var box=document.getElementById("iurl");function flash(){box.style.borderColor="var(--green)";box.style.color="var(--green)";setTimeout(function(){box.style.borderColor="";box.style.color=""},1200)}if(navigator.clipboard){navigator.clipboard.writeText(url).then(flash).catch(function(){fb(url,flash)})}else fb(url,flash)}' +
'function fb(t,cb){var ta=document.createElement("textarea");ta.value=t;ta.style.cssText="position:fixed;top:-9999px";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");if(cb)cb()}catch(e){alert("Copy: "+t)}document.body.removeChild(ta)}' +
'function testTS(){var url=document.getElementById("tsUrl").value.trim();var rd=document.getElementById("tsResult");if(!url){rd.className="test-box test-err";rd.textContent="❌ Enter URL first";return}if(!/^https?:\\/\\//.test(url))url="http://"+url;rd.className="test-box test-load";rd.textContent="⏳ Testing...";var done=false;var tmr=setTimeout(function(){if(done)return;done=true;rd.className="test-box test-err";rd.textContent="⏱ Timeout!"},8000);fetch(url+"/echo").then(function(r){if(done)return;done=true;clearTimeout(tmr);if(r.ok){rd.className="test-box test-ok";rd.textContent="✅ Connected!"}else{rd.className="test-box test-err";rd.textContent="❌ HTTP "+r.status}}).catch(function(e){if(done)return;done=true;clearTimeout(tmr);rd.className="test-box test-err";rd.textContent="❌ "+e.message})}' +
'function parseTIO(link){try{var u=new URL(link.replace("stremio://","https://"));var m=u.pathname.match(/\\/([^\\/]+)\\/manifest\\.json/);if(!m)return null;var p=m[1].split("|");var c={providers:[],sortBy:"size",language:"",qualityfilter:[]};p.forEach(function(x){var kv=x.split("=");if(kv[0]==="providers")c.providers=kv[1]?kv[1].split(","):[];else if(kv[0]==="sort")c.sortBy=kv[1];else if(kv[0]==="language")c.language=kv[1];else if(kv[0]==="qualityfilter")c.qualityfilter=kv[1]?kv[1].split(","):[]});return c}catch(e){return null}}' +
'function applyTIO(){var l=document.getElementById("configLink").value.trim();if(!l){alert("Paste a Torrentio link!");return}var c=parseTIO(l);if(!c){alert("Invalid link!");return}DEFAULT_TIO.providers=c.providers;DEFAULT_TIO.sortBy=c.sortBy||"size";DEFAULT_TIO.language=c.language||"";DEFAULT_TIO.qualityfilter=c.qualityfilter||[];gen();alert("✅ Applied!")}' +
'gen()' +
'<\/script>' +
'</body></html>';

  return html;
}

// ===================== SERVER =====================
var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var host = req.headers['host'] || 'localhost';
  var p = parseUrl(req.url, host);
  var cfg = p.userConfig || DEFAULT_CONFIG;
  var rest = p.rest;
  var pub = getPublicUrlFromReq(req);
  var query = parseQuery(req.url, host);

  console.log('[REQ]', req.method, rest);

  if (rest === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (rest === '/play') { handlePlay(query, cfg, res); return; }
  if (rest === '/' || rest === '/configure') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(buildConfigPage(cfg, p.configStr, pub));
    return;
  }
  if (rest === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildManifest(cfg, p.configStr, pub)));
    return;
  }
  if (rest.indexOf('/stream/') === 0) {
    var parts = rest.split('/').filter(Boolean);
    if (parts[1] && parts[2]) handleStream(parts[1], parts[2].replace('.json',''), cfg, res, pub);
    else { res.writeHead(404); res.end(); }
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('\n✅ Hybrid Addon v8.0.0');
  console.log('🌐 http://localhost:' + PORT);
  console.log('⚙️  http://localhost:' + PORT + '/configure\n');
});
