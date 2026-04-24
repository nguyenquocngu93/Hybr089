module.exports = {
  addonName: '🎬 Hybrid Addon',
  addonDesc: 'Torrentio + jac.red + Knaben → TorrServer | Made with love ❤️',
  addonVersion: 'Version 6.6.2',
  addonSubtitle: 'Torrentio · jac.red · Knaben → TorrServer',

  cardTorrentioConfig: 'Torrentio Config',
  cardSources: 'Data Sources',
  cardTorrServer: 'TorrServer',
  cardFilter: 'Common Filters',
  cardSearch: 'Search Settings',
  cardAnime: 'Anime Mode',
  cardInstall: 'Install Link',

  torrentioConfigLabel: 'Paste Torrentio config link',
  torrentioConfigPlaceholder: 'https://torrentio.strem.fun/providers=yts|sort=size|.../manifest.json',
  torrentioApply: '⚡ Apply',
  torrentioReset: '🔄 Reset to default',

  srcTorrentio: '🟢 Torrentio',
  srcTorrentioDesc: 'Aggregates many international trackers, high quality',
  srcKnaben: '🟠 Knaben',
  srcKnabenDesc: 'Aggregates TPB, 1337x, YTS, Nyaa... (English search)',
  srcJacred: '🔴 jac.red',
  srcJacredDesc: 'Russian trackers: RuTracker, KinoZal, NNMClub, Toloka...',
  srcJacredDomain: 'jac.red Domain',
  srcJacredDomainHint: 'Change domain if main domain is not accessible',

  tsUrlLabel: 'TorrServer URL',
  tsUrlPlaceholder: 'http://192.168.1.100:8090',
  tsTestBtn: '🔌 Test',
  tsHint: 'Stream torrents online without downloading.',
  tsHintLink: 'Download TorrServer',
  tsTesting: '⏳ Testing connection...',
  tsOk: '✅ Connected! TorrServer is running.',
  tsErrEmpty: '❌ Please enter TorrServer URL',
  tsErrTimeout: '❌ Timeout: Could not connect (8s)',
  tsErrFail: '❌ Error: ',

  filterNote: 'Applies to jac.red and Knaben. Torrentio has its own config.',
  filterSortLabel: 'Sort by',
  filterSortSize: 'Size',
  filterSortSeeds: 'Seeds',
  filterSortDate: 'Newest',
  filterMaxResults: 'Max results',
  filterSizeLabel: '📏 Filter by size (GB)',
  filterSizeMin: 'Minimum',
  filterSizeMax: 'Maximum',
  filterSizeHint: 'Enter GB. Leave max empty = no limit',
  filterQualityLabel: '🚫 Hide by resolution',
  filterQualityHint: 'Check to hide torrents with that resolution',

  preferPackLabel: '📦 Prefer Pack (series)',
  preferPackDesc: 'On: show full season packs. Off: find exact episode SxxExx only.',

  animeModeLabel: '🎌 Enable Anime Mode',
  animeModeDesc: 'Enable if anime episodes are selected incorrectly. Filters <500MB files, removes OP/ED.',

  installCopy: '📋 Copy',
  installBtn: '▶ Install to Stremio',
  installCopied: '✅ Link copied!',
  installCopyFail: 'Copy manually: ',

  generateBtn: '🔗 Generate Link & Update',

  guideTitle: '📖 How to use',
  guideSteps: [
    { title: 'Configure sources', desc: 'Enable/disable jac.red, Torrentio, Knaben. Enter TorrServer URL and test connection.' },
    { title: 'Filters', desc: 'Choose sort order, limit results, filter by size and resolution.' },
    { title: 'Pack / Single Episode', desc: 'Enable Prefer Pack to watch full season. Disable to find exact SxxExx episode.' },
    { title: 'Generate & Install', desc: 'Click Generate Link, copy or click Install to Stremio to install directly.' },
    { title: 'Anime Mode', desc: 'Enable if anime episodes are selected wrong. Auto filters and counts by file order.' }
  ],

  footerText: 'Made by <strong>fatcatQN</strong> with <span>♥️</span> love · v6.6.2',

  streamKnaben: '🟠 Knaben',
  streamJacred: '🔴 ',
  streamTorrentio: '🔗 Torrentio',
  streamPack: '📦 PACK | ',
  streamSingleEp: '🎬 EP | ',

  statusTitle: '📊 Server Status',
  statusUptime: 'Uptime',
  statusMemory: 'Memory used',
  statusTmdbCache: 'TMDB Cache',
  statusTsCache: 'TorrServer Cache',
  statusHour: 'h',
  statusMin: 'm',
  statusSec: 's',

  errMissingMagnet: 'Missing magnet or TorrServer URL',
  errNotFound: 'Torrent not found',
  errEpisodeNotFound: 'Episode not found',
  errGeneric: 'Server error'
};
