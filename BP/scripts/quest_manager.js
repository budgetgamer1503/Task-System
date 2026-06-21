import { world, system, Player } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
import { dist, getProgressBar, formatTime, getTodayKey, isConsecutiveDay } from './utils.js';
export class QuestManager {
    constructor(db, achievementMgr, chainMgr) {
        this.db = db;
        this.achievements = achievementMgr;
        this.chains = chainMgr;
        this.craftCursor = 0;
        this.locationCursor = 0;
        this.cosmeticCursor = 0;
    }
    start() {
        this.initEvents();
        this.startHudLoop();
        this.startCraftPolling();
        this.startTimedQuestCheck();
        this.startDebouncedSave();
        this.startCosmeticLoop();
    }
    initEvents() {
        world.afterEvents.playerBreakBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksBroken++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksBroken');
            const tasksForBlock = this.db.indices.block.get(ev.brokenBlockPermutation.type.id);
            if (tasksForBlock) {
                tasksForBlock.forEach(taskId => this.progressTask(ev.player, taskId, 1, TYPES.BLOCK, ev.brokenBlockPermutation.type.id));
            }
        });
        world.afterEvents.playerPlaceBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksPlaced++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksPlaced');
            const tasksForPlace = this.db.indices.place.get(ev.block.typeId);
            if (tasksForPlace) {
                tasksForPlace.forEach(taskId => this.progressTask(ev.player, taskId, 1, TYPES.PLACE, ev.block.typeId));
            }
        });
        world.afterEvents.entityDie.subscribe(ev => {
            if (!ev.damageSource.damagingEntity || !(ev.damageSource.damagingEntity instanceof Player)) return;
            const player = ev.damageSource.damagingEntity;
            const data = this.db.getPlayer(player.id);
            data.stats.kills++;
            this.db.markDirty(player.id);
            this.achievements.checkForStat(player, 'kills');
            const tasksForMob = this.db.indices.mob.get(ev.deadEntity.typeId);
            if (tasksForMob) {
                tasksForMob.forEach(taskId => this.progressTask(player, taskId, 1, TYPES.KILL, ev.deadEntity.typeId));
            }
        });
        world.afterEvents.entityDie.subscribe(ev => {
            if (!(ev.deadEntity instanceof Player)) return;
            const player = ev.deadEntity;
            const data = this.db.getPlayer(player.id);
            data.stats.deaths++;
            this.db.markDirty(player.id);
            this.achievements.checkForStat(player, 'deaths');
            this.db.tasks.forEach(task => {
                if (task.active) {
                    this.progressTask(player, task.id, 1, TYPES.DEATH, '');
                }
            });
        });
        world.afterEvents.itemUse.subscribe(ev => {
            if (ev.itemStack.typeId === 'minecraft:fishing_rod') {
            }
            this.db.tasks.forEach(task => {
                if (task.active) {
                    this.progressTask(ev.source, task.id, 1, TYPES.USE_ITEM, ev.itemStack.typeId);
                }
            });
            const data = this.db.getPlayer(ev.source.id);
            data.stats.itemsUsed++;
            this.db.markDirty(ev.source.id);
        });
        world.afterEvents.playerSpawn.subscribe(ev => {
            if (ev.initialSpawn) {
                const player = ev.player;
                if (!player.hasTag('received_quest_book_v3')) {
                    player.runCommand(`give @s ${CONFIG.ITEM_ID}`);
                    player.addTag('received_quest_book_v3');
                    player.sendMessage('§a[Quest System] §7You received your Quest Book! §dv3.0');
                    player.sendMessage('§7Use it to view quests, chains, achievements & the shop!');
                }
                system.runTimeout(() => {
                    this.achievements.checkAll(player);
                }, 40);
            }
        });
        world.afterEvents.playerLeave.subscribe(ev => {
            const id = ev.playerId;
            if (this.db.saveDirty.has(id)) {
                this.db.savePlayer(id);
                this.db.saveDirty.delete(id);
            }
        });
        system.runInterval(() => this.checkLocationBatch(), CONFIG.LOCATION_CHECK_INTERVAL);
    }
    startCraftPolling() {
        system.runInterval(() => {
            const hasFishQuest = Array.from(this.db.tasks.values()).some(t => t.active && (t.type === TYPES.FISH || t.objectives?.some(o => o.type === TYPES.FISH)));
            if (this.db.indices.craft.size === 0 && !hasFishQuest) return;
            const players = world.getAllPlayers();
            const batch = this.getPlayerBatch(players, 'craftCursor');
            batch.forEach(player => {
                const newSnap = this.db.snapshotInventory(player);
                const oldSnap = this.db.inventoryCache.get(player.id);
                if (oldSnap) {
                    for (const [itemId, newCount] of Object.entries(newSnap)) {
                        const oldCount = oldSnap[itemId] || 0;
                        if (newCount > oldCount) {
                            const diff = newCount - oldCount;
                            const tasksForCraft = this.db.indices.craft.get(itemId);
                            if (tasksForCraft) {
                                tasksForCraft.forEach(taskId => this.progressTask(player, taskId, diff, TYPES.CRAFT, itemId));
                                const data = this.db.getPlayer(player.id);
                                data.stats.itemsCrafted += diff;
                                this.db.markDirty(player.id);
                                this.achievements.checkForStat(player, 'itemsCrafted');
                            }
                            if (this.isFishItem(itemId)) {
                                this.db.tasks.forEach(task => {
                                    if (task.active) {
                                        this.progressTask(player, task.id, diff, TYPES.FISH, itemId);
                                    }
                                });
                                const data = this.db.getPlayer(player.id);
                                data.stats.fishCaught += diff;
                                this.db.markDirty(player.id);
                                this.achievements.checkForStat(player, 'fishCaught');
                            }
                        }
                    }
                }
                this.db.inventoryCache.set(player.id, newSnap);
            });
        }, CONFIG.CRAFT_CHECK_INTERVAL);
    }
    isFishItem(typeId) {
        const fishItems = [
            'minecraft:cod', 'minecraft:salmon', 'minecraft:tropical_fish',
            'minecraft:pufferfish', 'minecraft:cooked_cod', 'minecraft:cooked_salmon'
        ];
        return fishItems.includes(typeId);
    }
    startTimedQuestCheck() {
        system.runInterval(() => {
            const now = Date.now();
            let changed = false;
            this.db.tasks.forEach(task => {
                if (task.active && task.deadline && now >= task.deadline) {
                    task.active = false;
                    changed = true;
                    world.getAllPlayers().forEach(p => {
                        p.sendMessage(`§c[Quest System] §eTime Expired: §f${task.name}`);
                    });
                }
            });
            if (changed) this.db.saveTasks();
        }, CONFIG.TIMED_QUEST_INTERVAL);
    }
    startDebouncedSave() {
        system.runInterval(() => {
            this.db.flushDirty();
        }, 60);
    }
    startHudLoop() {
        system.runInterval(() => {
            world.getAllPlayers().forEach(player => {
                const data = this.db.getPlayer(player.id);
                this.checkCooldowns(data, player.id);
                if (data.tracked) {
                    const task = this.db.tasks.get(data.tracked);
                    if (task && !data.completed.includes(task.id)) {
                        const cdEnd = data.repeatCooldowns[task.id];
                        if (cdEnd && Date.now() < cdEnd) {
                            const remaining = Math.ceil((cdEnd - Date.now()) / 1000);
                            player.onScreenDisplay.setActionBar(`§c§lCOOLDOWN: §e${task.name}\n§7Available in §f${formatTime(remaining)}`);
                            return;
                        }
                        if (task.type === TYPES.GATHER || task.type === TYPES.LEVEL || task.objectives) {
                            this.checkPassiveTasks(player, task, data);
                        }
                        if (task.coop) {
                            let hudText = `§3§l[CO-OP] §e${task.name}\n`;
                            if (task.objectives && task.objectives.length > 0) {
                                if (!this.db.globalProgress[task.id]) {
                                    this.db.globalProgress[task.id] = task.objectives.map(() => 0);
                                }
                                hudText += task.objectives.map((obj, idx) => `§7${obj.target.replace('minecraft:', '')}: §f${this.db.globalProgress[task.id][idx] || 0}/${obj.req}`).join(' §8| ');
                            } else {
                                const current = this.db.globalProgress[task.id] || 0;
                                const max = task.req;
                                const bar = getProgressBar(current, max);
                                hudText += `${bar} §f${current}/${max}`;
                            }
                            player.onScreenDisplay.setActionBar(hudText);
                            return;
                        }
                        if (task.objectives && task.objectives.length > 0) {
                            if (!Array.isArray(data.progress[task.id])) {
                                data.progress[task.id] = task.objectives.map(() => 0);
                            }
                            let hudText = `§6§lQUEST: §e${task.name}\n`;
                            hudText += task.objectives.map((obj, idx) => `§7${obj.target.replace('minecraft:', '')}: §f${data.progress[task.id][idx] || 0}/${obj.req}`).join(' §8| ');
                            player.onScreenDisplay.setActionBar(hudText);
                        } else {
                            const current = data.progress[task.id] || 0;
                            const max = task.req;
                            const bar = getProgressBar(current, max);
                            let hudText = `§6§lQUEST: §e${task.name}\n${bar} §f${current}/${max}`;
                            if (task.deadline) {
                                const timeLeft = Math.max(0, Math.ceil((task.deadline - Date.now()) / 1000));
                                hudText += `  §c⏰${formatTime(timeLeft)}`;
                            }
                            hudText += `  §d+${task.points || 0}pts`;
                            if (task.chainId) {
                                const chain = this.db.chains.get(task.chainId);
                                if (chain) {
                                    hudText += `\n§8Chain: §7${chain.name}`;
                                }
                            }
                            player.onScreenDisplay.setActionBar(hudText);
                        }
                    } else {
                        data.tracked = null;
                        this.db.savePlayer(player.id);
                    }
                }
            });
        }, CONFIG.HUD_INTERVAL);
    }
    checkCooldowns(data, playerId) {
        const now = Date.now();
        let changed = false;
        for (const [taskId, cdEnd] of Object.entries(data.repeatCooldowns)) {
            if (now >= cdEnd) {
                const idx = data.completed.indexOf(taskId);
                if (idx !== -1) {
                    data.completed.splice(idx, 1);
                    data.progress[taskId] = 0;
                    changed = true;
                }
                delete data.repeatCooldowns[taskId];
                changed = true;
            }
        }
        if (changed) this.db.savePlayer(playerId);
    }
    checkPassiveTasks(player, task, data) {
        if (!task.coop && (!data.activeQuests || !data.activeQuests.includes(task.id))) return;
        if (task.objectives && task.objectives.length > 0) {
            if (!Array.isArray(data.progress[task.id])) {
                data.progress[task.id] = task.objectives.map(() => 0);
            }
            let changed = false;
            task.objectives.forEach((obj, idx) => {
                if (obj.type === TYPES.GATHER) {
                    let amount = 0;
                    const inv = player.getComponent('minecraft:inventory')?.container;
                    if (inv) {
                        for (let i = 0; i < inv.size; i++) {
                            if (inv.getItem(i)?.typeId === obj.target) amount += inv.getItem(i).amount;
                        }
                    }
                    if (amount !== data.progress[task.id][idx]) {
                        data.progress[task.id][idx] = Math.min(amount, obj.req);
                        changed = true;
                    }
                } else if (obj.type === TYPES.LEVEL) {
                    let amount = player.level;
                    if (amount !== data.progress[task.id][idx]) {
                        data.progress[task.id][idx] = Math.min(amount, obj.req);
                        changed = true;
                    }
                }
            });
            if (changed) {
                this.db.savePlayer(player.id);
                const allDone = task.objectives.every((obj, idx) => (data.progress[task.id][idx] || 0) >= obj.req);
                if (allDone) this.completeTask(player, task);
            }
        } else {
            let amount = 0;
            if (task.type === TYPES.GATHER) {
                const inv = player.getComponent('minecraft:inventory')?.container;
                if (inv) {
                    for (let i = 0; i < inv.size; i++) {
                        if (inv.getItem(i)?.typeId === task.target) amount += inv.getItem(i).amount;
                    }
                }
            } else if (task.type === TYPES.LEVEL) {
                amount = player.level;
            }
            if (amount !== (data.progress[task.id] || 0)) {
                data.progress[task.id] = Math.min(amount, task.req);
                this.db.savePlayer(player.id);
                if (amount >= task.req) this.completeTask(player, task);
            }
        }
    }
    checkLocations(player) {
        this.db.tasks.forEach(task => {
            if (!task.active) return;
            if (task.type !== TYPES.VISIT && task.type !== TYPES.WALK && task.type !== TYPES.APPROACH && !task.objectives) return;
            if (task.prereq && !this.isCompleted(player, task.prereq)) return;
            if (this.isCompleted(player, task.id)) return;
            
            const data = this.db.getPlayer(player.id);
            if (!task.coop && (!data.activeQuests || !data.activeQuests.includes(task.id))) return;

            const checkSingle = (type, target, req, idx = -1) => {
                if (type === TYPES.APPROACH) {
                    try {
                        const entities = player.dimension.getEntities({
                            location: player.location,
                            maxDistance: CONFIG.PROXIMITY || 6
                        });
                        const match = entities.find(e => e.typeId === target);
                        if (match) return true;
                    } catch (e) {}
                } else if (type === TYPES.VISIT) {
                    if (dist(player.location, target) <= CONFIG.PROXIMITY) return true;
                } else if (type === TYPES.WALK) {
                    let progress = 0;
                    if (idx !== -1 && Array.isArray(data.progress[task.id])) {
                        progress = data.progress[task.id][idx] || 0;
                    } else {
                        progress = data.progress[task.id] || 0;
                    }
                    const targetPoint = target[progress];
                    if (targetPoint && dist(player.location, targetPoint) <= CONFIG.PROXIMITY) return true;
                }
                return false;
            };

            if (task.objectives && task.objectives.length > 0) {
                task.objectives.forEach((obj, idx) => {
                    if (obj.type === TYPES.VISIT || obj.type === TYPES.APPROACH || obj.type === TYPES.WALK) {
                        if (checkSingle(obj.type, obj.target, obj.req, idx)) {
                            this.progressTask(player, task.id, 1, obj.type, obj.target);
                        }
                    }
                });
            } else {
                if (checkSingle(task.type, task.target, task.req)) {
                    this.progressTask(player, task.id, 1, task.type, task.target);
                }
            }
        });
    }
    progressTask(player, taskId, amount, targetType = null, targetId = null) {
        const task = this.db.tasks.get(taskId);
        if (!task || !task.active) return;
        if (this.isCompleted(player, taskId)) return;
        if (task.prereq && !this.isCompleted(player, task.prereq)) return;
        const data = this.db.getPlayer(player.id);
        if (!task.coop && (!data.activeQuests || !data.activeQuests.includes(taskId))) return;
        const cdEnd = data.repeatCooldowns[taskId];
        if (cdEnd && Date.now() < cdEnd) return;
        if (!targetType) targetType = task.type;
        if (!targetId) targetId = task.target;

        if (Math.random() > 0.7) player.runCommand('playsound random.orb @s ~~~ 0.5 1.5');

        if (task.coop) {
            if (!this.db.globalProgress[taskId]) {
                this.db.globalProgress[taskId] = task.objectives ? task.objectives.map(() => 0) : 0;
            }
            if (task.objectives && task.objectives.length > 0) {
                if (!Array.isArray(this.db.globalProgress[taskId])) {
                    this.db.globalProgress[taskId] = task.objectives.map(() => 0);
                }
                let updated = false;
                task.objectives.forEach((obj, idx) => {
                    if (obj.type === targetType && obj.target === targetId) {
                        const cur = this.db.globalProgress[taskId][idx] || 0;
                        if (cur < obj.req) {
                            this.db.globalProgress[taskId][idx] = Math.min(obj.req, cur + amount);
                            updated = true;
                        }
                    }
                });
                if (updated) {
                    this.db.saveGlobalProgress();
                    const allDone = task.objectives.every((obj, idx) => (this.db.globalProgress[taskId][idx] || 0) >= obj.req);
                    if (allDone) {
                        this.completeCoopTask(task);
                    }
                }
            } else {
                const cur = this.db.globalProgress[taskId] || 0;
                if (cur < task.req) {
                    this.db.globalProgress[taskId] = Math.min(task.req, cur + amount);
                    this.db.saveGlobalProgress();
                    if (this.db.globalProgress[taskId] >= task.req) {
                        this.completeCoopTask(task);
                    }
                }
            }
            return;
        }

        if (task.objectives && task.objectives.length > 0) {
            if (!Array.isArray(data.progress[taskId])) {
                data.progress[taskId] = task.objectives.map(() => 0);
            }
            let updated = false;
            task.objectives.forEach((obj, idx) => {
                if (obj.type === targetType && obj.target === targetId) {
                    const cur = data.progress[taskId][idx] || 0;
                    if (cur < obj.req) {
                        data.progress[taskId][idx] = Math.min(obj.req, cur + amount);
                        updated = true;
                    }
                }
            });
            if (updated) {
                this.db.markDirty(player.id);
                const allDone = task.objectives.every((obj, idx) => (data.progress[taskId][idx] || 0) >= obj.req);
                if (allDone) {
                    this.completeTask(player, task);
                }
            }
        } else {
            const current = data.progress[taskId] || 0;
            const newVal = Math.min(task.req, current + amount);
            data.progress[taskId] = newVal;
            if (newVal >= task.req) {
                this.completeTask(player, task);
            } else {
                this.db.markDirty(player.id);
            }
        }
    }
    completeCoopTask(task) {
        if (this.db.globalCompleted.includes(task.id)) return;
        this.db.globalCompleted.push(task.id);
        this.db.saveGlobalCompleted();
        world.getAllPlayers().forEach(player => {
            const data = this.db.getPlayer(player.id);
            if (!data.completed.includes(task.id)) {
                data.completed.push(task.id);
                const rewards = task.rewards || {};
                const pts = rewards.points || task.points || CONFIG.DEFAULT_QUEST_POINTS;
                data.points += pts;
                data.stats.pointsEarned += pts;
                data.stats.tasksCompleted++;
                if (data.tracked === task.id) data.tracked = null;
                if (data.activeQuests) {
                    const idx = data.activeQuests.indexOf(task.id);
                    if (idx !== -1) data.activeQuests.splice(idx, 1);
                }
                this.db.savePlayer(player.id);
            }
            player.runCommand('playsound random.levelup @s');
            player.sendMessage(`\n§3=============================`);
            player.sendMessage(`§b§l CO-OP QUEST COMPLETED: §f${task.name}`);
            player.sendMessage(`§7 Shared server progress complete!`);
            player.sendMessage(`§d Points Earned: §f+${task.points || 0}`);
            player.sendMessage(`§3=============================\n`);
        });
    }
    completeTask(player, task) {
        const data = this.db.getPlayer(player.id);
        if (data.completed.includes(task.id)) return;
        data.completed.push(task.id);
        data.stats.tasksCompleted++;
        const rewards = task.rewards || {};
        let pts = rewards.points || task.points || CONFIG.DEFAULT_QUEST_POINTS;
        if (task.repeatable && rewards.firstTimeBonus && !data.repeatCooldowns[task.id]) {
            pts += rewards.firstTimeBonus;
        }
        const today = getTodayKey();
        if (data.streak.lastCompletionDay) {
            if (isConsecutiveDay(data.streak.lastCompletionDay, today)) {
                data.streak.currentStreak++;
            } else if (data.streak.lastCompletionDay !== today) {
                data.streak.currentStreak = 1;
            }
        } else {
            data.streak.currentStreak = 1;
        }
        data.streak.lastCompletionDay = today;
        if (data.streak.currentStreak > data.streak.bestStreak) {
            data.streak.bestStreak = data.streak.currentStreak;
        }
        data.points += pts;
        data.stats.pointsEarned += pts;
        if (data.tracked === task.id) data.tracked = null;
        if (data.activeQuests) {
            const idx = data.activeQuests.indexOf(task.id);
            if (idx !== -1) data.activeQuests.splice(idx, 1);
        }
        if (task.repeatable) {
            const cd = (task.cooldownSec || CONFIG.DEFAULT_COOLDOWN) * 1000;
            data.repeatCooldowns[task.id] = Date.now() + cd;
            data.stats.repeatsDone++;
        }
        this.db.savePlayer(player.id);
        player.runCommand(`playsound random.levelup @s`);
        player.runCommand(`title @s actionbar §a§lTask Completed!`);
        if (task.bounty) {
            const creatorPlayer = world.getAllPlayers().find(p => p.id === task.creatorId);
            if (creatorPlayer) {
                creatorPlayer.sendMessage(`§6§l[Bounty Board] §aYour bounty "${task.name}" was completed by §e${player.name}§a!`);
            }
            world.getAllPlayers().forEach(p => {
                p.sendMessage(`§6§l[Bounty Board] §e${player.name} §fhas claimed the bounty §a${task.name} §fposted by §e${task.creatorName || 'someone'}!`);
            });
            this.db.tasks.delete(task.id);
            this.db.saveTasks();
        } else {
            const repeatTag = task.repeatable ? ' §d[Repeatable]' : '';
            const chainTag = task.chainId ? ` §8[Chain: ${this.db.chains.get(task.chainId)?.name || '?'}]` : '';
            player.sendMessage(`\n§a=============================`);
            player.sendMessage(`§e COMPLETED: §f${task.name}${repeatTag}${chainTag}`);
            player.sendMessage(`§7 ${task.desc}`);
            player.sendMessage(`§d Points Earned: §f+${pts} §7(Total: ${data.points})`);
            if (data.streak.currentStreak > 1) {
                player.sendMessage(`§6 🔥 ${data.streak.currentStreak}-Day Streak!`);
            }
            if (task.repeatable) {
                player.sendMessage(`§7 Repeatable in §f${formatTime(task.cooldownSec || CONFIG.DEFAULT_COOLDOWN)}`);
            }
            const rewardCommands = (rewards.commands && rewards.commands.length > 0)
                ? rewards.commands
                : (task.rewardCmd ? [task.rewardCmd] : []);
            if (rewardCommands.length > 0) {
                player.sendMessage(`§a Rewards: §f${task.rewardTxt || 'Items'}`);
                rewardCommands.forEach(cmd => {
                    try { player.runCommand(cmd); } catch (e) { }
                });
            }
            if (rewards.pool && rewards.pool.length > 0) {
                const randomCmd = rewards.pool[Math.floor(Math.random() * rewards.pool.length)];
                try { player.runCommand(randomCmd); } catch (e) { }
                player.sendMessage(`§d 🎲 Bonus Reward Drawn!`);
            }
            player.sendMessage(`§a=============================\n`);
            if (pts >= 50) {
                world.getAllPlayers().forEach(p => {
                    if (p.id !== player.id) {
                        p.sendMessage(`§6§l[!] §e${player.name} §fcompleted §a${task.name} §f(+${pts}pts)!`);
                    }
                });
            }
            this.chains.checkChainCompletion(player, task.id);
            this.achievements.checkForStat(player, 'tasksCompleted');
            this.achievements.checkForStat(player, 'pointsEarned');
            this.achievements.checkForStat(player, 'repeatsDone');
            this.achievements.checkForStat(player, 'chainsCompleted');
        }
    }
    isCompleted(player, taskId) {
        const data = this.db.getPlayer(player.id);
        return data.completed.includes(taskId);
    }
    getProgress(player, taskId) {
        const data = this.db.getPlayer(player.id);
        return data.progress[taskId] || 0;
    }
}
