import { world, system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
import { CONFIG, TYPES } from '../config.js';
import { formatTime } from '../utils.js';
import { parseObjectives, getObjectives, getPrerequisites, questFolder, taskOrder, folderOrder } from '../objective_utils.js';

export class AdminUI {
    constructor(db, chainMgr, npcMgr, backupMgr, uiRouter) {
        this.db = db;
        this.chains = chainMgr;
        this.npcs = npcMgr;
        this.backups = backupMgr;
        this.router = uiRouter;
    }

    openMenu(player) {
        new ActionFormData()
            .title('§5§lQUEST SYSTEM ADMIN')
            .body(`§7Task System v${CONFIG.VERSION}\n\n§f${this.db.tasks.size} quests • ${this.db.chains.size} chains • ${this.db.shop.size} shop items\n§7Create advanced quests, bind NPCs, and protect the database from this dashboard.`)
            .button('§aCreate Quest\n§7Multi-objective advanced editor', 'textures/items/book_writable')
            .button('§eManage Quests\n§7Edit, reorder or disable', 'textures/items/book_written')
            .button('§6Quest Chains\n§7Story progression lines', 'textures/items/chain')
            .button('§6Shop Manager\n§7Items and categorized menus', 'textures/items/gold_ingot')
            .button('§bNPC Quest Givers\n§7Bind quests and shops to entities', 'textures/ui/quest_npc')
            .button('§dDatabase Backups\n§7Create, restore or delete snapshots', 'textures/ui/quest_backup')
            .button('§3Leaderboard', 'textures/ui/quest_type_approach')
            .button('§5Admin Statistics', 'textures/items/clock_item')
            .button('§cReset Player Data\n§7Choose an online player', 'textures/ui/quest_refresh')
            .button('§eAdmin Guide', 'textures/items/book_normal')
            .button('§fOpen Player Mode', 'textures/ui/quest_dashboard')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    switch (result.selection) {
                        case 0: this.uiCreateQuest(player); break;
                        case 1: this.uiManageQuests(player); break;
                        case 2: this.uiManageChains(player); break;
                        case 3: this.router.openShopAdmin(player); break;
                        case 4: this.uiNpcBindings(player); break;
                        case 5: this.uiBackups(player); break;
                        case 6: this.router.openLeaderboard(player, 'admin'); break;
                        case 7: this.uiAdminStats(player); break;
                        case 8: this.uiResetPlayer(player); break;
                        case 9: this.uiShowGuide(player); break;
                        case 10: this.router.openPlayerLog(player); break;
                    }
                });
            });
    }

    questTypeMeta(type) {
        const definitions = {
            [TYPES.BLOCK]: {
                label: 'Destroy Blocks', description: 'Count blocks broken by the player.', icon: 'textures/ui/quest_type_block',
                targetLabel: 'Block identifier', placeholder: 'minecraft:stone', quantityLabel: 'Blocks to destroy', defaultReq: 10
            },
            [TYPES.KILL]: {
                label: 'Kill Entities', description: 'Count defeated mobs or entities.', icon: 'textures/ui/quest_type_kill',
                targetLabel: 'Entity identifier', placeholder: 'minecraft:zombie', quantityLabel: 'Entities to kill', defaultReq: 5
            },
            [TYPES.VISIT]: {
                label: 'Visit Location', description: 'Reach a coordinate within a chosen radius.', icon: 'textures/ui/quest_type_visit',
                targetLabel: 'Coordinates (x,y,z)', placeholder: '100,64,-30', fixedReq: 1, usesRadius: true
            },
            [TYPES.WALK]: {
                label: 'Checkpoint Path', description: 'Visit coordinates in the listed order.', icon: 'textures/ui/quest_type_walk',
                targetLabel: 'Checkpoints separated by semicolons', placeholder: '0,64,0;50,70,20;100,65,0', fixedReq: 1, usesRadius: true
            },
            [TYPES.GATHER]: {
                label: 'Gather Items', description: 'Have the required items in inventory.', icon: 'textures/ui/quest_type_gather',
                targetLabel: 'Item identifier', placeholder: 'minecraft:rotten_flesh', quantityLabel: 'Items required', defaultReq: 10
            },
            [TYPES.LEVEL]: {
                label: 'Reach Level', description: 'Reach the required experience level.', icon: 'textures/ui/quest_type_level',
                needsTarget: false, quantityLabel: 'Required experience level', defaultReq: 10
            },
            [TYPES.CRAFT]: {
                label: 'Craft Items', description: 'Count crafted items.', icon: 'textures/ui/quest_type_craft',
                targetLabel: 'Crafted item identifier', placeholder: 'minecraft:bread', quantityLabel: 'Items to craft', defaultReq: 5
            },
            [TYPES.DEATH]: {
                label: 'Player Deaths', description: 'Count player deaths.', icon: 'textures/ui/quest_type_death',
                needsTarget: false, quantityLabel: 'Deaths required', defaultReq: 1
            },
            [TYPES.FISH]: {
                label: 'Catch Fish', description: 'Count a chosen caught fish item.', icon: 'textures/ui/quest_type_fish',
                targetLabel: 'Caught item identifier', placeholder: 'minecraft:cod', quantityLabel: 'Catches required', defaultReq: 5
            },
            [TYPES.USE_ITEM]: {
                label: 'Use Item', description: 'Count uses of a chosen item.', icon: 'textures/ui/quest_type_use_item',
                targetLabel: 'Item identifier', placeholder: 'minecraft:ender_pearl', quantityLabel: 'Uses required', defaultReq: 5
            },
            [TYPES.PLACE]: {
                label: 'Place Blocks', description: 'Count blocks placed by the player.', icon: 'textures/ui/quest_type_place',
                targetLabel: 'Block identifier', placeholder: 'minecraft:oak_planks', quantityLabel: 'Blocks to place', defaultReq: 20
            },
            [TYPES.DISTANCE]: {
                label: 'Travel Distance', description: 'Count blocks travelled by the player.', icon: 'textures/ui/quest_type_distance',
                needsTarget: false, quantityLabel: 'Distance in blocks', defaultReq: 1000
            },
            [TYPES.EFFECT]: {
                label: 'Status Effect', description: 'Count seconds while a status effect is active.', icon: 'textures/ui/quest_type_effect',
                targetLabel: 'Effect identifier', placeholder: 'poison', quantityLabel: 'Seconds required', defaultReq: 30
            },
            [TYPES.APPROACH]: {
                label: 'Approach Entity', description: 'Get close to a chosen entity type.', icon: 'textures/ui/quest_type_approach',
                targetLabel: 'Entity identifier', placeholder: 'minecraft:villager', fixedReq: 1, usesRadius: true
            }
        };
        return definitions[type] || definitions[TYPES.BLOCK];
    }

    uiCreateQuest(player) {
        if (this.db.tasks.size >= CONFIG.MAX_TASKS) {
            player.sendMessage(`§c[Quest System] Quest limit reached (${CONFIG.MAX_TASKS}).`);
            return;
        }
        this.uiSelectObjectiveType(
            player,
            '§a§lCREATE QUEST',
            type => this.uiCreateQuestBasics(player, type),
            () => this.openMenu(player)
        );
    }

    uiSelectObjectiveType(player, title, onSelect, onBack) {
        const types = Object.values(TYPES);
        const form = new ActionFormData().title(title)
            .body('§7Choose a quest type first. The next screen will only show fields that are relevant to that type.');
        types.forEach(type => {
            const meta = this.questTypeMeta(type);
            form.button(`§f${meta.label}\n§7${meta.description}`, meta.icon);
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === types.length) onBack();
                else onSelect(types[result.selection] || TYPES.BLOCK);
            });
        });
    }

    uiCreateQuestBasics(player, type, previous = {}) {
        new ModalFormData().title(`Create ${this.questTypeMeta(type).label}`)
            .textField('Quest name', 'Example: The Rotten Army', { defaultValue: previous.name || '' })
            .textField('Description', 'Explain the objective and story', { defaultValue: previous.desc || '' })
            .textField('Chapter / folder', 'Main Story', { defaultValue: previous.folder || 'Main Story' })
            .textField('Chapter order (lower appears first)', '0', { defaultValue: String(previous.folderOrder ?? 0) })
            .textField('Quest order inside chapter', '0', { defaultValue: String(previous.order ?? 0) })
            .show(player).then(result => {
                if (result.canceled) return;
                const [nameRaw, descRaw, folderRaw, folderOrderRaw, orderRaw] = result.formValues;
                const name = String(nameRaw || '').trim();
                if (!name) {
                    player.sendMessage('§c[Quest System] Quest name cannot be empty.');
                    system.run(() => this.uiCreateQuestBasics(player, type, {
                        name: nameRaw, desc: descRaw, folder: folderRaw, folderOrder: folderOrderRaw, order: orderRaw
                    }));
                    return;
                }
                const draft = {
                    type,
                    name,
                    desc: String(descRaw || ''),
                    folder: String(folderRaw || 'Uncategorized').trim() || 'Uncategorized',
                    folderOrder: Number(folderOrderRaw) || 0,
                    order: Number(orderRaw) || 0
                };
                system.run(() => this.uiCreateQuestObjective(player, draft));
            });
    }

    buildObjectiveForm(title, type, existing = null) {
        const meta = this.questTypeMeta(type);
        const form = new ModalFormData().title(title);
        const layout = [];
        const needsTarget = meta.needsTarget !== false;
        if (needsTarget) {
            form.textField(meta.targetLabel || 'Target identifier', meta.placeholder || 'minecraft:stone', {
                defaultValue: existing?.targetRaw || (typeof existing?.target === 'string' ? existing.target : '') || ''
            });
            layout.push('target');
        }
        if (meta.fixedReq === undefined) {
            form.textField(meta.quantityLabel || 'Required amount', String(meta.defaultReq || 1), {
                defaultValue: String(existing?.req ?? meta.defaultReq ?? 1)
            });
            layout.push('quantity');
        }
        if (meta.usesRadius) {
            form.textField('Trigger radius in blocks', String(CONFIG.PROXIMITY), {
                defaultValue: String(existing?.radius ?? CONFIG.PROXIMITY)
            });
            layout.push('radius');
        }
        form.textField('Objective label shown to players (optional)', meta.label, { defaultValue: existing?.label || '' });
        layout.push('label');
        return { form, layout, meta };
    }

    parseObjectiveForm(type, values, layout, meta) {
        let targetRaw = '';
        let req = meta.fixedReq ?? meta.defaultReq ?? 1;
        let radius = CONFIG.PROXIMITY;
        let label = '';
        layout.forEach((field, index) => {
            const value = values[index];
            if (field === 'target') targetRaw = String(value || '').trim();
            else if (field === 'quantity') req = Math.max(1, Math.min(1000000000, Math.floor(Number(value) || 1)));
            else if (field === 'radius') radius = Math.max(1, Math.min(128, Math.floor(Number(value) || CONFIG.PROXIMITY)));
            else if (field === 'label') label = String(value || '').trim();
        });
        const objective = parseObjectives('', type, targetRaw, req)[0];
        objective.radius = radius;
        objective.label = label;
        return objective;
    }

    uiCreateQuestObjective(player, draft) {
        const built = this.buildObjectiveForm(`Objective: ${this.questTypeMeta(draft.type).label}`, draft.type);
        built.form.show(player).then(result => {
            if (result.canceled) return;
            const objective = this.parseObjectiveForm(draft.type, result.formValues, built.layout, built.meta);
            if (built.meta.needsTarget !== false && !objective.targetRaw) {
                player.sendMessage('§c[Quest System] This quest type needs a target.');
                system.run(() => this.uiCreateQuestObjective(player, draft));
                return;
            }
            draft.objectives = [objective];
            system.run(() => this.uiCreateQuestRules(player, draft));
        });
    }

    uiCreateQuestRules(player, draft) {
        const visibilityValues = ['chapter', 'chain', 'npc', 'everywhere'];
        const scopeValues = ['player', 'party', 'server'];
        new ModalFormData().title('Quest Rules')
            .toggle(`Player must activate quest (${CONFIG.MAX_ACTIVE_QUESTS} active maximum)`, { defaultValue: true })
            .toggle('Hidden until all prerequisites are completed', { defaultValue: false })
            .dropdown('Where this quest appears', ['Chapter / folder', 'Quest chain only', 'NPC only', 'Everywhere'], { defaultValueIndex: 0 })
            .dropdown('Who shares progress', ['Individual player', 'Party / co-op', 'Entire server'], { defaultValueIndex: 0 })
            .toggle('Repeatable quest', { defaultValue: false })
            .textField('Cooldown in seconds (0 = immediate)', '86400', { defaultValue: String(CONFIG.DEFAULT_COOLDOWN) })
            .textField('Time limit in minutes (0 = none)', '0', { defaultValue: '0' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [manualStart, hidden, visibilityIndex, scopeIndex, repeatable, cooldownRaw, timeLimitRaw] = result.formValues;
                draft.manualStart = Boolean(manualStart);
                draft.hidden = Boolean(hidden);
                draft.visibility = visibilityValues[visibilityIndex] || 'chapter';
                draft.scope = scopeValues[scopeIndex] || 'player';
                draft.repeatable = Boolean(repeatable);
                draft.cooldownSec = draft.repeatable ? Math.max(0, Math.floor(Number(cooldownRaw) || 0)) : 0;
                draft.timeLimitMin = Math.max(0, Number(timeLimitRaw) || 0);
                system.run(() => this.uiCreateQuestRewards(player, draft));
            });
    }

    uiCreateQuestRewards(player, draft) {
        new ModalFormData().title('Quest Rewards')
            .textField('Reward description shown to players', '1 Diamond', { defaultValue: '' })
            .textField('Reward commands separated by semicolons', 'give @s diamond 1', { defaultValue: '' })
            .textField('Quest points', '50', { defaultValue: String(CONFIG.DEFAULT_QUEST_POINTS) })
            .textField('First-completion bonus points', '0', { defaultValue: '0' })
            .textField('Random reward pool commands separated by semicolons', 'give @s emerald 1;give @s diamond 1', { defaultValue: '' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [rewardTextRaw, commandRaw, pointsRaw, firstBonusRaw, poolRaw] = result.formValues;
                draft.rewardTxt = String(rewardTextRaw || 'None');
                draft.commands = String(commandRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                draft.points = Math.max(0, Math.floor(Number(pointsRaw) || 0));
                draft.firstTimeBonus = Math.max(0, Math.floor(Number(firstBonusRaw) || 0));
                draft.pool = String(poolRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                system.run(() => this.saveNewQuest(player, draft));
            });
    }

    saveNewQuest(player, draft) {
        const id = `q_${Date.now().toString(36)}`;
        const first = draft.objectives[0];
        const task = {
            id,
            active: true,
            name: draft.name,
            desc: draft.desc,
            folder: draft.folder,
            category: draft.folder,
            folderOrder: draft.folderOrder,
            order: draft.order,
            type: first.type,
            target: first.target,
            targetRaw: first.targetRaw,
            req: first.req,
            objectives: draft.objectives,
            prerequisites: [],
            prereq: null,
            hidden: draft.hidden,
            manualStart: draft.manualStart,
            visibility: draft.visibility,
            scope: draft.scope,
            rewardCmd: draft.commands[0] || '',
            rewardTxt: draft.rewardTxt,
            points: draft.points,
            repeatable: draft.repeatable,
            cooldownSec: draft.repeatable ? draft.cooldownSec : 0,
            deadline: draft.timeLimitMin > 0 ? Date.now() + draft.timeLimitMin * 60000 : null,
            chainId: null,
            rewards: {
                commands: draft.commands,
                pool: draft.pool,
                points: draft.points,
                firstTimeBonus: draft.repeatable ? draft.firstTimeBonus : 0
            }
        };
        this.db.tasks.set(id, task);
        for (const existing of this.db.tasks.values()) {
            if (questFolder(existing) === task.folder) existing.folderOrder = task.folderOrder;
        }
        this.db.saveTasks();
        player.sendMessage(`§a[Quest System] Created §f${task.name}§a. ID: §7${task.id}`);
        system.run(() => this.uiAfterQuestCreated(player, task));
    }

    uiAfterQuestCreated(player, task) {
        new ActionFormData().title('§a§lQUEST CREATED')
            .body(`§f${task.name}\n§7ID: ${task.id}\n\n§7You no longer need to type IDs. Use the buttons below to select prerequisite quests, add more objectives, or bind the quest to the nearest NPC.`)
            .button('§eSelect Prerequisite Quests', 'textures/items/chain')
            .button('§6Add Another Objective', 'textures/ui/quest_multi')
            .button('§bBind This Quest to Nearest NPC', 'textures/ui/quest_npc')
            .button('§fReview / Edit Quest', 'textures/items/book_written')
            .button('§aDone', 'textures/ui/quest_dashboard')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiManagePrerequisites(player, task, 'post');
                    else if (result.selection === 1) this.uiSelectObjectiveType(player, '§6§lADD OBJECTIVE', type => this.uiObjectiveForm(player, task, -1, type, 'post'), () => this.uiAfterQuestCreated(player, task));
                    else if (result.selection === 2) {
                        const bound = this.npcs.bindNearest(player, 'quest', task.id);
                        player.sendMessage(bound.ok ? `§a[Quest System] ${task.name} is now bound to ${bound.entity.typeId}.` : `§c[Quest System] ${bound.reason}`);
                        this.uiAfterQuestCreated(player, task);
                    } else if (result.selection === 3) this.uiQuestAdminDetails(player, task);
                    else this.uiManageQuests(player);
                });
            });
    }

    uiManageQuests(player) {
        const tasks = Array.from(this.db.tasks.values()).sort((a, b) => folderOrder(a) - folderOrder(b) || questFolder(a).localeCompare(questFolder(b)) || taskOrder(a) - taskOrder(b) || a.name.localeCompare(b.name));
        const form = new ActionFormData().title('§e§lMANAGE QUESTS');
        form.body(`§7${tasks.length}/${CONFIG.MAX_TASKS} quests. Select a quest to edit its basic information, objectives, prerequisites, visibility, and rewards separately.`);
        tasks.forEach(task => {
            const tags = [task.active ? '§aON' : '§cOFF', task.scope === 'party' ? '§bCO-OP' : task.scope === 'server' ? '§dSERVER' : '', task.hidden ? '§8HIDDEN' : '', getObjectives(task).length > 1 ? `§6${getObjectives(task).length} OBJ` : ''].filter(Boolean).join(' ');
            form.button(`§f${task.name}\n${tags} §7• ${questFolder(task)} • ${task.id}`, getObjectives(task).length > 1 ? 'textures/ui/quest_multi' : 'textures/items/book_written');
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === tasks.length) this.openMenu(player);
                else this.uiQuestAdminDetails(player, tasks[result.selection]);
            });
        });
    }

    uiQuestAdminDetails(player, task) {
        const objectives = getObjectives(task);
        const prerequisiteNames = getPrerequisites(task).map(id => this.db.tasks.get(id)?.name || id);
        let body = `ID: ${task.id}\nChapter: ${questFolder(task)} (order ${folderOrder(task)})\nVisibility: ${task.visibility}\nScope: ${task.scope}\nOrder: ${task.order || 0}\nActive: ${task.active ? 'Yes' : 'No'}\nManual start: ${task.manualStart ? 'Yes' : 'No'}\nHidden: ${task.hidden ? 'Yes' : 'No'}\nRepeatable: ${task.repeatable ? `Yes (${formatTime(task.cooldownSec ?? 0)})` : 'No'}\nPrerequisites: ${prerequisiteNames.join(', ') || 'None'}\n\nObjectives:\n`;
        objectives.forEach((objective, index) => body += `${index + 1}. ${this.questTypeMeta(objective.type).label}: ${objective.targetRaw || '-'} (${objective.req})${objective.label ? ` - ${objective.label}` : ''}\n`);
        new ActionFormData().title(`§e§l${task.name}`).body(body)
            .button('§fEdit Basic Information', 'textures/items/book_writable')
            .button(`§6Manage Objectives\n§7${objectives.length}/${CONFIG.MAX_OBJECTIVES}`, 'textures/ui/quest_multi')
            .button(`§eManage Prerequisites\n§7${prerequisiteNames.length} selected`, 'textures/items/chain')
            .button('§dRules, Visibility & Repeat', 'textures/ui/quest_toggle_on')
            .button('§aRewards', 'textures/items/emerald')
            .button('§bBind to Nearest NPC', 'textures/ui/quest_npc')
            .button(task.active ? '§cDisable Quest' : '§aEnable Quest', 'textures/ui/quest_refresh')
            .button('§cDelete Quest', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiEditQuestBasics(player, task);
                    else if (result.selection === 1) this.uiManageObjectives(player, task);
                    else if (result.selection === 2) this.uiManagePrerequisites(player, task, 'details');
                    else if (result.selection === 3) this.uiEditQuestRules(player, task);
                    else if (result.selection === 4) this.uiEditQuestRewards(player, task);
                    else if (result.selection === 5) {
                        const bound = this.npcs.bindNearest(player, 'quest', task.id);
                        player.sendMessage(bound.ok ? `§a[Quest System] Bound ${task.name} to ${bound.entity.typeId}.` : `§c[Quest System] ${bound.reason}`);
                        this.uiQuestAdminDetails(player, task);
                    } else if (result.selection === 6) {
                        task.active = !task.active;
                        this.db.saveTasks();
                        this.uiQuestAdminDetails(player, task);
                    } else if (result.selection === 7) this.uiConfirmDeleteQuest(player, task);
                    else this.uiManageQuests(player);
                });
            });
    }

    uiEditQuestBasics(player, task) {
        new ModalFormData().title(`Edit ${task.name}`)
            .textField('Quest name', 'Quest name', { defaultValue: task.name || '' })
            .textField('Description', 'Quest story and instructions', { defaultValue: task.desc || '' })
            .textField('Chapter / folder', 'Main Story', { defaultValue: questFolder(task) })
            .textField('Chapter order', '0', { defaultValue: String(task.folderOrder ?? 0) })
            .textField('Quest order inside chapter', '0', { defaultValue: String(task.order ?? 0) })
            .show(player).then(result => {
                if (result.canceled) return;
                const [nameRaw, descRaw, folderRaw, folderOrderRaw, orderRaw] = result.formValues;
                const name = String(nameRaw || '').trim();
                if (!name) {
                    player.sendMessage('§c[Quest System] Quest name cannot be empty.');
                    system.run(() => this.uiEditQuestBasics(player, task));
                    return;
                }
                task.name = name;
                task.desc = String(descRaw || '');
                task.folder = String(folderRaw || 'Uncategorized').trim() || 'Uncategorized';
                task.category = task.folder;
                task.folderOrder = Number(folderOrderRaw) || 0;
                task.order = Number(orderRaw) || 0;
                for (const existing of this.db.tasks.values()) {
                    if (questFolder(existing) === task.folder) existing.folderOrder = task.folderOrder;
                }
                this.db.saveTasks();
                player.sendMessage('§a[Quest System] Basic quest information updated.');
                system.run(() => this.uiQuestAdminDetails(player, task));
            });
    }

    uiEditQuestRules(player, task) {
        const visibilityValues = ['chapter', 'chain', 'npc', 'everywhere'];
        const scopeValues = ['player', 'party', 'server'];
        const deadlineMin = task.deadline ? Math.max(0, Math.round((task.deadline - Date.now()) / 60000)) : 0;
        new ModalFormData().title(`Rules: ${task.name}`)
            .toggle(`Player must activate quest (${CONFIG.MAX_ACTIVE_QUESTS} active maximum)`, { defaultValue: task.manualStart ?? true })
            .toggle('Hidden until all prerequisites are completed', { defaultValue: task.hidden || false })
            .dropdown('Where this quest appears', ['Chapter / folder', 'Quest chain only', 'NPC only', 'Everywhere'], { defaultValueIndex: Math.max(0, visibilityValues.indexOf(task.visibility || 'chapter')) })
            .dropdown('Who shares progress', ['Individual player', 'Party / co-op', 'Entire server'], { defaultValueIndex: Math.max(0, scopeValues.indexOf(task.scope || 'player')) })
            .toggle('Repeatable quest', { defaultValue: task.repeatable || false })
            .textField('Cooldown in seconds (0 = immediate)', '86400', { defaultValue: String(task.cooldownSec ?? CONFIG.DEFAULT_COOLDOWN) })
            .textField('Time limit in minutes (0 = none)', '0', { defaultValue: String(deadlineMin) })
            .show(player).then(result => {
                if (result.canceled) return;
                const [manualStart, hidden, visibilityIndex, scopeIndex, repeatable, cooldownRaw, timeLimitRaw] = result.formValues;
                task.manualStart = Boolean(manualStart);
                task.hidden = Boolean(hidden);
                task.visibility = visibilityValues[visibilityIndex] || 'chapter';
                task.scope = scopeValues[scopeIndex] || 'player';
                task.repeatable = Boolean(repeatable);
                task.cooldownSec = task.repeatable ? Math.max(0, Math.floor(Number(cooldownRaw) || 0)) : 0;
                const timeLimitMin = Math.max(0, Number(timeLimitRaw) || 0);
                task.deadline = timeLimitMin > 0 ? Date.now() + timeLimitMin * 60000 : null;
                this.db.saveTasks();
                player.sendMessage('§a[Quest System] Quest rules updated.');
                system.run(() => this.uiQuestAdminDetails(player, task));
            });
    }

    uiEditQuestRewards(player, task) {
        new ModalFormData().title(`Rewards: ${task.name}`)
            .textField('Reward description shown to players', '1 Diamond', { defaultValue: task.rewardTxt || '' })
            .textField('Reward commands separated by semicolons', 'give @s diamond 1', { defaultValue: task.rewards?.commands?.join(';') || task.rewardCmd || '' })
            .textField('Quest points', '50', { defaultValue: String(task.points ?? task.rewards?.points ?? 0) })
            .textField('First-completion bonus points', '0', { defaultValue: String(task.rewards?.firstTimeBonus ?? 0) })
            .textField('Random reward pool commands separated by semicolons', 'give @s emerald 1;give @s diamond 1', { defaultValue: task.rewards?.pool?.join(';') || '' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [rewardTextRaw, commandRaw, pointsRaw, firstBonusRaw, poolRaw] = result.formValues;
                const commands = String(commandRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                const pool = String(poolRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                const points = Math.max(0, Math.floor(Number(pointsRaw) || 0));
                task.rewardTxt = String(rewardTextRaw || 'None');
                task.rewardCmd = commands[0] || '';
                task.points = points;
                task.rewards = {
                    ...(task.rewards || {}),
                    commands,
                    pool,
                    points,
                    firstTimeBonus: Math.max(0, Math.floor(Number(firstBonusRaw) || 0))
                };
                this.db.saveTasks();
                player.sendMessage('§a[Quest System] Rewards updated.');
                system.run(() => this.uiQuestAdminDetails(player, task));
            });
    }

    uiManageObjectives(player, task) {
        const objectives = getObjectives(task);
        const form = new ActionFormData().title(`§6§lOBJECTIVES: ${task.name}`)
            .body(`§7Each objective has its own type-specific editor. A quest completes only after all ${objectives.length} objective(s) are complete.`)
            .button(`§aAdd Objective\n§7${objectives.length}/${CONFIG.MAX_OBJECTIVES}`, 'textures/ui/quest_multi');
        objectives.forEach((objective, index) => {
            const meta = this.questTypeMeta(objective.type);
            form.button(`§f${index + 1}. ${meta.label}\n§7${objective.label || objective.targetRaw || `${objective.req} required`}`, meta.icon);
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === 0) {
                    if (objectives.length >= CONFIG.MAX_OBJECTIVES) {
                        player.sendMessage(`§c[Quest System] Maximum ${CONFIG.MAX_OBJECTIVES} objectives reached.`);
                        this.uiManageObjectives(player, task);
                    } else {
                        this.uiSelectObjectiveType(player, '§6§lADD OBJECTIVE', type => this.uiObjectiveForm(player, task, -1, type, 'objectives'), () => this.uiManageObjectives(player, task));
                    }
                } else if (result.selection === objectives.length + 1) this.uiQuestAdminDetails(player, task);
                else this.uiObjectiveDetails(player, task, result.selection - 1);
            });
        });
    }

    uiObjectiveDetails(player, task, index) {
        const objective = getObjectives(task)[index];
        if (!objective) {
            this.uiManageObjectives(player, task);
            return;
        }
        const meta = this.questTypeMeta(objective.type);
        new ActionFormData().title(`§6§l${meta.label}`)
            .body(`Type: ${objective.type}\nTarget: ${objective.targetRaw || '-'}\nRequired: ${objective.req}\nRadius: ${objective.radius || CONFIG.PROXIMITY}\nLabel: ${objective.label || 'Automatic'}`)
            .button('§aEdit / Change Type', 'textures/items/book_writable')
            .button('§cDelete Objective', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiSelectObjectiveType(player, '§6§lCHOOSE OBJECTIVE TYPE', type => this.uiObjectiveForm(player, task, index, type, 'objectives'), () => this.uiManageObjectives(player, task));
                    else if (result.selection === 1) {
                        const objectives = getObjectives(task);
                        if (objectives.length <= 1) {
                            player.sendMessage('§c[Quest System] A quest must have at least one objective.');
                        } else {
                            objectives.splice(index, 1);
                            task.objectives = objectives;
                            this.syncPrimaryObjective(task);
                            this.db.saveTasks();
                            player.sendMessage('§e[Quest System] Objective deleted.');
                        }
                        this.uiManageObjectives(player, task);
                    } else this.uiManageObjectives(player, task);
                });
            });
    }

    uiObjectiveForm(player, task, index, type, returnTarget = 'objectives') {
        const existing = index >= 0 ? getObjectives(task)[index] : null;
        const built = this.buildObjectiveForm(index >= 0 ? `Edit ${this.questTypeMeta(type).label}` : `Add ${this.questTypeMeta(type).label}`, type, existing);
        built.form.show(player).then(result => {
            if (result.canceled) return;
            const objective = this.parseObjectiveForm(type, result.formValues, built.layout, built.meta);
            if (built.meta.needsTarget !== false && !objective.targetRaw) {
                player.sendMessage('§c[Quest System] This objective type needs a target.');
                system.run(() => this.uiObjectiveForm(player, task, index, type, returnTarget));
                return;
            }
            const objectives = getObjectives(task);
            if (index >= 0) objectives[index] = objective;
            else objectives.push(objective);
            task.objectives = objectives.slice(0, CONFIG.MAX_OBJECTIVES);
            this.syncPrimaryObjective(task);
            this.db.saveTasks();
            player.sendMessage(`§a[Quest System] ${index >= 0 ? 'Objective updated' : 'Objective added'}.`);
            system.run(() => returnTarget === 'post' ? this.uiAfterQuestCreated(player, task) : this.uiManageObjectives(player, task));
        });
    }

    syncPrimaryObjective(task) {
        const first = getObjectives(task)[0];
        task.type = first.type;
        task.target = first.target;
        task.targetRaw = first.targetRaw;
        task.req = first.req;
    }

    wouldCreatePrerequisiteCycle(taskId, candidateId) {
        if (taskId === candidateId) return true;
        const stack = [candidateId];
        const visited = new Set();
        while (stack.length) {
            const id = stack.pop();
            if (id === taskId) return true;
            if (visited.has(id)) continue;
            visited.add(id);
            const task = this.db.tasks.get(id);
            if (!task) continue;
            getPrerequisites(task).forEach(prerequisiteId => stack.push(prerequisiteId));
        }
        return false;
    }

    uiManagePrerequisites(player, task, returnTarget = 'details') {
        const selected = new Set(getPrerequisites(task));
        const candidates = Array.from(this.db.tasks.values())
            .filter(candidate => candidate.id !== task.id)
            .sort((a, b) => questFolder(a).localeCompare(questFolder(b)) || a.name.localeCompare(b.name));
        const form = new ActionFormData().title(`§e§lPREREQUISITES: ${task.name}`)
            .body('§7Click quests to select or remove them. Players must complete every selected quest before this quest unlocks. No Quest IDs need to be typed.');
        candidates.forEach(candidate => {
            const checked = selected.has(candidate.id);
            const cycle = !checked && this.wouldCreatePrerequisiteCycle(task.id, candidate.id);
            form.button(`${checked ? '§a[Selected]' : cycle ? '§8[Cycle blocked]' : '§7[Not selected]'} §f${candidate.name}\n§7${questFolder(candidate)} • ${candidate.id}`, 'textures/items/book_written');
        });
        form.button('§cClear All', 'textures/ui/quest_close');
        form.button('§aDone', 'textures/ui/quest_dashboard');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection < candidates.length) {
                    const candidate = candidates[result.selection];
                    if (selected.has(candidate.id)) selected.delete(candidate.id);
                    else if (this.wouldCreatePrerequisiteCycle(task.id, candidate.id)) {
                        player.sendMessage('§c[Quest System] That prerequisite would create a circular dependency.');
                    } else selected.add(candidate.id);
                    task.prerequisites = Array.from(selected);
                    task.prereq = task.prerequisites[0] || null;
                    this.db.saveTasks();
                    this.uiManagePrerequisites(player, task, returnTarget);
                } else if (result.selection === candidates.length) {
                    task.prerequisites = [];
                    task.prereq = null;
                    this.db.saveTasks();
                    player.sendMessage('§e[Quest System] All prerequisites removed.');
                    this.uiManagePrerequisites(player, task, returnTarget);
                } else if (returnTarget === 'post') this.uiAfterQuestCreated(player, task);
                else this.uiQuestAdminDetails(player, task);
            });
        });
    }

    uiConfirmDeleteQuest(player, task) {
        new MessageFormData().title('Delete Quest?')
            .body(`Delete ${task.name} (${task.id})? This also removes it from quest chains and from other quests' prerequisite lists. Existing player history is retained.`)
            .button1('Delete')
            .button2('Cancel')
            .show(player).then(result => {
                system.run(() => {
                    if (result.selection === 0) {
                        this.db.tasks.delete(task.id);
                        this.db.chains.forEach(chain => chain.quests = chain.quests.filter(id => id !== task.id));
                        this.db.tasks.forEach(other => {
                            other.prerequisites = getPrerequisites(other).filter(id => id !== task.id);
                            other.prereq = other.prerequisites[0] || null;
                        });
                        this.db.saveTasks();
                        this.db.saveChains();
                        player.sendMessage(`§e[Quest System] Deleted ${task.name}.`);
                    }
                    this.uiManageQuests(player);
                });
            });
    }


    uiManageChains(player) {
        const chains = Array.from(this.db.chains.values());
        const form = new ActionFormData().title('§6§lQUEST CHAINS');
        form.body(`§7${chains.length}/${CONFIG.MAX_CHAINS} progression chains.`);
        form.button('§aCreate Chain', 'textures/items/chain');
        chains.forEach(chain => form.button(`§f${chain.name}\n§7${chain.arc} • ${chain.quests.length} quests`, chain.icon || 'textures/items/chain'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === 0) this.uiCreateChain(player);
                else if (result.selection === chains.length + 1) this.openMenu(player);
                else this.uiEditChain(player, chains[result.selection - 1]);
            });
        });
    }

    uiCreateChain(player, editChain = null) {
        new ModalFormData().title(editChain ? 'Edit Quest Chain' : 'Create Quest Chain')
            .textField('Chain name', 'Dragon Saga', { defaultValue: editChain?.name || '' })
            .textField('Description', 'Story description', { defaultValue: editChain?.description || '' })
            .textField('Arc / chapter label', 'Main Story', { defaultValue: editChain?.arc || 'Main Story' })
            .textField('Ordered Quest IDs separated by semicolons', 'q_one;q_two;q_three', { defaultValue: editChain?.quests?.join(';') || '' })
            .textField('Completion bonus points', '100', { defaultValue: String(editChain?.completionRewards?.points ?? 50) })
            .textField('Completion reward commands', 'give @s diamond 3', { defaultValue: editChain?.completionRewards?.commands?.join(';') || '' })
            .textField('Completion message', 'The saga is complete!', { defaultValue: editChain?.completionRewards?.message || '' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [nameRaw, description, arc, idsRaw, bonusRaw, commandsRaw, message] = result.formValues;
                const name = String(nameRaw || '').trim();
                if (!name) { player.sendMessage('§c[Quest System] Chain name is required.'); return; }
                const ids = String(idsRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                const missing = ids.filter(id => !this.db.tasks.has(id));
                if (missing.length) { player.sendMessage(`§c[Quest System] Missing quest IDs: ${missing.join(', ')}`); return; }
                const commands = String(commandsRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                this.chains.createChain({
                    id: editChain?.id,
                    name,
                    description: String(description || ''),
                    arc: String(arc || 'Side Story'),
                    quests: ids,
                    completionRewards: { commands, points: Math.max(0, Math.floor(Number(bonusRaw) || 0)), message: String(message || `${name} complete!`) },
                    active: true
                });
                player.sendMessage(`§a[Quest System] ${editChain ? 'Updated' : 'Created'} chain ${name}.`);
                system.run(() => this.uiManageChains(player));
            });
    }

    uiEditChain(player, chain) {
        let body = `Arc: ${chain.arc}\nQuests: ${chain.quests.length}\nBonus: ${chain.completionRewards?.points || 0} points\n\nOrder:\n`;
        chain.quests.forEach((id, index) => body += `${index + 1}. ${this.db.tasks.get(id)?.name || id}\n`);
        new ActionFormData().title(`§6§l${chain.name}`).body(body)
            .button('§aEdit Chain', 'textures/items/book_writable')
            .button('§cDelete Chain', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiCreateChain(player, chain);
                    else if (result.selection === 1) {
                        this.chains.deleteChain(chain.id);
                        player.sendMessage(`§e[Quest System] Deleted chain ${chain.name}.`);
                        this.uiManageChains(player);
                    } else this.uiManageChains(player);
                });
            });
    }

    uiNpcBindings(player) {
        const nearest = this.npcs.nearestEntity(player);
        const nearestLabel = nearest ? `${nearest.typeId}${nearest.nameTag ? ` (${nearest.nameTag})` : ''}` : 'No valid entity within 8 blocks';
        const bindingLabel = nearest ? this.npcs.describeBinding(nearest) : 'None';
        new ActionFormData().title('§b§lNPC QUEST GIVERS')
            .body(`§7Nearest target: §f${nearestLabel}\n§7Current binding: §f${bindingLabel}\n\n§7Stand close to an NPC or mob. You will select the quest, chapter, or shop from a list, so no IDs need to be typed.\n\n§8Vanilla NPC fallback command:\n§7/scriptevent tasksystem:open_npc`)
            .button('§aBind Nearest Entity', 'textures/ui/quest_npc')
            .button('§eTest Nearest Binding', 'textures/ui/quest_dashboard')
            .button('§cRemove Nearest Binding', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiBindNpc(player);
                    else if (result.selection === 1) {
                        const opened = this.npcs.openNearestBound(player);
                        if (!opened) player.sendMessage('§c[Quest System] The nearest entity has no valid binding.');
                        else player.sendMessage('§a[Quest System] NPC binding test opened successfully.');
                    } else if (result.selection === 2) {
                        player.sendMessage(this.npcs.unbindNearest(player) ? '§a[Quest System] NPC binding removed.' : '§c[Quest System] No nearby entity found.');
                        this.uiNpcBindings(player);
                    } else this.openMenu(player);
                });
            });
    }

    uiBindNpc(player) {
        const nearest = this.npcs.nearestEntity(player);
        if (!nearest) {
            player.sendMessage('§c[Quest System] Stand within 8 blocks of an NPC or mob first. Players and dropped items are ignored.');
            this.uiNpcBindings(player);
            return;
        }
        new ActionFormData().title('§b§lCHOOSE NPC MENU')
            .body(`§7Binding target: §f${nearest.typeId}${nearest.nameTag ? ` (${nearest.nameTag})` : ''}\n\n§7Choose what should open when a player interacts with it.`)
            .button('§eSpecific Quest', 'textures/items/book_written')
            .button('§6Quest Chapter / Folder', 'textures/ui/quest_folder')
            .button('§aShop Category', 'textures/items/emerald')
            .button('§bFull Quest Dashboard', 'textures/ui/quest_dashboard')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiBindNpcQuest(player);
                    else if (result.selection === 1) this.uiBindNpcFolder(player);
                    else if (result.selection === 2) this.uiBindNpcShop(player);
                    else if (result.selection === 3) {
                        const bound = this.npcs.bindNearest(player, 'dashboard', '');
                        player.sendMessage(bound.ok ? '§a[Quest System] NPC now opens the full quest dashboard.' : `§c[Quest System] ${bound.reason}`);
                        this.uiNpcBindings(player);
                    } else this.uiNpcBindings(player);
                });
            });
    }

    uiBindNpcQuest(player) {
        const tasks = Array.from(this.db.tasks.values()).sort((a, b) => questFolder(a).localeCompare(questFolder(b)) || a.name.localeCompare(b.name));
        const form = new ActionFormData().title('§e§lSELECT NPC QUEST')
            .body('§7Select by quest name. The internal Quest ID will be handled automatically.');
        tasks.forEach(task => form.button(`§f${task.name}\n§7${questFolder(task)} • ${task.id}`, getObjectives(task).length > 1 ? 'textures/ui/quest_multi' : 'textures/items/book_written'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === tasks.length) this.uiBindNpc(player);
                else {
                    const task = tasks[result.selection];
                    const bound = this.npcs.bindNearest(player, 'quest', task.id);
                    player.sendMessage(bound.ok ? `§a[Quest System] NPC bound to quest §f${task.name}§a.` : `§c[Quest System] ${bound.reason}`);
                    this.uiNpcBindings(player);
                }
            });
        });
    }

    uiBindNpcFolder(player) {
        const folders = this.db.getFolders(true);
        const form = new ActionFormData().title('§6§lSELECT NPC CHAPTER')
            .body('§7Select the chapter that this NPC should open.');
        folders.forEach(folder => form.button(`§f${folder.name}\n§7${folder.count} quest(s)`, 'textures/ui/quest_folder'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === folders.length) this.uiBindNpc(player);
                else {
                    const folder = folders[result.selection];
                    const bound = this.npcs.bindNearest(player, 'folder', folder.name);
                    player.sendMessage(bound.ok ? `§a[Quest System] NPC bound to chapter §f${folder.name}§a.` : `§c[Quest System] ${bound.reason}`);
                    this.uiNpcBindings(player);
                }
            });
        });
    }

    uiBindNpcShop(player) {
        const categories = Array.from(new Set(Array.from(this.db.shop.values()).map(item => item.category || 'General'))).sort();
        const form = new ActionFormData().title('§a§lSELECT NPC SHOP')
            .body('§7Select a shop category, or let the NPC open the complete shop.');
        form.button('§fAll Shop Categories', 'textures/items/emerald');
        categories.forEach(category => form.button(`§f${category}`, 'textures/items/emerald'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === categories.length + 1) this.uiBindNpc(player);
                else {
                    const category = result.selection === 0 ? 'all' : categories[result.selection - 1];
                    const bound = this.npcs.bindNearest(player, 'shop', category);
                    player.sendMessage(bound.ok ? `§a[Quest System] NPC bound to ${category === 'all' ? 'the full shop' : `shop category ${category}`}.` : `§c[Quest System] ${bound.reason}`);
                    this.uiNpcBindings(player);
                }
            });
        });
    }


    uiBackups(player) {
        const backups = this.backups.list();
        const form = new ActionFormData().title('§d§lDATABASE BACKUPS');
        form.body(`§7Up to ${CONFIG.MAX_BACKUPS} compressed world snapshots are stored in dynamic-property chunks. Backups include quests, chains, shops, all stored player profiles, parties and bounties.`);
        form.button('§aCreate Backup Now', 'textures/ui/quest_backup');
        backups.forEach(entry => form.button(`§f${entry.label}\n§7${new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 16)} • ${Math.ceil(entry.bytes / 1024)} KB`, 'textures/items/book_written'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === 0) this.uiCreateBackup(player);
                else if (result.selection === backups.length + 1) this.openMenu(player);
                else this.uiBackupDetails(player, backups[result.selection - 1]);
            });
        });
    }

    uiCreateBackup(player) {
        new ModalFormData().title('Create Database Backup')
            .textField('Backup label', 'Before major update', { defaultValue: `Manual ${new Date().toISOString().slice(0, 10)}` })
            .show(player).then(result => {
                if (result.canceled) return;
                try {
                    const entry = this.backups.create(result.formValues[0]);
                    player.sendMessage(`§a[Quest System] Backup created: §f${entry.label}`);
                } catch (e) {
                    player.sendMessage(`§c[Quest System] Backup failed: ${e}`);
                }
                system.run(() => this.uiBackups(player));
            });
    }

    uiBackupDetails(player, entry) {
        new ActionFormData().title(`§d§l${entry.label}`)
            .body(`Created: ${new Date(entry.createdAt).toISOString()}\nSize: ${entry.bytes} bytes\nChunks: ${entry.chunks}\n\nRestoring replaces current quest-system data. Create a fresh backup first.`)
            .button('§eRestore Backup', 'textures/ui/quest_refresh')
            .button('§cDelete Backup', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    try {
                        if (result.selection === 0) {
                            this.backups.restore(entry.id);
                            player.sendMessage(`§a[Quest System] Restored ${entry.label}.`);
                        } else if (result.selection === 1) {
                            this.backups.delete(entry.id);
                            player.sendMessage(`§e[Quest System] Deleted ${entry.label}.`);
                        }
                    } catch (e) {
                        player.sendMessage(`§c[Quest System] Backup operation failed: ${e}`);
                    }
                    this.uiBackups(player);
                });
            });
    }

    uiResetPlayer(player) {
        const players = world.getAllPlayers();
        const form = new ActionFormData().title('§c§lRESET PLAYER DATA');
        form.body('§7Choose an online player. This clears quest progress, points, achievements, active quests, party link and bounty progress.');
        players.forEach(target => form.button(`§f${target.name}${target.id === player.id ? ' §7(You)' : ''}`, 'textures/ui/quest_user'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === players.length) this.openMenu(player);
                else this.uiConfirmResetPlayer(player, players[result.selection]);
            });
        });
    }

    uiConfirmResetPlayer(admin, target) {
        new MessageFormData().title(`Reset ${target.name}?`)
            .body('This action cannot be undone unless a database backup exists.')
            .button1('Reset')
            .button2('Cancel')
            .show(admin).then(result => {
                system.run(() => {
                    if (result.selection === 0) {
                        this.db.resetPlayer(target.id);
                        target.sendMessage('§c[Quest System] Your quest data was reset by an administrator.');
                        admin.sendMessage(`§a[Quest System] Reset ${target.name}.`);
                    }
                    this.uiResetPlayer(admin);
                });
            });
    }

    uiAdminStats(player) {
        const tasks = Array.from(this.db.tasks.values());
        const players = Array.from(this.db.playerData.values());
        const folders = new Set(tasks.map(task => questFolder(task))).size;
        const multi = tasks.filter(task => getObjectives(task).length > 1).length;
        const coOp = tasks.filter(task => task.scope === 'party').length;
        const npcOnly = tasks.filter(task => task.visibility === 'npc').length;
        const totalCompletions = players.reduce((sum, data) => sum + (data.stats?.tasksCompleted || 0), 0);
        const totalPoints = players.reduce((sum, data) => sum + (data.points || 0), 0);
        const body = `§eQuest Content\n§f${tasks.filter(task => task.active).length}/${tasks.length} active quests\n§f${folders} chapters\n§f${multi} multi-objective quests\n§f${coOp} party quests\n§f${npcOnly} NPC-only quests\n§f${this.db.chains.size} chains\n§f${this.db.shop.size} shop items\n\n§bLive Systems\n§f${world.getAllPlayers().length} online players\n§f${players.length} loaded player profiles\n§f${totalCompletions} total completions\n§f${totalPoints} wallet points held\n§f${this.backups.list().length} backups`;
        new ActionFormData().title('§5§lADMIN STATISTICS').body(body)
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(() => system.run(() => this.openMenu(player)));
    }

    uiShowGuide(player) {
        const body = `§eCreating a Quest
§7Choose a quest type first. Each type opens a smaller form containing only the target, amount, radius, or other fields it needs.

§ePrerequisites
§7Open Manage Quests, select a quest, then choose Manage Prerequisites. Click quest names to select multiple prerequisites. IDs are handled automatically.

§eMultiple Objectives
§7Open Manage Objectives and add each objective separately. Every objective must be completed for the quest to finish.

§eVisibility
§fchapter §7appears inside folders.
§fchain §7appears only through its chain.
§fnpc §7opens only from a bound entity.
§feverywhere §7appears in normal chapter menus and may also be bound.

§eNPC Binding
§7Stand within eight blocks of an NPC or mob, choose NPC Quest Givers, then select a quest, chapter, or shop by name. Bound interactions cancel the normal entity interaction before opening the quest UI. For a vanilla NPC button fallback, use:
§f/scriptevent tasksystem:open_npc

§eCo-Op
§7Set progress scope to Party / co-op. Every party member contributes to the same objective progress.`;
        new ActionFormData().title('§e§lADMIN GUIDE').body(body)
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(() => system.run(() => this.openMenu(player)));
    }
}
