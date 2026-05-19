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
        const form = new ActionFormData().title({ translate: 'ads.ui.quest_log.title' });

        const activeTasks = Array.from(this.db.tasks.values()).filter(t => t.active);
        const completedCount = data.completed.length;
        const totalCount = Math.max(1, activeTasks.length);
        const pct = Math.floor((completedCount / totalCount) * 100);
        const achProgress = this.achievements.getProgress(player.id);

        let bodyText = [
            {
                translate: 'ads.ui.quest_log.body', with: [
                    String(data.points),
                    String(completedCount),
                    String(activeTasks.length),
                    getProgressBar(pct, 100),
                    String(pct),
                    String(achProgress.unlocked),
                    String(achProgress.total)
                ]
            }
        ];

        if (data.streak.currentStreak > 0) {
            bodyText.push({ translate: 'ads.ui.quest_log.streak', with: [String(data.streak.currentStreak)] });
        }

        form.body({ rawtext: bodyText });

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
            let prefixKey = '';
            let tags = '';

            if (isLocked) { icon = 'textures/items/chain'; prefixKey = 'ads.ui.prefix.locked'; }
            else if (onCooldown) { icon = 'textures/ui/timer'; prefixKey = 'ads.ui.prefix.cooldown'; }
            else if (isComp) { icon = 'textures/items/emerald'; prefixKey = 'ads.ui.prefix.done'; }
            else if (isTracked) { icon = 'textures/items/spyglass'; prefixKey = 'ads.ui.prefix.tracked'; }

            if (t.repeatable) tags += ' §d⟳';
            if (t.deadline) tags += ' §c⏰';
            if (t.chainId) tags += ' §8🔗';

            let btnText = [];
            if (prefixKey) btnText.push({ translate: prefixKey });
            else btnText.push({ text: '§e' });

            btnText.push({ text: `${t.name}${tags}\n§7${t.category} ` });
            btnText.push({ translate: 'ads.ui.quest_btn.points', with: [String(t.points || 0)] });

            form.button({ rawtext: btnText }, icon);
        });

        form.button({ translate: 'ads.ui.quest_log.btn_chains' }, 'textures/items/chain');
        form.button({ translate: 'ads.ui.quest_log.btn_achievements' }, 'textures/items/nether_star');
        form.button({ translate: 'ads.ui.quest_log.btn_leaderboard' }, 'textures/items/spyglass');
        form.button({ translate: 'ads.ui.quest_log.btn_shop' }, 'textures/items/gold_ingot');

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

        let body = [];
        body.push({ translate: 'ads.ui.quest_details.header', with: [task.name, task.category, task.type, task.desc] });
        body.push({ translate: 'ads.ui.quest_details.points', with: [String(task.points || 0)] });

        if (task.repeatable) body.push({ translate: 'ads.ui.quest_details.repeatable' });
        if (task.rewards?.firstTimeBonus > 0) body.push({ translate: 'ads.ui.quest_details.first_time', with: [String(task.rewards.firstTimeBonus)] });
        body.push({ text: '\n' });

        if (task.chainId) {
            const chain = this.db.chains.get(task.chainId);
            if (chain) {
                const chainProg = this.chains.getChainProgress(player.id, chain.id);
                body.push({ translate: 'ads.ui.quest_details.chain', with: [chain.name, String(chainProg.completed), String(chainProg.total)] });
            }
        }

        if (task.deadline) {
            const timeLeft = Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000));
            body.push({ translate: 'ads.ui.quest_details.time_remaining', with: [formatTime(timeLeft)] });
        }

        if (task.rewards?.pool?.length > 0) {
            body.push({ translate: 'ads.ui.quest_details.random_bonus' });
        }
        body.push({ text: '\n' });

        if (isLocked) {
            const preName = this.db.tasks.get(task.prereq)?.name || "Unknown Quest";
            body.push({ translate: 'ads.ui.quest_details.locked', with: [preName] });
        } else if (onCooldown) {
            const remaining = Math.ceil((cdEnd - Date.now()) / 1000);
            body.push({ translate: 'ads.ui.quest_details.cooldown', with: [formatTime(remaining)] });
        } else if (isComp) {
            body.push({ translate: 'ads.ui.quest_details.completed_msg' });
        } else {
            body.push({ translate: 'ads.ui.quest_details.progress_msg', with: [String(current), String(task.req), getProgressBar(current, task.req)] });
        }

        const form = new ActionFormData().title({ translate: 'ads.ui.quest_details.title' }).body({ rawtext: body });

        if (!isComp && !isLocked && !onCooldown) {
            const isTracked = data.tracked === task.id;
            form.button({ translate: isTracked ? 'ads.ui.quest_details.btn_stop_tracking' : 'ads.ui.quest_details.btn_track' }, 'textures/items/spyglass');
        }
        form.button({ translate: 'ads.ui.btn_back' }, 'textures/ui/arrow_left');

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
        const form = new ActionFormData().title({ translate: 'ads.ui.quest_chains.title' });

        if (chainProgresses.length === 0) {
            form.body({ translate: 'ads.ui.quest_chains.empty' });
            form.button({ translate: 'ads.ui.btn_back' });
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.openQuestLog(player));
            });
            return;
        }

        const data = this.db.getPlayer(player.id);
        const chainsCompletedCount = data.chainsCompleted.length;
        form.body({ translate: 'ads.ui.quest_chains.completed_count', with: [String(chainsCompletedCount), String(chainProgresses.length)] });

        chainProgresses.forEach(cp => {
            const statusIcon = cp.isComplete ? '§a✔ ' : `§e${cp.percent}% `;
            const bar = getProgressBar(cp.completed, cp.total, 8);

            let btnText = [
                { text: `${statusIcon}§f${cp.chain.name}\n§7${cp.chain.arc} ${bar} §f${cp.completed}/${cp.total}` }
            ];

            form.button({ rawtext: btnText }, cp.isComplete ? 'textures/items/emerald' : 'textures/items/chain');
        });

        form.button({ translate: 'ads.ui.btn_back' });

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

        let body = [];
        body.push({ translate: 'ads.ui.chain_detail.desc', with: [chain.name, chain.description || 'No description.', chain.arc] });
        body.push({ translate: 'ads.ui.chain_detail.progress', with: [getProgressBar(chainProgress.completed, chainProgress.total), String(chainProgress.completed), String(chainProgress.total)] });
        body.push({ translate: 'ads.ui.chain_detail.order' });

        chain.quests.forEach((qId, i) => {
            const task = this.db.tasks.get(qId);
            const done = data.completed.includes(qId);
            const isCurrent = i === chainProgress.currentQuestIndex;
            const marker = done ? '§a✔' : isCurrent ? '§e▶' : '§8○';
            body.push({ text: `  ${marker} §7${i + 1}. §f${task?.name || qId}\n` });
        });

        if (chainProgress.isComplete) {
            body.push({ translate: 'ads.ui.chain_detail.complete' });
            if (chain.completionRewards?.points) {
                body.push({ translate: 'ads.ui.chain_detail.bonus', with: [String(chain.completionRewards.points)] });
            }
        } else if (chainProgress.currentQuestId) {
            const currentTask = this.db.tasks.get(chainProgress.currentQuestId);
            body.push({ translate: 'ads.ui.chain_detail.current', with: [currentTask?.name || '?'] });
        }

        new MessageFormData()
            .title({ translate: 'ads.ui.chain_detail.title', with: [chain.name] })
            .body({ rawtext: body })
            .button1({ translate: 'ads.ui.chain_detail.btn_back' })
            .button2({ translate: 'ads.ui.btn_close' })
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

        const form = new ActionFormData().title({ translate: 'ads.ui.achievements.title' });

        let body = [];
        body.push({ translate: 'ads.ui.achievements.overall', with: [String(progress.unlocked), String(progress.total), String(progress.percent)] });
        body.push({ text: `${getProgressBar(progress.unlocked, progress.total)}\n` });
        body.push({ translate: 'ads.ui.achievements.visible_hidden', with: [String(visibleLocked), String(hiddenUnlocked)] });

        if (nextAchievement) {
            const pct = Math.floor((nextAchievement.progress / Math.max(1, nextAchievement.threshold)) * 100);
            body.push({ translate: 'ads.ui.achievements.closest' });
            body.push({ translate: 'ads.ui.achievements.closest_desc', with: [nextAchievement.icon, nextAchievement.name, String(nextAchievement.progress), String(nextAchievement.threshold), String(pct)] });
        } else {
            body.push({ translate: 'ads.ui.achievements.all_complete' });
        }

        form.body({ rawtext: body });

        for (const category of catKeys) {
            const achs = categories[category];
            const unlocked = achs.filter(a => a.unlocked).length;
            const catPct = Math.floor((unlocked / Math.max(1, achs.length)) * 100);

            form.button({ translate: 'ads.ui.achievements.cat_desc', with: [category, String(unlocked), String(achs.length), String(catPct)] }, 'textures/items/nether_star');
        }

        form.button({ translate: 'ads.ui.btn_back' });

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

        let body = [];
        body.push({ translate: 'ads.ui.achievement_category.progress', with: [categoryName, String(unlocked), String(sorted.length), String(Math.floor((unlocked / Math.max(1, sorted.length)) * 100))] });
        body.push({ text: `${getProgressBar(unlocked, sorted.length)}\n\n` });

        sorted.forEach(a => {
            if (a.unlocked) {
                body.push({ translate: 'ads.ui.achievement_category.unlocked', with: [a.icon, a.name, a.description, String(a.points)] });
            } else if (a.hidden) {
                body.push({ translate: 'ads.ui.achievement_category.hidden' });
            } else {
                const bar = getProgressBar(a.progress, a.threshold, 8);
                const remaining = Math.max(0, a.threshold - a.progress);
                body.push({ translate: 'ads.ui.achievement_category.locked', with: [a.icon, a.name, a.description, bar, String(a.progress), String(a.threshold), String(a.points), String(remaining)] });
            }
        });

        new MessageFormData()
            .title({ translate: 'ads.ui.achievement_category.title', with: [categoryName] })
            .body({ rawtext: body })
            .button1({ translate: 'ads.ui.achievement_category.btn_back' })
            .button2({ translate: 'ads.ui.btn_close' })
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

        let body = [];
        body.push({ translate: 'ads.ui.leaderboard.header' });
        body.push({ translate: 'ads.ui.leaderboard.desc' });
        body.push({ translate: 'ads.ui.leaderboard.players', with: [String(entries.length), String(onlinePlayers.length)] });

        const medals = ['§e§l#1', '§7§l#2', '§6§l#3'];

        if (entries.length === 0) {
            body.push({ translate: 'ads.ui.leaderboard.empty' });
        } else {
            entries.slice(0, 10).forEach((e, i) => {
                const rank = i < 3 ? medals[i] : `§7#${i + 1}`;
                const onlineTag = e.online ? ' §a●' : ' §8○';
                body.push({ translate: 'ads.ui.leaderboard.entry', with: [rank, e.name, onlineTag, String(e.points), String(e.tasks), String(e.achievements), String(ACHIEVEMENTS.length)] });

                if (e.streak > 0) {
                    body.push({ translate: 'ads.ui.leaderboard.entry_streak', with: [String(e.streak)] });
                } else {
                    body.push({ text: '\n\n' });
                }
            });
        }

        if (entries.length > 10) {
            body.push({ translate: 'ads.ui.leaderboard.hidden_profiles', with: [String(entries.length - 10)] });
        }

        const myData = this.db.getPlayer(player.id);
        const myRank = entries.findIndex(e => e.id === player.id) + 1;

        body.push({ translate: 'ads.ui.leaderboard.your_stats' });

        if (myRank > 0) {
            body.push({ translate: 'ads.ui.leaderboard.rank', with: [`#${myRank}`] });
        } else {
            body.push({ translate: 'ads.ui.leaderboard.unranked' });
        }

        body.push({ translate: 'ads.ui.leaderboard.wallet', with: [String(myData.points)] });
        body.push({ translate: 'ads.ui.leaderboard.quests_completed', with: [String(myData.stats.tasksCompleted || 0)] });
        body.push({ translate: 'ads.ui.leaderboard.ach_count', with: [String(myData.achievements.length), String(ACHIEVEMENTS.length)] });
        body.push({ translate: 'ads.ui.leaderboard.best_streak', with: [String(myData.streak.bestStreak || 0)] });

        new MessageFormData()
            .title({ translate: 'ads.ui.leaderboard.title' })
            .body({ rawtext: body })
            .button1({ translate: 'ads.ui.btn_back' })
            .button2({ translate: 'ads.ui.btn_close' })
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
