import { world } from '@minecraft/server';
export class ChainManager {
    constructor(db) {
        this.db = db;
    }
    createChain(chainData) {
        const id = chainData.id || `chain_${Date.now().toString(36)}`;
        const chain = {
            id,
            name: chainData.name,
            description: chainData.description || '',
            arc: chainData.arc || 'Side Story',
            quests: chainData.quests || [],
            completionRewards: chainData.completionRewards || {
                commands: [],
                points: 0,
                message: ''
            },
            icon: chainData.icon || 'textures/items/book_written',
            active: chainData.active !== undefined ? chainData.active : true
        };
        this.db.chains.set(id, chain);
        chain.quests.forEach((questId, index) => {
            const task = this.db.tasks.get(questId);
            if (task) {
                task.chainId = id;
                task.chainOrder = index;
                if (index > 0) {
                    task.prereq = chain.quests[index - 1];
                }
            }
        });
        this.db.saveTasks();
        this.db.saveChains();
        return chain;
    }
    deleteChain(chainId) {
        const chain = this.db.chains.get(chainId);
        if (!chain) return false;
        chain.quests.forEach(questId => {
            const task = this.db.tasks.get(questId);
            if (task) {
                task.chainId = null;
                task.chainOrder = undefined;
            }
        });
        this.db.chains.delete(chainId);
        this.db.saveTasks();
        this.db.saveChains();
        return true;
    }
    getChainProgress(playerId, chainId) {
        const chain = this.db.chains.get(chainId);
        if (!chain) return null;
        const data = this.db.getPlayer(playerId);
        let completed = 0;
        let currentQuestIndex = -1;
        chain.quests.forEach((questId, index) => {
            if (data.completed.includes(questId)) {
                completed++;
            } else if (currentQuestIndex === -1) {
                currentQuestIndex = index;
            }
        });
        const total = chain.quests.length;
        const isComplete = completed >= total;
        const percent = Math.floor((completed / Math.max(1, total)) * 100);
        return {
            chain,
            completed,
            total,
            percent,
            isComplete,
            currentQuestIndex,
            currentQuestId: currentQuestIndex >= 0 ? chain.quests[currentQuestIndex] : null
        };
    }
    checkChainCompletion(player, completedTaskId) {
        const task = this.db.tasks.get(completedTaskId);
        if (!task || !task.chainId) return;
        const chain = this.db.chains.get(task.chainId);
        if (!chain) return;
        const data = this.db.getPlayer(player.id);
        if (data.chainsCompleted.includes(chain.id)) return;
        const allDone = chain.quests.every(qId => data.completed.includes(qId));
        if (!allDone) return;
        data.chainsCompleted.push(chain.id);
        data.stats.chainsCompleted++;
        const rewards = chain.completionRewards || {};
        if (rewards.points) {
            data.points += rewards.points;
            data.stats.pointsEarned += rewards.points;
        }
        this.db.savePlayer(player.id);
        if (rewards.commands && rewards.commands.length > 0) {
            rewards.commands.forEach(cmd => {
                try { player.runCommand(cmd); } catch (e) { }
            });
        }
        player.runCommand('playsound random.levelup @s ~~~ 1 0.8');
        player.runCommand('playsound random.toast @s ~~~ 0.8 1.2');
        const msg = rewards.message || `You completed the ${chain.name} chain!`;
        player.sendMessage(`\n§6§l╔══════════════════════════╗`);
        player.sendMessage(`§6§l║  §e§l🔗 QUEST CHAIN COMPLETE!  §6§l║`);
        player.sendMessage(`§6§l╠══════════════════════════╣`);
        player.sendMessage(`§6§l║  §f${chain.name}`);
        player.sendMessage(`§6§l║  §7${msg}`);
        if (rewards.points) {
            player.sendMessage(`§6§l║  §d+${rewards.points} Bonus Points`);
        }
        player.sendMessage(`§6§l╚══════════════════════════╝\n`);
        world.getAllPlayers().forEach(p => {
            if (p.id !== player.id) {
                p.sendMessage(`§6§l[!] §e${player.name} §fcompleted chain §6${chain.name}§f!`);
            }
        });
        return true;
    }
    getAllChainsForPlayer(playerId) {
        const chains = Array.from(this.db.chains.values()).filter(c => c.active);
        return chains.map(chain => this.getChainProgress(playerId, chain.id));
    }
    getChainTasks(chainId) {
        const chain = this.db.chains.get(chainId);
        if (!chain) return [];
        return chain.quests.map(qId => this.db.tasks.get(qId)).filter(Boolean);
    }
}