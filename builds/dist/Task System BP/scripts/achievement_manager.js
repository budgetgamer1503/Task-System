import { world } from '@minecraft/server';
import { ACHIEVEMENTS, CONFIG } from './config.js';
export class AchievementManager {
    constructor(db) {
        this.db = db;
        this.statIndex = new Map();
        ACHIEVEMENTS.forEach(ach => {
            const list = this.statIndex.get(ach.stat) || [];
            list.push(ach);
            this.statIndex.set(ach.stat, list);
        });
    }
    checkForStat(player, statKey) {
        const candidates = this.statIndex.get(statKey);
        if (!candidates) return;
        const data = this.db.getPlayer(player.id);
        for (const ach of candidates) {
            if (data.achievements.includes(ach.id)) continue;
            const current = data.stats[ach.stat] || 0;
            if (current >= ach.threshold) {
                this.unlock(player, ach, data);
            }
        }
    }
    checkAll(player) {
        const data = this.db.getPlayer(player.id);
        for (const ach of ACHIEVEMENTS) {
            if (data.achievements.includes(ach.id)) continue;
            const current = data.stats[ach.stat] || 0;
            if (current >= ach.threshold) {
                this.unlock(player, ach, data);
            }
        }
    }
    unlock(player, achievement, data) {
        data.achievements.push(achievement.id);
        if (achievement.points > 0) {
            data.points += achievement.points;
            data.stats.pointsEarned += achievement.points;
        }
        this.db.savePlayer(player.id);
        player.runCommand('playsound random.toast @s ~~~ 1 1.5');
        player.sendMessage(`\n§e§l═══════════════════════════`);
        player.sendMessage(`  ${achievement.icon} §e§lACHIEVEMENT UNLOCKED!`);
        player.sendMessage(`  §f${achievement.name}`);
        player.sendMessage(`  §7${achievement.description}`);
        if (achievement.points > 0) {
            player.sendMessage(`  §d+${achievement.points} Quest Points`);
        }
        player.sendMessage(`§e§l═══════════════════════════\n`);
        world.getAllPlayers().forEach(p => {
            if (p.id !== player.id) {
                p.sendMessage(`${achievement.icon} §e${player.name} §funlocked §e${achievement.name}§f!`);
            }
        });
    }
    getPlayerAchievements(playerId) {
        const data = this.db.getPlayer(playerId);
        return ACHIEVEMENTS.map(ach => ({
            ...ach,
            unlocked: data.achievements.includes(ach.id),
            progress: data.stats[ach.stat] || 0
        }));
    }
    getProgress(playerId) {
        const data = this.db.getPlayer(playerId);
        const unlocked = data.achievements.length;
        const total = ACHIEVEMENTS.length;
        return { unlocked, total, percent: Math.floor((unlocked / Math.max(1, total)) * 100) };
    }
}