import { world } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
import { getObjectives, getPrerequisites, questFolder, stripFormatting } from './objective_utils.js';

export class Database {
    constructor() {
        this.tasks = new Map();
        this.playerData = new Map();
        this.shop = new Map();
        this.chains = new Map();
        this.serverProgress = { progress: {}, objectiveProgress: {}, completed: [] };
        this.indices = {
            block: new Map(), mob: new Map(), craft: new Map(), place: new Map(),
            use: new Map(), fish: new Map()
        };
        this.inventoryCache = new Map();
        this.saveDirty = new Set();
    }

    load() {
        this.loadTasks();
        this.loadShop();
        this.loadChains();
        this.loadServerProgress();
        console.log(`§a[QuestSystem] Database loaded: ${this.tasks.size} tasks, ${this.chains.size} chains, ${this.shop.size} shop items`);
    }

    migrateTask(task) {
        if (task.points === undefined) task.points = CONFIG.DEFAULT_QUEST_POINTS;
        if (task.repeatable === undefined) task.repeatable = false;
        if (task.cooldownSec === undefined) task.cooldownSec = CONFIG.DEFAULT_COOLDOWN;
        if (task.deadline === undefined) task.deadline = null;
        if (task.rewards === undefined) {
            task.rewards = {
                commands: task.rewardCmd ? [task.rewardCmd] : [],
                pool: [], points: task.points, firstTimeBonus: 0
            };
        }
        if (task.chainId === undefined) task.chainId = null;
        if (!Array.isArray(task.prerequisites)) task.prerequisites = task.prereq ? [task.prereq] : [];
        task.prereq = task.prerequisites[0] || null;
        if (!Array.isArray(task.objectives) || task.objectives.length === 0) task.objectives = getObjectives(task);
        if (!task.folder) task.folder = questFolder(task);
        if (!task.category) task.category = task.folder;
        if (task.hidden === undefined) task.hidden = false;
        if (task.manualStart === undefined) task.manualStart = false;
        if (!task.visibility) task.visibility = 'chapter';
        if (!task.scope) task.scope = 'player';
        if (!Number.isFinite(Number(task.order))) task.order = 0;
        if (!Number.isFinite(Number(task.folderOrder))) task.folderOrder = 0;
        if (task.active === undefined) task.active = true;
        task.name = String(task.name || 'Unnamed Quest');
        task.desc = String(task.desc || '');
        return task;
    }

