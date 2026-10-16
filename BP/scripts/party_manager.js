import { world } from '@minecraft/server';
import { CONFIG } from './config.js';

export class PartyManager {
    constructor(db) {
        this.db = db;
        this.parties = new Map();
    }

    load() {
        try {
            const raw = world.getDynamicProperty(CONFIG.DB_KEY_PARTIES);
            if (raw) JSON.parse(raw).forEach(party => this.parties.set(party.id, party));
        } catch (e) { console.warn('[QuestSystem] Party load error:', e); }
    }

    save() {
        world.setDynamicProperty(CONFIG.DB_KEY_PARTIES, JSON.stringify(Array.from(this.parties.values())));
    }

    makeCode() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
        return code;
    }

    create(player, name) {
        const data = this.db.getPlayer(player.id);
        if (data.partyId && this.parties.has(data.partyId)) return this.parties.get(data.partyId);
        let code = this.makeCode();
        while (Array.from(this.parties.values()).some(p => p.code === code)) code = this.makeCode();
        const id = `party_${Date.now().toString(36)}`;
        const party = {
            id, code, name: String(name || `${player.name}'s Party`).slice(0, 40),
            ownerId: player.id,
            members: [{ id: player.id, name: player.name }],
            objectiveProgress: {}, completed: [], createdAt: Date.now()
        };
        this.parties.set(id, party);
        data.partyId = id;
        this.db.savePlayer(player.id);
        this.save();
        return party;
    }

    join(player, code) {
        const party = Array.from(this.parties.values()).find(p => p.code === String(code || '').trim().toUpperCase());
        if (!party) return { ok: false, reason: 'Party code not found.' };
        const data = this.db.getPlayer(player.id);
        if (data.partyId && data.partyId !== party.id) this.leave(player);
        if (!party.members.some(m => m.id === player.id)) party.members.push({ id: player.id, name: player.name });
        data.partyId = party.id;
        this.db.savePlayer(player.id);
        this.save();
        return { ok: true, party };
    }

    leave(player) {
        const data = this.db.getPlayer(player.id);
        const party = this.parties.get(data.partyId);
        data.partyId = null;
        this.db.savePlayer(player.id);
        if (!party) return;
        party.members = party.members.filter(m => m.id !== player.id);
        if (party.members.length === 0) {
            this.parties.delete(party.id);
        } else if (party.ownerId === player.id) {
            party.ownerId = party.members[0].id;
        }
        this.save();
    }

    getPartyForPlayer(playerId) {
        const data = this.db.getPlayer(playerId);
        return data.partyId ? this.parties.get(data.partyId) || null : null;
    }

    getOnlineMembers(party) {
        const byId = new Map(world.getAllPlayers().map(player => [player.id, player]));
        return party.members.map(member => byId.get(member.id)).filter(Boolean);
    }

    exportData() { return Array.from(this.parties.values()); }

    importData(data) {
        this.parties.clear();
        (data || []).forEach(party => this.parties.set(party.id, party));
        this.save();
    }
}
