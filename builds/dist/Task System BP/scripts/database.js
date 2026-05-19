import { world } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
export class Database {
    constructor() {
        this.tasks = new Map();
        this.playerData = new Map();
        this.shop = new Map();
        this.chains = new Map();
        this.indices = { block: new Map(), mob: new Map(), craft: new Map(), place: new Map() };
        this.inventoryCache = new Map();
        this.saveDirty = new Set();
    }
    load() {
        this.loadTasks();
        this.loadShop();
        this.loadChains();
        console.log(`§a[QuestSystem] Database loaded: ${this.tasks.size} tasks, ${this.chains.size} chains, ${this.shop.size} shop items`);
    }
    loadTasks() {
        try {
            let rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS);
            let migrated = false;
            if (!rawTasks) {
                rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS_V25);
                if (rawTasks) {
                    console.log('§e[QuestSystem] Migrating tasks from v2.5 → v3.0...');
                    migrated = true;
                }
            }
            if (!rawTasks) {
                rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS_OLD);
                if (rawTasks) {
                    console.log('§e[QuestSystem] Migrating tasks from v2.0 → v3.0...');
                    migrated = true;
                }
            }
            if (rawTasks) {
                const parsed = JSON.parse(rawTasks);
                parsed.forEach(t => {
                    if (t.points === undefined) t.points = CONFIG.DEFAULT_QUEST_POINTS;
                    if (t.repeatable === undefined) t.repeatable = false;
                    if (t.cooldownSec === undefined) t.cooldownSec = CONFIG.DEFAULT_COOLDOWN;
                    if (t.deadline === undefined) t.deadline = null;
                    if (t.rewards === undefined) {
                        t.rewards = {
                            commands: t.rewardCmd ? [t.rewardCmd] : [],
                            pool: [],
                            points: t.points,
                            firstTimeBonus: 0
                        };
                    }
                    if (t.chainId === undefined) t.chainId = null;
                    this.tasks.set(t.id, t);
                    this.indexTask(t);
                });
                if (migrated) {
                    this.saveTasks();
                    console.log('§a[QuestSystem] Task migration complete.');
                }
            }
        } catch (e) { console.warn("DB Load Error (tasks):", e); }
    }
    loadShop() {
        try {
            let rawShop = world.getDynamicProperty(CONFIG.DB_KEY_SHOP);
            if (!rawShop) {
                rawShop = world.getDynamicProperty(CONFIG.DB_KEY_SHOP_V25);
                if (rawShop) console.log('§e[QuestSystem] Migrating shop from v2.5 → v3.0...');
            }
            if (rawShop) {
                const parsed = JSON.parse(rawShop);
                parsed.forEach(item => {
                    if (item.commands === undefined) {
                        item.commands = item.command ? [item.command] : [];
                    }
                    this.shop.set(item.id, item);
                });
                if (!world.getDynamicProperty(CONFIG.DB_KEY_SHOP)) {
                    this.saveShop();
                }
            }
        } catch (e) { console.warn("DB Load Error (shop):", e); }
    }
    loadChains() {
        try {
            const rawChains = world.getDynamicProperty(CONFIG.DB_KEY_CHAINS);
            if (rawChains) {
                const parsed = JSON.parse(rawChains);
                parsed.forEach(c => this.chains.set(c.id, c));
            }
        } catch (e) { console.warn("DB Load Error (chains):", e); }
    }
    indexTask(task) {
        if (!task.active) return;
        const addIndex = (map, key, id) => {
            const list = map.get(key) || [];
            list.push(id);
            map.set(key, list);
        };
        switch (task.type) {
            case TYPES.BLOCK:
                addIndex(this.indices.block, task.target, task.id);
                break;
            case TYPES.KILL:
                addIndex(this.indices.mob, task.target, task.id);
                break;
            case TYPES.CRAFT:
                addIndex(this.indices.craft, task.target, task.id);
                break;
            case TYPES.PLACE:
                addIndex(this.indices.place, task.target, task.id);
                break;
        }
    }
    rebuildIndices() {
        this.indices.block.clear();
        this.indices.mob.clear();
        this.indices.craft.clear();
        this.indices.place.clear();
        this.tasks.forEach(t => this.indexTask(t));
    }
    saveTasks() {
        const arr = Array.from(this.tasks.values());
        world.setDynamicProperty(CONFIG.DB_KEY_TASKS, JSON.stringify(arr));
        this.rebuildIndices();
    }
    saveShop() {
        const arr = Array.from(this.shop.values());
        world.setDynamicProperty(CONFIG.DB_KEY_SHOP, JSON.stringify(arr));
    }
    saveChains() {
        const arr = Array.from(this.chains.values());
        world.setDynamicProperty(CONFIG.DB_KEY_CHAINS, JSON.stringify(arr));
    }
    getPlayer(uuid) {
        if (!this.playerData.has(uuid)) {
            let raw = world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS}_${uuid}`);
            if (!raw) {
                raw = world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS_V25}_${uuid}`);
            }
            if (!raw) {
                raw = world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS_OLD}_${uuid}`);
            }
            const data = raw ? JSON.parse(raw) : this.createDefaultPlayerData();
            this.ensurePlayerFields(data);
            this.playerData.set(uuid, data);
        }
        return this.playerData.get(uuid);
    }
    createDefaultPlayerData() {
        return {
            progress: {},
            completed: [],
            tracked: null,
            stats: {
                kills: 0,
                tasksCompleted: 0,
                blocksBroken: 0,
                blocksPlaced: 0,
                pointsEarned: 0,
                repeatsDone: 0,
                deaths: 0,
                fishCaught: 0,
                itemsCrafted: 0,
                chainsCompleted: 0,
                itemsUsed: 0
            },
            points: 0,
            repeatCooldowns: {},
            achievements: [],
            chainsCompleted: [],
            streak: {
                lastCompletionDay: null,
                currentStreak: 0,
                bestStreak: 0
            }
        };
    }
    ensurePlayerFields(data) {
        if (data.points === undefined) data.points = 0;
        if (data.repeatCooldowns === undefined) data.repeatCooldowns = {};
        if (!data.stats) data.stats = {};
        const s = data.stats;
        if (s.tasks !== undefined && s.tasksCompleted === undefined) {
            s.tasksCompleted = s.tasks;
            delete s.tasks;
        }
        if (s.tasksCompleted === undefined) s.tasksCompleted = 0;
        if (s.kills === undefined) s.kills = 0;
        if (s.blocksBroken === undefined) s.blocksBroken = 0;
        if (s.blocksPlaced === undefined) s.blocksPlaced = 0;
        if (s.pointsEarned === undefined) s.pointsEarned = 0;
        if (s.repeatsDone === undefined) s.repeatsDone = 0;
        if (s.deaths === undefined) s.deaths = 0;
        if (s.fishCaught === undefined) s.fishCaught = 0;
        if (s.itemsCrafted === undefined) s.itemsCrafted = 0;
        if (s.chainsCompleted === undefined) s.chainsCompleted = 0;
        if (s.itemsUsed === undefined) s.itemsUsed = 0;
        if (!data.achievements) data.achievements = [];
        if (!data.chainsCompleted) data.chainsCompleted = [];
        if (!data.streak) {
            data.streak = { lastCompletionDay: null, currentStreak: 0, bestStreak: 0 };
        }
        if (data.streak.bestStreak === undefined) data.streak.bestStreak = 0;
    }
    savePlayer(uuid) {
        const data = this.playerData.get(uuid);
        if (data) {
            world.setDynamicProperty(`${CONFIG.DB_KEY_PLAYERS}_${uuid}`, JSON.stringify(data));
        }
    }
    markDirty(uuid) {
        this.saveDirty.add(uuid);
    }
    flushDirty() {
        for (const uuid of this.saveDirty) {
            this.savePlayer(uuid);
        }
        this.saveDirty.clear();
    }
    snapshotInventory(player) {
        const inv = player.getComponent('minecraft:inventory')?.container;
        if (!inv) return {};
        const snapshot = {};
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (item) {
                snapshot[item.typeId] = (snapshot[item.typeId] || 0) + item.amount;
            }
        }
        return snapshot;
    }
}