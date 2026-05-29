export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  const value = bytes / 1000 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function percent(loaded: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  return cleaned || 'download';
}
