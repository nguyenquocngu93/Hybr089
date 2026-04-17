var fs = require('fs');
var code = fs.readFileSync('index.js', 'utf8');

var oldCode = `    if (cfg.jacredEnabled) {
        getSearchTitles(imdbId, type).then(function(searchTitles) {
            console.log('[jac.red] Search titles:', searchTitles);

            // Fetch song song tất cả tên
            var fetchPromises = searchTitles.map(function(t) {
                return fetch(JAC_RED_API + '?search=' + encodeURIComponent(t), { timeout: 10000 })
                    .then(function(r) { return r.ok ? r.json() : []; })
                    .catch(function() { return []; });
            });

            return Promise.all(fetchPromises);
        }).then(function(results) {
            // Gộp và loại trùng theo magnet hash
            var seen = {}, unique = [];
            results.forEach(function(arr) {
                (arr || []).forEach(function(t) {
                    if (!t.magnet) return;
                    var h = t.magnet.match(/btih:([a-fA-F0-9]{40})/i);
                    var k = h ? h[1].toLowerCase() : t.magnet;
                    if (!seen[k]) { seen[k] = true; unique.push(t); }
                });
            });

            var jacSort   = cfg.jacredSortBy || 'size';
            var processed = unique.map(function(t) {
                return {
                    original : t,
                    title    : decodeUnicode(t.title || ''),
                    sizeGB   : parseSize(t.sizeName),
                    date     : t.createTime ? new Date(t.createTime).getTime() : 0,
                    sid      : t.sid || 0
                };
            });

            processed = sortJacredResults(processed, jacSort).slice(0, cfg.maxResults || 30);
            console.log('[jac.red] Tổng ' + unique.length + ' unique → hiển thị ' + processed.length);

            processed.forEach(function(t) {
                if (!t.original.magnet) return;
                var magnet      = t.original.magnet;
                var trackerName = getTrackerName(magnet);
                var info        = buildInfo(t, jacSort, trackerName);

                if (type === 'movie') {
                    streams.push({
                        name  : '🔗 ' + trackerName,
                        title : '📥 ' + t.title + '\\n' + info,
                        url   : ts + '/stream/' + encodeURIComponent(t.title) + '?link=' + encodeURIComponent(magnet) + '&index=0&play',
                        behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean }
                    });
                } else {
                    streams.push({
                        name  : '🔗 ' + trackerName,
                        title : '📥 ' + t.title + '\\n' + info,
                        url   : pub + '/play?magnet=' + encodeURIComponent(magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(t.title) + '&ts=' + encodeURIComponent(ts),
                        behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean }
                    });
                }
            });

            sendResponse();
        }).catch(function(e) {
            console.error('[jac.red]', e.message);
            sendResponse();
        });
    }`;

var newCode = `    if (cfg.jacredEnabled) {
        getSearchTitles(imdbId, type).then(function(searchTitles) {
            console.log('[jac.red] Search titles:', searchTitles);

            var seen = {}, unique = [];

            function searchNext(index) {
                if (index >= searchTitles.length) {
                    var jacSort   = cfg.jacredSortBy || 'size';
                    var processed = unique.map(function(t) {
                        return {
                            original : t,
                            title    : decodeUnicode(t.title || ''),
                            sizeGB   : parseSize(t.sizeName),
                            date     : t.createTime ? new Date(t.createTime).getTime() : 0,
                            sid      : t.sid || 0
                        };
                    });
                    processed = sortJacredResults(processed, jacSort).slice(0, cfg.maxResults || 30);
                    console.log('[jac.red] Tổng ' + unique.length + ' unique → hiển thị ' + processed.length);

                    processed.forEach(function(t) {
                        if (!t.original.magnet) return;
                        var magnet      = t.original.magnet;
                        var trackerName = getTrackerName(magnet);
                        var info        = buildInfo(t, jacSort, trackerName);
                        if (type === 'movie') {
                            streams.push({
                                name  : '🔗 ' + trackerName,
                                title : '📥 ' + t.title + '\\n' + info,
                                url   : ts + '/stream/' + encodeURIComponent(t.title) + '?link=' + encodeURIComponent(magnet) + '&index=0&play',
                                behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean }
                            });
                        } else {
                            streams.push({
                                name  : '🔗 ' + trackerName,
                                title : '📥 ' + t.title + '\\n' + info,
                                url   : pub + '/play?magnet=' + encodeURIComponent(magnet) + '&s=' + season + '&e=' + episode + '&title=' + encodeURIComponent(t.title) + '&ts=' + encodeURIComponent(ts),
                                behaviorHints: { notWebReady: true, bingeGroup: 'jacred-' + idClean }
                            });
                        }
                    });

                    sendResponse();
                    return;
                }

                var title = searchTitles[index];
                console.log('[jac.red] [' + (index+1) + '/' + searchTitles.length + '] Search: "' + title + '"');

                fetch(JAC_RED_API + '?search=' + encodeURIComponent(title), { timeout: 10000 })
                    .then(function(r) { return r.ok ? r.json() : []; })
                    .catch(function() { return []; })
                    .then(function(arr) {
                        var newCount = 0;
                        (arr || []).forEach(function(t) {
                            if (!t.magnet) return;
                            var h = t.magnet.match(/btih:([a-fA-F0-9]{40})/i);
                            var k = h ? h[1].toLowerCase() : t.magnet;
                            if (!seen[k]) { seen[k] = true; unique.push(t); newCount++; }
                        });
                        console.log('[jac.red] "' + title + '" → ' + (arr||[]).length + ' kết quả, +' + newCount + ' mới');
                        searchNext(index + 1);
                    });
            }

            searchNext(0);

        }).catch(function(e) {
            console.error('[jac.red]', e.message);
            sendResponse();
        });
    }`;

if (code.indexOf(oldCode) === -1) {
    console.log('❌ Không tìm thấy đoạn code cần thay!');
    process.exit(1);
}

fs.writeFileSync('index.js.bak', code, 'utf8');
console.log('💾 Đã backup → index.js.bak');

code = code.replace(oldCode, newCode);
fs.writeFileSync('index.js', code, 'utf8');
console.log('✅ Thay thành công!');
