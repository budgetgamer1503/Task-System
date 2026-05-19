import { world, system, Player } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
import { dist, getProgressBar, formatTime, getTodayKey, isConsecutiveDay } from './utils.js';
export class QuestManager {
    constructor(db, achievementMgr, chainMgr) {
        this.db = db;
        this.achievements = achievementMgr;
        this.chains = chainMgr;
    }
    start() {
        this.initEvents();
        this.startHudLoop();
        this.startCraftPolling();
        this.startTimedQuestCheck();
        this.startDebouncedSave();
    }
    initEvents() {
        world.afterEvents.playerBreakBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksBroken++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksBroken');
            const tasksForBlock = this.db.indices.block.get(ev.brokenBlockPermutation.type.id);
            if (tasksForBlock) {
                tasksForBlock.forEach(taskId => this.progressTask(ev.player, taskId, 1));
            }
        });
        world.afterEvents.playerPlaceBlock.subscribe(ev => {
            const data = this.db.getPlayer(ev.player.id);
            data.stats.blocksPlaced++;
            this.db.markDirty(ev.player.id);
            this.achievements.checkForStat(ev.player, 'blocksPlaced');
            const tasksForPlace = this.db.indices.place.get(ev.block.typeId);
            if (tasksForPlace) {
                tasksForPlace.forEach(taskId => this.progressTask(ev.player, taskId, 1));
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
                tasksForMob.forEach(taskId => this.progressTask(player, taskId, 1));
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
                if (task.active && task.type === TYPES.DEATH) {
                    this.progressTask(player, task.id, 1);
                }
            });
        });
        world.afterEvents.itemUse.subscribe(ev => {
            if (ev.itemStack.typeId === 'minecraft:fishing_rod') {
            }
            this.db.tasks.forEach(task => {
                if (task.active && task.type === TYPES.USE_ITEM && task.target === ev.itemStack.typeId) {
                    this.progressTask(ev.source, task.id, 1);
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
        system.runInterval(() => {
            world.getAllPlayers().forEach(p => this.checkLocations(p));
        }, CONFIG.LOCATION_CHECK_INTERVAL);
    }
    startCraftPolling() {
        system.runInterval(() => {
            if (this.db.indices.craft.size === 0) return;
            world.getAllPlayers().forEach(player => {
                const newSnap = this.db.snapshotInventory(player);
                const oldSnap = this.db.inventoryCache.get(player.id);
                if (oldSnap) {
                    for (const [itemId, newCount] of Object.entries(newSnap)) {
                        const oldCount = oldSnap[itemId] || 0;
                        if (newCount > oldCount) {
                            const diff = newCount - oldCount;
                            const tasksForCraft = this.db.indices.craft.get(itemId);
                            if (tasksForCraft) {
                                tasksForCraft.forEach(taskId => this.progressTask(player, taskId, diff));
                                const data = this.db.getPlayer(player.id);
                                data.stats.itemsCrafted += diff;
                                this.db.markDirty(player.id);
                                this.achievements.checkForStat(player, 'itemsCrafted');
                            }
                            if (this.isFishItem(itemId)) {
                                this.db.tasks.forEach(task => {
                                    if (task.active && task.type === TYPES.FISH && task.target === itemId) {
                                        this.progressTask(player, task.id, diff);
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
                        if (task.type === TYPES.GATHER || task.type === TYPES.LEVEL) {
                            this.checkPassiveTasks(player, task, data);
                        }
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
    checkLocations(player) {
        this.db.tasks.forEach(task => {
            if (!task.active) return;
            if (task.type !== TYPES.VISIT && task.type !== TYPES.WALK) return;
            if (task.prereq && !this.isCompleted(player, task.prereq)) return;
            if (this.isCompleted(player, task.id)) return;
            const pPos = player.location;
            if (task.type === TYPES.VISIT) {
                if (dist(pPos, task.target) <= CONFIG.PROXIMITY) this.completeTask(player, task);
            } else if (task.type === TYPES.WALK) {
                const progress = this.getProgress(player, task.id);
                const targetPoint = task.target[progress];
                if (targetPoint && dist(pPos, targetPoint) <= CONFIG.PROXIMITY) {
                    this.progressTask(player, task.id, 1);
                }
            }
        });
    }
    progressTask(player, taskId, amount) {
        const task = this.db.tasks.get(taskId);
        if (!task || !task.active) return;
        if (this.isCompleted(player, taskId)) return;
        if (task.prereq && !this.isCompleted(player, task.prereq)) return;
        const data = this.db.getPlayer(player.id);
        const cdEnd = data.repeatCooldowns[taskId];
        if (cdEnd && Date.now() < cdEnd) return;
        const current = data.progress[taskId] || 0;
        const newVal = current + amount;
        data.progress[taskId] = newVal;
        if (Math.random() > 0.7) player.runCommand('playsound random.orb @s ~~~ 0.5 1.5');
        if (newVal >= task.req) {
            this.completeTask(player, task);
        } else {
            this.db.markDirty(player.id);
        }
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
        if (task.repeatable) {
            const cd = (task.cooldownSec || CONFIG.DEFAULT_COOLDOWN) * 1000;
            data.repeatCooldowns[task.id] = Date.now() + cd;
            data.stats.repeatsDone++;
        }
        this.db.savePlayer(player.id);
        player.runCommand(`playsound random.levelup @s`);
        player.runCommand(`title @s actionbar §a§lTask Completed!`);
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
    isCompleted(player, taskId) {
        const data = this.db.getPlayer(player.id);
        return data.completed.includes(taskId);
    }
    getProgress(player, taskId) {
        const data = this.db.getPlayer(player.id);
        return data.progress[taskId] || 0;
    }
}