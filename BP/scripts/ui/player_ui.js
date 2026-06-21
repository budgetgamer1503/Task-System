import { world, system } from '@minecraft/server';
import { ActionFormData, MessageFormData, ModalFormData } from '@minecraft/server-ui';
import { CONFIG, ACHIEVEMENTS, CATEGORIES, TYPES } from '../config.js';
import { getProgressBar, formatTime } from '../utils.js';

export class PlayerUI {
    constructor(db, chainMgr, achievementMgr, uiRouter) {
        this.db = db;
        this.chains = chainMgr;
        this.achievements = achievementMgr;
        this.router = uiRouter;
    }

    openQuestLog(player, categoryFilter = null) {
        const data = this.db.getPlayer(player.id);
        
        if (categoryFilter === null) {
            const activeTasks = Array.from(this.db.tasks.values()).filter(t => t.active && !t.bounty);
            const completedCount = data.completed.length;
            const totalCount = Math.max(1, activeTasks.length);
            const pct = Math.floor((completedCount / totalCount) * 100);
            const achProgress = this.achievements.getProgress(player.id);
            const proceedingCount = (data.activeQuests || []).length;

            const form = new ActionFormData().title("§6§lQuest Log Portal");
            
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
            
            form.button(`§eActive Quests (${proceedingCount}/5)\n§7Manage active tasks`, 'textures/items/spyglass');
            form.button("§bBrowse Categories\n§7View categorized quests", 'textures/items/book_writable');
            form.button("§5Player Bounties\n§7Community-posted quests", 'textures/items/writable_book');
            form.button({ translate: 'ads.ui.quest_log.btn_chains' }, 'textures/items/chain');
            form.button({ translate: 'ads.ui.quest_log.btn_achievements' }, 'textures/items/nether_star');
            form.button({ translate: 'ads.ui.quest_log.btn_leaderboard' }, 'textures/items/spyglass');
            form.button({ translate: 'ads.ui.quest_log.btn_shop' }, 'textures/items/gold_ingot');
            
            form.show(player).then(r => {
                if (r.canceled) return;
                system.run(() => {
                    switch (r.selection) {
                        case 0: this.openQuestLog(player, "PROCEEDING"); break;
                        case 1: this.openCategorySelect(player); break;
                        case 2: this.openBountyMenu(player); break;
                        case 3: this.uiPlayerChains(player); break;
                        case 4: this.uiAchievements(player); break;
                        case 5: this.router.openLeaderboard(player); break;
                        case 6: this.router.openShopPlayer(player); break;
                    }
                });
            });
            return;
        }

        const form = new ActionFormData();
        let displayTasks = [];
        
        if (categoryFilter === "PROCEEDING") {
            form.title("§e§lActive Quests");
            const activeIds = data.activeQuests || [];
            displayTasks = Array.from(this.db.tasks.values()).filter(t => activeIds.includes(t.id));
        } else {
            form.title(`${categoryFilter}`);
            displayTasks = Array.from(this.db.tasks.values()).filter(t => t.active && t.category === categoryFilter && !t.bounty);
        }
        
        if (displayTasks.length === 0) {
            form.body("§7No quests found here.");
            form.button("§cBack", "textures/ui/arrow_left");
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => {
                    if (categoryFilter === "PROCEEDING") this.openQuestLog(player);
                    else this.openCategorySelect(player);
                });
            });
            return;
        }
        
        form.body(`§7Tap any quest to view details or select/deactivate it.`);
        
        displayTasks.sort((a, b) => {
            if (data.tracked === a.id) return -1;
            if (data.tracked === b.id) return 1;
            const aComp = data.completed.includes(a.id);
            const bComp = data.completed.includes(b.id);
            return aComp === bComp ? 0 : aComp ? 1 : -1;
        });

        displayTasks.forEach(t => {
            const isComp = data.completed.includes(t.id);
            const isTracked = data.tracked === t.id;
            const isActive = data.activeQuests?.includes(t.id);
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
            else if (isActive) { icon = 'textures/items/map'; }

            if (t.repeatable) tags += ' §d⟳';
            if (t.deadline) tags += ' §c⏰';
            if (t.chainId) tags += ' §8🔗';
            if (t.coop) tags += ' §3[CO-OP]';

            let btnText = [];
            if (prefixKey) btnText.push({ translate: prefixKey });
            else if (isActive && !isComp && !onCooldown && !isTracked) btnText.push({ text: '§e[Active] ' });
            else btnText.push({ text: '§e' });

            btnText.push({ text: `${t.name}${tags}\n§7${t.category} ` });
            btnText.push({ translate: 'ads.ui.quest_btn.points', with: [String(t.points || 0)] });

            form.button({ rawtext: btnText }, icon);
        });

        form.button("§cBack", "textures/ui/arrow_left");

        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === displayTasks.length) {
                    if (categoryFilter === "PROCEEDING") {
                        this.openQuestLog(player);
                    } else {
                        this.openCategorySelect(player);
                    }
                } else {
                    this.uiTaskDetails(player, displayTasks[r.selection], () => this.openQuestLog(player, categoryFilter));
                }
            });
        });
    }

    openCategorySelect(player) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title("Quest Categories");
        
        const activeTasks = Array.from(this.db.tasks.values()).filter(t => t.active && !t.bounty);
        const catKeys = Object.keys(CATEGORIES);
        
        form.body(`§7Choose a category to browse quests.\n§dYour Points: §f${data.points}`);
        
        catKeys.forEach(k => {
            const catName = CATEGORIES[k];
            const count = activeTasks.filter(t => t.category === catName).length;
            form.button(`${catName}\n§7Active Quests: §f${count}`, 'textures/items/book_normal');
        });
        
        form.button("§cBack to Main Menu", "textures/ui/arrow_left");
        
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === catKeys.length) {
                    this.openQuestLog(player);
                } else {
                    const catName = CATEGORIES[catKeys[r.selection]];
                    this.openQuestLog(player, catName);
                }
            });
        });
    }

    openCustomQuestList(player, title, tasks) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title(title);
        
        tasks.forEach(t => {
            const isComp = data.completed.includes(t.id);
            const isActive = data.activeQuests?.includes(t.id);
            const isTracked = data.tracked === t.id;
            
            let icon = 'textures/items/paper';
            let prefix = '';
            if (isComp) { icon = 'textures/items/emerald'; prefix = '§a[Done] '; }
            else if (isTracked) { icon = 'textures/items/spyglass'; prefix = '§6[TRACKED] '; }
            else if (isActive) { icon = 'textures/items/map'; prefix = '§e[Active] '; }

            form.button(`${prefix}${t.name}\n§7Reward: §d${t.points}pts`, icon);
        });
        
        form.button("§cBack", "textures/ui/arrow_left");
        
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === tasks.length) {
                    this.openQuestLog(player);
                } else {
                    this.uiTaskDetails(player, tasks[r.selection], () => this.openCustomQuestList(player, title, tasks));
                }
            });
        });
    }

    openBountyMenu(player) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title("§e§lBounty Board");
        
        const activeBounties = Array.from(this.db.tasks.values()).filter(t => t.active && t.bounty);
        
        form.body(`§7Fund and complete player-posted tasks!\n§dYour Points: §f${data.points}`);
        
        form.button("§a+ Post a Bounty\n§7Funded from your points", "textures/ui/plus");
        
        activeBounties.forEach(b => {
            form.button(`§e${b.name}\n§7Reward: §d${b.points}pts §8| §7By: ${b.creatorName || 'Unknown'}`, 'textures/items/writable_book');
        });
        
        form.button("§cBack to Main Menu", "textures/ui/arrow_left");
        
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === 0) {
                    this.uiCreateBounty(player);
                } else if (r.selection === activeBounties.length + 1) {
                    this.openQuestLog(player);
                } else {
                    const bounty = activeBounties[r.selection - 1];
                    this.uiBountyDetails(player, bounty);
                }
            });
        });
    }

    uiCreateBounty(player) {
        const data = this.db.getPlayer(player.id);
        
        new ModalFormData()
            .title("§a§lPost a Bounty")
            .textField("Bounty Name", "e.g., Zombie Slayer")
            .textField("Description", "e.g., Kill zombies in my yard")
            .dropdown("Target Type", ["Kill Mob", "Break Block", "Craft Item"])
            .textField("Target ID", "e.g., minecraft:zombie")
            .slider("Required Count", 1, 100, 1, 5)
            .slider("Reward Points", 10, Math.min(500, Math.max(10, data.points)), 5, 20)
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, desc, typeIdx, target, req, reward] = r.formValues;
                
                if (!name || !name.trim() || !target || !target.trim()) {
                    player.sendMessage("§c[Bounty Board] Name and Target cannot be empty!");
                    return;
                }
                
                if (data.points < reward) {
                    player.sendMessage("§c[Bounty Board] You cannot afford this reward!");
                    return;
                }
                
                data.points -= reward;
                this.db.savePlayer(player.id);
                
                const types = [TYPES.KILL, TYPES.BLOCK, TYPES.CRAFT];
                const type = types[typeIdx];
                const id = `bounty_${Date.now().toString(36)}`;
                
                const task = {
                    id,
                    active: true,
                    name: `Bounty: ${name}`,
                    desc: `${desc} (Posted by ${player.name})`,
                    category: '§5Special',
                    type,
                    target,
                    targetRaw: target,
                    req,
                    points: reward,
                    bounty: true,
                    creatorId: player.id,
                    creatorName: player.name,
                    rewards: {
                        commands: [],
                        pool: [],
                        points: reward,
                        firstTimeBonus: 0
                    }
                };
                
                this.db.tasks.set(id, task);
                this.db.saveTasks();
                
                world.getAllPlayers().forEach(p => {
                    p.sendMessage(`\n§6§l[Bounty Board] §e${player.name} §fposted a new bounty: §a${task.name} §f(Reward: §d${reward}pts§f)!`);
                    p.runCommand('playsound random.toast @s');
                });
                
                system.run(() => this.openBountyMenu(player));
            });
    }

    uiBountyDetails(player, bounty) {
        const data = this.db.getPlayer(player.id);
        const current = data.progress[bounty.id] || 0;
        const isTracked = data.tracked === bounty.id;
        const isCreator = bounty.creatorId === player.id;
        
        let body = `§6§l${bounty.name}\n\n`;
        body += `§7${bounty.desc}\n`;
        body += `§dReward: §f${bounty.points} points\n`;
        body += `§8Type: §7${bounty.type} | Target: ${bounty.target}\n\n`;
        body += `§fProgress: ${current}/${bounty.req}\n`;
        body += getProgressBar(current, bounty.req) + '\n\n';
        
        const form = new ActionFormData()
            .title("Bounty Details")
            .body(body);
            
        if (isCreator) {
            form.button("§cCancel Bounty & Refund", "textures/ui/realms_red_x");
        } else {
            const isActive = data.activeQuests?.includes(bounty.id);
            form.button(isActive ? "§cDeactivate Bounty" : "§aActivate Bounty", "textures/items/map");
            form.button(isTracked ? "§cStop Tracking" : "§aTrack Bounty", "textures/items/spyglass");
        }
        form.button("§cBack to Bounty Board", "textures/ui/arrow_left");
        
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (isCreator) {
                    if (r.selection === 0) {
                        this.db.tasks.delete(bounty.id);
                        this.db.saveTasks();
                        
                        data.points += bounty.points;
                        this.db.savePlayer(player.id);
                        
                        player.sendMessage(`§a[Bounty Board] Bounty canceled and refunded §d${bounty.points}pts§a!`);
                        this.openBountyMenu(player);
                    } else {
                        this.openBountyMenu(player);
                    }
                } else {
                    if (r.selection === 0) {
                        if (!data.activeQuests) data.activeQuests = [];
                        const idx = data.activeQuests.indexOf(bounty.id);
                        if (idx !== -1) {
                            data.activeQuests.splice(idx, 1);
                            player.sendMessage(`§cDeactivated bounty: ${bounty.name}`);
                        } else {
                            if (data.activeQuests.length >= 5) {
                                player.sendMessage("§cCannot activate bounty: Quest limit (5) reached!");
                            } else {
                                data.activeQuests.push(bounty.id);
                                player.sendMessage(`§aActivated bounty: ${bounty.name}`);
                            }
                        }
                        this.db.savePlayer(player.id);
                        this.uiBountyDetails(player, bounty);
                    } else if (r.selection === 1) {
                        data.tracked = isTracked ? null : bounty.id;
                        this.db.savePlayer(player.id);
                        this.uiBountyDetails(player, bounty);
                    } else {
                        this.openBountyMenu(player);
                    }
                }
            });
        });
    }

    uiTaskDetails(player, task, backCallback = null) {
        const data = this.db.getPlayer(player.id);
        const isComp = data.completed.includes(task.id);
        const isLocked = task.prereq && !data.completed.includes(task.prereq);
        const cdEnd = data.repeatCooldowns[task.id];
        const onCooldown = cdEnd && Date.now() < cdEnd;

        let body = [];
        
        let titleName = task.name;
        if (task.coop) titleName = `§3§l[CO-OP] §f${task.name}`;
        
        body.push({ translate: 'ads.ui.quest_details.header', with: [titleName, task.category, task.type, task.desc] });
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
            if (task.coop) {
                if (task.objectives && task.objectives.length > 0) {
                    body.push({ text: `§bServer Objectives (Co-Op):\n` });
                    if (!this.db.globalProgress[task.id]) {
                        this.db.globalProgress[task.id] = task.objectives.map(() => 0);
                    }
                    task.objectives.forEach((obj, idx) => {
                        const prog = this.db.globalProgress[task.id][idx] || 0;
                        const objBar = getProgressBar(prog, obj.req, 8);
                        body.push({ text: ` §7- §f${obj.type.toUpperCase()}: ${obj.target} (${prog}/${obj.req})\n  ${objBar}\n` });
                    });
                } else {
                    const current = this.db.globalProgress[task.id] || 0;
                    body.push({ translate: 'ads.ui.quest_details.progress_msg', with: [String(current), String(task.req), getProgressBar(current, task.req)] });
                }
            } else {
                if (task.objectives && task.objectives.length > 0) {
                    body.push({ text: `§eObjectives:\n` });
                    if (!Array.isArray(data.progress[task.id])) {
                        data.progress[task.id] = task.objectives.map(() => 0);
                    }
                    task.objectives.forEach((obj, idx) => {
                        const prog = data.progress[task.id][idx] || 0;
                        const objBar = getProgressBar(prog, obj.req, 8);
                        body.push({ text: ` §7- §f${obj.type.toUpperCase()}: ${obj.target} (${prog}/${obj.req})\n  ${objBar}\n` });
                    });
                } else {
                    const current = data.progress[task.id] || 0;
                    body.push({ translate: 'ads.ui.quest_details.progress_msg', with: [String(current), String(task.req), getProgressBar(current, task.req)] });
                }
            }
        }

        const form = new ActionFormData().title({ translate: 'ads.ui.quest_details.title' }).body({ rawtext: body });

        const options = [];
        
        if (!isComp && !isLocked && !onCooldown) {
            const isTracked = data.tracked === task.id;
            options.push({
                text: isTracked ? "§cStop Tracking" : "§aTrack Quest",
                action: 'track',
                icon: 'textures/items/spyglass'
            });

            if (!task.coop) {
                const isActive = data.activeQuests?.includes(task.id);
                options.push({
                    text: isActive ? "§cDeactivate Quest" : "§aActivate Quest",
                    action: 'active',
                    icon: 'textures/items/map'
                });
            }
        }
        
        options.push({
            text: "§cBack",
            action: 'back',
            icon: 'textures/ui/arrow_left'
        });

        options.forEach(opt => form.button(opt.text, opt.icon));

        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                const selected = options[r.selection];
                if (selected.action === 'track') {
                    data.tracked = (data.tracked === task.id) ? null : task.id;
                    this.db.savePlayer(player.id);
                    this.uiTaskDetails(player, task, backCallback);
                } else if (selected.action === 'active') {
                    if (!data.activeQuests) data.activeQuests = [];
                    const idx = data.activeQuests.indexOf(task.id);
                    if (idx !== -1) {
                        data.activeQuests.splice(idx, 1);
                        player.sendMessage(`§cDeactivated quest: ${task.name}`);
                    } else {
                        if (data.activeQuests.length >= 5) {
                            player.sendMessage("§cCannot activate quest: Quest limit (5) reached!");
                        } else {
                            data.activeQuests.push(task.id);
                            player.sendMessage(`§aActivated quest: ${task.name}`);
                        }
                    }
                    this.db.savePlayer(player.id);
                    this.uiTaskDetails(player, task, backCallback);
                } else {
                    if (backCallback) backCallback();
                    else this.openQuestLog(player);
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
