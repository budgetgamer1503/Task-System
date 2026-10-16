import { CONFIG, TYPES } from './config.js';

export function stripFormatting(value = '') {
    return String(value).replace(/§./g, '').trim();
}

export function toPositiveInt(value, fallback = 1, max = 1000000000) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(max, parsed));
}

export function normalizeTarget(type, rawTarget) {
    const targetRaw = String(rawTarget ?? '').trim();
    if (type === TYPES.VISIT) {
        const [x, y, z] = targetRaw.split(',').map(Number);
        return { x: x || 0, y: y || 0, z: z || 0 };
    }
    if (type === TYPES.WALK) {
        return targetRaw.split(';').map(part => {
            const [x, y, z] = part.split(',').map(Number);
            return { x: x || 0, y: y || 0, z: z || 0 };
        }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    }
    return targetRaw;
}

export function normalizeObjective(objective, fallbackTask = null) {
    const type = objective?.type || fallbackTask?.type || TYPES.BLOCK;
    const targetRaw = objective?.targetRaw ?? (typeof objective?.target === 'string' ? objective.target : '') ?? fallbackTask?.targetRaw ?? '';
    const target = objective?.target !== undefined && typeof objective.target !== 'string'
        ? objective.target
        : normalizeTarget(type, targetRaw || objective?.target || fallbackTask?.target || '');
    let req = toPositiveInt(objective?.req ?? fallbackTask?.req ?? 1, 1);
    if (type === TYPES.VISIT || type === TYPES.APPROACH) req = 1;
    if (type === TYPES.WALK && Array.isArray(target)) req = Math.max(1, target.length);
    return {
        type,
        target,
        targetRaw: targetRaw || (typeof target === 'string' ? target : ''),
        req: Math.max(1, req),
        label: String(objective?.label || '').trim(),
        radius: Math.max(1, toPositiveInt(objective?.radius ?? CONFIG.PROXIMITY, CONFIG.PROXIMITY, 128))
    };
}

export function getObjectives(task) {
    if (Array.isArray(task?.objectives) && task.objectives.length > 0) {
        return task.objectives.slice(0, CONFIG.MAX_OBJECTIVES).map(obj => normalizeObjective(obj, task));
    }
    return [normalizeObjective(null, task)];
}

export function parseObjectives(raw, fallbackType, fallbackTarget, fallbackReq) {
    const text = String(raw || '').trim();
    if (!text) {
        return [normalizeObjective({ type: fallbackType, targetRaw: fallbackTarget, req: fallbackReq })];
    }
    const rows = text.split(/\r?\n/);
    const objectives = [];
    for (const row of rows) {
        if (!row.trim()) continue;
        const [typeRaw, targetRaw = '', reqRaw = '1', ...labelParts] = row.split('|');
        const type = Object.values(TYPES).includes(typeRaw.trim()) ? typeRaw.trim() : fallbackType;
        objectives.push(normalizeObjective({
            type,
            targetRaw: targetRaw.trim(),
            req: toPositiveInt(reqRaw, 1),
            label: labelParts.join('|').trim()
        }));
        if (objectives.length >= CONFIG.MAX_OBJECTIVES) break;
    }
    return objectives.length > 0
        ? objectives
        : [normalizeObjective({ type: fallbackType, targetRaw: fallbackTarget, req: fallbackReq })];
}

export function serializeObjectives(task) {
    return getObjectives(task).map(obj => [obj.type, obj.targetRaw || (typeof obj.target === 'string' ? obj.target : ''), obj.req, obj.label || ''].join('|')).join('\n');
}

export function getPrerequisites(task) {
    const list = Array.isArray(task?.prerequisites) ? task.prerequisites : [];
    const merged = [...list];
    if (task?.prereq && !merged.includes(task.prereq)) merged.push(task.prereq);
    return merged.filter(Boolean);
}

export function prerequisitesMet(data, task) {
    return getPrerequisites(task).every(id => data.completed.includes(id));
}

export function questFolder(task) {
    return String(task?.folder || stripFormatting(task?.category) || 'Uncategorized').trim() || 'Uncategorized';
}

export function taskOrder(task) {
    const value = Number(task?.order);
    return Number.isFinite(value) ? value : 0;
}

export function folderOrder(task) {
    const value = Number(task?.folderOrder);
    return Number.isFinite(value) ? value : 0;
}

export function objectiveTitle(objective, index = 0) {
    if (objective.label) return objective.label;
    const target = objective.targetRaw || (typeof objective.target === 'string' ? objective.target : 'target');
    const names = {
        block: 'Destroy', kill: 'Kill', visit: 'Visit', walk: 'Reach checkpoint', gather: 'Collect',
        level: 'Reach level', craft: 'Craft', death: 'Die', fish: 'Catch', use_item: 'Use', place: 'Place',
        distance: 'Travel', effect: 'Experience effect', approach: 'Approach'
    };
    return `${names[objective.type] || `Objective ${index + 1}`} ${target}`.trim();
}

export function slugify(value = '') {
    return stripFormatting(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'all';
}
