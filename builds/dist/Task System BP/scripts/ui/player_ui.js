import { world, system } from '@minecraft/server';
import { ActionFormData, MessageFormData } from '@minecraft/server-ui';
import { CONFIG, ACHIEVEMENTS } from '../config.js';
import { getProgressBar, formatTime } from '../utils.js';
export class PlayerUI {
    constructor(db, chainMgr, achievementMgr, uiRouter) {
        this.db = db;
        this.chains = chainMgr;
        this.achievements = achievementMgr;
        this.router = uiRouter;
    }
    openQuestLog(player) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title('§6§lQuest Log §r§7v3.0');
        const activeTasks = Array.from(this.db.tasks.values()).filter(t => t.active);
        const completedCount = data.completed.length;
        const totalCount = Math.max(1, activeTasks.length);
        const pct = Math.floor((completedCount / totalCount) * 100);
        const achProgress = this.achievements.getProgress(player.id);
        let bodyText = `§7Use /tag @s add admin to manage quests.\n\n`;
        bodyText += `§d§lPoints: §f${data.points} §8| `;
        bodyText += `§a§lCompleted: §f${completedCount}/${activeTasks.length}\n`;
        bodyText += `§7Progress: ${getProgressBar(pct, 100)} §f${pct}%\n`;
        bodyText += `§e🏆 Achievements: §f${achProgress.unlocked}/${achProgress.total}`;
        if (data.streak.currentStreak > 0) {
            bodyText += ` §8| §6🔥 ${data.streak.currentStreak}-day streak`;
        }
        bodyText += `\n`;
        form.body(bodyText);
        activeTasks.sort((a, b) => {
            if (data.tracked === a.id) return -1;
            if (data.tracked === b.id) return 1;
            const aComp = data.completed.includes(a.id);
            const bComp = data.completed.includes(b.id);
            return aComp === bComp ? 0 : aComp ? 1 : -1;
        });
        activeTasks.forEach(t => {
            const isComp = data.completed.includes(t.id);
            const isTracked = data.tracked === t.id;
            const isLocked = t.prereq && !data.completed.includes(t.prereq);
            const cdEnd = data.repeatCooldowns[t.id];
            const onCooldown = cdEnd && Date.now() < cdEnd;
            let icon = 'textures/items/paper';
            let prefix = '§e';
            let tags = '';
            if (isLocked) { icon = 'textures/items/chain'; prefix = '§8[Locked] '; }
            else if (onCooldown) { icon = 'textures/ui/timer'; prefix = '§c[Cooldown] '; }
            else if (isComp) { icon = 'textures/items/emerald'; prefix = '§a[Done] '; }
            else if (isTracked) { icon = 'textures/items/spyglass'; prefix = '§6[TRACKED] '; }
            if (t.repeatable) tags += ' §d⟳';
            if (t.deadline) tags += ' §c⏰';
            if (t.chainId) tags += ' §8🔗';
            form.button(`${prefix}${t.name}${tags}\n§7${t.category} §8| §d${t.points || 0}pts`, icon);
        });
        form.button('§d🔗 Quest Chains', 'textures/items/chain');
        form.button('§e🏆 Achievements', 'textures/items/nether_star');
        form.button('§3Leaderboard', 'textures/items/spyglass');
        form.button('§6Quest Shop', 'textures/items/gold_ingot');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                const extraStart = activeTasks.length;
                if (r.selection === extraStart) {
                    this.uiPlayerChains(player);
                } else if (r.selection === extraStart + 1) {
                    this.uiAchievements(player);
                } else if (r.selection === extraStart + 2) {
                    this.router.openLeaderboard(player);
                } else if (r.selection === extraStart + 3) {
                    this.router.openShopPlayer(player);
                } else {
                    this.uiTaskDetails(player, activeTasks[r.selection]);
                }
            });
        });
    }
    uiTaskDetails(player, task) {
        const data = this.db.getPlayer(player.id);
        const isComp = data.completed.includes(task.id);
        const isLocked = task.prereq && !data.completed.includes(task.prereq);
        const current = data.progress[task.id] || 0;
        const cdEnd = data.repeatCooldowns[task.id];
        const onCooldown = cdEnd && Date.now() < cdEnd;
        let body = `§6${task.name}\n§7${task.category}\n§8Type: ${task.type}\n\n§f${task.desc}\n\n`;
        body += `§dPoints: §f${task.points || 0}`;
        if (task.repeatable) body += `  §d§l⟳ Repeatable`;
        if (task.rewards?.firstTimeBonus > 0) body += `  §e(+${task.rewards.firstTimeBonus} first time)`;
        body += `\n`;
        if (task.chainId) {
            const chain = this.db.chains.get(task.chainId);
            if (chain) {
                const chainProg = this.chains.getChainProgress(player.id, chain.id);
                body += `§8🔗 Chain: §7${chain.name} §8(${chainProg.completed}/${chainProg.total})\n`;
            }
        }
        if (task.deadline) {
            const timeLeft = Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000));
            body += `§c⏰ Time Remaining: §f${formatTime(timeLeft)}\n`;
        }
        if (task.rewards?.pool?.length > 0) {
            body += `§e🎲 Has random bonus reward\n`;
        }
        body += `\n`;
        if (isLocked) {
            const preName = this.db.tasks.get(task.prereq)?.name || "Unknown Quest";
            body += `§c⚠ Locked! Complete "${preName}" first.`;
        } else if (onCooldown) {
            const remaining = Math.ceil((cdEnd - Date.now()) / 1000);
            body += `§c⏳ On Cooldown: §f${formatTime(remaining)}\n§7This quest will reset when cooldown expires.`;
        } else if (isComp) {
            body += `§a✔ Completed!`;
        } else {
            body += `§7Progress: §f${current}/${task.req}\n${getProgressBar(current, task.req)}`;
        }
        const form = new ActionFormData().title('§8§lQuest Details').body(body);
        if (!isComp && !isLocked && !onCooldown) {
            const isTracked = data.tracked === task.id;
            form.button(isTracked ? '§cStop Tracking' : '§aTrack Quest', 'textures/items/spyglass');
        }
        form.button('§cBack', 'textures/ui/arrow_left');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (!isComp && !isLocked && !onCooldown && r.selection === 0) {
                    data.tracked = (data.tracked === task.id) ? null : task.id;
                    this.db.savePlayer(player.id);
                    this.openQuestLog(player);
                } else {
                    this.openQuestLog(player);
                }
            });
        });
    }
    uiPlayerChains(player) {
        const chainProgresses = this.chains.getAllChainsForPlayer(player.id);
        const form = new ActionFormData().title('§d§l🔗 Quest Chains');
        if (chainProgresses.length === 0) {
            form.body('§7No quest chains available yet.');
            form.button('§cBack');
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.openQuestLog(player));
            });
            return;
        }
        const data = this.db.getPlayer(player.id);
        const chainsCompletedCount = data.chainsCompleted.length;
        form.body(`§7Ordered quest storylines.\n§d§lCompleted: §f${chainsCompletedCount}/${chainProgresses.length}\n`);
        chainProgresses.forEach(cp => {
            const statusIcon = cp.isComplete ? '§a✔ ' : `§e${cp.percent}% `;
            const bar = getProgressBar(cp.completed, cp.total, 8);
            form.button(`${statusIcon}§f${cp.chain.name}\n§7${cp.chain.arc} ${bar} §f${cp.completed}/${cp.total}`,
                cp.isComplete ? 'textures/items/emerald' : 'textures/items/chain');
        });
        form.button('§cBack');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === chainProgresses.length) {
                    this.openQuestLog(player);
                } else {
                    this.uiChainDetail(player, chainProgresses[r.selection]);
                }
            });
        });
    }
    uiChainDetail(player, chainProgress) {
        const chain = chainProgress.chain;
        const data = this.db.getPlayer(player.id);
        let body = `§6§l${chain.name}\n`;
        body += `§7${chain.description || 'No description.'}\n`;
        body += `§8Arc: ${chain.arc}\n\n`;
        body += `§fProgress: ${getProgressBar(chainProgress.completed, chainProgress.total)} §f${chainProgress.completed}/${chainProgress.total}\n\n`;
        body += `§e§lQuest Order:\n`;
        chain.quests.forEach((qId, i) => {
            const task = this.db.tasks.get(qId);
            const done = data.completed.includes(qId);
            const isCurrent = i === chainProgress.currentQuestIndex;
            const marker = done ? '§a✔' : isCurrent ? '§e▶' : '§8○';
            body += `  ${marker} §7${i + 1}. §f${task?.name || qId}\n`;
        });
        if (chainProgress.isComplete) {
            body += `\n§a§l✔ Chain Complete!`;
            if (chain.completionRewards?.points) {
                body += ` §d(+${chain.completionRewards.points} bonus pts)`;
            }
        } else if (chainProgress.currentQuestId) {
            const currentTask = this.db.tasks.get(chainProgress.currentQuestId);
            body += `\n§eCurrent: §f${currentTask?.name || '?'}`;
        }
        new MessageFormData()
            .title(`§d§l🔗 ${chain.name}`)
            .body(body)
            .button1('§cBack to Chains')
            .button2('§cClose')
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.uiPlayerChains(player));
            });
    }
    uiAchievements(player) {
        const allAch = this.achievements.getPlayerAchievements(player.id);
        const progress = this.achievements.getProgress(player.id);
        const categories = {};
        allAch.forEach(a => {
            if (!categories[a.category]) categories[a.category] = [];
            categories[a.category].push(a);
        });
        const nextAchievement = allAch
            .filter(a => !a.unlocked && !a.hidden)
            .sort((a, b) => (b.progress / Math.max(1, b.threshold)) - (a.progress / Math.max(1, a.threshold)))[0];
        const hiddenUnlocked = allAch.filter(a => a.hidden && a.unlocked).length;
        const visibleLocked = allAch.filter(a => !a.hidden && !a.unlocked).length;
        const catKeys = Object.keys(categories).sort((a, b) => {
            const aDone = categories[a].filter(x => x.unlocked).length / Math.max(1, categories[a].length);
            const bDone = categories[b].filter(x => x.unlocked).length / Math.max(1, categories[b].length);
            return bDone - aDone || a.localeCompare(b);
        });
        const form = new ActionFormData().title('§e§lAchievement Vault');
        let body = `§e§lOverall: §f${progress.unlocked}/${progress.total} §8(${progress.percent}%)\n`;
        body += `${getProgressBar(progress.unlocked, progress.total)}\n`;
        body += `§7Visible locked: §f${visibleLocked} §8| §7Hidden found: §f${hiddenUnlocked}\n`;
        if (nextAchievement) {
            const pct = Math.floor((nextAchievement.progress / Math.max(1, nextAchievement.threshold)) * 100);
            body += `\n§a§lClosest Unlock\n`;
            body += `${nextAchievement.icon} §f${nextAchievement.name} §8- §7${nextAchievement.progress}/${nextAchievement.threshold} §8(${pct}%)\n`;
        } else {
            body += `\n§aAll visible achievements are complete. Hidden achievements may still remain.\n`;
        }
        form.body(body);
        for (const category of catKeys) {
            const achs = categories[category];
            const unlocked = achs.filter(a => a.unlocked).length;
            const catPct = Math.floor((unlocked / Math.max(1, achs.length)) * 100);
            form.button(`§f${category}\n§7${unlocked}/${achs.length} unlocked §8| §e${catPct}%`, 'textures/items/nether_star');
        }
        form.button('§cBack');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === catKeys.length) {
                    this.openQuestLog(player);
                } else {
                    this.uiAchievementCategory(player, catKeys[r.selection], categories[catKeys[r.selection]]);
                }
            });
        });
    }
    uiAchievementCategory(player, categoryName, achs) {
        const sorted = achs.slice().sort((a, b) => {
            if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
            return (b.progress / Math.max(1, b.threshold)) - (a.progress / Math.max(1, a.threshold));
        });
        const unlocked = sorted.filter(a => a.unlocked).length;
        let body = `§e§l${categoryName}\n`;
        body += `§7Category progress: §f${unlocked}/${sorted.length} §8(${Math.floor((unlocked / Math.max(1, sorted.length)) * 100)}%)\n`;
        body += `${getProgressBar(unlocked, sorted.length)}\n\n`;
        sorted.forEach(a => {
            if (a.unlocked) {
                body += `${a.icon} §a${a.name}\n`;
                body += `  §7${a.description}\n`;
                body += `  §d+${a.points} pts §a✔ Unlocked\n\n`;
            } else if (a.hidden) {
                body += `§8§l? §7??? §8(Hidden)\n`;
                body += `  §8Complete to reveal\n\n`;
            } else {
                const bar = getProgressBar(a.progress, a.threshold, 8);
                const remaining = Math.max(0, a.threshold - a.progress);
                body += `${a.icon} §7${a.name}\n`;
                body += `  §7${a.description}\n`;
                body += `  ${bar} §f${a.progress}/${a.threshold} §8| §d${a.points} pts\n`;
                body += `  §8${remaining} more needed\n\n`;
            }
        });
        new MessageFormData()
            .title(`§e§l${categoryName} Achievements`)
            .body(body)
            .button1('§aBack to Achievements')
            .button2('§cClose')
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.uiAchievements(player));
            });
    }
    openLeaderboard(player, backTarget = 'player') {
        const onlinePlayers = world.getAllPlayers();
        const onlineNames = new Map();
        onlinePlayers.forEach(p => {
            onlineNames.set(p.id, p.name);
            this.db.getPlayer(p.id);
        });
        const entries = Array.from(this.db.playerData.entries()).map(([id, data], index) => ({
            id,
            name: onlineNames.get(id) || `Saved Player ${index + 1}`,
            online: onlineNames.has(id),
            tasks: data.stats?.tasksCompleted || data.completed?.length || 0,
            points: data.points || 0,
            achievements: data.achievements?.length || 0,
            streak: data.streak?.bestStreak || 0,
            pointsEarned: data.stats?.pointsEarned || 0
        }));
        onlinePlayers.forEach(p => {
            if (entries.some(e => e.id === p.id)) return;
            const data = this.db.getPlayer(p.id);
            entries.push({
                id: p.id,
                name: p.name,
                tasks: data.stats.tasksCompleted || 0,
                points: data.points || 0,
                achievements: data.achievements.length,
                streak: data.streak.bestStreak || 0,
                pointsEarned: data.stats.pointsEarned || 0,
                online: true
            });
        });
        entries.sort((a, b) => b.points - a.points || b.tasks - a.tasks);
        let bodyText = '§3§lQUEST LEADERBOARD\n';
        bodyText += '§8────────────────────────\n';
        bodyText += `§7Ranked by wallet points, then completed quests.\n`;
        bodyText += `§7Players shown: §f${entries.length} §8| §7Online: §b${onlinePlayers.length}\n\n`;
        const medals = ['§e§l#1', '§7§l#2', '§6§l#3'];
        if (entries.length === 0) {
            bodyText += '§7No player data loaded yet.';
        } else {
            entries.slice(0, 10).forEach((e, i) => {
                const rank = i < 3 ? medals[i] : `§7#${i + 1}`;
                const onlineTag = e.online ? ' §a●' : ' §8○';
                bodyText += `${rank} §f${e.name}${onlineTag}\n`;
                bodyText += `   §d${e.points} pts §8| §a${e.tasks} quests §8| §e${e.achievements}/${ACHIEVEMENTS.length} ach`;
                if (e.streak > 0) bodyText += ` §8| §6${e.streak}d streak`;
                bodyText += `\n\n`;
            });
        }
        if (entries.length > 10) bodyText += `§8${entries.length - 10} more saved profiles hidden.\n\n`;
        const myData = this.db.getPlayer(player.id);
        const myRank = entries.findIndex(e => e.id === player.id) + 1;
        bodyText += `\n\n§6§lYour Stats:\n`;
        bodyText += `§fRank: §e${myRank > 0 ? `#${myRank}` : 'Unranked'}\n`;
        bodyText += `§dWallet Points: §f${myData.points}\n`;
        bodyText += `§aCompleted: §f${myData.stats.tasksCompleted || 0} quests\n`;
        bodyText += `§eAchievements: §f${myData.achievements.length}/${ACHIEVEMENTS.length}\n`;
        bodyText += `§6Best Streak: §f${myData.streak.bestStreak || 0} days`;
        new MessageFormData()
            .title('§3§lLeaderboard')
            .body(bodyText)
            .button1('§aBack')
            .button2('§cClose')
            .show(player).then(r => {
                if (r.selection === 0) {
                    system.run(() => {
                        if (backTarget === 'admin') this.router.openAdminMenu(player);
                        else this.openQuestLog(player);
                    });
                }
            });
    }
}
