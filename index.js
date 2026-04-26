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
 version: '6.7.0',
 name: '🎬 Hybrid Addon',
 description: 'Torrentio + jac.red + Knaben + Magnetz → TorrServer | Made with love ❤️',
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
 TMDB_CACHE[cacheKey + '_full'] = { year: year };
 return fetch('https://api.themoviedb.org/3/' + metaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=ru', { timeout: 120000 })
 .then(function(r) { return r.ok ? r.json() : {}; })
 .then(function(d) {
 var ruTitle = (d.title || d.name || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
 console.log('[TMDb] ' + imdbId + ' → RU:"' + ruTitle + '" (' + year + ')');
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
 var cacheKey = imdbId + '_ru';
 var tmdbData = TMDB_CACHE[cacheKey + '_full'] || {};
 var expectedYear = tmdbData.year || '';
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
 var types = t.types || [], seasons = t.seasons || [], yearNum = parseInt(t.relased || t.released || t.related || '0') || 0;
 if (type === 'movie' && (types.includes('series') || seasons.length > 0)) continue;
 if (type === 'series' && types.includes('movie') && seasons.length === 0) continue;
 
 if (expectedYear && yearNum > 1900) {
 var diff = Math.abs(yearNum - parseInt(expectedYear));
 if (diff > 2) {
 console.log('[jac.red] ⏭️ Bỏ qua vì năm ' + yearNum + ' không khớp ±2 năm với ' + expectedYear);
 continue;
 }
 }
 
 seen.set(key, true);
 var qualityText = ''; if (t.quality === 2160) qualityText = '4K'; else if (t.quality === 1080) qualityText = '1080p'; else if (t.quality === 720) qualityText = '720p'; else if (t.quality === 480) qualityText = '480p'; else if (t.quality) qualityText = t.quality + 'p';
 var videoType = ''; if (t.videotype) { var vt = t.videotype.toLowerCase(); if (vt.includes('hdr') || vt.includes('dolby')) videoType = 'HDR'; else if (vt.includes('sdr')) videoType = 'SDR'; }
 var audio = ''; if (t.voice && Array.isArray(t.voice) && t.voice.length > 0) audio = t.voice.filter(function(v){return v;}).join('/');
 unique.push({ original: t, title: decodeUnicode(t.title || ''), sizeGB: parseSize(t.sizeName || t.size), date: t.createdTime ? new Date(t.createdTime).getTime() : 0, sid: t.sid || t.seeds || t.seeders || 0, tracker: t.tracker || 'Unknown', magnet: t.magnet, quality: qualityText, videoType: videoType, audio: audio, year: yearNum });
 newCount++;
 }
 }
 console.log('[jac.red] ' + sourceName + ' → ' + arr.length + ' kết quả, +' + newCount + ' unique');
 return newCount;
 }
 
 var promises = [];
 if (ruTitle) promises.push(fetch(apiUrl + '?search=' + encodeURIComponent(ruTitle), { timeout: 120000 }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }).then(function(arr) { addResults(arr, 'RU "' + ruTitle + '"'); }));
 promises.push(fetch(apiUrl + '?search=' + encodeURIComponent(imdbId), { timeout: 120000 }).then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }).then(function(arr) { addResults(arr, 'IMDb "' + imdbId + '"'); }));
 
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
    var finalQuery = query;
    if (type === 'series' && !preferPack && season && episode) {
        var s = String(season).padStart(2, '0');
        var e = String(episode).padStart(2, '0');
        finalQuery = query + ' S' + s + 'E' + e;
    }
    var baseUrl = MAGNETZ_BASE_URL + "?query=" + encodeURIComponent(finalQuery) + "&sort=" + sortParam;
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
 var metaType = (type === 'series') ? 'tv' : 'movie';
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
 
 // Lọc season cho Knaben Pack
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
 var streamName = '🟠 ' + t.tracker;
 var badge = '';
 if (type === 'series') badge = isPack ? '📦 PACK | ' : '🎬 TẬP LẺ | ';
 var displayTitle = badge + title + '\n' + sizeGB + ' GB | 🌱 ' + t.seeds + ' seeds\n📡 ' + t.tracker;
 
 if (type === 'movie') {
 streams.push({ name: streamName, title: displayTitle, url: ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 } else {
 var url = isPack
 ? pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(title) + '&ts=' + encodeURIComponent(ts)
 : ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play';
 streams.push({ name: streamName, title: displayTitle, url: url, behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 }
 });
 sendResponse();
 }).catch(function() { sendResponse(); });
 }
 
 // ===================== MAGNETZ =====================
 if (cfg.magnetzEnabled) {
 var metaType2 = (type === 'series') ? 'tv' : 'movie';
 Promise.all([
 getRuTitleFromTMDb(imdbId, type),
 getOriginalTitleFromTMDb(imdbId, type)
 ]).then(function(titles) {
 var originalTitle = titles[1];
 var query = originalTitle || imdbId;
 console.log('[Magnetz] Search: "' + query + '"');
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
 
 // Lọc season cho Magnetz Pack - logic giống Knaben
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
 var streamName = '🟢 ' + t.tracker;
 var badge = '';
 if (type === 'series') badge = isPack ? '📦 PACK | ' : '🎬 TẬP LẺ | ';
 var displayTitle = badge + title + '\n' + sizeGB + ' GB | 🌱 ' + t.seeds + ' seeds\n📡 ' + t.tracker;
 
 if (type === 'movie') {
 streams.push({ name: streamName, title: displayTitle, url: ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
 } else {
 var url = isPack
 ? pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(title) + '&ts=' + encodeURIComponent(ts)
 : ts + '/stream/' + encodeURIComponent(title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play';
 streams.push({ name: streamName, title: displayTitle, url: url, behaviorHints: { notWebReady: true, bingeGroup: t.source + '-' + idClean } });
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
 var completePackPattern = /S\d{1,2}[-~]S?\d{1,2}|Season\s*\d+\s*[-~]\s*\d+|сезон[ы]?\s*\d+\s*[-~]\s*\d+|Complete|Полный|Все\s*сезон[ы]?|1-\d+\s*сезон/i;
 var isCompletePack = completePackPattern.test(title);
 if (!isCompletePack) {
 var singleSeasonPattern = new RegExp('S' + sPad + '(?:[^\\d]|$)|Season\\s*' + season + '(?:[^\\d]|$)|сезон\\s*' + season + '(?:[^\\d]|$)|' + season + '\\s*сезон', 'i');
 var otherSeasonPattern = /S\d{1,2}(?:[^\d]|$)|Season\s*\d|сезон\s*\d|\d+\s*сезон/gi;
 var hasOtherSeason = false;
 var matches = title.match(otherSeasonPattern);
 if (matches) {
 for (var i = 0; i < matches.length; i++) {
 if (!singleSeasonPattern.test(matches[i])) {
 var otherSeasonMatch = matches[i].match(/\d+/);
 if (otherSeasonMatch && parseInt(otherSeasonMatch[0]) !== season) {
 hasOtherSeason = true; break;
 }
 }
 }
 }
 if (hasOtherSeason) return;
 if (!singleSeasonPattern.test(title) && /S\d{1,2}|Season\s*\d|сезон\s*\d/.test(title)) return;
 }
 }
 
 var trackerDisplay = t.tracker.charAt(0).toUpperCase() + t.tracker.slice(1);
 var sizeGB = t.sizeGB.toFixed(2), seeds = t.sid, quality = t.quality || '', videoType = t.videoType || '', audio = t.audio || '';
 var streamName = '🔴 ' + trackerDisplay;
 var streamTitle = t.title + '\n' + sizeGB + ' GB | 🌱 ' + seeds + ' seeds';
 if (quality) { streamTitle += ' | 🎬 ' + quality; if (videoType) streamTitle += ' ' + videoType; }
 if (audio) streamTitle += ' | 🔊 ' + audio;
 streamTitle += '\n📡 ' + trackerDisplay;
 
 if (type === 'movie') streams.push({ name: streamName, title: streamTitle, url: ts + '/stream/' + encodeURIComponent(t.title) + '?link=' + encodeURIComponent(t.magnet) + '&index=0&play', behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean } });
 else streams.push({ name: streamName, title: streamTitle, url: pub + '/play?magnet=' + encodeURIComponent(t.magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(t.title) + '&ts=' + encodeURIComponent(ts), behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean } });
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

// ===================== CONFIG PAGE =====================
function buildConfigPage(cfg, configStr, pub) {
 var installUrl = pub + (configStr ? '/' + configStr : '') + '/manifest.json';
 var stremioUrl = 'stremio://' + installUrl.replace(/^https?:\/\//, '');
 var githubLink = 'https://github.com/nguyenquocngu93/Hybrid-';
 var commonSort = cfg.commonSortBy || 'size';
 var jacredDomain = cfg.jacredDomain || DEFAULT_JACRED_DOMAIN;
 var sizeMinGB = cfg.sizeMinGB !== undefined ? cfg.sizeMinGB : 0;
 var sizeMaxGB = cfg.sizeMaxGB !== undefined ? cfg.sizeMaxGB : 100;
 var domainOptions = '';
 for (var key in JAC_RED_DOMAINS) domainOptions += '<option value="' + key + '"' + (jacredDomain === key ? ' selected' : '') + '>' + key + '</option>';
 
 var html = '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hybrid Addon v6.7.0</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#080812;--bg2:#0d0d1f;--bg3:#12122a;--card:#141428;--border:#1e1e40;--border2:#2a2a50;--text:#e8e8f0;--text2:#9090b0;--text3:#5a5a80;--primary:#7c6df8;--primary2:#9d8fff;--green:#22d3a5;--green2:#10b981;--red:#f87171;--yellow:#fbbf24;--blue:#60a5fa;--grad1:linear-gradient(135deg,#7c6df8,#a855f7);--grad2:linear-gradient(135deg,#22d3a5,#059669);--grad3:linear-gradient(135deg,#f87171,#ef4444);--radius:14px;--radius2:10px;--radius3:8px;--shadow:0 4px 24px rgba(0,0,0,.4)}body{font-family:"Inter",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px 16px 48px;line-height:1.6}.wrap{max-width:640px;margin:0 auto}.header{text-align:center;margin-bottom:32px;padding:32px 24px;background:var(--card);border:1px solid var(--border);border-radius:20px;position:relative;overflow:hidden}.header::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at top,rgba(124,109,248,.15),transparent 60%);pointer-events:none}.header h1{font-size:26px;font-weight:700;background:var(--grad1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-.5px;margin-bottom:6px}.header p{color:var(--text2);font-size:13px;font-weight:400}.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(124,109,248,.15);border:1px solid rgba(124,109,248,.3);border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;color:var(--primary2);margin-top:10px;letter-spacing:.5px}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:12px;transition:border-color .2s}.card:hover{border-color:var(--border2)}.card-header{display:flex;align-items:center;gap:8px;margin-bottom:16px}.card-header h2{font-size:14px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.8px}.card-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}.ci-purple{background:rgba(124,109,248,.2)}.ci-green{background:rgba(34,211,165,.2)}.ci-red{background:rgba(248,113,113,.2)}.ci-yellow{background:rgba(251,191,36,.2)}.ci-blue{background:rgba(96,165,250,.2)}.fg{margin-bottom:14px}.fg:last-child{margin-bottom:0}.fg label{display:block;color:var(--text2);font-size:12px;font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}input[type=text],input[type=number],textarea,select{width:100%;padding:11px 14px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius3);color:var(--text);font-size:14px;font-family:"Inter",sans-serif;transition:border-color .2s,box-shadow .2s;outline:none}input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(124,109,248,.15)}textarea{resize:vertical;min-height:72px;font-family:"JetBrains Mono",monospace;font-size:12px}select option{background:var(--bg2)}.trow{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}.trow:last-of-type{border:none;padding-bottom:0}.trow-info{flex:1;min-width:0}.trow-info .trow-label{font-size:15px;font-weight:500;color:var(--text)}.trow-info .trow-sub{font-size:12px;color:var(--text3);margin-top:2px}.sw{position:relative;width:46px;height:26px;flex-shrink:0}.sw input{opacity:0;width:0;height:0}.sl{position:absolute;inset:0;background:var(--border2);border-radius:26px;cursor:pointer;transition:.25s}.sl::before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 4px rgba(0,0,0,.3)}input:checked+.sl{background:var(--primary)}input:checked+.sl::before{transform:translateX(20px)}.btn{padding:11px 18px;border:none;border-radius:var(--radius3);font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .2s;font-family:"Inter",sans-serif;white-space:nowrap}.btn:hover{filter:brightness(1.1);transform:translateY(-1px)}.btn:active{transform:translateY(0)}.btn-ghost{background:var(--bg2);border:1px solid var(--border2);color:var(--text2)}.btn-primary{background:var(--grad1);color:#fff;box-shadow:0 4px 15px rgba(124,109,248,.3)}.btn-green{background:var(--grad2);color:#fff;box-shadow:0 4px 15px rgba(34,211,165,.3)}.btn-full{width:100%}.btn-sm{padding:8px 14px;font-size:12px;border-radius:6px}.btn-row{display:flex;gap:8px;margin-top:8px}.sort-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}.sort-btn{padding:14px 8px;background:var(--bg2);border:2px solid var(--border2);border-radius:var(--radius3);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all .2s;font-family:"Inter",sans-serif}.sort-btn:hover{border-color:var(--primary);color:var(--text)}.sort-btn.active{border-color:var(--primary);background:rgba(124,109,248,.15);color:var(--primary2)}.sort-btn .sort-icon{font-size:18px;display:block;margin-bottom:4px}.qf-grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.qf-label{display:flex;align-items:center;gap:6px;padding:7px 12px;background:var(--bg2);border:1.5px solid var(--border2);border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s;user-select:none}.qf-label:hover{border-color:var(--primary);color:var(--text)}.qf-label input[type=checkbox]{width:14px;height:14px;accent-color:var(--primary);cursor:pointer}.qf-label.active-qf{border-color:var(--red);background:rgba(248,113,113,.1);color:var(--red)}.url-box{background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius3);padding:12px 14px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--blue);word-break:break-all;margin:14px 0;line-height:1.6}.info-box{background:rgba(124,109,248,.06);border-left:3px solid var(--primary);border-radius:0 var(--radius3) var(--radius3) 0;padding:10px 14px;margin-bottom:14px}.info-box p{color:var(--text2);font-size:13px;line-height:1.6;margin-bottom:2px}.info-box p:last-child{margin-bottom:0}.info-box strong{color:var(--text)}.test-result{margin-top:8px;padding:8px 12px;border-radius:6px;font-size:12px;font-family:"Inter",sans-serif;display:none}.test-result.ok{background:rgba(34,211,165,.1);color:var(--green);border:1px solid rgba(34,211,165,.3)}.test-result.err{background:rgba(248,113,113,.1);color:var(--red);border:1px solid rgba(248,113,113,.3)}.test-result.loading{background:rgba(124,109,248,.1);color:var(--primary2);border:1px solid rgba(124,109,248,.3)}.install-row{display:grid;grid-template-columns:auto 1fr;gap:8px}.guide{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-top:8px}.guide h3{font-size:13px;font-weight:600;color:var(--primary2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px}.step-item{display:flex;gap:12px;margin-bottom:14px}.step-item:last-child{margin-bottom:0}.step-num{width:24px;height:24px;border-radius:50%;background:rgba(124,109,248,.2);color:var(--primary2);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}.step-content{flex:1}.step-content strong{font-size:13px;color:var(--text);display:block;margin-bottom:4px}.step-content p{font-size:13px;color:var(--text3);line-height:1.6}.gen-wrap{margin:16px 0}.footer{text-align:center;margin-top:32px;padding:20px;color:var(--text3);font-size:13px;border-top:1px solid var(--border)}.footer span{color:var(--red)}.footer a{color:var(--primary2);text-decoration:none}.footer a:hover{text-decoration:underline}.hint{font-size:12px;color:var(--text3);margin-top:5px;line-height:1.5}.hint a{color:var(--primary2);text-decoration:none}.hint a:hover{text-decoration:underline}.divider{height:1px;background:var(--border);margin:14px 0}.tag{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;letter-spacing:.4px}.tag-green{background:rgba(34,211,165,.15);color:var(--green);border:1px solid rgba(34,211,165,.25)}.tag-red{background:rgba(248,113,113,.15);color:var(--red);border:1px solid rgba(248,113,113,.25)}.tag-yellow{background:rgba(251,191,36,.15);color:var(--yellow);border:1px solid rgba(251,191,36,.25)}</style></head><body><div class="wrap"><div class="header"><h1>🎬 Hybrid Addon</h1><p>Torrentio · jac.red · Knaben · Magnetz → TorrServer</p><div class="badge">✨ Version 6.7.0</div></div><div class="card"><div class="card-header"><div class="card-icon ci-green">🔗</div><h2>Torrentio Config</h2></div><div class="fg"><label>Dán link config Torrentio</label><textarea id="configLink" placeholder="https://torrentio.strem.fun/providers=yts|sort=size|.../manifest.json"></textarea></div><div class="btn-row"><button class="btn btn-ghost" style="flex:1" onclick="applyTorrentioConfig()">⚡ Áp dụng</button><button class="btn btn-ghost" style="flex:1" onclick="resetTorrentioConfig()">🔄 Reset mặc định</button></div></div><div class="card"><div class="card-header"><div class="card-icon ci-purple">📡</div><h2>Nguồn dữ liệu</h2></div><div class="trow"><div class="trow-info"><div class="trow-label">🟢 Torrentio</div><div class="trow-sub">Tổng hợp nhiều tracker quốc tế, chất lượng cao</div></div><label class="sw"><input type="checkbox" id="torrentioEnabled"' + (cfg.torrentioEnabled ? ' checked' : '') + '><span class="sl"></span></label></div><div class="trow"><div class="trow-info"><div class="trow-label">🟠 Knaben</div><div class="trow-sub">Tổng hợp từ TPB, 1337x, YTS, Nyaa...</div></div><label class="sw"><input type="checkbox" id="knabenEnabled"' + (cfg.knabenEnabled ? ' checked' : '') + '><span class="sl"></span></label></div><div class="trow"><div class="trow-info"><div class="trow-label">🟢 Magnetz</div><div class="trow-sub">Công cụ tìm kiếm torrent quốc tế</div></div><label class="sw"><input type="checkbox" id="magnetzEnabled"' + (cfg.magnetzEnabled ? ' checked' : '') + '><span class="sl"></span></label></div><div class="trow"><div class="trow-info"><div class="trow-label">🔴 jac.red</div><div class="trow-sub">Tracker Nga: RuTracker, KinoZal, NNMClub, Toloka...</div></div><label class="sw"><input type="checkbox" id="jacredEnabled"' + (cfg.jacredEnabled ? ' checked' : '') + '><span class="sl"></span></label></div><div class="divider"></div><div class="fg" style="margin-top:14px"><label>Domain jac.red</label><select id="jacredDomain">' + domainOptions + '</select><p class="hint">Đổi domain nếu domain chính không truy cập được</p></div></div><div class="card"><div class="card-header"><div class="card-icon ci-blue">🖥</div><h2>TorrServer</h2></div><div class="fg"><label>URL TorrServer</label><div style="display:flex;gap:8px;align-items:center"><input type="text" id="tsUrl" value="' + (cfg.torrServerUrl || '') + '" placeholder="http://192.168.1.100:8090" style="flex:1"><button class="btn btn-ghost btn-sm" onclick="testTorrServer()">🔌 Test</button></div><div id="tsTestResult" class="test-result"></div><p class="hint">Xem torrent online không cần tải về. <a href="https://github.com/YouROK/TorrServer" target="_blank">Tải TorrServer</a></p></div></div><div class="card"><div class="card-header"><div class="card-icon ci-yellow">⚙️</div><h2>Bộ lọc chung</h2></div><p style="font-size:11px;color:var(--text3);margin-bottom:16px">Áp dụng cho jac.red, Knaben, Magnetz. Torrentio có cấu hình riêng.</p><div class="fg"><label>Sắp xếp theo</label><div class="sort-grid"><div class="sort-btn' + (commonSort === 'size' ? ' active' : '') + '" onclick="setCommonSort(\'size\',this)"><span class="sort-icon">💾</span>Dung lượng</div><div class="sort-btn' + (commonSort === 'seeds' ? ' active' : '') + '" onclick="setCommonSort(\'seeds\',this)"><span class="sort-icon">👥</span>Seeds</div><div class="sort-btn' + (commonSort === 'date' ? ' active' : '') + '" onclick="setCommonSort(\'date\',this)"><span class="sort-icon">📅</span>Mới nhất</div></div><input type="hidden" id="commonSort" value="' + commonSort + '"></div><div class="fg"><label>Số kết quả tối đa</label><input type="number" id="maxResults" value="' + (cfg.maxResults || 30) + '" min="5" max="100"></div><div class="fg"><label>📏 Lọc dung lượng (GB)</label><div style="display:flex;gap:8px"><input type="number" id="minSize" placeholder="Tối thiểu" value="' + (cfg.sizeMinGB || '') + '" style="flex:1" step="0.5" min="0"><input type="number" id="maxSize" placeholder="Tối đa" value="' + (cfg.sizeMaxGB || '') + '" style="flex:1" step="0.5" min="0"></div><p class="hint" style="margin-top:4px">Nhập số GB. Để trống tối đa = không giới hạn</p></div><div class="fg"><label>🚫 Ẩn theo độ phân giải</label><div class="qf-grid"><label class="qf-label" id="qfl-480p"><input type="checkbox" value="480p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('480p') ? 'checked' : '') + ' onchange="updateQfLabel(this)"> 480p</label><label class="qf-label" id="qfl-720p"><input type="checkbox" value="720p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('720p') ? 'checked' : '') + ' onchange="updateQfLabel(this)"> 720p</label><label class="qf-label" id="qfl-1080p"><input type="checkbox" value="1080p" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('1080p') ? 'checked' : '') + ' onchange="updateQfLabel(this)"> 1080p</label><label class="qf-label" id="qfl-4K"><input type="checkbox" value="4K" ' + (cfg.commonQualityFilter && cfg.commonQualityFilter.includes('4K') ? 'checked' : '') + ' onchange="updateQfLabel(this)"> 4K</label></div><p class="hint">Tick để ẩn torrent có độ phân giải tương ứng</p></div></div><div class="card"><div class="card-header"><div class="card-icon ci-purple">🔍</div><h2>Tùy chỉnh tìm kiếm</h2></div><div class="trow"><div class="trow-info"><div class="trow-label">📦 Ưu tiên Pack</div><div class="trow-sub">Tắt để tìm tập lẻ chính xác (SxxExx)</div></div><label class="sw"><input type="checkbox" id="preferPack"' + (cfg.preferPack !== false ? ' checked' : '') + '><span class="sl"></span></label></div></div><div class="card"><div class="card-header"><div class="card-icon ci-red">🎌</div><h2>Anime Mode</h2></div><div class="trow"><div class="trow-info"><div class="trow-label">🎌 Bật Anime Mode</div><div class="trow-sub">Bật khi xem anime bị chọn sai tập. Lọc file <500MB, bỏ OP/ED, đếm thứ tự.</div></div><label class="sw"><input type="checkbox" id="animeMode"' + (cfg.animeMode ? ' checked' : '') + '><span class="sl"></span></label></div></div><div class="card"><div class="card-header"><div class="card-icon ci-green">📦</div><h2>Link cài đặt</h2></div><div class="url-box" id="iurl">' + installUrl + '</div><div class="install-row"><button class="btn btn-ghost" onclick="copyUrl()">📋 Copy</button><a class="btn btn-green" href="' + stremioUrl + '" id="slink">▶ Cài vào Stremio</a></div></div><div class="gen-wrap"><button class="btn btn-primary btn-full" style="padding:16px;font-size:15px;border-radius:var(--radius)" onclick="gen()">🔗 Tạo Link & Cập nhật</button></div><div class="guide"><h3>📖 Hướng dẫn sử dụng</h3><div class="step-item"><div class="step-num">1</div><div class="step-content"><strong>Cấu hình nguồn</strong><p>Bật/tắt nguồn jac.red, Torrentio, Knaben, Magnetz. Nhập URL TorrServer và test kết nối.</p></div></div><div class="step-item"><div class="step-num">2</div><div class="step-content"><strong>Bộ lọc</strong><p>Chọn cách sắp xếp, giới hạn số kết quả, lọc theo dung lượng và độ phân giải.</p></div></div><div class="step-item"><div class="step-num">3</div><div class="step-content"><strong>Tùy chỉnh tìm kiếm</strong><p>Chọn ưu tiên Pack hoặc tìm tập lẻ.</p></div></div><div class="step-item"><div class="step-num">4</div><div class="step-content"><strong>Tạo link & Cài đặt</strong><p>Nhấn "Tạo Link", copy hoặc nhấn "Cài vào Stremio" để cài trực tiếp.</p></div></div><div class="step-item"><div class="step-num">5</div><div class="step-content"><strong>Anime Mode</strong><p>Bật khi xem anime bị chọn sai tập. Tự động lọc và đếm tập theo thứ tự file.</p></div></div></div><div class="footer">Made by <strong>fatcatQN</strong> with <span>♥️</span> love · v6.7.0</div></div><script>var currentConfig=' + JSON.stringify({ providers: cfg.providers, sortBy: cfg.sortBy, language: cfg.language, qualityfilter: cfg.qualityfilter }) + ';function updateQfLabel(cb){var lbl=cb.closest("label");if(cb.checked)lbl.classList.add("active-qf");else lbl.classList.remove("active-qf")}document.querySelectorAll(".qf-label input[type=checkbox]").forEach(function(cb){updateQfLabel(cb)});function setCommonSort(v,el){document.getElementById("commonSort").value=v;document.querySelectorAll(".sort-btn").forEach(function(b){b.classList.remove("active")});el.classList.add("active")}function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"")}function parseTorrentioLink(link){try{var u=new URL(link.replace("stremio://","https://"));var m=u.pathname.match(/\\/([^\\/]+)\\/manifest\\.json/);if(!m)return null;var p=m[1].split("|");var c={providers:[],sortBy:"size",language:"",qualityfilter:[]};p.forEach(function(x){var kv=x.split("=");var k=kv[0],v=kv[1];if(k==="providers")c.providers=v.split(",");else if(k==="sort")c.sortBy=v;else if(k==="language")c.language=v;else if(k==="qualityfilter")c.qualityfilter=v.split(",")});return c}catch(e){return null}}function applyTorrentioConfig(){var l=document.getElementById("configLink").value.trim();if(!l)return alert("Vui lòng dán link config!");var c=parseTorrentioLink(l);if(!c)return alert("Link không hợp lệ!");currentConfig=c;gen()}function resetTorrentioConfig(){currentConfig=' + JSON.stringify(DEFAULT_TORRENTIO_CONFIG) + ';document.getElementById("configLink").value="";gen()}function getCurrentConfig(){var qualityFilter=Array.from(document.querySelectorAll(".qf-grid input[type=checkbox]:checked")).map(function(c){return c.value});return Object.assign({torrServerUrl:document.getElementById("tsUrl").value.trim(),jacredEnabled:document.getElementById("jacredEnabled").checked,torrentioEnabled:document.getElementById("torrentioEnabled").checked,knabenEnabled:document.getElementById("knabenEnabled").checked,magnetzEnabled:document.getElementById("magnetzEnabled").checked,commonSortBy:document.getElementById("commonSort").value,maxResults:parseInt(document.getElementById("maxResults").value)||30,jacredDomain:document.getElementById("jacredDomain").value,animeMode:document.getElementById("animeMode").checked,preferPack:document.getElementById("preferPack").checked,commonQualityFilter:qualityFilter,sizeMinGB:parseFloat(document.getElementById("minSize").value)||0,sizeMaxGB:parseFloat(document.getElementById("maxSize").value)||100},currentConfig)}function copyUrl(){var url=document.getElementById("iurl").textContent;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){alert("✅ Đã copy link!")}).catch(function(){fallbackCopy(url)})}else{fallbackCopy(url)}}function fallbackCopy(text){var ta=document.createElement("textarea");ta.value=text;ta.style.cssText="position:fixed;top:-9999px;left:-9999px";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");alert("✅ Đã copy link!")}catch(e){alert("Copy thủ công: "+text)}document.body.removeChild(ta)}function gen(){var c=getCurrentConfig();var e=enc(c);var u=location.protocol+"//"+location.host+"/"+e+"/manifest.json";document.getElementById("iurl").textContent=u;document.getElementById("slink").href="stremio://"+u.replace(/^https?:\\/\\//,"")}async function testTorrServer(){var url=document.getElementById("tsUrl").value.trim();var rd=document.getElementById("tsTestResult");if(!url){rd.className="test-result err";rd.style.display="block";rd.textContent="❌ Vui lòng nhập URL TorrServer";return}if(!url.match(/^https?:\\/\\//))url="http://"+url;rd.className="test-result loading";rd.style.display="block";rd.textContent="⏳ Đang kiểm tra...";try{var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort()},8000);var r=await fetch(url+"/echo",{signal:ctrl.signal});clearTimeout(tid);if(r.ok){rd.className="test-result ok";rd.textContent="✅ Kết nối thành công! TorrServer đang hoạt động."}else throw new Error("HTTP "+r.status)}catch(e){rd.className="test-result err";rd.textContent=e.name==="AbortError"?"❌ Timeout: Không kết nối được (8s)":"❌ Lỗi: "+e.message}}</script></body></html>';
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
 console.log('\n✅ Hybrid Addon v6.7.0: http://localhost:' + PORT);
 console.log('⚙️ Configure: http://localhost:' + PORT + '/configure');
 console.log('🎌 Anime Mode:', DEFAULT_CONFIG.animeMode ? 'ON' : 'OFF');
 console.log('🟠 Knaben:', DEFAULT_CONFIG.knabenEnabled ? 'ON' : 'OFF');
 console.log('🟢 Magnetz:', DEFAULT_CONFIG.magnetzEnabled ? 'ON' : 'OFF');
 console.log('📦 Prefer Pack:', DEFAULT_CONFIG.preferPack ? 'ON' : 'OFF');
 console.log('🌐 Knaben search language: English (default)');
 console.log('❤️ Made with love\n');
});
