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
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
export function base64Encode(input) {
    let output = '';
    let i = 0;
    while (i < input.length) {
        const chr1 = input.charCodeAt(i++);
        const chr2 = input.charCodeAt(i++);
        const chr3 = input.charCodeAt(i++);
        const enc1 = chr1 >> 2;
        const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        let enc4 = chr3 & 63;
        if (isNaN(chr2)) {
            enc3 = 64;
            enc4 = 64;
        } else if (isNaN(chr3)) {
            enc4 = 64;
        }
        output += BASE64_CHARS.charAt(enc1) + BASE64_CHARS.charAt(enc2) + BASE64_CHARS.charAt(enc3) + BASE64_CHARS.charAt(enc4);
    }
    return output;
}
export function base64Decode(input) {
    let output = '';
    let i = 0;
    const cleaned = String(input || '').replace(/[^A-Za-z0-9+/=]/g, '');
    while (i < cleaned.length) {
        const enc1 = BASE64_CHARS.indexOf(cleaned.charAt(i++));
        const enc2 = BASE64_CHARS.indexOf(cleaned.charAt(i++));
        const enc3 = BASE64_CHARS.indexOf(cleaned.charAt(i++));
        const enc4 = BASE64_CHARS.indexOf(cleaned.charAt(i++));
        const chr1 = (enc1 << 2) | (enc2 >> 4);
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        const chr3 = ((enc3 & 3) << 6) | enc4;
        output += String.fromCharCode(chr1);
        if (enc3 !== 64) output += String.fromCharCode(chr2);
        if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    return output;
}
