import { world } from '@minecraft/server';
import { CONFIG } from './config.js';

export class BackupManager {
    constructor(db, parties, bounties) {
        this.db = db;
        this.parties = parties;
        this.bounties = bounties;
        this.meta = [];
    }

    load() {
        try {
            const raw = world.getDynamicProperty(CONFIG.DB_KEY_BACKUPS);
            this.meta = raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn('[QuestSystem] Backup metadata load error:', e);
            this.meta = [];
        }
    }

    saveMeta() {
        world.setDynamicProperty(CONFIG.DB_KEY_BACKUPS, JSON.stringify(this.meta));
    }

    collectPlayerProperties() {
        const result = {};
        try {
            const ids = typeof world.getDynamicPropertyIds === 'function' ? world.getDynamicPropertyIds() : [];
            for (const key of ids) {
                if (key.startsWith(`${CONFIG.DB_KEY_PLAYERS}_`)) result[key] = world.getDynamicProperty(key);
            }
        } catch (e) { }
        return result;
    }

    create(label = 'Manual Backup') {
        const id = `bk_${Date.now().toString(36)}`;
        const payload = JSON.stringify({
            createdAt: Date.now(),
            core: this.db.exportCore(),
            parties: this.parties.exportData(),
            bounties: this.bounties.exportData(),
            playerProperties: this.collectPlayerProperties()
        });
        const chunks = [];
        for (let i = 0; i < payload.length; i += CONFIG.BACKUP_CHUNK_SIZE) chunks.push(payload.slice(i, i + CONFIG.BACKUP_CHUNK_SIZE));
        chunks.forEach((chunk, index) => world.setDynamicProperty(`ts_backup_${id}_${index}`, chunk));
        this.meta.unshift({ id, label: String(label).slice(0, 50), createdAt: Date.now(), chunks: chunks.length, bytes: payload.length });
        while (this.meta.length > CONFIG.MAX_BACKUPS) this.delete(this.meta[this.meta.length - 1].id, false);
        this.saveMeta();
        return this.meta[0];
    }

    read(id) {
        const meta = this.meta.find(entry => entry.id === id);
        if (!meta) throw new Error('Backup not found.');
        let payload = '';
        for (let i = 0; i < meta.chunks; i++) payload += world.getDynamicProperty(`ts_backup_${id}_${i}`) || '';
        return JSON.parse(payload);
    }

    restore(id) {
        const snapshot = this.read(id);
        try {
            for (const key of world.getDynamicPropertyIds()) {
                if (key.startsWith(`${CONFIG.DB_KEY_PLAYERS}_`)) world.setDynamicProperty(key, undefined);
            }
        } catch (e) { }
        this.db.importCore(snapshot.core || {});
        this.parties.importData(snapshot.parties || []);
        this.bounties.importData(snapshot.bounties || []);
        for (const [key, value] of Object.entries(snapshot.playerProperties || {})) world.setDynamicProperty(key, value);
        return true;
    }

    delete(id, save = true) {
        const meta = this.meta.find(entry => entry.id === id);
        if (!meta) return false;
        for (let i = 0; i < meta.chunks; i++) world.setDynamicProperty(`ts_backup_${id}_${i}`, undefined);
        this.meta = this.meta.filter(entry => entry.id !== id);
        if (save) this.saveMeta();
        return true;
    }

    list() { return this.meta.slice(); }
}
