import { world } from '@minecraft/server';
import { CONFIG, TYPES } from './config.js';
import { base64Encode, base64Decode } from './utils.js';
export class Database {
    constructor() {
        this.tasks = new Map();
        this.playerData = new Map();
        this.shop = new Map();
        this.chains = new Map();
        this.indices = { block: new Map(), mob: new Map(), craft: new Map(), place: new Map() };
        this.inventoryCache = new Map();
        this.saveDirty = new Set();
        this.globalProgress = {};
        this.globalCompleted = [];
        this.parties = new Map();
        this.partyInvites = new Map();
    }
    load() {
        this.tasks.clear();
        this.shop.clear();
        this.chains.clear();
        this.rebuildIndices();
        this.loadTasks();
        this.loadShop();
        this.loadChains();
        this.loadParties();
        try {
            const rawGlobal = world.getDynamicProperty('ts_global_progress');
            this.globalProgress = rawGlobal ? JSON.parse(rawGlobal) : {};
        } catch (e) { this.globalProgress = {}; }
        try {
            const rawGlobalComp = world.getDynamicProperty('ts_global_completed');
            this.globalCompleted = rawGlobalComp ? JSON.parse(rawGlobalComp) : [];
        } catch (e) { this.globalCompleted = []; }
        console.log(`§a[QuestSystem] Database loaded: ${this.tasks.size} tasks, ${this.chains.size} chains, ${this.shop.size} shop items`);
    }
    saveGlobalProgress() {
        try {
            world.setDynamicProperty('ts_global_progress', JSON.stringify(this.globalProgress));
        } catch (e) {}
    }
    saveGlobalCompleted() {
        try {
            world.setDynamicProperty('ts_global_completed', JSON.stringify(this.globalCompleted));
        } catch (e) {}
    }
    createBackupPayload() {
        return {
            version: CONFIG.VERSION,
            timestamp: Date.now(),
            tasks: Array.from(this.tasks.values()),
            chains: Array.from(this.chains.values()),
            shop: Array.from(this.shop.values()),
            parties: Array.from(this.parties.values())
        };
    }
    applyBackupPayload(payload) {
        if (!payload || !Array.isArray(payload.tasks)) return false;
        world.setDynamicProperty(CONFIG.DB_KEY_TASKS, JSON.stringify(payload.tasks));
        world.setDynamicProperty(CONFIG.DB_KEY_CHAINS, JSON.stringify(Array.isArray(payload.chains) ? payload.chains : []));
        world.setDynamicProperty(CONFIG.DB_KEY_SHOP, JSON.stringify(Array.isArray(payload.shop) ? payload.shop : []));
        if (Array.isArray(payload.parties)) {
            world.setDynamicProperty(CONFIG.DB_KEY_PARTIES, JSON.stringify(payload.parties));
        }
        this.load();
        return true;
    }
    backup(slot) {
        try {
            const meta = {
                timestamp: Date.now(),
                tasksCount: this.tasks.size,
                chainsCount: this.chains.size,
                shopCount: this.shop.size
            };
            world.setDynamicProperty(`ts_backup_slot_${slot}_meta`, JSON.stringify(meta));
            world.setDynamicProperty(`ts_backup_slot_${slot}_tasks`, JSON.stringify(Array.from(this.tasks.values())));
            world.setDynamicProperty(`ts_backup_slot_${slot}_chains`, JSON.stringify(Array.from(this.chains.values())));
            world.setDynamicProperty(`ts_backup_slot_${slot}_shop`, JSON.stringify(Array.from(this.shop.values())));
            world.setDynamicProperty(`ts_backup_slot_${slot}_parties`, JSON.stringify(Array.from(this.parties.values())));
            return true;
        } catch (e) {
            console.warn(`Backup error slot ${slot}:`, e);
            return false;
        }
    }
    getBackupInfo(slot) {
        try {
            const raw = world.getDynamicProperty(`ts_backup_slot_${slot}_meta`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }
    restore(slot) {
        try {
            const rawTasks = world.getDynamicProperty(`ts_backup_slot_${slot}_tasks`);
            const rawChains = world.getDynamicProperty(`ts_backup_slot_${slot}_chains`);
            const rawShop = world.getDynamicProperty(`ts_backup_slot_${slot}_shop`);
            const rawParties = world.getDynamicProperty(`ts_backup_slot_${slot}_parties`);
            if (!rawTasks) return false;

            world.setDynamicProperty(CONFIG.DB_KEY_TASKS, rawTasks);
            if (rawChains) world.setDynamicProperty(CONFIG.DB_KEY_CHAINS, rawChains);
            if (rawShop) world.setDynamicProperty(CONFIG.DB_KEY_SHOP, rawShop);
            if (rawParties) world.setDynamicProperty(CONFIG.DB_KEY_PARTIES, rawParties);

            this.load();
            return true;
        } catch (e) {
            console.warn(`Restore error slot ${slot}:`, e);
            return false;
        }
    }
    clearBackup(slot) {
        try {
            world.setDynamicProperty(`ts_backup_slot_${slot}_meta`, undefined);
            world.setDynamicProperty(`ts_backup_slot_${slot}_tasks`, undefined);
            world.setDynamicProperty(`ts_backup_slot_${slot}_chains`, undefined);
            world.setDynamicProperty(`ts_backup_slot_${slot}_shop`, undefined);
            world.setDynamicProperty(`ts_backup_slot_${slot}_parties`, undefined);
            return true;
        } catch (e) {
            return false;
        }
    }
    exportBackupBase64(slot = null) {
        try {
            let payload;
            if (slot) {
                const rawTasks = world.getDynamicProperty(`ts_backup_slot_${slot}_tasks`);
                if (!rawTasks) return null;
                const rawChains = world.getDynamicProperty(`ts_backup_slot_${slot}_chains`);
                const rawShop = world.getDynamicProperty(`ts_backup_slot_${slot}_shop`);
                const rawParties = world.getDynamicProperty(`ts_backup_slot_${slot}_parties`);
                payload = {
                    version: CONFIG.VERSION,
                    timestamp: Date.now(),
                    tasks: JSON.parse(rawTasks),
                    chains: rawChains ? JSON.parse(rawChains) : [],
                    shop: rawShop ? JSON.parse(rawShop) : [],
                    parties: rawParties ? JSON.parse(rawParties) : []
                };
            } else {
                payload = this.createBackupPayload();
            }
            return base64Encode(JSON.stringify(payload));
        } catch (e) {
            console.warn('Backup export error:', e);
            return null;
        }
    }
    importBackupBase64(encoded) {
        try {
            const payload = JSON.parse(base64Decode(encoded));
            return this.applyBackupPayload(payload);
        } catch (e) {
            console.warn('Backup import error:', e);
            return false;
        }
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
    loadParties() {
        this.parties.clear();
        try {
            const rawParties = world.getDynamicProperty(CONFIG.DB_KEY_PARTIES);
            if (rawParties) {
                const parsed = JSON.parse(rawParties);
                parsed.forEach(p => this.parties.set(p.id, p));
            }
        } catch (e) { console.warn("DB Load Error (parties):", e); }
    }
    indexTask(task) {
        if (!task.active) return;
        const addIndex = (map, key, id) => {
            const list = map.get(key) || [];
            if (!list.includes(id)) {
                list.push(id);
            }
            map.set(key, list);
        };
        const indexSingle = (type, target, id) => {
            switch (type) {
                case TYPES.BLOCK:
                    addIndex(this.indices.block, target, id);
                    break;
                case TYPES.KILL:
                    addIndex(this.indices.mob, target, id);
                    break;
                case TYPES.CRAFT:
                    addIndex(this.indices.craft, target, id);
                    break;
                case TYPES.PLACE:
                    addIndex(this.indices.place, target, id);
                    break;
            }
        };
        if (task.objectives && task.objectives.length > 0) {
            task.objectives.forEach(obj => {
                indexSingle(obj.type, obj.target, task.id);
            });
        } else {
            indexSingle(task.type, task.target, task.id);
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
    saveParties() {
        const arr = Array.from(this.parties.values());
        world.setDynamicProperty(CONFIG.DB_KEY_PARTIES, JSON.stringify(arr));
    }
    getPartyByMember(playerId) {
        for (const party of this.parties.values()) {
            if (party.members.includes(playerId)) return party;
        }
        return null;
    }
    getPartyMembers(playerId) {
        const party = this.getPartyByMember(playerId);
        return party ? party.members.slice() : [playerId];
    }
    createParty(ownerId, ownerName, name) {
        this.leaveParty(ownerId);
        const party = {
            id: `party_${Date.now().toString(36)}`,
            name: name || `${ownerName}'s Party`,
            ownerId,
            ownerName,
            members: [ownerId],
            memberNames: { [ownerId]: ownerName },
            createdAt: Date.now()
        };
        this.parties.set(party.id, party);
        this.saveParties();
        return party;
    }
    leaveParty(playerId) {
        const party = this.getPartyByMember(playerId);
        if (!party) return false;
        party.members = party.members.filter(id => id !== playerId);
        delete party.memberNames[playerId];
        if (party.members.length === 0) {
            this.parties.delete(party.id);
        } else if (party.ownerId === playerId) {
            party.ownerId = party.members[0];
            party.ownerName = party.memberNames[party.ownerId] || 'Party Leader';
        }
        this.saveParties();
        return true;
    }
    inviteToParty(ownerId, targetId) {
        const party = this.getPartyByMember(ownerId);
        if (!party || party.ownerId !== ownerId) return false;
        if (party.members.includes(targetId) || party.members.length >= CONFIG.MAX_PARTY_SIZE) return false;
        this.partyInvites.set(targetId, { partyId: party.id, expiresAt: Date.now() + CONFIG.PARTY_INVITE_SECONDS * 1000 });
        return true;
    }
    acceptPartyInvite(playerId, playerName) {
        const invite = this.partyInvites.get(playerId);
        if (!invite || Date.now() > invite.expiresAt) {
            this.partyInvites.delete(playerId);
            return null;
        }
        const party = this.parties.get(invite.partyId);
        if (!party || party.members.length >= CONFIG.MAX_PARTY_SIZE) return null;
        this.leaveParty(playerId);
        party.members.push(playerId);
        party.memberNames[playerId] = playerName;
        this.partyInvites.delete(playerId);
        this.saveParties();
        return party;
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
            activeQuests: [],
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
        if (data.activeQuests === undefined) data.activeQuests = [];
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
