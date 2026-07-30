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
 sizeMaxGB: 1000
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
 if (up.includes('TB') || up.includes('ТБ')) return s * 1024;
 if (up.includes('GB') || up.includes('ГБ')) return s;
 if (up.includes('MB') || up.includes('МБ')) return s / 1024;
 if (up.includes('KB') || up.includes('КБ')) return s / (1024 * 1024);
 if (s > 100) return s / 1024;
 return s;
}

function isQualityHidden(title, quality, hideList) {
 if (!hideList || !hideList.length) return false;
 var t = (title || '').toLowerCase();
 var q = (quality || '').toLowerCase();
 for (var i = 0; i < hideList.length; i++) {
 var h = String(hideList[i]).toLowerCase();
 if (h === '4k') { if (q === '4k' || /\b(4k|2160p|uhd)\b/.test(t)) return true; }
 else if (q === h) return true;
 else if (t.indexOf(h) !== -1) return true;
 }
 return false;
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
 version: '7.0.0',
 name: 'Hybrid Addon',
 description: 'Torrentio + jac.red + Knaben + Magnetz',
 resources: ['stream'],
 types: ['movie','series','anime'],
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
 var metaType = (type === 'series' || type === 'anime') ? 'tv' : 'movie';
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
 var metaType = (type === 'series' || type === 'anime') ? 'tv' : 'movie';
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
 if ((type === 'movie') && (types.includes('series') || types.includes('anime') || seasons.length > 0)) continue;
 if ((type === 'series' || type === 'anime') && types.includes('movie') && seasons.length === 0) continue;
 
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
    else if (type === 'series' || type === 'anime') filterSegment = '2000000/1/bytes';
    var finalQuery = query;
    if ((type === 'series' || type === 'anime') && !preferPack && season && episode) {
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
 var maxSize = parseFloat(cfg.sizeMaxGB) || 1000;
 
 // Kiểm tra có phải anime không
 var isAnime = (type === 'anime' || cfg.animeMode);
 var seriesType = (type === 'series' || type === 'anime');
 
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
 if (maxSize < 1000 && t.sizeGB > maxSize) return;
 var title = t.title;
 if (isQualityHidden(title, null, cfg.commonQualityFilter)) return;
 var episodeMatch = title.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
 var isSingleEpisode = episodeMatch !== null;
 var isPack = (seriesType && !isSingleEpisode);
 
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
 var badge = seriesType ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
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
 console.log('[Magnetz] Search: "' + query + '" (series/anime: tên + Sxx)');
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
 if (maxSize < 1000 && t.sizeGB > maxSize) return;
 var title = t.title;
 if (isQualityHidden(title, null, cfg.commonQualityFilter)) return;
 var episodeMatch = title.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
 var isSingleEpisode = episodeMatch !== null;
 var isPack = (seriesType && !isSingleEpisode);
 
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
 var badge = seriesType ? (isPack ? '📦 PACK | ' : '🎬 EP | ') : '';
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
 if (maxSize < 1000 && t.sizeGB > maxSize) return;
 var title = t.title;
 if (isQualityHidden(title, t.quality, cfg.commonQualityFilter)) return;
 
 if (seriesType && season > 0) {
 var sPad = String(season).padStart(2, '0');
 
 // Pack trọn bộ -> hiện ở tất cả season
 var completePackPattern = /S\d{1,2}[-~]S?\d{1,2}|Season\s*\d+\s*[-~]\s*\d+|сезон[ы]?\s*\d+\s*[-~]\s*\d+|Complete|Полный|Все\s*сезон[ы]?|1-\d+\s*сезон/i;
 var isCompletePack = completePackPattern.test(title);
 
 if (!isCompletePack) {
 var singleSeasonPattern = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)|сезон\\s*' + season + '(?:[^\\d]|$)|' + season + '\\s*сезон', 'i');
 var anySeasonPattern = /S\d{1,2}(?:[^\d]|$)|Season\s*\d|сезон\s*\d|\d+\s*сезон/gi;
 var hasSeasonMention = anySeasonPattern.test(title);
 
 if (isAnime) {
 // ANIME / ANIME MODE: Cho phép pack không Sxx (vd: [13+1 из...], 1-14 серии)
 var noSeasonSeriesPattern = /\[\d+\+?\d*\s*(из|of|ep|сери)/i;
 var isSeriesPack = noSeasonSeriesPattern.test(title) || title.indexOf('серии') !== -1 || title.indexOf('сери') !== -1;
 
 if (hasSeasonMention) {
 if (!singleSeasonPattern.test(title) && !isCompletePack) return;
 } else if (isSeriesPack) {
 // OK - anime pack
 } else {
 // Có thể là movie trong anime series -> bỏ qua
 if (/фильм|Movie|Gekijouban/i.test(title)) return;
 // Còn lại cho qua (pack không ghi season)
 }
 } else {
 // TV SHOWS: Lọc chặt
 if (hasSeasonMention) {
 if (!singleSeasonPattern.test(title)) return;
 } else {
 return;
 }
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

// ===================== CONFIG PAGE (TỐI GIẢN) =====================
function buildConfigPage(cfg, configStr, pub) {
 var installUrl = pub + (configStr ? '/' + configStr : '') + '/manifest.json';
 var stremioUrl = 'stremio://' + installUrl.replace(/^https?:\/\//, '');
 var commonSort = cfg.commonSortBy || 'size';
 var jacredDomain = cfg.jacredDomain || DEFAULT_JACRED_DOMAIN;
 var domainOptions = '';
 for (var key in JAC_RED_DOMAINS) domainOptions += '<option value="' + key + '"' + (jacredDomain === key ? ' selected' : '') + '>' + key + '</option>';
 
 var html = '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hybrid Addon v7.0.0</title>'
 + '<style>'
 + '*{margin:0;padding:0;box-sizing:border-box}'
 + 'body{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#e0e0f0;font-family:"Segoe UI",system-ui,sans-serif;padding:20px;font-size:14px;min-height:100vh;position:relative;overflow-x:hidden}'
 + 'body::before{content:"";position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 30%,rgba(167,139,250,0.15) 0%,transparent 50%),radial-gradient(circle at 70% 70%,rgba(96,165,250,0.1) 0%,transparent 50%);pointer-events:none;z-index:0}'
 + '.wrap{max-width:620px;margin:0 auto;position:relative;z-index:1}'
 + 'h1{text-align:center;background:linear-gradient(135deg,#a78bfa,#60a5fa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-size:28px;font-weight:800;margin-bottom:4px;letter-spacing:-0.5px}'
 + '.sub{text-align:center;color:rgba(255,255,255,0.6);margin-bottom:24px;font-size:13px;font-weight:500}'
 + '.card{background:rgba(255,255,255,0.08);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.15);border-radius:20px;padding:20px;margin-bottom:16px;box-shadow:0 8px 32px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.1);transition:transform 0.3s,box-shadow 0.3s}'
 + '.card:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.15)}'
 + '.card h2{color:rgba(255,255,255,0.9);font-size:14px;margin-bottom:16px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;display:flex;align-items:center;gap:8px}'
 + '.card h2::before{content:"";width:4px;height:16px;background:linear-gradient(180deg,#a78bfa,#60a5fa);border-radius:2px}'
 + 'label{display:block;color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;font-weight:600}'
 + 'input,select,textarea{width:100%;padding:14px 16px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:14px;outline:none;margin-bottom:12px;transition:border-color 0.3s,box-shadow 0.3s;box-shadow:inset 0 2px 4px rgba(0,0,0,0.2)}'
 + 'input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:8px;background:linear-gradient(90deg,rgba(167,139,250,0.15),rgba(96,165,250,0.15));border:1px solid rgba(255,255,255,0.1);border-radius:8px;outline:none;cursor:pointer;margin:8px 0 16px;transition:all .3s}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;background:linear-gradient(135deg,#a78bfa,#7c3aed);border-radius:50%;border:2px solid rgba(255,255,255,0.3);box-shadow:0 2px 8px rgba(167,139,250,0.4);cursor:pointer;transition:all .2s}input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.15);box-shadow:0 4px 12px rgba(167,139,250,0.6)}input[type=range]::-moz-range-thumb{width:24px;height:24px;background:linear-gradient(135deg,#a78bfa,#7c3aed);border-radius:50%;border:2px solid rgba(255,255,255,0.3);box-shadow:0 2px 8px rgba(167,139,250,0.4);cursor:pointer}input[type=range]::-moz-range-track{height:8px;background:linear-gradient(90deg,rgba(167,139,250,0.15),rgba(96,165,250,0.15));border:1px solid rgba(255,255,255,0.1);border-radius:8px}'
 + 'input:focus,select:focus,textarea:focus{border-color:#a78bfa;box-shadow:inset 0 2px 4px rgba(0,0,0,0.2),0 0 0 3px rgba(167,139,250,0.2)}'
 + 'input::placeholder,textarea::placeholder{color:rgba(255,255,255,0.3)}'
 + 'textarea{resize:vertical;min-height:80px;font-family:"SF Mono","Fira Code",monospace;font-size:12px}'
 + '.trow{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.08)}'
 + '.trow:last-child{border:none;padding-bottom:0}'
 + '.trow-info{flex:1}'
 + '.trow-name{font-weight:600;font-size:15px;color:rgba(255,255,255,0.95)}'
 + '.trow-sub{color:rgba(255,255,255,0.4);font-size:12px;margin-top:3px}'
 + '.sw{position:relative;width:52px;height:28px;flex-shrink:0}'
 + '.sw input{opacity:0;width:0;height:0;position:absolute}'
 + '.sw-track{position:absolute;inset:0;background:rgba(255,255,255,0.1);border-radius:28px;transition:.3s;cursor:pointer;border:1px solid rgba(255,255,255,0.2)}'
 + '.sw-thumb{position:absolute;width:22px;height:22px;top:2px;left:2px;background:linear-gradient(135deg,#fff,#e0e0e0);border-radius:50%;transition:.3s;box-shadow:0 2px 8px rgba(0,0,0,0.3)}'
 + '.sw input:checked+.sw-track{background:linear-gradient(135deg,#a78bfa,#7c3aed);border-color:#a78bfa}'
 + '.sw input:checked+.sw-thumb{transform:translateX(24px)}'
 + '.btn{display:inline-block;padding:12px 20px;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;transition:all 0.3s}'
 + '.btn-ghost{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.8);width:100%;backdrop-filter:blur(10px)}'
 + '.btn-ghost:hover{background:rgba(255,255,255,0.15);transform:translateY(-1px)}'
 + '.btn-purple{background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff;box-shadow:0 4px 15px rgba(167,139,250,0.4)}'
 + '.btn-purple:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(167,139,250,0.5)}'  
 + '.btn-green{background:linear-gradient(135deg,#34d399,#10b981);color:#fff;box-shadow:0 4px 15px rgba(16,185,129,0.4)}'
 + '.btn-green:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(16,185,129,0.5)}'
 + '.btn-full{width:100%}'
 + '.btn-row{display:flex;gap:10px;margin-top:10px}'
 + '.btn-row .btn{flex:1}'
 + '.gen-btn{width:100%;padding:18px;border:none;border-radius:16px;font-size:16px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#a78bfa,#7c3aed,#f472b6);color:#fff;margin:20px 0;box-shadow:0 8px 30px rgba(167,139,250,0.4);transition:all 0.3s;text-transform:uppercase;letter-spacing:2px}'
 + '.gen-btn:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(167,139,250,0.5)}'
 + '.gen-btn:active{transform:translateY(-1px)}'
 + '.url-box{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:14px;font-family:"SF Mono","Fira Code",monospace;font-size:12px;color:#60a5fa;word-break:break-all;margin:12px 0;cursor:pointer;transition:all 0.3s;backdrop-filter:blur(10px)}'
 + '.url-box:hover{background:rgba(96,165,250,0.1);border-color:#60a5fa}'
 + '.sort-row{display:flex;gap:8px;margin-bottom:12px}'
 + '.sort-btn{flex:1;padding:12px;background:rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.1);border-radius:12px;color:rgba(255,255,255,0.6);font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all 0.3s;backdrop-filter:blur(10px)}'
 + '.sort-btn:hover{border-color:rgba(167,139,250,0.3);color:rgba(255,255,255,0.8)}'
 + '.sort-btn.on{border-color:#a78bfa;color:#fff;background:rgba(167,139,250,0.2)}'
 + '.qf-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}'
 + '.qf-label{display:flex;align-items:center;gap:6px;padding:10px 14px;background:rgba(0,0,0,0.3);border:1.5px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;transition:all 0.3s;color:rgba(255,255,255,0.7)}'
 + '.qf-label input{width:auto;margin:0;accent-color:#a78bfa}'
 + '.qf-label:hover{border-color:rgba(167,139,250,0.3)}'
 + '.qf-label.on{border-color:#f87171;color:#f87171;background:rgba(248,113,113,0.15)}'
 + '.two-col{display:flex;gap:12px}'
 + '.two-col>div{flex:1}'
 + '.hint{font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px}'
 + '.test-box{margin-top:8px;padding:12px 14px;border-radius:10px;font-size:13px;display:none;font-weight:500}'
 + '.test-ok{display:block;background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.3)}'
 + '.test-err{display:block;background:rgba(248,113,113,0.15);color:#f87171;border:1px solid rgba(248,113,113,0.3)}'
 + '.test-load{display:block;background:rgba(167,139,250,0.15);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);animation:pulse 1.5s infinite}'
 + '@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}'
 + '.divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);margin:16px 0}'
 + '.footer{text-align:center;color:rgba(255,255,255,0.4);font-size:12px;margin-top:24px;padding:16px}'
 + '.footer span{background:linear-gradient(135deg,#a78bfa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600}'
 + '@media(max-width:480px){.wrap{padding:0 4px}.card{padding:16px;border-radius:16px}.gen-btn{font-size:14px;padding:16px}}'
 + '.toast-container{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:none;width:100%;max-width:420px;padding:0 16px}'
 + '.toast{pointer-events:auto;display:flex;align-items:center;gap:12px;min-width:280px;max-width:100%;padding:14px 18px;background:rgba(28,28,30,0.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.45),0 0 0 1px rgba(255,255,255,0.05);color:#fff;font-size:14px;font-weight:500;opacity:0;transform:translateY(-24px) scale(0.96);transition:opacity .35s cubic-bezier(.22,1,.36,1),transform .35s cubic-bezier(.22,1,.36,1)}'
 + '.toast.show{opacity:1;transform:translateY(0) scale(1)}'
 + '.toast.hide{opacity:0;transform:translateY(-16px) scale(0.96)}'
 + '.toast-icon{flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px}'
 + '.toast-icon.success{background:linear-gradient(135deg,#34d399,#10b981);box-shadow:0 4px 12px rgba(16,185,129,0.4)}'
 + '.toast-icon.info{background:linear-gradient(135deg,#60a5fa,#3b82f6);box-shadow:0 4px 12px rgba(59,130,246,0.4)}'
 + '.toast-icon.warn{background:linear-gradient(135deg,#fbbf24,#f59e0b);box-shadow:0 4px 12px rgba(245,158,11,0.4)}'
 + '.toast-msg{flex:1;line-height:1.35}'
 + '.toast-close{flex-shrink:0;width:22px;height:22px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:rgba(255,255,255,0.6);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all .2s}'
 + '.toast-close:hover{background:rgba(255,255,255,0.2);color:#fff}'
 + '.menu-btn{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:42px;height:42px;border:none;border-radius:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;transition:all .25s;z-index:2}'
 + '.menu-btn:hover{background:rgba(167,139,250,0.2);border-color:rgba(167,139,250,0.4)}'
 + '.menu-btn span{display:block;width:18px;height:2px;background:#e0e0f0;border-radius:2px;transition:all .3s}'
 + '.menu-btn.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}'
 + '.menu-btn.open span:nth-child(2){opacity:0;transform:scaleX(0)}'
 + '.menu-btn.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}'
 + '.drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10000;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}'
 + '.drawer-overlay.show{opacity:1;visibility:visible}'
 + '.drawer{position:fixed;top:0;right:0;width:min(360px,92vw);height:100%;background:linear-gradient(165deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-left:1px solid rgba(255,255,255,0.12);z-index:10001;transform:translateX(100%);transition:transform .38s cubic-bezier(.22,1,.36,1);box-shadow:-12px 0 40px rgba(0,0,0,0.4);display:flex;flex-direction:column;padding:0;overflow-y:auto}'
 + '.drawer.show{transform:translateX(0)}'
 + '.drawer-header{display:flex;align-items:center;justify-content:space-between;padding:20px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.08)}'
 + '.drawer-header h3{font-size:16px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0}'
 + '.drawer-close{width:36px;height:36px;border:none;border-radius:10px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}'
 + '.drawer-close:hover{background:rgba(248,113,113,0.2);color:#f87171}'
 + '.drawer-body{padding:20px;flex:1}'
 + '.drawer-body label{display:block;color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-weight:600}'
 + '.drawer-footer{padding:16px 20px 28px;border-top:1px solid rgba(255,255,255,0.08)}'
 + '</style><style>.logo-wrap{position:relative;display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:8px;padding:16px 56px 16px 20px;background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.12);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3)}.logo-icon{flex-shrink:0;filter:drop-shadow(0 4px 12px rgba(167,139,250,0.4))}.logo-text{display:flex;flex-direction:column;gap:2px}.logo-title{font-size:22px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#e0e7ff,#c4b5fd,#f9a8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.logo-ver{font-size:11px;font-weight:600;color:#a78bfa;opacity:0.8;letter-spacing:1px;text-transform:uppercase}</style></head><body><div class="toast-container" id="toastContainer"></div><div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div><div class="drawer" id="drawer"><div class="drawer-header"><h3>Install Addon</h3><button class="drawer-close" onclick="closeDrawer()">×</button></div><div class="drawer-body"><label>Manifest URL</label><div class="url-box" id="iurl" onclick="copyUrl()">' + installUrl + '</div><div class="btn-row"><button class="btn btn-ghost" onclick="copyUrl()">Copy</button><a class="btn btn-green" href="' + stremioUrl + '" id="slink" onclick="onInstallClick(event)">Install</a></div></div><div class="drawer-footer"><p style="font-size:12px;color:rgba(255,255,255,0.35);text-align:center;margin:0">Generate config trước, rồi mở menu để cài</p></div></div><div class="wrap">'
 + '<div class="logo-wrap"><div class="logo-icon"><svg width="36" height="36" viewBox="0 0 36 36" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="#a78bfa"/><stop offset="50%" stop-color="#6366f1"/><stop offset="100%" stop-color="#f472b6"/></linearGradient></defs><rect x="2" y="2" width="32" height="32" rx="10" fill="url(#lg)"/><path d="M18 8 L24 14 L22 14 L22 22 L20 22 L20 26 L16 26 L16 22 L14 22 L14 14 L12 14 Z" fill="#fff" opacity="0.95"/><circle cx="18" cy="16" r="2" fill="#a78bfa"/></svg></div>'
+ '<div class="logo-text"><div class="logo-title">Hybrid Addon</div><div class="logo-ver">v7.0.0</div></div><button class="menu-btn" id="menuBtn" onclick="toggleDrawer()" aria-label="Menu"><span></span><span></span><span></span></button></div>'
+ '<p class="sub">Torrentio · jac.red · Knaben · Magnetz</p>'
 
 + '<div class="card"><h2>Torrentio Config</h2>'
 + '<label>Paste Torrentio link</label>'
 + '<textarea id="configLink" placeholder="https://torrentio.strem.fun/.../manifest.json"></textarea>'
 + '<button class="btn btn-ghost btn-full" onclick="applyTIO()">Apply Torrentio</button>'
 + '</div>'
 
 + '<div class="card"><h2>Sources</h2>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Torrentio</div><div class="trow-sub">Multi-tracker</div></div><label class="sw"><input type="checkbox" id="torrentioEnabled"' + (cfg.torrentioEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Knaben</div><div class="trow-sub">TPB, 1337x, YTS, Nyaa...</div></div><label class="sw"><input type="checkbox" id="knabenEnabled"' + (cfg.knabenEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Magnetz</div><div class="trow-sub">Tên + Năm / Tên + Sxx</div></div><label class="sw"><input type="checkbox" id="magnetzEnabled"' + (cfg.magnetzEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">jac.red</div><div class="trow-sub">Tên Nga + IMDb | Anime: pack không Sxx</div></div><label class="sw"><input type="checkbox" id="jacredEnabled"' + (cfg.jacredEnabled ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="divider"></div>'
 + '<label>JacRed Domain</label><select id="jacredDomain">' + domainOptions + '</select>'
 + '</div>'
 
 + '<div class="card"><h2>TorrServer</h2>'
 + '<label>URL</label>'
 + '<input type="text" id="tsUrl" value="' + (cfg.torrServerUrl || '') + '" placeholder="http://192.168.1.100:8090">'
 + '<button class="btn btn-ghost btn-full" onclick="testTS()" style="margin-bottom:6px">Test Connection</button>'
 + '<div id="tsResult" class="test-box"></div>'
 + '</div>'
 
 + '<div class="card"><h2>Filters</h2>'
 + '<label>Sort by</label>'
 + '<div class="sort-row">'
 + '<div class="sort-btn' + (commonSort === 'size' ? ' on' : '') + '" onclick="setSort(\'size\',this)">Size</div>'
 + '<div class="sort-btn' + (commonSort === 'seeds' ? ' on' : '') + '" onclick="setSort(\'seeds\',this)">Seeds</div>'
 + '<div class="sort-btn' + (commonSort === 'date' ? ' on' : '') + '" onclick="setSort(\'date\',this)">Newest</div>'
 + '</div><input type="hidden" id="commonSort" value="' + commonSort + '">'
 + '<div class="two-col"><div><label>Max Results</label><input type="number" id="maxResults" value="' + (cfg.maxResults || 30) + '" min="5" max="2000"></div></div>'
 + '<div class="two-col"><div><label>Min: <span id="minVal">' + (cfg.sizeMinGB || 0) + '</span> GB</label><input type="range" id="minSize" value="' + (cfg.sizeMinGB || 0) + '" min="0" max="1000" step="0.5" oninput="document.getElementById(\'minVal\').textContent=this.value"></div><div><label>Max: <span id="maxVal">' + (cfg.sizeMaxGB || 1000) + '</span> GB</label><input type="range" id="maxSize" value="' + (cfg.sizeMaxGB || 1000) + '" min="0" max="1000" step="0.5" oninput="document.getElementById(\'maxVal\').textContent=this.value"></div></div>'
 + '<label>Hide Quality</label>'
 + '<div class="qf-row">'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('480p') ? ' on' : '') + '"><input type="checkbox" value="480p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('480p') ? 'checked' : '') + ' onchange="toggleQf(this)">480p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('720p') ? ' on' : '') + '"><input type="checkbox" value="720p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('720p') ? 'checked' : '') + ' onchange="toggleQf(this)">720p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('1080p') ? ' on' : '') + '"><input type="checkbox" value="1080p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('1080p') ? 'checked' : '') + ' onchange="toggleQf(this)">1080p</label>'
 + '<label class="qf-label' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('4K') ? ' on' : '') + '"><input type="checkbox" value="4K" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('4K') ? 'checked' : '') + ' onchange="toggleQf(this)">4K</label>'
 + '</div>'
 + '</div>'
 
 + '<div class="card"><h2>Options</h2>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Prefer Pack</div><div class="trow-sub">Show packs instead of episodes</div></div><label class="sw"><input type="checkbox" id="preferPack"' + (cfg.preferPack !== false ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '<div class="trow"><div class="trow-info"><div class="trow-name">Anime Mode</div><div class="trow-sub">Allow packs without Sxx pattern</div></div><label class="sw"><input type="checkbox" id="animeMode"' + (cfg.animeMode ? ' checked' : '') + '><div class="sw-track"></div><div class="sw-thumb"></div></label></div>'
 + '</div>'
 
 + '<button class="gen-btn" onclick="gen()">Generate & Update</button>'
 
 + '<div class="footer">Hybrid Addon v7.0.0 | <span>fatcatQN</span></div>'
 + '</div>'
 
 + '<script>'
 + 'var tioCfg=' + JSON.stringify({ providers: cfg.providers, sortBy: cfg.sortBy, language: cfg.language, qualityfilter: cfg.qualityfilter }) + ';'
 + 'var defaultTio=' + JSON.stringify(DEFAULT_TORRENTIO_CONFIG) + ';'
 + 'var toastTimer=null;'
 + 'function openDrawer(){document.getElementById("drawer").classList.add("show");document.getElementById("drawerOverlay").classList.add("show");document.getElementById("menuBtn").classList.add("open");document.body.style.overflow="hidden"}'
 + 'function closeDrawer(){document.getElementById("drawer").classList.remove("show");document.getElementById("drawerOverlay").classList.remove("show");document.getElementById("menuBtn").classList.remove("open");document.body.style.overflow=""}'
 + 'function toggleDrawer(){if(document.getElementById("drawer").classList.contains("show"))closeDrawer();else openDrawer()}'
 + 'function showToast(msg,type){type=type||"success";var c=document.getElementById("toastContainer");if(!c)return;var icons={success:"✓",info:"↗",warn:"!"};var t=document.createElement("div");t.className="toast";t.innerHTML=\'<div class="toast-icon \'+type+\'">\'+(icons[type]||"✓")+\'</div><div class="toast-msg">\'+msg+\'</div><button class="toast-close" onclick="this.parentElement.classList.add(\\\'hide\\\');setTimeout(function(){this.remove()}.bind(this.parentElement),350)">×</button>\';c.appendChild(t);requestAnimationFrame(function(){requestAnimationFrame(function(){t.classList.add("show")})});clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.add("hide");setTimeout(function(){if(t.parentNode)t.remove()},350)},3200)}'
 + 'function toggleQf(cb){var l=cb.parentElement;if(cb.checked)l.classList.add("on");else l.classList.remove("on")}'
 + 'function setSort(v,el){document.getElementById("commonSort").value=v;document.querySelectorAll(".sort-btn").forEach(function(b){b.classList.remove("on")});el.classList.add("on")}'
 + 'function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"")}'
 + 'function getCfg(){var qf=[];document.querySelectorAll(".qf-row input:checked").forEach(function(c){qf.push(c.value)});return{torrServerUrl:document.getElementById("tsUrl").value.trim(),jacredEnabled:document.getElementById("jacredEnabled").checked,torrentioEnabled:document.getElementById("torrentioEnabled").checked,knabenEnabled:document.getElementById("knabenEnabled").checked,magnetzEnabled:document.getElementById("magnetzEnabled").checked,commonSortBy:document.getElementById("commonSort").value,maxResults:parseInt(document.getElementById("maxResults").value)||30,jacredDomain:document.getElementById("jacredDomain").value,animeMode:document.getElementById("animeMode").checked,preferPack:document.getElementById("preferPack").checked,commonQualityFilter:qf,sizeMinGB:parseFloat(document.getElementById("minSize").value)||0,sizeMaxGB:parseFloat(document.getElementById("maxSize").value)||1000,providers:tioCfg.providers,sortBy:tioCfg.sortBy,language:tioCfg.language,qualityfilter:tioCfg.qualityfilter}}'
 + 'function gen(){var c=getCfg();var e=enc(c);var u=location.protocol+"//"+location.host+"/"+e+"/manifest.json";document.getElementById("iurl").textContent=u;document.getElementById("slink").href="stremio://"+u.replace(/^https?:\\/\\//,"");showToast("Config updated!","success");openDrawer()}'
 + 'function copyUrl(){var u=document.getElementById("iurl").textContent;if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){showToast("Link copied to clipboard","success")}).catch(function(){fallbackCopy(u)})}else{fallbackCopy(u)}}'
 + 'function fallbackCopy(u){try{var ta=document.createElement("textarea");ta.value=u;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);showToast("Link copied to clipboard","success")}catch(e){showToast("Copy failed — select & copy manually","warn");prompt("Copy:",u)}}'
 + 'function onInstallClick(e){showToast("Opening Stremio to install…","info")}'
 + 'function parseTIO(l){try{var u=new URL(l.replace("stremio://","https://"));var m=u.pathname.match(/\\/([^\\/]+)\\/manifest\\.json/);if(!m)return null;var p=m[1].split("|");var c={providers:[],sortBy:"size",language:"",qualityfilter:[]};p.forEach(function(x){var kv=x.split("=");if(kv[0]==="providers")c.providers=kv[1]?kv[1].split(","):[];else if(kv[0]==="sort")c.sortBy=kv[1];else if(kv[0]==="language")c.language=kv[1];else if(kv[0]==="qualityfilter")c.qualityfilter=kv[1]?kv[1].split(","):[]});return c}catch(e){return null}}'
 + 'function applyTIO(){var l=document.getElementById("configLink").value.trim();if(!l){showToast("Paste Torrentio link first","warn");return}var c=parseTIO(l);if(!c){showToast("Invalid Torrentio link","warn");return}tioCfg=c;var cfgObj=getCfg();var e=enc(cfgObj);var u=location.protocol+"//"+location.host+"/"+e+"/manifest.json";document.getElementById("iurl").textContent=u;document.getElementById("slink").href="stremio://"+u.replace(/^https?:\\/\\//,"");showToast("Torrentio config applied","success")}'
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
 console.log('\nHybrid Addon v7.0.0 : http://localhost:' + PORT);
 console.log('Configure: http://localhost:' + PORT + '/configure');
 console.log('Types: movie, series, anime\n');
});