    loadTasks() {
        try {
            let rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS);
            let migrated = false;
            if (!rawTasks) {
                rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS_V25);
                if (rawTasks) migrated = true;
            }
            if (!rawTasks) {
                rawTasks = world.getDynamicProperty(CONFIG.DB_KEY_TASKS_OLD);
                if (rawTasks) migrated = true;
            }
            if (rawTasks) {
                const parsed = JSON.parse(rawTasks);
                parsed.forEach(raw => {
                    const task = this.migrateTask(raw);
                    this.tasks.set(task.id, task);
                });
                this.rebuildIndices();
                if (migrated) this.saveTasks();
            }
        } catch (e) { console.warn('DB Load Error (tasks):', e); }
    }

    loadShop() {
        try {
            let rawShop = world.getDynamicProperty(CONFIG.DB_KEY_SHOP);
            if (!rawShop) rawShop = world.getDynamicProperty(CONFIG.DB_KEY_SHOP_V25);
            if (rawShop) {
                const parsed = JSON.parse(rawShop);
                parsed.forEach(item => {
                    if (!Array.isArray(item.commands)) item.commands = item.command ? [item.command] : [];
                    if (!item.category) item.category = 'General';
                    if (!Number.isFinite(Number(item.order))) item.order = 0;
                    this.shop.set(item.id, item);
                });
                if (!world.getDynamicProperty(CONFIG.DB_KEY_SHOP)) this.saveShop();
            }
        } catch (e) { console.warn('DB Load Error (shop):', e); }
    }

    loadChains() {
        try {
            const raw = world.getDynamicProperty(CONFIG.DB_KEY_CHAINS);
            if (raw) JSON.parse(raw).forEach(chain => this.chains.set(chain.id, chain));
        } catch (e) { console.warn('DB Load Error (chains):', e); }
    }

    loadServerProgress() {
        try {
            const raw = world.getDynamicProperty(CONFIG.DB_KEY_SERVER_PROGRESS);
            if (raw) this.serverProgress = { ...this.serverProgress, ...JSON.parse(raw) };
        } catch (e) { console.warn('DB Load Error (server progress):', e); }
    }

    addIndex(map, key, taskId, objectiveIndex) {
        if (!key) return;
        const list = map.get(key) || [];
        list.push({ taskId, objectiveIndex });
        map.set(key, list);
    }

    indexTask(task) {
        if (!task.active) return;
        getObjectives(task).forEach((objective, objectiveIndex) => {
            switch (objective.type) {
                case TYPES.BLOCK: this.addIndex(this.indices.block, objective.target, task.id, objectiveIndex); break;
                case TYPES.KILL: this.addIndex(this.indices.mob, objective.target, task.id, objectiveIndex); break;
                case TYPES.CRAFT: this.addIndex(this.indices.craft, objective.target, task.id, objectiveIndex); break;
                case TYPES.PLACE: this.addIndex(this.indices.place, objective.target, task.id, objectiveIndex); break;
                case TYPES.USE_ITEM: this.addIndex(this.indices.use, objective.target, task.id, objectiveIndex); break;
                case TYPES.FISH: this.addIndex(this.indices.fish, objective.target, task.id, objectiveIndex); break;
            }
        });
    }

    rebuildIndices() {
        Object.values(this.indices).forEach(map => map.clear());
        this.tasks.forEach(task => this.indexTask(task));
    }

    saveTasks() {
        world.setDynamicProperty(CONFIG.DB_KEY_TASKS, JSON.stringify(Array.from(this.tasks.values())));
        this.rebuildIndices();
    }

    saveShop() {
        world.setDynamicProperty(CONFIG.DB_KEY_SHOP, JSON.stringify(Array.from(this.shop.values())));
    }

    saveChains() {
        world.setDynamicProperty(CONFIG.DB_KEY_CHAINS, JSON.stringify(Array.from(this.chains.values())));
    }

    saveServerProgress() {
        world.setDynamicProperty(CONFIG.DB_KEY_SERVER_PROGRESS, JSON.stringify(this.serverProgress));
    }

    createDefaultPlayerData() {
        return {
            progress: {}, objectiveProgress: {}, completed: [], tracked: null, activeQuests: [],
            stats: {
                kills: 0, tasksCompleted: 0, blocksBroken: 0, blocksPlaced: 0,
                pointsEarned: 0, repeatsDone: 0, deaths: 0, fishCaught: 0,
                itemsCrafted: 0, chainsCompleted: 0, itemsUsed: 0, distanceTravelled: 0
            },
            points: 0, repeatCooldowns: {}, achievements: [], chainsCompleted: [], everCompleted: [],
            partyId: null, bountyProgress: {}, completedBounties: [], pendingRewardCommands: [], pendingCompletionTasks: [],
            streak: { lastCompletionDay: null, currentStreak: 0, bestStreak: 0 }
        };
    }

    ensurePlayerFields(data) {
        if (!data || typeof data !== 'object') data = this.createDefaultPlayerData();
        if (!data.progress) data.progress = {};
        if (!data.objectiveProgress) data.objectiveProgress = {};
        if (!Array.isArray(data.completed)) data.completed = [];
        if (!Array.isArray(data.activeQuests)) data.activeQuests = [];
        if (data.activeQuests.length > CONFIG.MAX_ACTIVE_QUESTS) data.activeQuests = data.activeQuests.slice(0, CONFIG.MAX_ACTIVE_QUESTS);
        if (data.points === undefined) data.points = 0;
        if (!data.repeatCooldowns) data.repeatCooldowns = {};
        if (!data.stats) data.stats = {};
        const s = data.stats;
        if (s.tasks !== undefined && s.tasksCompleted === undefined) { s.tasksCompleted = s.tasks; delete s.tasks; }
        for (const key of ['tasksCompleted', 'kills', 'blocksBroken', 'blocksPlaced', 'pointsEarned', 'repeatsDone', 'deaths', 'fishCaught', 'itemsCrafted', 'chainsCompleted', 'itemsUsed', 'distanceTravelled']) {
            if (s[key] === undefined) s[key] = 0;
        }
        if (!Array.isArray(data.achievements)) data.achievements = [];
        if (!Array.isArray(data.chainsCompleted)) data.chainsCompleted = [];
        if (!data.streak) data.streak = { lastCompletionDay: null, currentStreak: 0, bestStreak: 0 };
        if (data.streak.bestStreak === undefined) data.streak.bestStreak = 0;
        if (data.partyId === undefined) data.partyId = null;
        if (!data.bountyProgress) data.bountyProgress = {};
        if (!Array.isArray(data.completedBounties)) data.completedBounties = [];
        if (!Array.isArray(data.everCompleted)) data.everCompleted = [];
        if (!Array.isArray(data.pendingRewardCommands)) data.pendingRewardCommands = [];
        if (!Array.isArray(data.pendingCompletionTasks)) data.pendingCompletionTasks = [];
        return data;
    }

    getPlayer(uuid) {
        if (!this.playerData.has(uuid)) {
            let data;
            try {
                let raw = world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS}_${uuid}`)
                    || world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS_V25}_${uuid}`)
                    || world.getDynamicProperty(`${CONFIG.DB_KEY_PLAYERS_OLD}_${uuid}`);
                data = raw ? JSON.parse(raw) : this.createDefaultPlayerData();
            } catch (e) {
                console.warn(`Player data load failed for ${uuid}:`, e);
                data = this.createDefaultPlayerData();
            }
            this.playerData.set(uuid, this.ensurePlayerFields(data));
        }
        return this.playerData.get(uuid);
    }

    savePlayer(uuid) {
        const data = this.playerData.get(uuid);
        if (data) world.setDynamicProperty(`${CONFIG.DB_KEY_PLAYERS}_${uuid}`, JSON.stringify(data));
    }

    markDirty(uuid) { this.saveDirty.add(uuid); }

    flushDirty() {
        for (const uuid of this.saveDirty) this.savePlayer(uuid);
        this.saveDirty.clear();
    }

    resetPlayer(uuid) {
        this.playerData.delete(uuid);
        world.setDynamicProperty(`${CONFIG.DB_KEY_PLAYERS}_${uuid}`, undefined);
    }

    snapshotInventory(player) {
        const inv = player.getComponent('minecraft:inventory')?.container;
        if (!inv) return {};
        const snapshot = {};
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (item) snapshot[item.typeId] = (snapshot[item.typeId] || 0) + item.amount;
        }
        return snapshot;
    }

    getFolders(includeNpcOnly = false) {
        const folders = new Map();
        this.tasks.forEach(task => {
            if (!task.active) return;
            if (!includeNpcOnly && task.visibility === 'npc') return;
            const name = questFolder(task);
            const current = folders.get(name) || { name, count: 0, order: Number(task.folderOrder) || 0 };
            current.count++;
            current.order = Math.min(current.order, Number(task.folderOrder) || 0);
            folders.set(name, current);
        });
        return Array.from(folders.values()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }

    exportCore() {
        return {
            version: CONFIG.VERSION,
            tasks: Array.from(this.tasks.values()),
            shop: Array.from(this.shop.values()),
            chains: Array.from(this.chains.values()),
            serverProgress: this.serverProgress,
            players: Array.from(this.playerData.entries())
        };
    }

    importCore(snapshot) {
        this.playerData.clear();
        this.saveDirty.clear();
        this.tasks.clear();
        (snapshot.tasks || []).forEach(raw => {
            const task = this.migrateTask(raw);
            this.tasks.set(task.id, task);
        });
        this.shop.clear();
        (snapshot.shop || []).forEach(item => this.shop.set(item.id, item));
        this.chains.clear();
        (snapshot.chains || []).forEach(chain => this.chains.set(chain.id, chain));
        this.serverProgress = snapshot.serverProgress || { progress: {}, objectiveProgress: {}, completed: [] };
        if (Array.isArray(snapshot.players)) {
            for (const [id, raw] of snapshot.players) {
                const data = this.ensurePlayerFields(raw);
                this.playerData.set(id, data);
                this.savePlayer(id);
            }
        }
        this.saveTasks();
        this.saveShop();
        this.saveChains();
        this.saveServerProgress();
    }
}
