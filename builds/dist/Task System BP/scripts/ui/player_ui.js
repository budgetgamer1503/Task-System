import { world, system } from '@minecraft/server';
import { ActionFormData, MessageFormData, ModalFormData } from '@minecraft/server-ui';
import { CONFIG, ACHIEVEMENTS } from '../config.js';
import { getProgressBar, formatTime } from '../utils.js';
import { getObjectives, getPrerequisites, prerequisitesMet, questFolder, taskOrder, folderOrder, objectiveTitle } from '../objective_utils.js';

export class PlayerUI {
    constructor(db, chainMgr, achievementMgr, partyMgr, bountyMgr, questMgr, uiRouter) {
        this.db = db;
        this.chains = chainMgr;
        this.achievements = achievementMgr;
        this.parties = partyMgr;
        this.bounties = bountyMgr;
        this.quests = questMgr;
        this.router = uiRouter;
    }

    openQuestLog(player) {
        const data = this.db.getPlayer(player.id);
        const activeTasks = Array.from(this.db.tasks.values()).filter(task => task.active);
        const visibleTasks = activeTasks.filter(task => !task.hidden || prerequisitesMet(data, task));
        const available = visibleTasks.filter(task => prerequisitesMet(data, task) && !this.quests.isCompleted(player, task.id)).length;
        const party = this.parties.getPartyForPlayer(player.id);
        const activeBounties = this.bounties.active().length;
        const achievementProgress = this.achievements.getProgress(player.id);

        new ActionFormData()
            .title('§6§lQUEST HUB')
            .body(`§7A cleaner dashboard for every quest system.\n\n§dWallet: §f${data.points} points\n§aAvailable quests: §f${available}\n§eActive quests: §f${data.activeQuests.length}/${CONFIG.MAX_ACTIVE_QUESTS}\n§bParty: §f${party?.name || 'None'}\n§6Bounties: §f${activeBounties}\n§5Achievements: §f${achievementProgress.unlocked}/${achievementProgress.total}`)
            .button('§e§lQuests & Chapters\n§7Browse organized quest folders', 'textures/ui/quest_folder')
            .button(`§a§lActive Quests\n§7${data.activeQuests.length}/${CONFIG.MAX_ACTIVE_QUESTS} selected`, 'textures/ui/quest_dashboard')
            .button('§6§lQuest Chains\n§7Story progression lines', 'textures/items/chain')
            .button(`§b§lParty / Co-Op\n§7${party ? party.name : 'Create or join a party'}`, 'textures/ui/quest_party')
            .button(`§c§lPlayer Bounties\n§7${activeBounties} currently available`, 'textures/ui/quest_bounty')
            .button('§d§lAchievements\n§7View your achievement vault', 'textures/items/nether_star')
            .button('§6§lQuest Shop\n§7Spend your quest points', 'textures/items/gold_ingot')
            .button('§3§lLeaderboard\n§7Compare server progress', 'textures/items/spyglass')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    switch (result.selection) {
                        case 0: this.uiQuestFolders(player); break;
                        case 1: this.uiActiveQuests(player); break;
                        case 2: this.uiPlayerChains(player); break;
                        case 3: this.uiParty(player); break;
                        case 4: this.uiBounties(player); break;
                        case 5: this.uiAchievements(player); break;
                        case 6: this.router.openShopPlayer(player); break;
                        case 7: this.openLeaderboard(player); break;
                    }
                });
            });
    }

    getChapterTasks(player, folder, allowNpcOnly = false) {
        const data = this.db.getPlayer(player.id);
        return Array.from(this.db.tasks.values())
            .filter(task => task.active && questFolder(task) === folder)
            .filter(task => allowNpcOnly || task.visibility !== 'npc')
            .filter(task => task.visibility !== 'chain')
            .filter(task => !task.hidden || prerequisitesMet(data, task))
            .sort((a, b) => taskOrder(a) - taskOrder(b) || a.name.localeCompare(b.name));
    }

    uiQuestFolders(player) {
        const data = this.db.getPlayer(player.id);
        const groups = new Map();
        for (const task of this.db.tasks.values()) {
            if (!task.active || task.visibility === 'npc' || task.visibility === 'chain') continue;
            if (task.hidden && !prerequisitesMet(data, task)) continue;
            const folder = questFolder(task);
            if (!groups.has(folder)) groups.set(folder, []);
            groups.get(folder).push(task);
        }
        const folders = Array.from(groups.entries()).sort((a, b) => {
            const aOrder = Math.min(...a[1].map(folderOrder));
            const bOrder = Math.min(...b[1].map(folderOrder));
            return aOrder - bOrder || a[0].localeCompare(b[0]);
        });
        const form = new ActionFormData().title('§e§lQUEST CHAPTERS');
        form.body('§7Choose a chapter instead of searching through one giant quest list.');
        folders.forEach(([name, tasks]) => {
            const completed = tasks.filter(task => this.quests.isCompleted(player, task.id)).length;
            const unlocked = tasks.filter(task => prerequisitesMet(data, task)).length;
            form.button(`§f§l${name}\n§7${completed}/${tasks.length} complete • ${unlocked} unlocked`, 'textures/ui/quest_folder');
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === folders.length) this.openQuestLog(player);
                else this.openFolder(player, folders[result.selection][0]);
            });
        });
    }

    openFolder(player, folder, allowNpcOnly = false) {
        const tasks = this.getChapterTasks(player, folder, allowNpcOnly);
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title(`§e§l${folder}`);
        form.body(`§7${tasks.length} quests in this chapter. Select a quest for objectives, rewards and tracking.`);
        tasks.forEach(task => {
            const completed = this.quests.isCompleted(player, task.id);
            const locked = !prerequisitesMet(data, task);
            const active = data.activeQuests.includes(task.id);
            const values = this.quests.getObjectiveValues(player, task);
            const objectives = getObjectives(task);
            const finishedObjectives = values.filter((value, index) => value >= objectives[index].req).length;
            let prefix = '§e○';
            let icon = 'textures/items/paper';
            if (locked) { prefix = '§8🔒'; icon = 'textures/items/chain'; }
            else if (completed) { prefix = '§a✔'; icon = 'textures/items/emerald'; }
            else if (active) { prefix = '§b▶'; icon = 'textures/items/spyglass'; }
            const scope = task.scope === 'party' ? ' §b[CO-OP]' : task.scope === 'server' ? ' §d[SERVER]' : '';
            form.button(`${prefix} §f${task.name}${scope}\n§7${finishedObjectives}/${objectives.length} objectives • §d${task.points || 0} pts`, icon);
        });
        form.button('§8Back to Chapters', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === tasks.length) this.uiQuestFolders(player);
                else this.uiTaskDetails(player, tasks[result.selection], allowNpcOnly ? 'npc' : 'folder');
            });
        });
    }

    uiActiveQuests(player) {
        const data = this.db.getPlayer(player.id);
        const tasks = data.activeQuests.map(id => this.db.tasks.get(id)).filter(Boolean);
        const form = new ActionFormData().title('§a§lACTIVE QUESTS');
        form.body(`§7You can actively select up to ${CONFIG.MAX_ACTIVE_QUESTS} manual-start quests. Legacy automatic quests continue working normally.`);
        tasks.forEach(task => form.button(`§f${task.name}\n§7${questFolder(task)} • ${task.scope}`, 'textures/items/spyglass'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === tasks.length) this.openQuestLog(player);
                else this.uiTaskDetails(player, tasks[result.selection], 'active');
            });
        });
    }

    uiTaskDetails(player, task, source = 'folder') {
        const data = this.db.getPlayer(player.id);
        const completed = this.quests.isCompleted(player, task.id);
        const locked = !prerequisitesMet(data, task);
        const accepted = data.activeQuests.includes(task.id);
        const cooldownEnd = data.repeatCooldowns[task.id];
        const onCooldown = cooldownEnd && Date.now() < cooldownEnd;
        const objectives = getObjectives(task);
        const values = this.quests.getObjectiveValues(player, task);
        const prerequisites = getPrerequisites(task);

        let body = `§7${task.desc || 'No description.'}\n\n§6Chapter: §f${questFolder(task)}\n§6Scope: §f${task.scope || 'player'}\n§6Reward: §d${task.points || 0} points\n`;
        if (task.repeatable) body += `§6Repeatable: §fYes (${formatTime(Number(task.cooldownSec ?? 0))})\n`;
        if (task.deadline) body += `§cTime remaining: §f${formatTime(Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000)))}\n`;
        if (prerequisites.length) {
            body += '\n§ePrerequisites:\n';
            prerequisites.forEach(id => body += `${data.completed.includes(id) ? '§a✔' : '§c✖'} §f${this.db.tasks.get(id)?.name || id}\n`);
        }
        body += '\n§eObjectives:\n';
        objectives.forEach((objective, index) => {
            const current = Math.min(objective.req, values[index] || 0);
            body += `${current >= objective.req ? '§a✔' : '§7○'} §f${objectiveTitle(objective, index)}\n   ${getProgressBar(current, objective.req, 10)} §f${Math.floor(current)}/${objective.req}\n`;
        });
        if (locked) body += '\n§cThis quest is locked until every prerequisite is complete.';
        else if (onCooldown) body += `\n§cCooldown: ${formatTime(Math.ceil((cooldownEnd - Date.now()) / 1000))}`;
        else if (completed) body += '\n§aQuest completed.';
        else if (task.manualStart && !accepted) body += `\n§eSelect Start Quest to add it to your ${CONFIG.MAX_ACTIVE_QUESTS}-quest active list.`;

        const form = new ActionFormData().title(`§6§l${task.name}`).body(body);
        const actions = [];
        if (!completed && !locked && !onCooldown && task.manualStart) {
            if (accepted) {
                form.button('§cAbandon Active Quest\n§7Progress is kept', 'textures/ui/quest_close');
                actions.push('abandon');
            } else {
                form.button('§aStart Quest\n§7Add to active quest list', 'textures/ui/quest_dashboard');
                actions.push('accept');
            }
        }
        if (!completed && !locked && !onCooldown && (!task.manualStart || accepted)) {
            form.button(data.tracked === task.id ? '§cStop HUD Tracking' : '§bTrack on HUD', 'textures/items/spyglass');
            actions.push('track');
        }
        form.button('§8Back', 'textures/ui/quest_back');
        actions.push('back');

        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                const action = actions[result.selection];
                if (action === 'accept') {
                    if (data.activeQuests.length >= CONFIG.MAX_ACTIVE_QUESTS) {
                        player.sendMessage(`§c[Quest System] You already have ${CONFIG.MAX_ACTIVE_QUESTS} active quests.`);
                    } else if (!data.activeQuests.includes(task.id)) {
                        data.activeQuests.push(task.id);
                        this.db.savePlayer(player.id);
                        player.sendMessage(`§a[Quest System] Started: §f${task.name}`);
                    }
                    this.uiTaskDetails(player, task, source);
                } else if (action === 'abandon') {
                    data.activeQuests = data.activeQuests.filter(id => id !== task.id);
                    if (data.tracked === task.id) data.tracked = null;
                    this.db.savePlayer(player.id);
                    this.uiActiveQuests(player);
                } else if (action === 'track') {
                    data.tracked = data.tracked === task.id ? null : task.id;
                    this.db.savePlayer(player.id);
                    this.uiTaskDetails(player, task, source);
                } else {
                    if (source === 'npc') this.openQuestLog(player);
                    else if (source === 'active') this.uiActiveQuests(player);
                    else this.openFolder(player, questFolder(task));
                }
            });
        });
    }

    uiParty(player) {
        const party = this.parties.getPartyForPlayer(player.id);
        if (!party) {
            new ActionFormData()
                .title('§b§lPARTY / CO-OP')
                .body('§7Create a party or enter a six-character code. Party-scoped quests share objective progress between all members.')
                .button('§aCreate Party', 'textures/ui/quest_party')
                .button('§eJoin with Code', 'textures/items/name_tag')
                .button('§8Back', 'textures/ui/quest_back')
                .show(player).then(result => {
                    if (result.canceled) return;
                    system.run(() => {
                        if (result.selection === 0) this.uiCreateParty(player);
                        else if (result.selection === 1) this.uiJoinParty(player);
                        else this.openQuestLog(player);
                    });
                });
            return;
        }
        const memberText = party.members.map(member => `${member.id === party.ownerId ? '§6★' : '§7•'} §f${member.name}`).join('\n');
        new ActionFormData()
            .title(`§b§l${party.name}`)
            .body(`§eJoin Code: §f§l${party.code}\n§7Share this code with teammates.\n\n§eMembers (${party.members.length}):\n${memberText}\n\n§aShared quests completed: §f${party.completed?.length || 0}`)
            .button('§bView Co-Op Quests', 'textures/ui/quest_multi')
            .button('§cLeave Party', 'textures/ui/quest_close')
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === 0) this.uiScopeQuests(player, 'party');
                    else if (result.selection === 1) {
                        this.parties.leave(player);
                        player.sendMessage('§e[Quest System] You left the party.');
                        this.openQuestLog(player);
                    } else this.openQuestLog(player);
                });
            });
    }

    uiCreateParty(player) {
        new ModalFormData().title('Create Party')
            .textField('Party name', 'Example: Dragon Hunters', { defaultValue: `${player.name}'s Party` })
            .show(player).then(result => {
                if (result.canceled) return;
                const party = this.parties.create(player, result.formValues[0]);
                player.sendMessage(`§a[Quest System] Party created. Join code: §f${party.code}`);
                system.run(() => this.uiParty(player));
            });
    }

    uiJoinParty(player) {
        new ModalFormData().title('Join Party')
            .textField('Six-character party code', 'ABC123')
            .show(player).then(result => {
                if (result.canceled) return;
                const joined = this.parties.join(player, result.formValues[0]);
                player.sendMessage(joined.ok ? `§a[Quest System] Joined §f${joined.party.name}` : `§c[Quest System] ${joined.reason}`);
                if (joined.ok) this.quests.syncSharedCompletions(player);
                system.run(() => this.uiParty(player));
            });
    }

    uiScopeQuests(player, scope) {
        const tasks = Array.from(this.db.tasks.values()).filter(task => task.active && task.scope === scope).sort((a, b) => taskOrder(a) - taskOrder(b));
        const form = new ActionFormData().title(scope === 'party' ? '§b§lCO-OP QUESTS' : '§d§lSERVER QUESTS');
        form.body(`§7${tasks.length} ${scope}-scoped quests share progress.`);
        tasks.forEach(task => form.button(`§f${task.name}\n§7${questFolder(task)} • ${getObjectives(task).length} objectives`, 'textures/ui/quest_multi'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === tasks.length) this.uiParty(player);
                else this.uiTaskDetails(player, tasks[result.selection], 'active');
            });
        });
    }

    getBountyObjectiveText(bounty) {
        const labels = {
            player_kill: 'Hunt player',
            kill: 'Kill entity',
            block: 'Break block',
            place: 'Place block',
            gather: 'Gather item'
        };
        const target = bounty.type === 'player_kill'
            ? (bounty.targetName || bounty.target)
            : bounty.target;
        return `${labels[bounty.type] || bounty.type}: ${target}`;
    }

    uiBounties(player) {
        const bounties = this.bounties.active();
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title('§c§lPLAYER BOUNTY BOARD');
        form.body(`§7Any player can fund a public task from their own balance. The first eligible player to finish it receives the reward.\n\n§dYour balance: §f${data.points}`);
        form.button('§aPost a New Bounty', 'textures/ui/quest_bounty');
        bounties.forEach(bounty => {
            const current = data.bountyProgress[bounty.id] || 0;
            form.button(`§f${bounty.name}\n§7${this.getBountyObjectiveText(bounty)} ${current}/${bounty.req} • §d${bounty.reward} pts`, 'textures/ui/quest_bounty');
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === 0) this.uiCreateBounty(player);
                else if (result.selection === bounties.length + 1) this.openQuestLog(player);
                else this.uiBountyDetails(player, bounties[result.selection - 1]);
            });
        });
    }

    uiCreateBounty(player) {
        const types = [
            { id: 'player_kill', title: '§cHunt a Player', desc: 'Reward the first eligible player who eliminates a chosen player.' },
            { id: 'kill', title: '§6Kill an Entity', desc: 'Example: minecraft:skeleton' },
            { id: 'block', title: '§eBreak Blocks', desc: 'Example: minecraft:stone' },
            { id: 'place', title: '§aPlace Blocks', desc: 'Example: minecraft:oak_planks' },
            { id: 'gather', title: '§bGather Items', desc: 'Example: minecraft:diamond' }
        ];
        const form = new ActionFormData().title('§c§lCHOOSE BOUNTY TYPE')
            .body('§7Each bounty type now opens its own relevant setup screen.');
        types.forEach(type => form.button(`${type.title}\n§7${type.desc}`, 'textures/ui/quest_bounty'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === types.length) this.uiBounties(player);
                else if (types[result.selection].id === 'player_kill') this.uiChooseBountyTargetPlayer(player);
                else this.uiCreateStandardBounty(player, types[result.selection].id);
            });
        });
    }

    uiChooseBountyTargetPlayer(player) {
        const targets = world.getAllPlayers().filter(target => target.id !== player.id);
        const form = new ActionFormData().title('§c§lCHOOSE TARGET PLAYER');
        form.body(targets.length
            ? '§7Choose the player who must be eliminated. The bounty remains active if they leave and later return.'
            : '§cNo other players are online. A player-hunt bounty requires an online target during creation.');
        targets.forEach(target => form.button(`§f${target.name}\n§7Post an elimination request`, 'textures/ui/quest_bounty'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === targets.length) this.uiCreateBounty(player);
                else this.uiCreatePlayerKillBounty(player, targets[result.selection]);
            });
        });
    }

    uiCreatePlayerKillBounty(player, targetPlayer) {
        const targetName = targetPlayer.name;
        const targetId = targetPlayer.id;
        new ModalFormData().title(`Player Hunt: ${targetName}`)
            .textField('Bounty name', `Example: Hunt ${targetName}`, { defaultValue: `Hunt ${targetName}` })
            .textField('Description', 'Why should this player be hunted?', { defaultValue: `Eliminate ${targetName}.` })
            .textField('Funded reward points', '100', { defaultValue: '100' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [name, desc, reward] = result.formValues;
                const created = this.bounties.create(player, {
                    name,
                    desc,
                    type: 'player_kill',
                    target: targetName,
                    targetName,
                    targetId,
                    req: 1,
                    reward
                });
                player.sendMessage(created.ok
                    ? `§a[Bounty] Posted a player-hunt request for §f${targetName}§a.`
                    : `§c[Bounty] ${created.reason}`);
                system.run(() => this.uiBounties(player));
            });
    }

    uiCreateStandardBounty(player, type) {
        const settings = {
            kill: { title: 'Kill Entity Bounty', target: 'Entity identifier', placeholder: 'minecraft:skeleton', example: 'Skeleton Cleanup' },
            block: { title: 'Break Block Bounty', target: 'Block identifier', placeholder: 'minecraft:stone', example: 'Mining Contract' },
            place: { title: 'Place Block Bounty', target: 'Block identifier', placeholder: 'minecraft:oak_planks', example: 'Builder Contract' },
            gather: { title: 'Gather Item Bounty', target: 'Item identifier', placeholder: 'minecraft:diamond', example: 'Resource Request' }
        }[type];
        if (!settings) return this.uiCreateBounty(player);
        new ModalFormData().title(settings.title)
            .textField('Bounty name', `Example: ${settings.example}`)
            .textField('Description', 'What should players do?')
            .textField(settings.target, settings.placeholder)
            .textField('Required quantity', '25', { defaultValue: '10' })
            .textField('Funded reward points', '100', { defaultValue: '50' })
            .show(player).then(result => {
                if (result.canceled) return;
                const [name, desc, target, req, reward] = result.formValues;
                const created = this.bounties.create(player, { name, desc, type, target, req, reward });
                player.sendMessage(created.ok ? `§a[Bounty] Posted §f${created.bounty.name}` : `§c[Bounty] ${created.reason}`);
                system.run(() => this.uiBounties(player));
            });
    }

    uiBountyDetails(player, bounty) {
        const data = this.db.getPlayer(player.id);
        const current = data.bountyProgress[bounty.id] || 0;
        const extraWarning = bounty.type === 'player_kill'
            ? '\n\n§cPlayer Hunt: §7The funded reward is paid to the first eligible player who eliminates the target. The bounty creator cannot claim it.'
            : '';
        const form = new ActionFormData().title(`§c§l${bounty.name}`)
            .body(`§7${bounty.desc || 'No description.'}\n\n§ePosted by: §f${bounty.creatorName}\n§eObjective: §f${this.getBountyObjectiveText(bounty)}\n§eProgress: §f${current}/${bounty.req}\n${getProgressBar(current, bounty.req)}\n§dReward: §f${bounty.reward} points${extraWarning}`);
        if (bounty.creatorId === player.id) form.button('§cCancel and Refund', 'textures/ui/quest_close');
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (bounty.creatorId === player.id && result.selection === 0) {
                    this.bounties.cancel(player, bounty.id);
                    player.sendMessage('§e[Bounty] Canceled and refunded.');
                }
                this.uiBounties(player);
            });
        });
    }

    uiPlayerChains(player) {
        const chainProgresses = this.chains.getAllChainsForPlayer(player.id);
        const form = new ActionFormData().title('§6§lQUEST CHAINS');
        form.body(`§7Progress through ordered story lines. Completed chains: ${this.db.getPlayer(player.id).chainsCompleted.length}/${chainProgresses.length}`);
        chainProgresses.forEach(progress => form.button(`${progress.isComplete ? '§a✔' : `§e${progress.percent}%`} §f${progress.chain.name}\n§7${progress.chain.arc} ${getProgressBar(progress.completed, progress.total, 8)} ${progress.completed}/${progress.total}`, progress.isComplete ? 'textures/items/emerald' : 'textures/items/chain'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === chainProgresses.length) this.openQuestLog(player);
                else this.uiChainDetail(player, chainProgresses[result.selection]);
            });
        });
    }

    uiChainDetail(player, progress) {
        const data = this.db.getPlayer(player.id);
        let body = `§7${progress.chain.description || 'No description.'}\n\n§6Arc: §f${progress.chain.arc}\n§6Progress: §f${progress.completed}/${progress.total}\n${getProgressBar(progress.completed, progress.total)}\n\n`;
        progress.chain.quests.forEach((id, index) => {
            const task = this.db.tasks.get(id);
            body += `${data.completed.includes(id) ? '§a✔' : progress.currentQuestId === id ? '§e▶' : '§8○'} §7${index + 1}. §f${task?.name || id}\n`;
        });
        new ActionFormData().title(`§6§l${progress.chain.name}`).body(body)
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(() => system.run(() => this.uiPlayerChains(player)));
    }

    uiAchievements(player) {
        const all = this.achievements.getPlayerAchievements(player.id);
        const progress = this.achievements.getProgress(player.id);
        const categories = {};
        all.forEach(achievement => {
            if (!categories[achievement.category]) categories[achievement.category] = [];
            categories[achievement.category].push(achievement);
        });
        const names = Object.keys(categories).sort();
        const form = new ActionFormData().title('§d§lACHIEVEMENT VAULT');
        form.body(`§7Unlocked ${progress.unlocked}/${progress.total} (${progress.percent}%)\n${getProgressBar(progress.unlocked, progress.total)}`);
        names.forEach(name => {
            const unlocked = categories[name].filter(item => item.unlocked).length;
            form.button(`§f${name}\n§7${unlocked}/${categories[name].length} unlocked`, 'textures/items/nether_star');
        });
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === names.length) this.openQuestLog(player);
                else this.uiAchievementCategory(player, names[result.selection], categories[names[result.selection]]);
            });
        });
    }

    uiAchievementCategory(player, category, achievements) {
        let body = '';
        achievements.forEach(item => {
            if (item.unlocked) body += `§a✔ ${item.icon} §f${item.name}\n§7${item.description} §d+${item.points}\n\n`;
            else if (item.hidden) body += '§8? Hidden Achievement\n\n';
            else body += `§7○ ${item.icon} §f${item.name}\n§7${item.description}\n${getProgressBar(item.progress, item.threshold, 8)} ${item.progress}/${item.threshold}\n\n`;
        });
        new ActionFormData().title(`§d§l${category}`).body(body)
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(() => system.run(() => this.uiAchievements(player)));
    }

    openLeaderboard(player, backTarget = 'player') {
        const onlinePlayers = world.getAllPlayers();
        const onlineNames = new Map(onlinePlayers.map(item => [item.id, item.name]));
        onlinePlayers.forEach(item => this.db.getPlayer(item.id));
        const entries = Array.from(this.db.playerData.entries()).map(([id, data], index) => ({
            id, name: onlineNames.get(id) || `Saved Player ${index + 1}`,
            online: onlineNames.has(id), points: data.points || 0,
            tasks: data.stats?.tasksCompleted || 0, achievements: data.achievements?.length || 0,
            streak: data.streak?.bestStreak || 0
        })).sort((a, b) => b.points - a.points || b.tasks - a.tasks);
        let body = '§7Top server questers\n\n';
        entries.slice(0, 10).forEach((entry, index) => body += `${index < 3 ? ['§e#1', '§7#2', '§6#3'][index] : `§8#${index + 1}`} §f${entry.name}${entry.online ? ' §a●' : ' §8○'}\n   §d${entry.points} pts §7• ${entry.tasks} quests • ${entry.achievements}/${ACHIEVEMENTS.length} achievements\n`);
        const myRank = entries.findIndex(entry => entry.id === player.id) + 1;
        body += `\n§eYour rank: §f${myRank > 0 ? `#${myRank}` : 'Unranked'}`;
        new ActionFormData().title('§3§lLEADERBOARD').body(body)
            .button('§8Back', 'textures/ui/quest_back')
            .show(player).then(() => system.run(() => backTarget === 'admin' ? this.router.openAdminMenu(player) : this.openQuestLog(player)));
    }
}
