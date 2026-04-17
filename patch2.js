var fs = require('fs');
var code = fs.readFileSync('index.js', 'utf8');

var oldFn = `function getSearchTitles(imdbId, type) {
    return getTitlesFromTMDb(imdbId, type).then(function(titles) {
        if (!titles) {
            return getTitleFromCinemeta(imdbId, type).then(function(name) {
                return [name];
            });
        }

        // Gom tên unique, bỏ trống
        var list = [titles.ru, titles.en, titles.original].filter(function(t) {
            return t && t.trim().length > 0;
        });

        // Loại trùng (so sánh lowercase)
        var seen = {}, unique = [];
        list.forEach(function(t) {
            var key = t.toLowerCase().trim();
            if (!seen[key]) { seen[key] = true; unique.push(t); }
        });

        console.log('[Search titles] ' + imdbId + ' → ' + JSON.stringify(unique));
        return unique;
    });
}`;

var newFn = `function getSearchTitles(imdbId, type) {
    return getTitlesFromTMDb(imdbId, type).then(function(titles) {
        if (!titles) {
            return getTitleFromCinemeta(imdbId, type).then(function(name) {
                return [name];
            });
        }

        // ✅ EN trước → RU sau (EN ra file khủng hơn trên jac.red)
        var list = [titles.en, titles.original, titles.ru].filter(function(t) {
            return t && t.trim().length > 0;
        });

        var seen = {}, unique = [];
        list.forEach(function(t) {
            var key = t.toLowerCase().trim();
            if (!seen[key]) { seen[key] = true; unique.push(t); }
        });

        console.log('[Search titles] ' + imdbId + ' → ' + JSON.stringify(unique));
        return unique;
    });
}`;

if (code.indexOf(oldFn) === -1) {
    console.log('❌ Không tìm thấy!');
    process.exit(1);
}

fs.writeFileSync('index.js.bak', code, 'utf8');
code = code.replace(oldFn, newFn);
fs.writeFileSync('index.js', code, 'utf8');
console.log('✅ Xong! EN search trước, RU search sau');
