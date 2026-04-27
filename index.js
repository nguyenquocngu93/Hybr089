var http = require('http');
var fetch = require('node-fetch');
var cheerio = require('cheerio');

var JAC_RED_DOMAINS = {
 'jac.red': 'https://jac.red/api/v1.0/torrents',
 'jac-red.ru': 'https://jac-red.ru/api/v1.0/torrents',
 'jr.maxvol.pro': 'https://jr.maxvol.pro/api/v1.0/torrents',
 'ru.jacred.pro': 'https://ru.jacred.pro/api/v1.0/torrents',
 'jacred.stream': 'https://jacred.stream/api/v1.0/torrents'
};

var DEFAULT_JACRED_DOMAIN = 'jac.red';
var TMDB_API_KEY = '6979c8ec101ed849f44d197c86582644';
var PORT = 7000;
var KNABEN_BASE_URL = 'https://knaben.org/search/';
var MAGNETZ_BASE_URL = 'https://magnetz.eu/search';

var TMDB_CACHE = {};

var DEFAULT_TORRENTIO_CONFIG = {
 providers: ['yts','eztv','rarbg','1337x','thepiratebay','kickasstorrents','torrentgalaxy','magnetdl','horriblesubs','nyaasi','tokyotosho','anidex','nekobt','rutor','rutracker','torrent9','ilcorsaronero','mejortorrent','wolfmax4k','cinecalidad','besttorrents'],
 sortBy: 'size',
 language: 'russian,ukrainian',
 qualityfilter: ['480p']
};

var DEFAULT_CONFIG = Object.assign({
 torrServerUrl: '',
 jacredEnabled: true,
 torrentioEnabled: true,
 knabenEnabled: true,
 magnetzEnabled: true,
 maxResults: 30,
 jacredDomain: DEFAULT_JACRED_DOMAIN,
 animeMode: false,
 preferPack: true,
 commonSortBy: 'size',
 commonQualityFilter: [],
 sizeMinGB: 0,
 sizeMaxGB: 100
}, DEFAULT_TORRENTIO_CONFIG);

function decodeConfig(str) {
 try {
 var cleanStr = str.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/manifest\.json$/, '').replace(/\/configure$/, '');
 var configPart = cleanStr.split('/')[0];
 if (!configPart) return null;
 var b64 = configPart.replace(/-/g,'+').replace(/_/g,'/');
 while (b64.length % 4) b64 += '=';
 var decoded = JSON.parse(Buffer.from(b64,'base64').toString('utf8'));
 return Object.assign({}, DEFAULT_CONFIG, decoded);
 } catch(e) { return null; }
}

var KEYWORDS = ['manifest.json','stream','configure','api','play','test-ts'];

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
 } catch (e) {
 return { userConfig: null, configStr: null, rest: reqUrl };
 }
}

function parseQuery(reqUrl, host) {
 try {
 var url = new URL(reqUrl, 'http://' + host);
 return Object.fromEntries(url.searchParams.entries());
 } catch (e) { return {}; }
}

function decodeUnicode(str) {
 try { return str.replace(/\\u[\dA-F]{4}/gi, function(m) { return String.fromCharCode(parseInt(m.replace(/\\u/g,''), 16)); }); }
 catch(e) { return str; }
}

function parseSize(sn) {
 if (!sn) return 0;
 var s = parseFloat(sn) || 0;
 var up = String(sn).toUpperCase();
 if (up.includes('GB') || up.includes('ГБ')) return s;
 if (up.includes('MB') || up.includes('МБ')) return s / 1024;
 if (s > 100) return s / 1024;
 return s;
}

