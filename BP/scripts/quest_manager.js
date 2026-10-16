import { world, system, Player } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
import { dist, getProgressBar, formatTime, getTodayKey, isConsecutiveDay } from './utils.js';
import { getObjectives, prerequisitesMet, objectiveTitle } from './objective_utils.js';

export class QuestManager {
    constructor(db, achievementMgr, chainMgr, partyMgr, bountyMgr) {
        this.db = db;
        this.achievements = achievementMgr;
        this.chains = chainMgr;
        this.parties = partyMgr;
        this.bounties = bountyMgr;
        this.lastLocations = new Map();
    }

    start() {
        this.initEvents();
        this.startHudLoop();
        this.startInventoryPolling();
        this.startTimedQuestCheck();
        this.startDebouncedSave();
    }

    handleIndexed(map, key, player, amount = 1) {
        const entries = map.get(key);
        if (!entries) return;
        for (const entry of entries) this.progressObjective(player, entry.taskId, entry.objectiveIndex, amount);
    }

    initEvents() {
        world.afterEvents.playerBreakBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksBroken++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksBroken');
            const typeId = ev.brokenBlockPermutation.type.id;
            this.handleIndexed(this.db.indices.block, typeId, ev.player, 1);
            this.bounties.progressEvent(ev.player, 'block', typeId, 1);
        });

        world.afterEvents.playerPlaceBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksPlaced++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksPlaced');
            this.handleIndexed(this.db.indices.place, ev.block.typeId, ev.player, 1);
            this.bounties.progressEvent(ev.player, 'place', ev.block.typeId, 1);
        });

        world.afterEvents.entityDie.subscribe(ev => {
            if (ev.damageSource.damagingEntity instanceof Player) {
                const player = ev.damageSource.damagingEntity;
                const data = this.db.getPlayer(player.id);
                data.stats.kills++;
                this.db.markDirty(player.id);
                this.achievements.checkForStat(player, 'kills');
                this.handleIndexed(this.db.indices.mob, ev.deadEntity.typeId, player, 1);
                this.bounties.progressEvent(player, 'kill', ev.deadEntity.typeId, 1);
                if (ev.deadEntity instanceof Player) {
                    this.bounties.progressPlayerKill(player, ev.deadEntity);
                }
            }
            if (ev.deadEntity instanceof Player) {
                const player = ev.deadEntity;
                const data = this.db.getPlayer(player.id);
                data.stats.deaths++;
                this.db.markDirty(player.id);
                this.achievements.checkForStat(player, 'deaths');
                this.db.tasks.forEach(task => {
                    getObjectives(task).forEach((objective, index) => {
                        if (objective.type === TYPES.DEATH) this.progressObjective(player, task.id, index, 1);
                    });
                });
            }
        });

        world.afterEvents.itemUse.subscribe(ev => {
            const player = ev.source;
            this.handleIndexed(this.db.indices.use, ev.itemStack.typeId, player, 1);
            const data = this.db.getPlayer(player.id);
            data.stats.itemsUsed++;
            this.db.markDirty(player.id);
        });

        world.afterEvents.playerSpawn.subscribe(ev => {
            if (!ev.initialSpawn) return;
            const player = ev.player;
            if (!player.hasTag('received_quest_book_v3')) {
                player.runCommand(`give @s ${CONFIG.ITEM_ID}`);
                player.addTag('received_quest_book_v3');
                player.sendMessage(`§a[Quest System] §7You received your Quest Book! §dv${CONFIG.VERSION}`);
                player.sendMessage('§7Open it for chapters, co-op quests, bounties, achievements and the shop.');
            }
            this.db.getPlayer(player.id);
            system.runTimeout(() => {
                this.deliverPendingRewards(player);
                this.syncSharedCompletions(player);
                this.achievements.checkAll(player);
            }, 40);
        });

        world.afterEvents.playerLeave.subscribe(ev => {
            const id = ev.playerId;
            if (this.db.saveDirty.has(id)) {
                this.db.savePlayer(id);
                this.db.saveDirty.delete(id);
            }
            this.lastLocations.delete(id);
        });

        system.runInterval(() => {
            world.getAllPlayers().forEach(player => this.checkWorldObjectives(player));
        }, CONFIG.LOCATION_CHECK_INTERVAL);
    }

    startInventoryPolling() {
        system.runInterval(() => {
            const needsQuestPolling = this.db.indices.craft.size > 0 || this.db.indices.fish.size > 0;
            const needsBountyPolling = this.bounties.active().some(bounty => bounty.type === 'gather');
            if (!needsQuestPolling && !needsBountyPolling) return;
            world.getAllPlayers().forEach(player => {
                const newSnap = this.db.snapshotInventory(player);
                const oldSnap = this.db.inventoryCache.get(player.id);
                if (oldSnap) {
                    for (const [itemId, newCount] of Object.entries(newSnap)) {
                        const oldCount = oldSnap[itemId] || 0;
                        if (newCount <= oldCount) continue;
                        const diff = newCount - oldCount;
                        this.handleIndexed(this.db.indices.craft, itemId, player, diff);
                        this.handleIndexed(this.db.indices.fish, itemId, player, diff);
                        this.bounties.progressEvent(player, 'gather', itemId, diff);
                        if (this.db.indices.craft.has(itemId)) {
                            const data = this.db.getPlayer(player.id);
                            data.stats.itemsCrafted += diff;
                            this.db.markDirty(player.id);
                            this.achievements.checkForStat(player, 'itemsCrafted');
                        }
                        if (this.db.indices.fish.has(itemId)) {
                            const data = this.db.getPlayer(player.id);
                            data.stats.fishCaught += diff;
                            this.db.markDirty(player.id);
                            this.achievements.checkForStat(player, 'fishCaught');
                        }
                    }
                }
                this.db.inventoryCache.set(player.id, newSnap);
            });
        }, CONFIG.CRAFT_CHECK_INTERVAL);
    }

    startTimedQuestCheck() {
        system.runInterval(() => {
            const now = Date.now();
            let changed = false;
            this.db.tasks.forEach(task => {
                if (task.active && task.deadline && now >= task.deadline) {
                    task.active = false;
                    changed = true;
                    world.getAllPlayers().forEach(player => player.sendMessage(`§c[Quest System] §eTime expired: §f${task.name}`));
                }
            });
            if (changed) this.db.saveTasks();
        }, CONFIG.TIMED_QUEST_INTERVAL);
    }

    startDebouncedSave() {
        system.runInterval(() => this.db.flushDirty(), 60);
    }

    isEligible(player, task) {
        if (!task?.active) return false;
        const data = this.db.getPlayer(player.id);
        if (!prerequisitesMet(data, task)) return false;
        if (task.manualStart && !data.activeQuests.includes(task.id)) return false;
        if (task.scope === 'party' && !this.parties.getPartyForPlayer(player.id)) return false;
        const cdEnd = data.repeatCooldowns[task.id];
        if (cdEnd && Date.now() < cdEnd) return false;
        return !this.isCompleted(player, task.id);
    }

    getStore(player, task) {
        if (task.scope === 'party') {
            const party = this.parties.getPartyForPlayer(player.id);
            if (!party) return null;
            if (!party.objectiveProgress) party.objectiveProgress = {};
            if (!party.completed) party.completed = [];
            return { kind: 'party', data: party };
        }
        if (task.scope === 'server') {
            return { kind: 'server', data: this.db.serverProgress };
        }
        return { kind: 'player', data: this.db.getPlayer(player.id) };
    }

    saveStore(player, store) {
        if (!store) return;
        if (store.kind === 'party') this.parties.save();
        else if (store.kind === 'server') this.db.saveServerProgress();
        else this.db.markDirty(player.id);
    }

    getObjectiveValues(player, task) {
        const store = this.getStore(player, task);
        const objectives = getObjectives(task);
        if (!store) return objectives.map(() => 0);
        const existing = store.data.objectiveProgress?.[task.id];
        if (Array.isArray(existing)) return objectives.map((_, index) => Number(existing[index]) || 0);
        const legacy = Number(store.data.progress?.[task.id]) || 0;
        return objectives.map((_, index) => index === 0 ? legacy : 0);
    }

    setObjectiveValue(player, task, objectiveIndex, value, absolute = false) {
        if (!this.isEligible(player, task)) return;
        const store = this.getStore(player, task);
        if (!store) return;
        const objectives = getObjectives(task);
        const objective = objectives[objectiveIndex];
        if (!objective) return;
        if (!store.data.objectiveProgress) store.data.objectiveProgress = {};
        const values = this.getObjectiveValues(player, task);
        const next = absolute ? value : values[objectiveIndex] + value;
        values[objectiveIndex] = Math.max(0, Math.min(objective.req, next));
        store.data.objectiveProgress[task.id] = values;
        if (!store.data.progress) store.data.progress = {};
        store.data.progress[task.id] = values.length === 1 ? values[0] : values.reduce((sum, current) => sum + current, 0);
        this.saveStore(player, store);
        if (values.every((current, index) => current >= objectives[index].req)) this.completeTask(player, task, store);
        else if (!absolute && Math.random() > 0.75) player.runCommand('playsound random.orb @s ~~~ 0.45 1.5');
    }

    progressObjective(player, taskId, objectiveIndex, amount) {
        const task = this.db.tasks.get(taskId);
        if (!task) return;
        this.setObjectiveValue(player, task, objectiveIndex, amount, false);
    }

    setObjectiveAbsolute(player, task, objectiveIndex, amount) {
        this.setObjectiveValue(player, task, objectiveIndex, amount, true);
    }

    checkWorldObjectives(player) {
        const currentLocation = { ...player.location, dimension: player.dimension.id };
        const previous = this.lastLocations.get(player.id);
        let travelled = 0;
        if (previous && previous.dimension === currentLocation.dimension) {
            travelled = dist(previous, currentLocation);
            if (travelled > 32) travelled = 0;
        }
        this.lastLocations.set(player.id, currentLocation);
        if (travelled > 0) {
            const data = this.db.getPlayer(player.id);
            data.stats.distanceTravelled += travelled;
            this.db.markDirty(player.id);
        }

        this.db.tasks.forEach(task => {
            if (!this.isEligible(player, task)) return;
            const objectives = getObjectives(task);
            objectives.forEach((objective, index) => {
                try {
                    if (objective.type === TYPES.GATHER) {
                        const inv = player.getComponent('minecraft:inventory')?.container;
                        let count = 0;
                        if (inv) {
                            for (let slot = 0; slot < inv.size; slot++) {
                                const item = inv.getItem(slot);
                                if (item?.typeId === objective.target) count += item.amount;
                            }
                        }
                        this.setObjectiveAbsolute(player, task, index, count);
                    } else if (objective.type === TYPES.LEVEL) {
                        this.setObjectiveAbsolute(player, task, index, player.level);
                    } else if (objective.type === TYPES.VISIT) {
                        if (dist(player.location, objective.target) <= objective.radius) this.setObjectiveAbsolute(player, task, index, 1);
                    } else if (objective.type === TYPES.WALK) {
                        const values = this.getObjectiveValues(player, task);
                        const checkpoint = objective.target?.[Math.floor(values[index] || 0)];
                        if (checkpoint && dist(player.location, checkpoint) <= objective.radius) this.progressObjective(player, task.id, index, 1);
                    } else if (objective.type === TYPES.DISTANCE && travelled > 0) {
                        this.progressObjective(player, task.id, index, travelled);
                    } else if (objective.type === TYPES.EFFECT) {
                        if (player.getEffect(objective.target)) this.progressObjective(player, task.id, index, CONFIG.LOCATION_CHECK_INTERVAL / 20);
                    } else if (objective.type === TYPES.APPROACH) {
                        const nearby = player.dimension.getEntities({ type: objective.target, location: player.location, maxDistance: objective.radius });
                        if (nearby.length > 0) this.setObjectiveAbsolute(player, task, index, 1);
                    }
                } catch (e) { }
            });
        });
    }

    completeTask(player, task, store = null) {
        store = store || this.getStore(player, task);
        if (!store || store.data.completed.includes(task.id)) return;

        if (store.kind === 'player') {
            this.applyCompletion(player, player.id, task, false);
            return;
        }

        store.data.completed.push(task.id);
        this.saveStore(player, store);

        if (store.kind === 'party') {
            const party = store.data;
            for (const member of party.members) {
                const online = world.getAllPlayers().find(p => p.id === member.id);
                this.applyCompletion(online || null, member.id, task, online ? false : true);
            }
            this.parties.save();
        } else if (store.kind === 'server') {
            world.getAllPlayers().forEach(member => this.applyCompletion(member, member.id, task, false));
            this.db.saveServerProgress();
        }

        const cooldownSec = Math.max(0, Number(task.cooldownSec ?? CONFIG.DEFAULT_COOLDOWN));
        if (task.repeatable && cooldownSec === 0) {
            system.run(() => {
                if (store.kind === 'party' || store.kind === 'server') {
                    store.data.completed = store.data.completed.filter(id => id !== task.id);
                    delete store.data.objectiveProgress[task.id];
                    delete store.data.progress[task.id];
                    this.saveStore(player, store);
                }
            });
        }
    }

    applyCompletion(player, playerId, task, silent = false) {
        const data = this.db.getPlayer(playerId);
        if (data.completed.includes(task.id)) return;
        data.completed.push(task.id);
        data.activeQuests = data.activeQuests.filter(id => id !== task.id);
        data.stats.tasksCompleted++;
        const rewards = task.rewards || {};
        const firstCompletion = !data.everCompleted?.includes?.(task.id);
        if (!Array.isArray(data.everCompleted)) data.everCompleted = [];
        if (firstCompletion) data.everCompleted.push(task.id);
        let points = Number(rewards.points ?? task.points ?? CONFIG.DEFAULT_QUEST_POINTS) || 0;
        if (task.repeatable && firstCompletion) points += Number(rewards.firstTimeBonus || 0);

        const today = getTodayKey();
        if (data.streak.lastCompletionDay) {
            if (isConsecutiveDay(data.streak.lastCompletionDay, today)) data.streak.currentStreak++;
            else if (data.streak.lastCompletionDay !== today) data.streak.currentStreak = 1;
        } else data.streak.currentStreak = 1;
        data.streak.lastCompletionDay = today;
        data.streak.bestStreak = Math.max(data.streak.bestStreak, data.streak.currentStreak);

        data.points += points;
        data.stats.pointsEarned += points;
        if (data.tracked === task.id) data.tracked = null;

        if (task.repeatable) {
            const cooldownSec = Math.max(0, Number(task.cooldownSec ?? CONFIG.DEFAULT_COOLDOWN));
            if (cooldownSec > 0) data.repeatCooldowns[task.id] = Date.now() + cooldownSec * 1000;
            data.stats.repeatsDone++;
            if (cooldownSec === 0) {
                system.run(() => {
                    const fresh = this.db.getPlayer(playerId);
                    fresh.completed = fresh.completed.filter(id => id !== task.id);
                    delete fresh.objectiveProgress[task.id];
                    delete fresh.progress[task.id];
                    this.db.savePlayer(playerId);
                });
            }
        }
        const rewardCommands = rewards.commands?.length ? rewards.commands : (task.rewardCmd ? [task.rewardCmd] : []);
        const poolCommand = rewards.pool?.length
            ? rewards.pool[Math.floor(Math.random() * rewards.pool.length)]
            : null;
        if (!player || silent) {
            data.pendingRewardCommands.push(...rewardCommands);
            if (poolCommand) data.pendingRewardCommands.push(poolCommand);
            if (!data.pendingCompletionTasks.includes(task.id)) data.pendingCompletionTasks.push(task.id);
            this.db.savePlayer(playerId);
            return;
        }
        this.db.savePlayer(playerId);

        player.runCommand('playsound random.levelup @s');
        player.runCommand('title @s actionbar §a§lQuest Completed!');
        player.sendMessage('\n§a=============================');
        player.sendMessage(`§e COMPLETED: §f${task.name}${task.repeatable ? ' §d[Repeatable]' : ''}`);
        player.sendMessage(`§7 ${task.desc}`);
        player.sendMessage(`§d Points Earned: §f+${points} §7(Total: ${data.points})`);
        if (data.streak.currentStreak > 1) player.sendMessage(`§6 🔥 ${data.streak.currentStreak}-Day Streak!`);
        if (task.repeatable && Number(task.cooldownSec ?? 0) > 0) player.sendMessage(`§7 Repeatable in §f${formatTime(task.cooldownSec)}`);

        if (rewardCommands.length) {
            player.sendMessage(`§a Rewards: §f${task.rewardTxt || 'Items'}`);
            rewardCommands.forEach(command => { try { player.runCommand(command); } catch (e) { } });
        }
        if (poolCommand) {
            try { player.runCommand(poolCommand); } catch (e) { }
            player.sendMessage('§d 🎲 Random bonus reward drawn!');
        }
        player.sendMessage('§a=============================\n');

        this.chains.checkChainCompletion(player, task.id);
        for (const stat of ['tasksCompleted', 'pointsEarned', 'repeatsDone', 'chainsCompleted']) this.achievements.checkForStat(player, stat);
    }


    deliverPendingRewards(player) {
        const data = this.db.getPlayer(player.id);
        if (!data.pendingRewardCommands?.length) return;
        const commands = data.pendingRewardCommands.splice(0);
        let delivered = 0;
        for (const command of commands) {
            try {
                player.runCommand(command);
                delivered++;
            } catch (e) {
                data.pendingRewardCommands.push(command);
            }
        }
        const completedTasks = data.pendingCompletionTasks.splice(0);
        this.db.savePlayer(player.id);
        for (const taskId of completedTasks) this.chains.checkChainCompletion(player, taskId);
        if (completedTasks.length) {
            for (const stat of ['tasksCompleted', 'pointsEarned', 'repeatsDone', 'chainsCompleted']) this.achievements.checkForStat(player, stat);
        }
        if (delivered > 0) player.sendMessage(`§a[Quest System] Delivered §f${delivered} §aqueued co-op reward${delivered === 1 ? '' : 's'}.`);
    }

    syncSharedCompletions(player) {
        const data = this.db.getPlayer(player.id);
        const party = this.parties.getPartyForPlayer(player.id);
        this.db.tasks.forEach(task => {
            if (data.completed.includes(task.id)) return;
            if (task.scope === 'server' && this.db.serverProgress.completed?.includes(task.id)) {
                this.applyCompletion(player, player.id, task, false);
            } else if (task.scope === 'party' && party?.completed?.includes(task.id)) {
                this.applyCompletion(player, player.id, task, false);
            }
        });
    }

    startHudLoop() {
        system.runInterval(() => {
            world.getAllPlayers().forEach(player => {
                const data = this.db.getPlayer(player.id);
                this.checkCooldowns(data, player.id);
                if (!data.tracked) return;
                const task = this.db.tasks.get(data.tracked);
                if (!task || this.isCompleted(player, task.id)) {
                    data.tracked = null;
                    this.db.savePlayer(player.id);
                    return;
                }
                const cooldownEnd = data.repeatCooldowns[task.id];
                if (cooldownEnd && Date.now() < cooldownEnd) {
                    player.onScreenDisplay.setActionBar(`§c§lCOOLDOWN: §e${task.name}\n§7Available in §f${formatTime(Math.ceil((cooldownEnd - Date.now()) / 1000))}`);
                    return;
                }
                const objectives = getObjectives(task);
                const values = this.getObjectiveValues(player, task);
                const index = objectives.findIndex((objective, i) => values[i] < objective.req);
                const objective = objectives[Math.max(0, index)];
                const current = values[Math.max(0, index)] || 0;
                let text = `§6§lQUEST: §e${task.name}\n§f${objectiveTitle(objective, Math.max(0, index))} §7${getProgressBar(current, objective.req)} §f${Math.floor(current)}/${objective.req}`;
                if (objectives.length > 1) text += ` §8(${values.filter((value, i) => value >= objectives[i].req).length}/${objectives.length})`;
                if (task.deadline) text += ` §c⏰${formatTime(Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000)))}`;
                player.onScreenDisplay.setActionBar(text);
            });
        }, CONFIG.HUD_INTERVAL);
    }

    checkCooldowns(data, playerId) {
        const now = Date.now();
        let changed = false;
        for (const [taskId, end] of Object.entries(data.repeatCooldowns)) {
            if (now < end) continue;
            data.completed = data.completed.filter(id => id !== taskId);
            delete data.progress[taskId];
            delete data.objectiveProgress[taskId];
            delete data.repeatCooldowns[taskId];
            changed = true;
        }
        if (changed) this.db.savePlayer(playerId);
    }

    isCompleted(player, taskId) {
        const task = this.db.tasks.get(taskId);
        if (!task) return this.db.getPlayer(player.id).completed.includes(taskId);
        const store = this.getStore(player, task);
        if (store?.data.completed?.includes(taskId)) return true;
        return this.db.getPlayer(player.id).completed.includes(taskId);
    }

    getProgress(player, taskId) {
        const task = this.db.tasks.get(taskId);
        if (!task) return 0;
        return this.getObjectiveValues(player, task)[0] || 0;
    }
}
