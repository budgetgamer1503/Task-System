import { world } from '@minecraft/server';
import { CONFIG } from './config.js';

export class BountyManager {
    constructor(db) {
        this.db = db;
        this.bounties = new Map();
    }

    load() {
        try {
            const raw = world.getDynamicProperty(CONFIG.DB_KEY_BOUNTIES);
            if (raw) JSON.parse(raw).forEach(bounty => this.bounties.set(bounty.id, bounty));
        } catch (e) { console.warn('[QuestSystem] Bounty load error:', e); }
    }

    save() {
        world.setDynamicProperty(CONFIG.DB_KEY_BOUNTIES, JSON.stringify(Array.from(this.bounties.values())));
    }

    create(player, values) {
        const data = this.db.getPlayer(player.id);
        const reward = Math.max(1, Math.floor(Number(values.reward) || 1));
        const req = Math.max(1, Math.floor(Number(values.req) || 1));
        const type = String(values.type || '').trim();
        const target = String(values.target || '').trim();
        const targetId = values.targetId ? String(values.targetId) : null;
        const targetName = String(values.targetName || target).trim();

        if (!type) return { ok: false, reason: 'Choose a bounty objective type.' };
        if (!target) return { ok: false, reason: 'Choose or enter a valid target.' };
        if (type === 'player_kill' && targetId === player.id) {
            return { ok: false, reason: 'You cannot place a player-hunt bounty on yourself.' };
        }
        if (data.points < reward) return { ok: false, reason: 'Not enough quest points to fund this bounty.' };

        data.points -= reward;
        this.db.savePlayer(player.id);
        const bounty = {
            id: `bounty_${Date.now().toString(36)}`,
            creatorId: player.id,
            creatorName: player.name,
            name: String(values.name || 'Player Bounty').slice(0, 60),
            desc: String(values.desc || '').slice(0, 300),
            type,
            target,
            targetId,
            targetName,
            req: type === 'player_kill' ? 1 : req,
            reward,
            active: true,
            createdAt: Date.now(),
            claimedBy: null,
            claimedByName: null
        };
        this.bounties.set(bounty.id, bounty);
        this.save();

        if (type === 'player_kill') {
            world.getAllPlayers().forEach(other => {
                if (other.id === targetId || other.name.toLowerCase() === targetName.toLowerCase()) {
                    other.sendMessage(`§c[Bounty] §e${player.name} §fplaced a §cplayer-hunt bounty §fon you worth §d${reward} points§f!`);
                }
            });
        }
        return { ok: true, bounty };
    }

    cancel(player, bountyId) {
        const bounty = this.bounties.get(bountyId);
        if (!bounty || !bounty.active || bounty.creatorId !== player.id) return false;
        bounty.active = false;
        bounty.canceled = true;
        const data = this.db.getPlayer(player.id);
        data.points += bounty.reward;
        this.db.savePlayer(player.id);
        this.save();
        return true;
    }

    progressMatching(player, type, matcher, amount = 1) {
        const data = this.db.getPlayer(player.id);
        let changed = false;
        for (const bounty of this.bounties.values()) {
            if (!bounty.active || bounty.type !== type || !matcher(bounty)) continue;
            // The player who funded a bounty cannot reclaim their own reward.
            if (bounty.creatorId === player.id || data.completedBounties.includes(bounty.id)) continue;
            const current = data.bountyProgress[bounty.id] || 0;
            const next = Math.min(bounty.req, current + amount);
            data.bountyProgress[bounty.id] = next;
            changed = true;
            if (next >= bounty.req) {
                bounty.active = false;
                bounty.claimedBy = player.id;
                bounty.claimedByName = player.name;
                bounty.claimedAt = Date.now();
                data.completedBounties.push(bounty.id);
                data.points += bounty.reward;
                data.stats.pointsEarned += bounty.reward;
                player.runCommand('playsound random.levelup @s ~~~ 1 1.15');
                player.sendMessage(`§6[Bounty] §aCompleted §f${bounty.name}§a and earned §d${bounty.reward} points§a!`);
                world.getAllPlayers().forEach(other => {
                    if (other.id !== player.id) other.sendMessage(`§6[Bounty] §e${player.name} §fclaimed §a${bounty.name} §7(+${bounty.reward} pts)`);
                });
                this.save();
            }
        }
        if (changed) this.db.savePlayer(player.id);
    }

    progressEvent(player, type, target, amount = 1) {
        const normalizedTarget = String(target || '').trim().toLowerCase();
        this.progressMatching(
            player,
            type,
            bounty => String(bounty.target || '').trim().toLowerCase() === normalizedTarget,
            amount
        );
    }

    progressPlayerKill(killer, victim) {
        if (!killer || !victim || killer.id === victim.id) return;
        const victimName = String(victim.name || '').trim().toLowerCase();
        this.progressMatching(killer, 'player_kill', bounty => {
            const idMatch = bounty.targetId && bounty.targetId === victim.id;
            const savedName = String(bounty.targetName || bounty.target || '').trim().toLowerCase();
            return idMatch || (savedName && savedName === victimName);
        }, 1);
    }

    active() {
        return Array.from(this.bounties.values()).filter(bounty => bounty.active).sort((a, b) => b.createdAt - a.createdAt);
    }

    exportData() { return Array.from(this.bounties.values()); }

    importData(data) {
        this.bounties.clear();
        (data || []).forEach(bounty => this.bounties.set(bounty.id, bounty));
        this.save();
    }
}