function getPublicUrlFromReq(req) {
 var host = req.headers['x-forwarded-host'] || req.headers['host'] || ('localhost:' + PORT);
 var proto = req.headers['x-forwarded-proto'] || 'http';
 if (host.indexOf('lhr.life') !== -1 || host.indexOf('localhost.run') !== -1) proto = 'https';
 if (host.indexOf('://') !== -1) return host.replace(/\/$/,'');
 return (proto + '://' + host).replace(/\/$/,'');
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
 version: '6.8.0',
 name: 'Hybrid Addon',
 description: 'Torrentio + jac.red + Knaben + Magnetz',
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

function getRuTitleFromTMDb(imdbId, type) {
 var cacheKey = imdbId + '_ru';
 if (TMDB_CACHE[cacheKey]) return Promise.resolve(TMDB_CACHE[cacheKey]);
 var metaType = (type === 'series') ? 'tv' : 'movie';
 return fetch('https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id', { timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : {}; })
 .then(function(data) {
 var results = data[metaType + '_results'] || [];
 if (results.length === 0) return null;
 var tmdbId = results[0].id;
 var releaseDate = results[0].release_date || results[0].first_air_date || '';
 var year = releaseDate ? releaseDate.substring(0, 4) : '';
 TMDB_CACHE[cacheKey + '_full'] = { year: year, origTitle: results[0].title || results[0].name || '' };
 return fetch('https://api.themoviedb.org/3/' + metaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=ru', { timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : {}; })
 .then(function(d) {
 var ruTitle = (d.title || d.name || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
 TMDB_CACHE[cacheKey] = ruTitle || null;
 return ruTitle || null;
 });
 })
 .catch(function() { return null; });
}

function getOriginalTitleFromTMDb(imdbId, type) {
 var cacheKey = imdbId + '_orig';
 if (TMDB_CACHE[cacheKey]) return Promise.resolve(TMDB_CACHE[cacheKey]);
 var metaType = (type === 'series') ? 'tv' : 'movie';
 return fetch('https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id', { timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : {}; })
 .then(function(data) {
 var results = data[metaType + '_results'] || [];
 if (results.length === 0) return null;
 var title = results[0].title || results[0].name || imdbId;
 var releaseDate = results[0].release_date || results[0].first_air_date || '';
 var year = releaseDate ? releaseDate.substring(0, 4) : '';
 TMDB_CACHE[imdbId + '_year'] = year;
 TMDB_CACHE[cacheKey] = title;
 return title;
 })
 .catch(function() { return imdbId; });
}

var torrServerCache = {}, CACHE_TTL = 30 * 60 * 1000;

function getTorrServerFiles(tsUrl, magnet, title) {
 return fetch(tsUrl + '/torrents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', link: magnet, title: title, poster: '', save_to_db: false }), timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : null; })
 .then(function(data) {
 if (!data || !data.hash) return null;
 if (data.file_stats && data.file_stats.length > 0) return { hash: data.hash, files: data.file_stats };
 return new Promise(function(resolve) {
 var attempts = 0, maxAttempts = 12;
 function tryGet() {
 attempts++;
 setTimeout(function() {
 fetch(tsUrl + '/torrents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get', hash: data.hash }), timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : null; })
 .then(function(d) {
 if (d && d.file_stats && d.file_stats.length > 0) resolve({ hash: data.hash, files: d.file_stats });
 else if (attempts < maxAttempts) tryGet();
 else resolve({ hash: data.hash, files: [] });
 })
 .catch(function() { if (attempts < maxAttempts) tryGet(); else resolve({ hash: data.hash, files: [] }); });
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
 if (cacheKey) {
 var cached = torrServerCache[cacheKey];
 if (cached && (Date.now() - cached.timestamp) < CACHE_TTL)
 return Promise.resolve({ hash: cacheKey, files: cached.files });
 }
 return getTorrServerFiles(ts, magnet, title).then(function(result) {
 if (result && result.files.length > 0 && cacheKey)
 torrServerCache[cacheKey] = { files: result.files, timestamp: Date.now() };
 return result;
 });
}

function findAnimeEpisodeFile(files, season, episode) {
 if (!files || files.length === 0) return null;
 var videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts'];
 var allFiles = files.map(function(f, idx) { return Object.assign({}, f, { _realIndex: (f.id !== undefined && f.id !== null) ? Number(f.id) : idx }); });
 var videoFiles = allFiles.filter(function(f) { return videoExts.some(function(ex) { return (f.path || '').toLowerCase().endsWith(ex); }); });
 var episodeFiles = videoFiles.filter(function(f) {
 var basename = (f.path || '').split('/').pop().toLowerCase();
 var path = (f.path || '').toLowerCase();
 var sizeMB = (f.length || 0) / (1024 * 1024);
 if (sizeMB < 500) return false;
 var excludeKeywords = ['sample','trailer','opening','ending','preview','ncop','nced','creditless','menu','extra','bonus','sp','ova','special','ed ',' op ',' opening',' ending','credit'];
 for (var i = 0; i < excludeKeywords.length; i++) { if (basename.indexOf(excludeKeywords[i]) !== -1 || path.indexOf(excludeKeywords[i]) !== -1) return false; }
 return true;
 });
 if (episodeFiles.length === 0) return null;
 episodeFiles.sort(function(a, b) { return (a.path || '').localeCompare(b.path || ''); });
 if (episode > 0 && episode <= episodeFiles.length) return episodeFiles[episode - 1];
 return null;
}

function findEpisodeFile(files, season, episode) {
 if (!files || files.length === 0) return null;
 var s = String(season).padStart(2, '0'), sNum = String(season);
 var e = String(episode).padStart(2, '0'), eNum = String(episode);
 var videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts'];
 var allFiles = files.map(function(f, idx) { return Object.assign({}, f, { _realIndex: (f.id !== undefined && f.id !== null) ? Number(f.id) : idx }); });
 var videoFiles = allFiles.filter(function(f) { return videoExts.some(function(ex) { return (f.path || '').toLowerCase().endsWith(ex); }); });
 var hasCorrectSeason = videoFiles.some(function(f) { return f.season === season || f.season === String(season) || f.season === sNum || f.season === s; });
 var episodeFiles = videoFiles.filter(function(f) {
 var basename = (f.path || '').split('/').pop().toLowerCase();
 var path = (f.path || '').toLowerCase();
 var excludeKeywords = ['sample','trailer','opening','ending','preview','ncop','nced','creditless','menu','extra','bonus','sp','ova','special','ed ',' op '];
 for (var i = 0; i < excludeKeywords.length; i++) { if (basename.indexOf(excludeKeywords[i]) !== -1 || path.indexOf(excludeKeywords[i]) !== -1) return false; }
 return true;
 });
 if (episodeFiles.length === 0) return null;
 for (var i = 0; i < episodeFiles.length; i++) {
 var f = episodeFiles[i];
 var fS = String(f.season !== undefined ? f.season : ''), fE = String(f.episode !== undefined ? f.episode : '');
 if (hasCorrectSeason) { if (fS !== '' && fE !== '' && (fS === sNum || fS === s) && (fE === eNum || fE === e)) return f; }
 else { if (fE !== '' && (fE === eNum || fE === e)) return f; }
 }
 for (var i = 0; i < episodeFiles.length; i++) {
 var basename = (episodeFiles[i].path || '').split('/').pop().toLowerCase();
 if (new RegExp('s0*' + season + 'e0*' + episode + '(?:\\D|$)').test(basename)) return episodeFiles[i];
 if (new RegExp('^0*' + episode + '[\\s\\.\\-_]').test(basename)) return episodeFiles[i];
 if (new RegExp('ep\\s*0*' + episode + '(?:\\D|$)', 'i').test(basename)) return episodeFiles[i];
 }
 var seasonPatterns = ['season_' + s, 'season_' + sNum, 'season ' + sNum, '/s' + s + '/', '/s' + sNum + '/', 'сезон_' + sNum, 'сезон ' + sNum];
 var seasonFiles = episodeFiles.filter(function(f) { var fp = (f.path || '').toLowerCase(); for (var i = 0; i < seasonPatterns.length; i++) { if (fp.indexOf(seasonPatterns[i]) !== -1) return true; } return new RegExp('s0*' + season + 'e').test(fp); });
 var targetFiles = seasonFiles.length > 0 ? seasonFiles : episodeFiles;
 targetFiles.sort(function(a, b) { return (a.path || '').localeCompare(b.path || ''); });
 if (episode > 0 && episode <= targetFiles.length) return targetFiles[episode - 1];
 return null;
}

function handlePlay(query, cfg, res) {
 var magnet = query.magnet || '', season = parseInt(query.s) || 0, episode = parseInt(query.e) || 0, title = query.title || 'video', ts = query.ts || cfg.torrServerUrl || '';
 if (ts && !ts.match(/^https?:\/\//)) ts = 'http://' + ts;
 if (!magnet || !ts) { res.writeHead(400); res.end('Missing magnet or ts'); return; }
 if (!season || !episode) { res.writeHead(302, { 'Location': ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(magnet) + '&index=0&play' }); res.end(); return; }
 getCachedFiles(ts, magnet, title).then(function(result) {
 if (!result || !result.files) { res.writeHead(404); res.end('Torrent not found'); return; }
 var found = cfg.animeMode ? findAnimeEpisodeFile(result.files, season, episode) : findEpisodeFile(result.files, season, episode);
 if (found) { res.writeHead(302, { 'Location': ts + '/stream/' + encodeURIComponent(title) + '?link=' + result.hash + '&index=' + found._realIndex + '&play' }); res.end(); }
 else { res.writeHead(404); res.end('Episode S' + season + 'E' + episode + ' not found'); }
 }).catch(function() { res.writeHead(500); res.end('Error'); });
}

// ===================== JACRED =====================
function searchJacred(imdbId, type, maxResults, sortBy, apiUrl) {
 return getRuTitleFromTMDb(imdbId, type).then(function(ruTitle) {
 var seen = new Map(), unique = [];
 
 function addResults(arr, sourceName) {
 if (!arr || !arr.length) return 0;
 var newCount = 0;
 for (var i = 0; i < arr.length; i++) {
 var t = arr[i];
 if (!t.magnet) continue;
 var hashMatch = t.magnet.match(/btih:([a-fA-F0-9]{40})/i);
 var key = hashMatch ? hashMatch[1].toLowerCase() : t.magnet;
 if (!seen.has(key)) {
 var types = t.types || [], seasons = t.seasons || [];
 if (type === 'movie' && (types.includes('series') || seasons.length > 0)) continue;
 if (type === 'series' && types.includes('movie') && seasons.length === 0) continue;
 
 seen.set(key, true);
 var qualityText = ''; if (t.quality === 2160) qualityText = '4K'; else if (t.quality === 1080) qualityText = '1080p'; else if (t.quality === 720) qualityText = '720p'; else if (t.quality === 480) qualityText = '480p'; else if (t.quality) qualityText = t.quality + 'p';
 var videoType = ''; if (t.videotype) { var vt = t.videotype.toLowerCase(); if (vt.includes('hdr') || vt.includes('dolby')) videoType = 'HDR'; else if (vt.includes('sdr')) videoType = 'SDR'; }
 var audio = ''; if (t.voice && Array.isArray(t.voice) && t.voice.length > 0) audio = t.voice.filter(function(v){return v;}).join('/');
 var yearNum = parseInt(t.relased || t.released || t.related || '0') || 0;
 unique.push({ original: t, title: decodeUnicode(t.title || ''), sizeGB: parseSize(t.sizeName || t.size), date: t.createdTime ? new Date(t.createdTime).getTime() : 0, sid: t.sid || t.seeds || t.seeders || 0, tracker: t.tracker || 'Unknown', magnet: t.magnet, quality: qualityText, videoType: videoType, audio: audio, year: yearNum });
 newCount++;
 }
 }
 console.log('[jac.red] ' + sourceName + ' +' + newCount + ' unique');
 return newCount;
 }
 
 var promises = [];
 if (ruTitle) {
 promises.push(fetch(apiUrl + '?search=' + encodeURIComponent(ruTitle), { timeout: 120000 }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }).then(function(arr) { addResults(arr, 'RU'); }));
 }
 promises.push(fetch(apiUrl + '?search=' + encodeURIComponent(imdbId), { timeout: 120000 }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }).then(function(arr) { addResults(arr, 'IMDb'); }));
 
 return Promise.all(promises).then(function() {
 if (unique.length === 0) return [];
 unique.sort(function(a, b) { if (sortBy === 'seeds') return b.sid - a.sid; if (sortBy === 'date') return b.date - a.date; return b.sizeGB - a.sizeGB; });
 return unique.slice(0, maxResults || 30);
 });
 });
}

// ===================== KNABEN =====================
function searchKnaben(query, maxResults, type, preferPack, season, episode) {
    var baseUrl = 'https://knaben.org/search/';
    var filterSegment = '0/1/bytes';
    if (type === 'movie') filterSegment = '3000000/1/bytes';
    else if (type === 'series') filterSegment = '2000000/1/bytes';
    var finalQuery = query;
    if (type === 'series' && !preferPack && season && episode) {
        var s = String(season).padStart(2, '0');
        var e = String(episode).padStart(2, '0');
        finalQuery = query + ' S' + s + 'E' + e;
    }
    var url = baseUrl + encodeURIComponent(finalQuery) + '/' + filterSegment;
    return fetch(url, { timeout: 120000 })
        .then(function(r) { return r.text(); })
        .then(function(html) {
            var $ = cheerio.load(html);
            var results = [];
            var seen = new Map();
            $('table tbody tr').each(function(i, row) {
                if (results.length >= maxResults) return false;
                var cols = $(row).find('td');
                if (cols.length < 6) return;
                var magnet = null;
                $(row).find('a').each(function(j, a) {
                    var href = $(a).attr('href');
                    if (href && href.indexOf('magnet:') === 0) {
                        magnet = href;
                        return false;
                    }
                });
                if (!magnet) return;
                var title = $(cols[1]).text().trim();
                var sizeStr = $(cols[2]).text().trim();
                var seeds = parseInt($(cols[4]).text().trim()) || 0;
                var hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
                var key = hashMatch ? hashMatch[1].toLowerCase() : magnet;
                if (seen.has(key)) return;
                seen.set(key, true);
                results.push({
                    title: title,
                    magnet: magnet,
                    sizeGB: parseSize(sizeStr),
                    seeds: seeds,
                    tracker: 'Knaben',
                    source: 'knaben'
                });
            });
            console.log('[Knaben] Found', results.length, 'results');
            return results;
        })
        .catch(function(e) { 
            console.error('[Knaben] Error:', e.message); 
            return []; 
        });
}

// ===================== MAGNETZ =====================
function searchMagnetz(query, maxResults, type, preferPack, season, episode) {
    var sortParam = "size";
    var baseUrl = MAGNETZ_BASE_URL + "?query=" + encodeURIComponent(query) + "&sort=" + sortParam;
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
                    tracker: 'Magnetz',
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

// ===================== STREAM HANDLER =====================
function handleStream(type, id, cfg, res, pub) {
 var ts = cfg.torrServerUrl || ''; if (ts && !ts.match(/^https?:\/\//)) ts = 'http://' + ts;
 var idClean = decodeURIComponent(id), parts = idClean.split(':'), imdbId = parts[0], season = parseInt(parts[1]) || 0, episode = parseInt(parts[2]) || 0;
 var streams = [], completed = 0, total = (cfg.jacredEnabled ? 1 : 0) + (cfg.torrentioEnabled ? 1 : 0) + (cfg.knabenEnabled ? 1 : 0) + (cfg.magnetzEnabled ? 1 : 0);
 if (!total) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ streams: [] })); return; }
 
 function sendResponse() { if (++completed >= total) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ streams: streams })); } }
 var commonSort = cfg.commonSortBy || 'size';
 var minSize = parseFloat(cfg.sizeMinGB) || 0;
 var maxSize = parseFloat(cfg.sizeMaxGB) || 100;
 
 // ===================== KNABEN =====================
 if (cfg.knabenEnabled) {
 Promise.all([
 getRuTitleFromTMDb(imdbId, type),
 getOriginalTitleFromTMDb(imdbId, type)
 ]).then(function(titles) {
 var originalTitle = titles[1];
 var query = originalTitle || imdbId;
 console.log('[Knaben] Search: "' + query + '"');
 return searchKnaben(query, cfg.maxResults || 30, type, cfg.preferPack, season, episode);
 }).catch(function() { return searchKnaben(imdbId, cfg.maxResults || 30, type, cfg.preferPack, season, episode); })
 .then(function(results) {
 if (commonSort === 'seeds') results.sort(function(a, b) { return b.seeds - a.seeds; });
 else if (commonSort === 'date') results.sort(function(a, b) { return (b.date || 0) - (a.date || 0); });
 else results.sort(function(a, b) { return b.sizeGB - a.sizeGB; });
 
 results.forEach(function(t) {
 if (!t.magnet) return;
 if (t.sizeGB < minSize) return;
 if (maxSize < 100 && t.sizeGB > maxSize) return;
 var title = t.title;
 var episodeMatch = title.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
 var isSingleEpisode = episodeMatch !== null;
 var isPack = (type === 'series' && !isSingleEpisode);
 
 if (isPack && season > 0) {
 var sPad = String(season).padStart(2, '0');
 var seasonPattern = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)|第\\s*' + season + '\\s*季|S' + season + '(?:[^\\d]|$)', 'i');
 var otherSeasonPattern = /S\d{1,2}(?:[^\d]|$)|Season\s*\d|第\s*\d+\s*季/gi;
 var hasOtherSeason = false;
 var matches = title.match(otherSeasonPattern);
 if (matches) {
 for (var i = 0; i < matches.length; i++) {
 if (!seasonPattern.test(matches[i])) {
 var otherSeasonMatch = matches[i].match(/\d+/);
 if (otherSeasonMatch && parseInt(otherSeasonMatch[0]) !== season) {
 hasOtherSeason = true; break;
 }
 }
 }
 }
 if (hasOtherSeason) return;
 }
 
 var sizeGB = t.sizeGB.toFixed(2);
 var badge = type === 'series' ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
 var displayTitle = badge + title + '\n' + sizeGB + ' GB | 🌱 ' + t.seeds + '\n📡 ' + t.tracker;
 
 if (type === 'movie') {
 streams.push({ name: '🟠 ' + t.tracker, title: displayTitle, url: ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 } else {
 var url = isPack
 ? pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(title) + '&ts=' + encodeURIComponent(ts)
 : ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play';
 streams.push({ name: '🟠 ' + t.tracker, title: displayTitle, url: url, behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 }
 });
 sendResponse();
 }).catch(function() { sendResponse(); });
 }
 
 // ===================== MAGNETZ =====================
 if (cfg.magnetzEnabled) {
 Promise.all([
 getRuTitleFromTMDb(imdbId, type),
 getOriginalTitleFromTMDb(imdbId, type)
 ]).then(function(titles) {
 var originalTitle = titles[1];
 var query = originalTitle || imdbId;
 
 if (type === 'movie') {
 var year = TMDB_CACHE[imdbId + '_year'] || '';
 if (year) query = query + ' ' + year;
 console.log('[Magnetz] Search: "' + query + '" (movie: tên + năm)');
 } else {
 if (season > 0) {
 query = query + ' S' + String(season).padStart(2, '0');
 }
 console.log('[Magnetz] Search: "' + query + '" (series: tên + Sxx)');
 }
 
 return searchMagnetz(query, cfg.maxResults || 30, type, cfg.preferPack, season, episode);
 }).catch(function() { return searchMagnetz(imdbId, cfg.maxResults || 30, type, cfg.preferPack, season, episode); })
 .then(function(results) {
 if (commonSort === 'seeds') results.sort(function(a, b) { return b.seeds - a.seeds; });
 else if (commonSort === 'date') results.sort(function(a, b) { return (b.date || 0) - (a.date || 0); });
 else results.sort(function(a, b) { return b.sizeGB - a.sizeGB; });
 
 results.forEach(function(t) {
 if (!t.magnet) return;
 if (t.sizeGB < minSize) return;
 if (maxSize < 100 && t.sizeGB > maxSize) return;
 var title = t.title;
 var episodeMatch = title.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
 var isSingleEpisode = episodeMatch !== null;
 var isPack = (type === 'series' && !isSingleEpisode);
 
 if (isPack && season > 0) {
 var sPad = String(season).padStart(2, '0');
 var seasonPattern = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)|第\\s*' + season + '\\s*季|S' + season + '(?:[^\\d]|$)', 'i');
 var otherSeasonPattern = /S\d{1,2}(?:[^\d]|$)|Season\s*\d|第\s*\d+\s*季/gi;
 var hasOtherSeason = false;
 var matches = title.match(otherSeasonPattern);
 if (matches) {
 for (var i = 0; i < matches.length; i++) {
 if (!seasonPattern.test(matches[i])) {
 var otherSeasonMatch = matches[i].match(/\d+/);
 if (otherSeasonMatch && parseInt(otherSeasonMatch[0]) !== season) {
 hasOtherSeason = true; break;
 }
 }
 }
 }
 if (hasOtherSeason) return;
 }
 
 var sizeGB = t.sizeGB.toFixed(2);
 var badge = type === 'series' ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
 var displayTitle = badge + title + '\n' + sizeGB + ' GB | 🌱 ' + t.seeds + '\n📡 ' + t.tracker;
 
 if (type === 'movie') {
 streams.push({ name: '🟢 ' + t.tracker, title: displayTitle, url: ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 } else {
 var url = isPack
 ? pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(title) + '&ts=' + encodeURIComponent(ts)
 : ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play';
 streams.push({ name: '🟢 ' + t.tracker, title: displayTitle, url: url, behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 }
 });
 sendResponse();
 }).catch(function() { sendResponse(); });
 }
 
 // ===================== JACRED =====================
 if (cfg.jacredEnabled) {
 var apiUrl = JAC_RED_DOMAINS[cfg.jacredDomain] || JAC_RED_DOMAINS[DEFAULT_JACRED_DOMAIN];
 searchJacred(imdbId, type, cfg.maxResults || 30, commonSort, apiUrl).then(function(results) {
 results.forEach(function(t) {
 if (!t.magnet) return;
 if (t.sizeGB < minSize) return;
 if (maxSize < 100 && t.sizeGB > maxSize) return;
 var title = t.title;
 
 if (type === 'series' && season > 0) {
 var sPad = String(season).padStart(2, '0');
 
 // Pack trọn bộ -> hiện ở tất cả season
 var completePackPattern = /S\d{1,2}[-~]S?\d{1,2}|Season\s*\d+\s*[-~]\s*\d+|сезон[ы]?\s*\d+\s*[-~]\s*\d+|Complete|Полный|Все\s*сезон[ы]?|1-\d+\s*сезон/i;
 var isCompletePack = completePackPattern.test(title);
 
 if (!isCompletePack) {
 // Pattern cho season cụ thể
 var singleSeasonPattern = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)|сезон\\s*' + season + '(?:[^\\d]|$)|' + season + '\\s*сезон', 'i');
 var anySeasonPattern = /S\d{1,2}(?:[^\d]|$)|Season\s*\d|сезон\s*\d|\d+\s*сезон/gi;
 var hasSeasonMention = anySeasonPattern.test(title);
 
 if (hasSeasonMention) {
 if (!singleSeasonPattern.test(title)) return;
 } else {
 if (!isCompletePack) return;
 }
 }
 }
 
 var trackerDisplay = t.tracker.charAt(0).toUpperCase() + t.tracker.slice(1);
 var sizeGB = t.sizeGB.toFixed(2), seeds = t.sid, quality = t.quality || '', videoType = t.videoType || '', audio = t.audio || '';
 var streamTitle = t.title + '\n' + sizeGB + ' GB | 🌱 ' + seeds;
 if (quality) { streamTitle += ' | 🎬 ' + quality; if (videoType) streamTitle += ' ' + videoType; }
 if (audio) streamTitle += ' | 🔊 ' + audio;
 streamTitle += '\n📡 ' + trackerDisplay;
 
 if (type === 'movie') streams.push({ name: '🔴 ' + trackerDisplay, title: streamTitle, url: ts + '/stream/' + encodeURIComponent(t.title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean } });
 else streams.push({ name: '🔴 ' + trackerDisplay, title: streamTitle, url: pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(t.title) + '&ts=' + encodeURIComponent(ts), behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean } });
 });
 sendResponse();
 }).catch(function(e) { console.error('[jac.red]', e.message); sendResponse(); });
 }
 
 // ===================== TORRENTIO =====================
 if (cfg.torrentioEnabled) {
 var tioUrl = buildTorrentioBase(cfg) + '/stream/' + type + '/' + idClean + '.json';
 fetch(tioUrl, { timeout: 120000 }).then(function(r) { return r.ok ? r.json() : { streams: [] }; }).then(function(data) {
 if (data.streams) data.streams.filter(function(s) { return s.infoHash; }).forEach(function(s) {
 streams.push({ name: '🔗 Torrentio', title: '🎬 ' + s.title, url: ts + '/stream/' + encodeURIComponent(s.title || 'video') + '?link=' + s.infoHash + '&index=' + (s.fileIdx || 0) + '&play', behaviorHints: { notWebReady: true, bingeGroup: 'torrentio-' + s.infoHash } });
 });
 sendResponse();
 }).catch(function(e) { console.error('[Torrentio]', e.message); sendResponse(); });
 }
}

// ===================== CONFIG PAGE (TỐI GIẢN CSS) =====================
function buildConfigPage(cfg, configStr, pub) {
 var installUrl = pub + (configStr ? '/' + configStr : '') + '/manifest.json';
 var stremioUrl = 'stremio://' + installUrl.replace(/^https?:\/\//, '');
 var commonSort = cfg.commonSortBy || 'size';
 var jacredDomain = cfg.jacredDomain || DEFAULT_JACRED_DOMAIN;
 var domainOptions = '';
 for (var key in JAC_RED_DOMAINS) domainOptions += '<option value="' + key + '"' + (jacredDomain === key ? ' selected' : '') + '>' + key + '</option>';
 
 var html = '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hybrid Addon v6.8.0</title>'
 + '<style>'
 + '*{margin:0;padding:0;box-sizing:border-box}'
 + 'body{background:#0a0a14;color:#e0e0f0;font-family:system-ui,sans-serif;padding:16px;font-size:14px}'
 + '.wrap{max-width:600px;margin:0 auto}'
 + 'h1{text-align:center;color:#a78bfa;margin-bottom:4px;font-size:20px}'
 + '.sub{text-align:center;color:#888;margin-bottom:16px;font-size:12px}'
 + '.card{background:#12122a;border:1px solid #2a2a50;border-radius:10px;padding:14px;margin-bottom:10px}'
 + '.card h2{color:#a78bfa;font-size:13px;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}'
 + 'label{display:block;color:#888;font-size:11px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}'
 + 'input,select,textarea{width:100%;padding:10px;background:#0a0a1e;border:1px solid #2a2a50;border-radius:6px;color:#e0e0f0;font-size:13px;outline:none;margin-bottom:8px}'
 + 'input:focus,select:focus,textarea:focus{border-color:#a78bfa}'
 + 'textarea{resize:vertical;min-height:60px;font-family:monospace;font-size:11px}'
 + '.trow{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e1e40}'
 + '.trow:last-child{border:none;padding-bottom:0}'
 + '.trow-info{flex:1}'
 + '.trow-name{font-weight:500;font-size:13px}'
 + '.trow-sub{color:#666;font-size:11px;margin-top:2px}'
 + '.sw{position:relative;width:42px;height:24px;flex-shrink:0}'
 + '.sw input{opacity:0;width:0;height:0;position:absolute}'
 + '.sw-track{position:absolute;inset:0;background:#2a2a50;border-radius:24px;transition:.2s}'
 + '.sw-thumb{position:absolute;width:18px;height:18px;top:3px;left:3px;background:#fff;border-radius:50%;transition:.2s}'
 + '.sw input:checked+.sw-track{background:#7c3aed}'
 + '.sw input:checked+.sw-thumb{transform:translateX(18px)}'
 + '.btn{display:inline-block;padding:10px 16px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center}'
 + '.btn-ghost{background:#0a0a1e;border:1px solid #2a2a50;color:#888;width:100%}'
 + '.btn-purple{background:#7c3aed;color:#fff}'  
 + '.btn-green{background:#10b981;color:#fff}'
 + '.btn-full{width:100%}'
 + '.btn-row{display:flex;gap:8px;margin-top:8px}'
 + '.btn-row .btn{flex:1}'
 + '.gen-btn{width:100%;padding:14px;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;background:#7c3aed;color:#fff;margin:12px 0}'
 + '.url-box{background:#0a0a1e;border:1px solid #2a2a50;border-radius:6px;padding:10px;font-family:monospace;font-size:11px;color:#60a5fa;word-break:break-all;margin:10px 0;cursor:pointer}'
 + '.sort-row{display:flex;gap:6px;margin-bottom:8px}'
 + '.sort-btn{flex:1;padding:10px;background:#0a0a1e;border:2px solid #2a2a50;border-radius:6px;color:#888;font-size:11px;font-weight:600;cursor:pointer;text-align:center}'
 + '.sort-btn.on{border-color:#7c3aed;color:#a78bfa;background:rgba(124,58,237,.1)}'
 + '.qf-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}'
 + '.qf-label{display:flex;align-items:center;gap:4px;padding:6px 10px;background:#0a0a1e;border:1.5px solid #2a2a50;border-radius:4px;cursor:pointer;font-size:12px;user-select:none}'
 + '.qf-label input{width:auto;margin:0}'
 + '.qf-label.on{border-color:#f87171;color:#f87171}'
 + '.two-col{display:flex;gap:8px}'
 + '.two-col>div{flex:1}'
 + '.hint{font-size:11px;color:#555;margin-top:2px}'
 + '.test-box{margin-top:6px;padding:8px 10px;border-radius:4px;font-size:11px;display:none}'
 + '.test-ok{display:block;background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2)}'
 + '.test-err{display:block;background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.2)}'
 + '.test-load{display:block;background:rgba(124,58,237,.1);color:#a78bfa;border:1px solid rgba(124,58,237,.2)}'
 + '.divider{height:1px;background:#1e1e40;margin:10px 0}'
 + '.footer{text-align:center;color:#555;font-size:11px;margin-top:16px;padding:10px}'
 + '</style></head><body><div class="wrap">'
 + '<h1>Hybrid Addon</h1><p class="sub">v6.8.0 | Torrentio · jac.red · Knaben · Magnetz</p>'
 
 // TORRENTIO CONFIG
 + '<div class="card"><h2>Torrentio Config</h2>'
 + '<label>Paste Torrentio link</label>'
 + '<textarea id="configLink" placeholder="https://torrentio.strem.fun/.../manifest.json"></textarea>'
 + '<button class="btn btn-ghost btn-full" onclick="applyTIO()">Apply Torrentio</button>'
 + '</div>'
 
 // SOURCES
 + '<div class="card"><h2>Sources</h2>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Torrentio</div><div class="trow-sub">Multi-tracker</div></div><label class="sw"><input type="checkbox" id="torrentioEnabled"' + (cfg.torrentioEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Knaben</div><div class="trow-sub">TPB, 1337x, YTS, Nyaa...</div></div><label class="sw"><input type="checkbox" id="knabenEnabled"' + (cfg.knabenEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Magnetz</div><div class="trow-sub">Tên + Năm (movie) / Tên + Sxx (series)</div></div><label class="sw"><input type="checkbox" id="magnetzEnabled"' + (cfg.magnetzEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">jac.red</div><div class="trow-sub">Tên Nga + IMDb | Pack trọn bộ hiện tất cả season</div></div><label class="sw"><input type="checkbox" id="jacredEnabled"' + (cfg.jacredEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="divider"></div>'
 + '<label>JacRed Domain</label><select id="jacredDomain">' + domainOptions + '</select>'
 + '</div>'
 
 // TORRSERVER
 + '<div class="card"><h2>TorrServer</h2>'
 + '<label>URL</label>'
 + '<input type="text" id="tsUrl" value="' + (cfg.torrServerUrl || '') + '" placeholder="http://192.168.1.100:8090">'
 + '<button class="btn btn-ghost btn-full" onclick="testTS()" style="margin-bottom:6px">Test Connection</button>'
 + '<div id="tsResult" class="test-box"></div>'
 + '</div>'
 
 // FILTERS
 + '<div class="card"><h2>Filters</h2>'
 + '<label>Sort by</label>'
 + '<div class="sort-row">'
 + '<div class="sort-btn' + (commonSort === 'size' ? ' on' : '') + '" onclick="setSort(\'size\',this)">Size</div>'
 + '<div class="sort-btn' + (commonSort === 'seeds' ? ' on' : '') + '" onclick="setSort(\'seeds\',this)">Seeds</div>'
 + '<div class="sort-btn' + (commonSort === 'date' ? ' on' : '') + '" onclick="setSort(\'date\',this)">Newest</div>'
 + '</div><input type="hidden" id="commonSort" value="' + commonSort + '">'
 + '<div class="two-col"><div><label>Max Results</label><input type="number" id="maxResults" value="' + (cfg.maxResults || 30) + '" min="5" max="100"></div></div>'
 + '<div class="two-col"><div><label>Min (GB)</label><input type="number" id="minSize" value="' + (cfg.sizeMinGB || '') + '" placeholder="0" step="0.5"></div><div><label>Max (GB)</label><input type="number" id="maxSize" value="' + (cfg.sizeMaxGB || '') + '" placeholder="100" step="0.5"></div></div>'
 + '<label>Hide Quality</label>'
 + '<div class="qf-row">'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('480p') ? ' on' : '') + '"><input type="checkbox" value="480p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('480p') ? 'checked' : '') + ' onchange="toggleQf(this)">480p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('720p') ? ' on' : '') + '"><input type="checkbox" value="720p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('720p') ? 'checked' : '') + ' onchange="toggleQf(this)">720p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('1080p') ? ' on' : '') + '"><input type="checkbox" value="1080p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('1080p') ? 'checked' : '') + ' onchange="toggleQf(this)">1080p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('4K') ? ' on' : '') + '"><input type="checkbox" value="4K" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('4K') ? 'checked' : '') + ' onchange="toggleQf(this)">4K</label>'
 + '</div>'
 + '</div>'
 
 // OPTIONS
 + '<div class="card"><h2>Options</h2>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Prefer Pack</div><div class="trow-sub">Show packs instead of single episodes</div></div><label class="sw"><input type="checkbox" id="preferPack"' + (cfg.preferPack !== false ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Anime Mode</div><div class="trow-sub">Optimize episode selection for anime</div></div><label class="sw"><input type="checkbox" id="animeMode"' + (cfg.animeMode ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '</div>'
 
 // GENERATE
 + '<button class="gen-btn" onclick="gen()">Generate & Update</button>'
 
 // INSTALL
 + '<div class="card"><h2>Install</h2>'
 + '<label>Manifest URL (click to copy)</label>'
 + '<div class="url-box" id="iurl" onclick="copyUrl()">' + installUrl + '</div>'
 + '<div class="btn-row"><button class="btn btn-ghost" onclick="copyUrl()">Copy</button><a class="btn btn-green" href="' + stremioUrl + '" id="slink">Install</a></div>'
 + '</div>'
 
 + '<div class="footer">Hybrid Addon v6.8.0 | fatcatQN</div>'
 + '</div>'
 
 + '<script>'
 + 'var tioCfg=' + JSON.stringify({ providers: cfg.providers, sortBy: cfg.sortBy, language: cfg.language, qualityfilter: cfg.qualityfilter }) + ';'
 + 'var defaultTio=' + JSON.stringify(DEFAULT_TORRENTIO_CONFIG) + ';'
 + 'function toggleQf(cb){var l=cb.parentElement;if(cb.checked)l.classList.add("on");else l.classList.remove("on")}'
 + 'function setSort(v,el){document.getElementById("commonSort").value=v;document.querySelectorAll(".sort-btn").forEach(function(b){b.classList.remove("on")});el.classList.add("on")}'
 + 'function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"")}'
 + 'function getCfg(){var qf=[];document.querySelectorAll(".qf-row input:checked").forEach(function(c){qf.push(c.value)});return{torrServerUrl:document.getElementById("tsUrl").value.trim(),jacredEnabled:document.getElementById("jacredEnabled").checked,torrentioEnabled:document.getElementById("torrentioEnabled").checked,knabenEnabled:document.getElementById("knabenEnabled").checked,magnetzEnabled:document.getElementById("magnetzEnabled").checked,commonSortBy:document.getElementById("commonSort").value,maxResults:parseInt(document.getElementById("maxResults").value)||30,jacredDomain:document.getElementById("jacredDomain").value,animeMode:document.getElementById("animeMode").checked,preferPack:document.getElementById("preferPack").checked,commonQualityFilter:qf,sizeMinGB:parseFloat(document.getElementById("minSize").value)||0,sizeMaxGB:parseFloat(document.getElementById("maxSize").value)||100,providers:tioCfg.providers,sortBy:tioCfg.sortBy,language:tioCfg.language,qualityfilter:tioCfg.qualityfilter}}'
 + 'function gen(){var c=getCfg();var e=enc(c);var u=location.protocol+"//"+location.host+"/"+e+"/manifest.json";document.getElementById("iurl").textContent=u;document.getElementById("slink").href="stremio://"+u.replace(/^https?:\\/\\//,"")}'
 + 'function copyUrl(){var u=document.getElementById("iurl").textContent;if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){alert("Copied!")})}else{prompt("Copy:",u)}}'
 + 'function parseTIO(l){try{var u=new URL(l.replace("stremio://","https://"));var m=u.pathname.match(/\\/([^\\/]+)\\/manifest\\.json/);if(!m)return null;var p=m[1].split("|");var c={providers:[],sortBy:"size",language:"",qualityfilter:[]};p.forEach(function(x){var kv=x.split("=");if(kv[0]==="providers")c.providers=kv[1]?kv[1].split(","):[];else if(kv[0]==="sort")c.sortBy=kv[1];else if(kv[0]==="language")c.language=kv[1];else if(kv[0]==="qualityfilter")c.qualityfilter=kv[1]?kv[1].split(","):[]});return c}catch(e){return null}}'
 + 'function applyTIO(){var l=document.getElementById("configLink").value.trim();if(!l){alert("Paste link first!");return}var c=parseTIO(l);if(!c){alert("Invalid!");return}tioCfg=c;gen();alert("Applied!")}'
 + 'async function testTS(){var url=document.getElementById("tsUrl").value.trim();var rd=document.getElementById("tsResult");if(!url){rd.className="test-box test-err";rd.textContent="Enter URL";return}if(!/^https?:\\/\\//.test(url))url="http://"+url;rd.className="test-box test-load";rd.textContent="Testing...";try{var ctrl=new AbortController();var tmr=setTimeout(function(){ctrl.abort()},8000);var r=await fetch(url+"/echo",{signal:ctrl.signal});clearTimeout(tmr);if(r.ok){rd.className="test-box test-ok";rd.textContent="Connected!"}else throw new Error("HTTP "+r.status)}catch(e){rd.className="test-box test-err";rd.textContent=e.name==="AbortError"?"Timeout":"Error: "+e.message}}'
 + '<\/script>'
 + '</body></html>';
 
 return html;
}

// ===================== SERVER =====================
var server = http.createServer(function(req, res) {
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
 var host = req.headers['host'] || 'localhost';
 var p = parseUrl(req.url, host), cfg = p.userConfig || DEFAULT_CONFIG, rest = p.rest;
 var pub = getPublicUrlFromReq(req), query = parseQuery(req.url, host);
 console.log('[REQ] ' + req.url);
 
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
 console.log('\nHybrid Addon v6.8.0 : http://localhost:' + PORT);
 console.log('Configure: http://localhost:' + PORT + '/configure\n');
});
