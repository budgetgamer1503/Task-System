import { world, system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { CONFIG, CATEGORIES, TYPES } from '../config.js';
import { formatTime } from '../utils.js';

export class AdminUI {
    constructor(db, chainMgr, uiRouter) {
        this.db = db;
        this.chains = chainMgr;
        this.router = uiRouter;
    }

    openMenu(player) {
        new ActionFormData()
            .title('§d§lQuest System §ev3.0 §a(Admin)')
            .body('§2Control Panel')
            .button('§aCreate Quest', 'textures/items/book_writable')
            .button('§bManage Quests', 'textures/items/book_written')
            .button('§dQuest Chains', 'textures/items/chain')
            .button('§6Manage Exchange', 'textures/items/gold_ingot')
            .button('§eAdmin Guide', 'textures/items/book_normal')
            .button('§3Leaderboard', 'textures/items/spyglass')
            .button('§5Admin Stats', 'textures/items/clock_item')
            .button('§cReset My Data', 'textures/ui/refresh')
            .button('§8Player Mode', 'textures/items/iron_helmet')
            .show(player).then(r => {
                if (r.canceled) return;
                system.run(() => {
                    switch (r.selection) {
                        case 0: this.uiCreateQuest(player); break;
                        case 1: this.uiManageQuests(player); break;
                        case 2: this.uiManageChains(player); break;
                        case 3: this.router.openShopAdmin(player); break;
                        case 4: this.uiShowGuide(player); break;
                        case 5: this.router.openLeaderboard(player, 'admin'); break;
                        case 6: this.uiAdminStats(player); break;
                        case 7:
                            const id = player.id;
                            this.db.playerData.delete(id);
                            try {
                                const key = `${CONFIG.DB_KEY_PLAYERS}_${id}`;
                                world.setDynamicProperty(key, undefined);
                            } catch (e) { }
                            player.sendMessage("§cData Reset!");
                            break;
                        case 8: this.router.openPlayerLog(player); break;
                    }
                });
            });
    }

    uiCreateQuest(player, editTask = null) {
        const allTasks = Array.from(this.db.tasks.values());
        const prereqOpts = ['None', ...allTasks.map(t => t.name)];
        new ModalFormData()
            .title(editTask ? '§e§lEdit Quest' : '§a§lCreate New Quest')
            .textField('Quest Name', 'e.g. Explorer Task', { defaultValue: editTask?.name || '' })
            .textField('Description', 'Story text here...', { defaultValue: editTask?.desc || '' })
            .dropdown('Category', Object.values(CATEGORIES), { defaultValueIndex: editTask ? Math.max(0, Object.values(CATEGORIES).indexOf(editTask.category)) : 0 })
            .dropdown('Type', Object.values(TYPES), { defaultValueIndex: editTask ? Math.max(0, Object.values(TYPES).indexOf(editTask.type)) : 0 })
            .textField('Target ID / Coords', 'minecraft:zombie OR 100,64,100', { defaultValue: editTask?.targetRaw || (typeof editTask?.target === 'string' ? editTask.target : '') })
            .slider('Required Amount', 1, 100, { valueStep: 1, defaultValue: editTask?.req || 1 })
            .dropdown('Prerequisite', prereqOpts, { defaultValueIndex: editTask?.prereq ? allTasks.findIndex(t => t.id === editTask.prereq) + 1 : 0 })
            .textField('Incentive Commands (separate with ;)', '/give @s diamond 1', { defaultValue: editTask?.rewards?.commands?.join(';') || editTask?.rewardCmd || '' })
            .textField('Incentive Display Text', 'e.g. 1x Diamond', { defaultValue: editTask?.rewardTxt || '' })
            .slider('Quest Points', 1, 500, { valueStep: 1, defaultValue: editTask?.points || CONFIG.DEFAULT_QUEST_POINTS })
            .toggle('Repeatable', { defaultValue: editTask?.repeatable || false })
            .slider('Cooldown (seconds)', 0, 3600, { valueStep: 30, defaultValue: editTask?.cooldownSec || CONFIG.DEFAULT_COOLDOWN })
            .slider('Time Limit (minutes, 0=none)', 0, 1440, { valueStep: 5, defaultValue: editTask?.deadline ? Math.round((editTask.deadline - Date.now()) / 60000) : 0 })
            .slider('First-Time Bonus Points', 0, 200, { valueStep: 5, defaultValue: editTask?.rewards?.firstTimeBonus || 0 })
            .textField('Random Incentive Pool (cmds, ;sep)', 'optional', { defaultValue: editTask?.rewards?.pool?.join(';') || '' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, desc, catIdx, typeIdx, targetRaw, req, preIdx,
                    rewardCmdStr, rewardTxt, points, repeatable, cooldownSec,
                    timeLimitMin, firstTimeBonus, poolStr] = r.formValues;
                if (!name || name.trim() === '') {
                    player.sendMessage('§c[Quest System] Quest name cannot be empty!');
                    return;
                }
                const type = Object.values(TYPES)[typeIdx];
                let target = targetRaw;
                if (type === TYPES.VISIT) {
                    const [x, y, z] = targetRaw.split(',').map(Number);
                    target = { x, y, z };
                } else if (type === TYPES.WALK) {
                    target = targetRaw.split(';').map(s => {
                        const [x, y, z] = s.split(',').map(Number);
                        return { x, y, z };
                    });
                }
                const rewardCommands = rewardCmdStr ? rewardCmdStr.split(';').filter(s => s.trim()) : [];
                const rewardPool = poolStr ? poolStr.split(';').filter(s => s.trim()) : [];
                const id = editTask?.id || `q_${Date.now().toString(36)}`;
                const task = {
                    id,
                    active: editTask?.active ?? true,
                    name, desc,
                    category: Object.values(CATEGORIES)[catIdx],
                    type, target, targetRaw,
                    req: (type === TYPES.VISIT) ? 1 : (type === TYPES.WALK ? target.length : req),
                    prereq: preIdx === 0 ? null : allTasks[preIdx - 1].id,
                    rewardCmd: rewardCommands[0] || '',
                    rewardTxt: rewardTxt || 'None',
                    points: points,
                    repeatable: repeatable,
                    cooldownSec: repeatable ? cooldownSec : 0,
                    deadline: timeLimitMin > 0 ? Date.now() + timeLimitMin * 60000 : null,
                    chainId: editTask?.chainId || null,
                    rewards: {
                        commands: rewardCommands,
                        pool: rewardPool,
                        points: points,
                        firstTimeBonus: repeatable ? firstTimeBonus : 0
                    }
                };
                this.db.tasks.set(id, task);
                this.db.saveTasks();
                let msg = `§a§lQuest ${editTask ? 'Updated' : 'Created'}! §r§f${name}`;
                msg += `\n§7  Points: §d${points}`;
                if (firstTimeBonus > 0) msg += ` §7(+${firstTimeBonus} first-time)`;
                msg += ` §8| `;
                msg += repeatable ? `§dRepeatable (${formatTime(cooldownSec)})` : '§7One-time';
                if (timeLimitMin > 0) msg += ` §8| §c⏰ ${timeLimitMin}min limit`;
                if (rewardPool.length > 0) msg += `\n§7  🎲 Random pool: ${rewardPool.length} items`;
                player.sendMessage(msg);
            });
    }

    uiManageQuests(player) {
        const form = new ActionFormData().title('§b§lManage Quests');
        const tasksList = Array.from(this.db.tasks.values());
        if (tasksList.length === 0) {
            form.body('§7No quests created yet.');
            form.button('§c< Back');
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.openMenu(player));
            });
            return;
        }
        form.body(`§7${tasksList.length} quest(s) total. Select one to edit.`);
        tasksList.forEach((t) => {
            let tags = '';
            if (t.repeatable) tags += ' §d⟳';
            if (t.deadline) tags += ' §c⏰';
            if (t.chainId) tags += ' §8🔗';
            form.button(`${t.active ? '§a' : '§c'}${t.name}${tags}\n§7ID: ${t.id}`);
        });
        form.show(player).then(r => {
            if (r.canceled) return;
            const task = tasksList[r.selection];
            system.run(() => {
                let body = `§fID: §7${task.id}\n`;
                body += `§fType: §7${task.type}\n`;
                body += `§fTarget: §7${task.targetRaw || JSON.stringify(task.target)}\n`;
                body += `§fPrereq: §7${task.prereq || 'None'}\n`;
                body += `§fPoints: §d${task.points || 0}\n`;
                body += `§fRepeatable: §7${task.repeatable ? `Yes (${formatTime(task.cooldownSec || 0)} cd)` : 'No'}\n`;
                if (task.chainId) {
                    const chain = this.db.chains.get(task.chainId);
                    body += `§fChain: §7${chain?.name || task.chainId}\n`;
                }
                if (task.rewards?.pool?.length > 0) {
                    body += `§fRandom Pool: §7${task.rewards.pool.length} items\n`;
                }
                if (task.deadline) {
                    const left = Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000));
                    body += `§fTime Left: §c${formatTime(left)}\n`;
                }
                new MessageFormData()
                    .title(`§e§lEdit: ${task.name}`)
                    .body(body)
                    .button1('§eEdit Quest Details')
                    .button2('§6Toggle Active / Delete')
                    .show(player).then(res => {
                        system.run(() => {
                            if (res.selection === 0) {
                                this.uiCreateQuest(player, task);
                            }
                            if (res.selection === 1) {
                                new MessageFormData()
                                    .title('§c§lOptions')
                                    .body('Choose action')
                                    .button1('§cDelete Permanently')
                                    .button2('§eToggle Active/Inactive')
                                    .show(player).then(x => {
                                        system.run(() => {
                                            if (x.selection === 0) {
                                                this.db.tasks.delete(task.id);
                                                this.db.saveTasks();
                                                player.sendMessage("§cQuest Deleted");
                                            }
                                            if (x.selection === 1) {
                                                task.active = !task.active;
                                                this.db.saveTasks();
                                                player.sendMessage(`§aQuest ${task.active ? 'Activated' : 'Deactivated'}`);
                                            }
                                        });
                                    });
                            }
                        });
                    });
            });
        });
    }

    uiManageChains(player) {
        const form = new ActionFormData().title('§d§l🔗 Quest Chains');
        const chainsList = Array.from(this.db.chains.values());
        form.body(`§7${chainsList.length} chain(s). Chains group quests into ordered storylines.`);
        form.button('§a+ Create New Chain', 'textures/items/chain');
        chainsList.forEach(c => {
            const questCount = c.quests.length;
            form.button(`§f${c.name}\n§7${c.arc} §8| §a${questCount} quests`, c.icon || 'textures/items/book_written');
        });
        form.button('§c< Back');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === 0) {
                    this.uiCreateChain(player);
                } else if (r.selection === chainsList.length + 1) {
                    this.openMenu(player);
                } else {
                    this.uiEditChain(player, chainsList[r.selection - 1]);
                }
            });
        });
    }

    uiCreateChain(player, editChain = null) {
        new ModalFormData()
            .title(editChain ? '§eEdit Chain' : '§a§lCreate Quest Chain')
            .textField('Chain Name', 'e.g. The Iron Road', { defaultValue: editChain?.name || '' })
            .textField('Description', 'A story of...', { defaultValue: editChain?.description || '' })
            .textField('Story Arc', 'e.g. Main Story', { defaultValue: editChain?.arc || 'Main Story' })
            .textField('Quest IDs (;sep, in order)', 'q_abc;q_def;q_ghi', { defaultValue: editChain?.quests?.join(';') || '' })
            .slider('Completion Bonus Points', 0, 500, { valueStep: 10, defaultValue: editChain?.completionRewards?.points || 50 })
            .textField('Completion Incentive Cmds (;sep)', '/give @s netherite_ingot 1', { defaultValue: editChain?.completionRewards?.commands?.join(';') || '' })
            .textField('Completion Message', 'You finished the chapter!', { defaultValue: editChain?.completionRewards?.message || '' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, description, arc, questIdsRaw, bonusPts, rewardCmdsRaw, completionMsg] = r.formValues;
                if (!name || !name.trim()) {
                    player.sendMessage('§c[Chains] Name cannot be empty!');
                    return;
                }
                const questIds = questIdsRaw ? questIdsRaw.split(';').filter(s => s.trim()) : [];
                const rewardCmds = rewardCmdsRaw ? rewardCmdsRaw.split(';').filter(s => s.trim()) : [];
                const missing = questIds.filter(id => !this.db.tasks.has(id));
                if (missing.length > 0) {
                    player.sendMessage(`§c[Chains] Unknown quest IDs: §f${missing.join(', ')}`);
                    player.sendMessage(`§7Tip: Create the quests first, then add them to a chain.`);
                    return;
                }
                const chain = this.chains.createChain({
                    id: editChain?.id || undefined,
                    name, description, arc,
                    quests: questIds,
                    completionRewards: {
                        commands: rewardCmds,
                        points: bonusPts,
                        message: completionMsg || `${name} complete!`
                    },
                    active: true
                });
                player.sendMessage(`§a§lChain ${editChain ? 'Updated' : 'Created'}! §r§f${name}`);
                player.sendMessage(`§7  Quests: §f${questIds.length} §8| §dBonus: ${bonusPts}pts`);
            });
    }

    uiEditChain(player, chain) {
        let body = `§fName: §7${chain.name}\n`;
        body += `§fArc: §7${chain.arc}\n`;
        body += `§fQuests: §7${chain.quests.length}\n`;
        body += `§fBonus Points: §d${chain.completionRewards?.points || 0}\n\n`;
        body += `§6§lQuest Order:\n`;
        chain.quests.forEach((qId, i) => {
            const task = this.db.tasks.get(qId);
            body += `  §7${i + 1}. §f${task?.name || qId}\n`;
        });
        new MessageFormData()
            .title(`§d§l🔗 ${chain.name}`)
            .body(body)
            .button1('§eEdit Chain')
            .button2('§cDelete Chain')
            .show(player).then(r => {
                system.run(() => {
                    if (r.selection === 0) {
                        this.uiCreateChain(player, chain);
                    } else if (r.selection === 1) {
                        this.chains.deleteChain(chain.id);
                        player.sendMessage(`§cChain "${chain.name}" deleted. Quests preserved.`);
                        this.uiManageChains(player);
                    }
                });
            });
    }

    uiAdminStats(player) {
        const totalQuests = this.db.tasks.size;
        const tasks = Array.from(this.db.tasks.values());
        const activeQuests = tasks.filter(t => t.active).length;
        const repeatableQuests = tasks.filter(t => t.repeatable).length;
        const timedQuests = tasks.filter(t => t.deadline).length;
        const chainedQuests = tasks.filter(t => t.chainId).length;
        const totalChains = this.db.chains.size;
        const exchangeItems = this.db.shop.size;
        const online = world.getAllPlayers();
        const onlinePlayers = online.length;
        const onlineNames = new Map();
        online.forEach(p => {
            onlineNames.set(p.id, p.name);
            this.db.getPlayer(p.id);
        });
        const playerRows = Array.from(this.db.playerData.entries()).map(([id, data], index) => ({
            id,
            name: onlineNames.get(id) || `Saved Player ${index + 1}`,
            online: onlineNames.has(id),
            data
        }));
        const savedPlayers = playerRows.length;
        const totalCompletions = playerRows.reduce((sum, row) => sum + (row.data.stats?.tasksCompleted || row.data.completed?.length || 0), 0);
        const totalPoints = playerRows.reduce((sum, row) => sum + (row.data.points || 0), 0);
        const totalAchievements = playerRows.reduce((sum, row) => sum + (row.data.achievements?.length || 0), 0);
        const bestStreak = playerRows.reduce((best, row) => Math.max(best, row.data.streak?.bestStreak || 0), 0);
        const topPlayer = playerRows
            .slice()
            .sort((a, b) => (b.data.points || 0) - (a.data.points || 0) || (b.data.stats?.tasksCompleted || 0) - (a.data.stats?.tasksCompleted || 0))[0];
        let mostCompleted = { name: 'N/A', count: 0 };
        tasks.forEach(task => {
            const count = playerRows.filter(row => row.data.completed?.includes(task.id)).length;
            if (count > mostCompleted.count) {
                mostCompleted = { name: task.name, count };
            }
        });
        let body = `§5§lSYSTEM OVERVIEW\n`;
        body += `§8────────────────────────\n`;
        body += `§fQuests: §a${activeQuests} active §8/ §7${totalQuests} total\n`;
        body += `§fInactive: §c${totalQuests - activeQuests} §8| §dRepeatable: §f${repeatableQuests} §8| §cTimed: §f${timedQuests}\n`;
        body += `§fLinked to chains: §d${chainedQuests} §8| §fChains: §d${totalChains}\n`;
        body += `§fExchange items: §6${exchangeItems}\n\n`;
        body += `§3§lPLAYER ACTIVITY\n`;
        body += `§8────────────────────────\n`;
        body += `§fOnline now: §b${onlinePlayers} §8| §fSaved profiles: §b${savedPlayers}\n`;
        body += `§fTotal completions: §a${totalCompletions}\n`;
        body += `§fCurrent points in wallets: §d${totalPoints}\n`;
        body += `§fAchievements unlocked: §e${totalAchievements}\n`;
        body += `§fBest streak recorded: §6${bestStreak} days\n\n`;
        body += `§e§lTOP SIGNALS\n`;
        body += `§8────────────────────────\n`;
        body += `§fTop player: §e${topPlayer ? topPlayer.name : 'N/A'} §8- §d${topPlayer?.data.points || 0} pts\n`;
        body += `§fMost completed quest: §a${mostCompleted.name} §8- §f${mostCompleted.count} clears\n`;
        body += `§7Tip: leaderboard uses online players plus cached saved profiles loaded this session.`;
        new MessageFormData()
            .title('§5§lAdmin Dashboard')
            .body(body)
            .button1('§aBack to Admin')
            .button2('§cClose')
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.openMenu(player));
            });
    }

    uiShowGuide(player) {
        new ActionFormData()
            .title('§e§lAdmin Guide')
            .body('§7Pick a setup topic. Each page gives exact formats and safe examples for quest creation.')
            .button('§aQuick Start\n§7Build a working quest fast', 'textures/items/book_normal')
            .button('§bBlocks, Items & Crafting\n§7Mine, place, gather, craft', 'textures/items/diamond_pickaxe')
            .button('§cCombat & Deaths\n§7Mob kills and death tracking', 'textures/items/diamond_sword')
            .button('§aTravel & Routes\n§7Visit points and waypoint paths', 'textures/items/compass_item')
            .button('§6Rewards & Shop\n§7Points, commands, random pools', 'textures/items/gold_ingot')
            .button('§dChains & Progression\n§7Story arcs and unlock order', 'textures/items/chain')
            .button('§5Admin Tools\n§7Stats, leaderboard, maintenance', 'textures/items/clock_item')
            .button('§cBack')
            .show(player).then(r => {
                system.run(() => {
                    if (r.canceled || r.selection === 7) {
                        this.openMenu(player);
                        return;
                    }
                    this.uiShowGuideDetail(player, r.selection);
                });
            });
    }

    uiShowGuideDetail(player, pageIndex) {
        let title = "";
        let content = "";
        switch (pageIndex) {
            case 0:
                title = "Quick Start";
                content = "§a§lRecommended Flow§r\n\n§f1. Create Quest\n§7Choose a clear name, short description, category, and type.\n\n§f2. Set Target\n§7Use exact IDs like minecraft:zombie or minecraft:diamond_ore.\n\n§f3. Set Required Amount\n§7Keep early quests small so players understand the system.\n\n§f4. Add Points and Rewards\n§7Points always work. Commands are optional and run after completion.\n\n§f5. Test in Player Mode\n§7Use Player Mode from the admin menu before publishing many quests.";
                break;
            case 1:
                title = "Blocks, Items & Crafting";
                content = "§b§lBlock Quest§r\n§7Target: minecraft:stone\n§7Tracks blocks broken.\n\n§a§lPlace Quest§r\n§7Target: minecraft:oak_planks\n§7Tracks blocks placed.\n\n§6§lGather Quest§r\n§7Target: minecraft:apple\n§7Tracks item gains in inventory.\n\n§e§lCraft Quest§r\n§7Target: minecraft:crafting_table\n§7Tracks crafted items when detected by the script.\n\n§fUse exact identifiers. Custom addon IDs work when the item/block exists.";
                break;
            case 2:
                title = "Combat & Deaths";
                content = "§c§lKill Quest§r\n§7Target: minecraft:zombie\n§7Required amount: number of kills.\n\n§4§lBoss or Custom Mob§r\n§7Target: custom_addon:boss_id\n§7Use the entity type ID from the addon.\n\n§8§lDeath Quest§r\n§7Type: death\n§7Target can be left blank. Required amount controls death count.\n\n§fKeep combat rewards higher than simple gather quests because risk is higher.";
                break;
            case 3:
                title = "Travel & Routes";
                content = "§a§lVisit Quest§r\n§7Target format: x,y,z\n§7Example: 100,64,100\n§7Completes when player is within " + CONFIG.PROXIMITY + " blocks.\n\n§2§lWalk Quest§r\n§7Target format: x,y,z;x,y,z;x,y,z\n§7Example: 0,64,0;50,65,25;100,70,100\n§7Use this for patrols, tours, and story routes.\n\n§fAvoid placing targets inside walls, water, lava, or protected areas.";
                break;
            case 4:
                title = "Rewards & Shop";
                content = "§6§lReward Commands§r\n§7Separate multiple commands with semicolons.\n§7Example: /give @s diamond 1;/xp 5L @s\n\n§d§lQuest Points§r\n§7Points feed the leaderboard and shop economy.\n\n§e§lFirst-Time Bonus§r\n§7Useful for repeatable quests. Players get extra points only the first time.\n\n§b§lRandom Pool§r\n§7Put command options in the random pool. One reward is selected when completed.\n\n§fShop items should cost more than one easy quest to keep the economy balanced.";
                break;
            case 5:
                title = "Chains & Progression";
                content = "§d§lQuest Chains§r\n§7Chains turn separate quests into ordered storylines.\n\n§fQuest IDs§r\n§7Use semicolon-separated IDs in order:\n§7q_first;q_second;q_final\n\n§a§lCompletion Bonus§r\n§7Award bonus points or commands when the full chain is complete.\n\n§e§lBest Practice§r\n§7Create all quests first, copy their IDs from Manage Quests, then build the chain.\n\n§fChains are best for tutorials, chapters, server events, and rank progression.";
                break;
            case 6:
                title = "Admin Tools";
                content = "§5§lAdmin Dashboard§r\n§7Shows quest counts, player activity, points, achievements, and top signals.\n\n§3§lLeaderboard§r\n§7Ranks online players and cached saved profiles loaded this session.\n\n§e§lAchievements§r\n§7Players unlock achievements automatically from tracked stats.\n\n§c§lReset My Data§r\n§7Only resets the admin player's own saved quest data. It does not delete global quests.\n\n§fUse stats after events to see which quests players actually complete.";
                break;
        }
        new MessageFormData()
            .title(`§l${title}`)
            .body(content)
            .button1("§aBack to Guide")
            .button2("§cClose")
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.uiShowGuide(player));
            });
    }
}
