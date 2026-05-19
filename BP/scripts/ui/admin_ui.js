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
            .title({ translate: 'ads.ui.admin.main.title' })
            .body({ translate: 'ads.ui.admin.main.body' })
            .button({ translate: 'ads.ui.admin.main.btn_create' }, 'textures/items/book_writable')
            .button({ translate: 'ads.ui.admin.main.btn_manage' }, 'textures/items/book_written')
            .button({ translate: 'ads.ui.admin.main.btn_chains' }, 'textures/items/chain')
            .button({ translate: 'ads.ui.admin.main.btn_shop' }, 'textures/items/gold_ingot')
            .button({ translate: 'ads.ui.admin.main.btn_guide' }, 'textures/items/book_normal')
            .button({ translate: 'ads.ui.admin.main.btn_leaderboard' }, 'textures/items/spyglass')
            .button({ translate: 'ads.ui.admin.main.btn_stats' }, 'textures/items/clock_item')
            .button({ translate: 'ads.ui.admin.main.btn_reset' }, 'textures/ui/refresh')
            .button({ translate: 'ads.ui.admin.main.btn_player_mode' }, 'textures/items/iron_helmet')
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
                            player.sendMessage({ translate: 'ads.ui.admin.main.data_reset' });
                            break;
                        case 8: this.router.openPlayerLog(player); break;
                    }
                });
            });
    }

    uiCreateQuest(player, editTask = null) {
        const allTasks = Array.from(this.db.tasks.values());
        const prereqOpts = ['None'];
        allTasks.forEach(t => prereqOpts.push(t.name));
        
        new ModalFormData()
            .title({ translate: editTask ? 'ads.ui.admin.create.title_edit' : 'ads.ui.admin.create.title_new' })
            .textField({ translate: 'ads.ui.admin.create.lbl_name' }, { translate: 'ads.ui.admin.create.pl_name' }, { defaultValue: editTask?.name || '' })
            .textField({ translate: 'ads.ui.admin.create.lbl_desc' }, { translate: 'ads.ui.admin.create.pl_desc' }, { defaultValue: editTask?.desc || '' })
            .dropdown({ translate: 'ads.ui.admin.create.lbl_cat' }, Object.values(CATEGORIES), { defaultValueIndex: editTask ? Math.max(0, Object.values(CATEGORIES).indexOf(editTask.category)) : 0 })
            .dropdown({ translate: 'ads.ui.admin.create.lbl_type' }, Object.values(TYPES), { defaultValueIndex: editTask ? Math.max(0, Object.values(TYPES).indexOf(editTask.type)) : 0 })
            .textField({ translate: 'ads.ui.admin.create.lbl_target' }, { translate: 'ads.ui.admin.create.pl_target' }, { defaultValue: editTask?.targetRaw || (typeof editTask?.target === 'string' ? editTask.target : '') })
            .slider({ translate: 'ads.ui.admin.create.lbl_req' }, 1, 100, { valueStep: 1, defaultValue: editTask?.req || 1 })
            .dropdown({ translate: 'ads.ui.admin.create.lbl_prereq' }, prereqOpts, { defaultValueIndex: editTask?.prereq ? allTasks.findIndex(t => t.id === editTask.prereq) + 1 : 0 })
            .textField({ translate: 'ads.ui.admin.create.lbl_cmds' }, { translate: 'ads.ui.admin.create.pl_cmds' }, { defaultValue: editTask?.rewards?.commands?.join(';') || editTask?.rewardCmd || '' })
            .textField({ translate: 'ads.ui.admin.create.lbl_reward_txt' }, { translate: 'ads.ui.admin.create.pl_reward_txt' }, { defaultValue: editTask?.rewardTxt || '' })
            .slider({ translate: 'ads.ui.admin.create.lbl_points' }, 1, 500, { valueStep: 1, defaultValue: editTask?.points || CONFIG.DEFAULT_QUEST_POINTS })
            .toggle({ translate: 'ads.ui.admin.create.lbl_repeatable' }, { defaultValue: editTask?.repeatable || false })
            .slider({ translate: 'ads.ui.admin.create.lbl_cooldown' }, 0, 3600, { valueStep: 30, defaultValue: editTask?.cooldownSec || CONFIG.DEFAULT_COOLDOWN })
            .slider({ translate: 'ads.ui.admin.create.lbl_time_limit' }, 0, 1440, { valueStep: 5, defaultValue: editTask?.deadline ? Math.round((editTask.deadline - Date.now()) / 60000) : 0 })
            .slider({ translate: 'ads.ui.admin.create.lbl_first_bonus' }, 0, 200, { valueStep: 5, defaultValue: editTask?.rewards?.firstTimeBonus || 0 })
            .textField({ translate: 'ads.ui.admin.create.lbl_pool' }, { translate: 'ads.ui.admin.create.pl_pool' }, { defaultValue: editTask?.rewards?.pool?.join(';') || '' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, desc, catIdx, typeIdx, targetRaw, req, preIdx,
                    rewardCmdStr, rewardTxt, points, repeatable, cooldownSec,
                    timeLimitMin, firstTimeBonus, poolStr] = r.formValues;
                if (!name || name.trim() === '') {
                    player.sendMessage({ translate: 'ads.ui.admin.create.err_name' });
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
                
                let repeatKey = repeatable ? 'ads.ui.admin.create.msg_repeatable' : 'ads.ui.admin.create.msg_onetime';
                player.sendMessage({ translate: editTask ? 'ads.ui.admin.create.msg_updated' : 'ads.ui.admin.create.msg_created', with: [name, String(points), String(firstTimeBonus), String(timeLimitMin), String(rewardPool.length), formatTime(cooldownSec)] });
            });
    }

    uiManageQuests(player) {
        const form = new ActionFormData().title({ translate: 'ads.ui.admin.manage.title' });
        const tasksList = Array.from(this.db.tasks.values());
        if (tasksList.length === 0) {
            form.body({ translate: 'ads.ui.admin.manage.empty' });
            form.button({ translate: 'ads.ui.admin.btn_back' });
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.openMenu(player));
            });
            return;
        }
        form.body({ translate: 'ads.ui.admin.manage.body', with: [String(tasksList.length)] });
        tasksList.forEach((t) => {
            let tags = '';
            if (t.repeatable) tags += ' §d⟳';
            if (t.deadline) tags += ' §c⏰';
            if (t.chainId) tags += ' §8🔗';
            
            form.button({ rawtext: [
                { text: `${t.active ? '§a' : '§c'}${t.name}${tags}\n` },
                { translate: 'ads.ui.admin.manage.item_id', with: [t.id] }
            ] });
        });
        
        form.button({ translate: 'ads.ui.admin.btn_back' });

        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === tasksList.length) {
                    this.openMenu(player);
                    return;
                }
                const task = tasksList[r.selection];
                
                let body = [];
                body.push({ translate: 'ads.ui.admin.manage.detail_id', with: [task.id] });
                body.push({ translate: 'ads.ui.admin.manage.detail_type', with: [task.type] });
                body.push({ translate: 'ads.ui.admin.manage.detail_target', with: [task.targetRaw || JSON.stringify(task.target)] });
                body.push({ translate: 'ads.ui.admin.manage.detail_prereq', with: [task.prereq || 'None'] });
                body.push({ translate: 'ads.ui.admin.manage.detail_points', with: [String(task.points || 0)] });
                body.push({ translate: 'ads.ui.admin.manage.detail_repeatable', with: [task.repeatable ? 'Yes' : 'No', formatTime(task.cooldownSec || 0)] });
                
                if (task.chainId) {
                    const chain = this.db.chains.get(task.chainId);
                    body.push({ translate: 'ads.ui.admin.manage.detail_chain', with: [chain?.name || task.chainId] });
                }
                if (task.rewards?.pool?.length > 0) {
                    body.push({ translate: 'ads.ui.admin.manage.detail_pool', with: [String(task.rewards.pool.length)] });
                }
                if (task.deadline) {
                    const left = Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000));
                    body.push({ translate: 'ads.ui.admin.manage.detail_time', with: [formatTime(left)] });
                }

                new MessageFormData()
                    .title({ translate: 'ads.ui.admin.manage.detail_title', with: [task.name] })
                    .body({ rawtext: body })
                    .button1({ translate: 'ads.ui.admin.manage.btn_edit' })
                    .button2({ translate: 'ads.ui.admin.manage.btn_toggle' })
                    .show(player).then(res => {
                        system.run(() => {
                            if (res.selection === 0) {
                                this.uiCreateQuest(player, task);
                            }
                            if (res.selection === 1) {
                                new MessageFormData()
                                    .title({ translate: 'ads.ui.admin.manage.opt_title' })
                                    .body({ translate: 'ads.ui.admin.manage.opt_body' })
                                    .button1({ translate: 'ads.ui.admin.manage.btn_delete' })
                                    .button2({ translate: 'ads.ui.admin.manage.btn_toggle_active' })
                                    .show(player).then(x => {
                                        system.run(() => {
                                            if (x.selection === 0) {
                                                this.db.tasks.delete(task.id);
                                                this.db.saveTasks();
                                                player.sendMessage({ translate: 'ads.ui.admin.manage.msg_deleted' });
                                                this.uiManageQuests(player);
                                            }
                                            if (x.selection === 1) {
                                                task.active = !task.active;
                                                this.db.saveTasks();
                                                player.sendMessage({ translate: task.active ? 'ads.ui.admin.manage.msg_activated' : 'ads.ui.admin.manage.msg_deactivated' });
                                                this.uiManageQuests(player);
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
        const form = new ActionFormData().title({ translate: 'ads.ui.admin.chains.title' });
        const chainsList = Array.from(this.db.chains.values());
        form.body({ translate: 'ads.ui.admin.chains.body', with: [String(chainsList.length)] });
        form.button({ translate: 'ads.ui.admin.chains.btn_create' }, 'textures/items/chain');
        chainsList.forEach(c => {
            const questCount = c.quests.length;
            form.button({ translate: 'ads.ui.admin.chains.item_btn', with: [c.name, c.arc, String(questCount)] }, c.icon || 'textures/items/book_written');
        });
        form.button({ translate: 'ads.ui.admin.btn_back' });
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
            .title({ translate: editChain ? 'ads.ui.admin.chains.title_edit' : 'ads.ui.admin.chains.title_new' })
            .textField({ translate: 'ads.ui.admin.chains.lbl_name' }, { translate: 'ads.ui.admin.chains.pl_name' }, { defaultValue: editChain?.name || '' })
            .textField({ translate: 'ads.ui.admin.chains.lbl_desc' }, { translate: 'ads.ui.admin.chains.pl_desc' }, { defaultValue: editChain?.description || '' })
            .textField({ translate: 'ads.ui.admin.chains.lbl_arc' }, { translate: 'ads.ui.admin.chains.pl_arc' }, { defaultValue: editChain?.arc || 'Main Story' })
            .textField({ translate: 'ads.ui.admin.chains.lbl_ids' }, { translate: 'ads.ui.admin.chains.pl_ids' }, { defaultValue: editChain?.quests?.join(';') || '' })
            .slider({ translate: 'ads.ui.admin.chains.lbl_bonus' }, 0, 500, { valueStep: 10, defaultValue: editChain?.completionRewards?.points || 50 })
            .textField({ translate: 'ads.ui.admin.chains.lbl_cmds' }, { translate: 'ads.ui.admin.chains.pl_cmds' }, { defaultValue: editChain?.completionRewards?.commands?.join(';') || '' })
            .textField({ translate: 'ads.ui.admin.chains.lbl_msg' }, { translate: 'ads.ui.admin.chains.pl_msg' }, { defaultValue: editChain?.completionRewards?.message || '' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, description, arc, questIdsRaw, bonusPts, rewardCmdsRaw, completionMsg] = r.formValues;
                if (!name || !name.trim()) {
                    player.sendMessage({ translate: 'ads.ui.admin.chains.err_name' });
                    return;
                }
                const questIds = questIdsRaw ? questIdsRaw.split(';').filter(s => s.trim()) : [];
                const rewardCmds = rewardCmdsRaw ? rewardCmdsRaw.split(';').filter(s => s.trim()) : [];
                const missing = questIds.filter(id => !this.db.tasks.has(id));
                if (missing.length > 0) {
                    player.sendMessage({ translate: 'ads.ui.admin.chains.err_missing', with: [missing.join(', ')] });
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
                player.sendMessage({ translate: editChain ? 'ads.ui.admin.chains.msg_updated' : 'ads.ui.admin.chains.msg_created', with: [name, String(questIds.length), String(bonusPts)] });
            });
    }

    uiEditChain(player, chain) {
        let body = [];
        body.push({ translate: 'ads.ui.admin.chains.detail_name', with: [chain.name] });
        body.push({ translate: 'ads.ui.admin.chains.detail_arc', with: [chain.arc] });
        body.push({ translate: 'ads.ui.admin.chains.detail_quests', with: [String(chain.quests.length)] });
        body.push({ translate: 'ads.ui.admin.chains.detail_bonus', with: [String(chain.completionRewards?.points || 0)] });
        body.push({ translate: 'ads.ui.admin.chains.detail_order' });
        
        chain.quests.forEach((qId, i) => {
            const task = this.db.tasks.get(qId);
            body.push({ text: `  §7${i + 1}. §f${task?.name || qId}\n` });
        });

        new MessageFormData()
            .title({ translate: 'ads.ui.admin.chains.detail_title', with: [chain.name] })
            .body({ rawtext: body })
            .button1({ translate: 'ads.ui.admin.chains.btn_edit' })
            .button2({ translate: 'ads.ui.admin.chains.btn_delete' })
            .show(player).then(r => {
                system.run(() => {
                    if (r.selection === 0) {
                        this.uiCreateChain(player, chain);
                    } else if (r.selection === 1) {
                        this.chains.deleteChain(chain.id);
                        player.sendMessage({ translate: 'ads.ui.admin.chains.msg_deleted', with: [chain.name] });
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

        new MessageFormData()
            .title({ translate: 'ads.ui.admin.stats.title' })
            .body({ translate: 'ads.ui.admin.stats.body', with: [
                String(activeQuests), String(totalQuests),
                String(totalQuests - activeQuests), String(repeatableQuests), String(timedQuests),
                String(chainedQuests), String(totalChains),
                String(exchangeItems),
                String(onlinePlayers), String(savedPlayers),
                String(totalCompletions),
                String(totalPoints),
                String(totalAchievements),
                String(bestStreak),
                topPlayer ? topPlayer.name : 'N/A', String(topPlayer?.data.points || 0),
                mostCompleted.name, String(mostCompleted.count)
            ]})
            .button1({ translate: 'ads.ui.admin.btn_back' })
            .button2({ translate: 'ads.ui.btn_close' })
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.openMenu(player));
            });
    }

    uiShowGuide(player) {
        new ActionFormData()
            .title({ translate: 'ads.ui.admin.guide.title' })
            .body({ translate: 'ads.ui.admin.guide.body' })
            .button({ translate: 'ads.ui.admin.guide.btn_quick' }, 'textures/items/book_normal')
            .button({ translate: 'ads.ui.admin.guide.btn_blocks' }, 'textures/items/diamond_pickaxe')
            .button({ translate: 'ads.ui.admin.guide.btn_combat' }, 'textures/items/diamond_sword')
            .button({ translate: 'ads.ui.admin.guide.btn_travel' }, 'textures/items/compass_item')
            .button({ translate: 'ads.ui.admin.guide.btn_rewards' }, 'textures/items/gold_ingot')
            .button({ translate: 'ads.ui.admin.guide.btn_chains' }, 'textures/items/chain')
            .button({ translate: 'ads.ui.admin.guide.btn_tools' }, 'textures/items/clock_item')
            .button({ translate: 'ads.ui.admin.btn_back' })
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
        const pages = ['quick', 'blocks', 'combat', 'travel', 'rewards', 'chains', 'tools'];
        const pageKey = pages[pageIndex];

        new MessageFormData()
            .title({ translate: `ads.ui.admin.guide.title_${pageKey}` })
            .body({ translate: `ads.ui.admin.guide.body_${pageKey}` })
            .button1({ translate: 'ads.ui.admin.guide.btn_back' })
            .button2({ translate: 'ads.ui.btn_close' })
            .show(player).then(r => {
                if (r.selection === 0) system.run(() => this.uiShowGuide(player));
            });
    }
}
