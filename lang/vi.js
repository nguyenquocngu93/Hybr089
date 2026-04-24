module.exports = {
  addonName: '🎬 Hybrid Addon',
  addonDesc: 'Torrentio + jac.red + Knaben → TorrServer | Made with love ❤️',
  addonVersion: 'Version 6.6.2',
  addonSubtitle: 'Torrentio · jac.red · Knaben → TorrServer',

  cardTorrentioConfig: 'Torrentio Config',
  cardSources: 'Nguồn dữ liệu',
  cardTorrServer: 'TorrServer',
  cardFilter: 'Bộ lọc chung',
  cardSearch: 'Tùy chỉnh tìm kiếm',
  cardAnime: 'Anime Mode',
  cardInstall: 'Link cài đặt',

  torrentioConfigLabel: 'Dán link config Torrentio',
  torrentioConfigPlaceholder: 'https://torrentio.strem.fun/providers=yts|sort=size|.../manifest.json',
  torrentioApply: '⚡ Áp dụng',
  torrentioReset: '🔄 Reset mặc định',

  srcTorrentio: '🟢 Torrentio',
  srcTorrentioDesc: 'Tổng hợp nhiều tracker quốc tế, chất lượng cao',
  srcKnaben: '🟠 Knaben',
  srcKnabenDesc: 'Tổng hợp từ TPB, 1337x, YTS, Nyaa... (tìm kiếm tiếng Anh)',
  srcJacred: '🔴 jac.red',
  srcJacredDesc: 'Tracker Nga: RuTracker, KinoZal, NNMClub, Toloka...',
  srcJacredDomain: 'Domain jac.red',
  srcJacredDomainHint: 'Đổi domain nếu domain chính không truy cập được',

  tsUrlLabel: 'URL TorrServer',
  tsUrlPlaceholder: 'http://192.168.1.100:8090',
  tsTestBtn: '🔌 Test',
  tsHint: 'Xem torrent online không cần tải về.',
  tsHintLink: 'Tải TorrServer',
  tsTesting: '⏳ Đang kiểm tra...',
  tsOk: '✅ Kết nối thành công! TorrServer đang hoạt động.',
  tsErrEmpty: '❌ Vui lòng nhập URL TorrServer',
  tsErrTimeout: '❌ Timeout: Không kết nối được (8s)',
  tsErrFail: '❌ Lỗi: ',

  filterNote: 'Áp dụng cho jac.red, Knaben. Torrentio có cấu hình riêng.',
  filterSortLabel: 'Sắp xếp theo',
  filterSortSize: 'Dung lượng',
  filterSortSeeds: 'Seeds',
  filterSortDate: 'Mới nhất',
  filterMaxResults: 'Số kết quả tối đa',
  filterSizeLabel: '📏 Lọc dung lượng (GB)',
  filterSizeMin: 'Tối thiểu',
  filterSizeMax: 'Tối đa',
  filterSizeHint: 'Nhập số GB. Để trống tối đa = không giới hạn',
  filterQualityLabel: '🚫 Ẩn theo độ phân giải',
  filterQualityHint: 'Tick để ẩn torrent có độ phân giải tương ứng',

  preferPackLabel: '📦 Ưu tiên Pack (series)',
  preferPackDesc: 'Bật: hiện pack cả season. Tắt: chỉ tìm tập lẻ SxxExx chính xác.',

  animeModeLabel: '🎌 Bật Anime Mode',
  animeModeDesc: 'Bật khi xem anime bị chọn sai tập. Lọc file <500MB, bỏ OP/ED, đếm thứ tự.',

  installCopy: '📋 Copy',
  installBtn: '▶ Cài vào Stremio',
  installCopied: '✅ Đã copy link!',
  installCopyFail: 'Copy thủ công: ',

  generateBtn: '🔗 Tạo Link & Cập nhật',

  guideTitle: '📖 Hướng dẫn sử dụng',
  guideSteps: [
    { title: 'Cấu hình nguồn', desc: 'Bật/tắt nguồn jac.red, Torrentio, Knaben. Nhập URL TorrServer và test kết nối.' },
    { title: 'Bộ lọc', desc: 'Chọn cách sắp xếp, giới hạn số kết quả, lọc theo dung lượng và độ phân giải.' },
    { title: 'Pack / Tập lẻ', desc: 'Bật "Ưu tiên Pack" để xem cả season. Tắt để tìm đúng tập SxxExx.' },
    { title: 'Tạo link & Cài đặt', desc: 'Nhấn "Tạo Link", copy hoặc nhấn "Cài vào Stremio" để cài trực tiếp.' },
    { title: 'Anime Mode', desc: 'Bật khi xem anime bị chọn sai tập. Tự động lọc và đếm tập theo thứ tự file.' }
  ],

  footerText: 'Made by <strong>fatcatQN</strong> with <span>♥️</span> love · v6.6.2',

  streamKnaben: '🟠 Knaben',
  streamJacred: '🔴 ',
  streamTorrentio: '🔗 Torrentio',
  streamPack: '📦 PACK | ',
  streamSingleEp: '🎬 TẬP LẺ | ',

  statusTitle: '📊 Trạng thái Server',
  statusUptime: 'Uptime',
  statusMemory: 'RAM đang dùng',
  statusTmdbCache: 'TMDB Cache',
  statusTsCache: 'TorrServer Cache',
  statusHour: 'giờ',
  statusMin: 'phút',
  statusSec: 'giây',

  errMissingMagnet: 'Thiếu magnet hoặc TorrServer URL',
  errNotFound: 'Không tìm thấy torrent',
  errEpisodeNotFound: 'Không tìm thấy tập phim',
  errGeneric: 'Lỗi server'
};
