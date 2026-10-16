export function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
export function getProgressBar(curr, max, length = 10) {
    const pct = Math.min(1, curr / Math.max(1, max));
    const fill = Math.floor(pct * length);
    return `§a${'|'.repeat(fill)}§c${'|'.repeat(length - fill)}`;
}
export function formatTime(seconds) {
    if (seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    let parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}
export function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isConsecutiveDay(dayA, dayB) {
    if (!dayA || !dayB) return false;
    const a = new Date(dayA + 'T00:00:00');
    const b = new Date(dayB + 'T00:00:00');
    const diff = Math.abs(b.getTime() - a.getTime());
    return diff === 86400000;
}
export function parseVisitTarget(raw) {
    const [x, y, z] = raw.split(',').map(Number);
    return { x, y, z };
}
export function parseWalkTarget(raw) {
    return raw.split(';').map(s => {
        const [x, y, z] = s.split(',').map(Number);
        return { x, y, z };
    });
}