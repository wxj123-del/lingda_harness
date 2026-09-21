/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'connection.error': '连接异常，刷新重试',
  'connection.connecting': '重新连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在重试，点击立即重连',
  'update.title': '软件更新',
  'update.check': '检查更新',
  'update.install': '安装并重启',
  'update.current': '当前已是最新版本',
  'update.available': '发现新版本',
  'update.checking': '正在检查更新…',
  'update.installing': '正在安装更新…',
  'update.ready': '更新完成，正在重启…',
  'update.sourceReady': '更新完成，请重启应用',
  'update.error': '更新检查失败',
  'update.source': '源码仓库：检查 AtomGit 提交',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'connection.error': 'Disconnected',
  'connection.connecting': 'Reconnecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Reconnecting, reconnect now',
  'update.title': 'Software updates',
  'update.check': 'Check for updates',
  'update.install': 'Install and restart',
  'update.current': 'You are up to date',
  'update.available': 'Update available',
  'update.checking': 'Checking for updates…',
  'update.installing': 'Installing update…',
  'update.ready': 'Update installed, restarting…',
  'update.sourceReady': 'Update complete, restart the application',
  'update.error': 'Update check failed',
  'update.source': 'Source checkout: check AtomGit commits',
} satisfies Record<SettingsKey, string>
