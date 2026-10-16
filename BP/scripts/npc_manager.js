import { world, system } from '@minecraft/server';
import { slugify } from './objective_utils.js';

export class NpcManager {
    constructor(db) {
        this.db = db;
        this.router = null;
        this.lastOpen = new Map();
    }

    setRouter(router) { this.router = router; }

    start() {
        let subscribed = false;
        const beforeSignal = world.beforeEvents?.playerInteractWithEntity;
        if (beforeSignal && typeof beforeSignal.subscribe === 'function') {
            beforeSignal.subscribe(event => {
                const entity = event.target || event.targetEntity;
                if (!entity || !this.hasBinding(entity)) return;
                event.cancel = true;
                this.handleInteraction(event);
            });
            subscribed = true;
        }

        const afterSignal = world.afterEvents?.playerInteractWithEntity;
        if (afterSignal && typeof afterSignal.subscribe === 'function') {
            afterSignal.subscribe(event => this.handleInteraction(event));
            subscribed = true;
        }

        const scriptEvents = system.afterEvents?.scriptEventReceive;
        if (scriptEvents && typeof scriptEvents.subscribe === 'function') {
            scriptEvents.subscribe(event => {
                if (event.id !== 'tasksystem:open_npc') return;
                const source = event.initiator || event.sourceEntity;
                const player = source?.typeId === 'minecraft:player' ? source : null;
                if (!player) return;
                system.run(() => {
                    if (!this.openNearestBound(player)) {
                        player.sendMessage('§c[Quest System] No bound NPC or entity was found nearby.');
                    }
                });
            });
        }

        if (!subscribed) {
            console.warn('[QuestSystem] Entity interaction events are unavailable. Add this command to an NPC button: /scriptevent tasksystem:open_npc');
        }
    }

    handleInteraction(event) {
        const player = event.player;
        const entity = event.target || event.targetEntity;
        if (!player || !entity || !this.router) return;
        const now = Date.now();
        if (now - (this.lastOpen.get(player.id) || 0) < 700) return;
        if (!this.hasBinding(entity)) return;
        this.lastOpen.set(player.id, now);
        system.run(() => this.openBoundEntity(player, entity));
    }

    getBinding(entity) {
        if (!entity || typeof entity.getTags !== 'function') return null;
        let tags = [];
        try { tags = entity.getTags(); } catch { return null; }
        const questTag = tags.find(tag => tag.startsWith('tsq_'));
        if (questTag) return { mode: 'quest', value: questTag.slice(4) };
        const folderTag = tags.find(tag => tag.startsWith('tsfolder_'));
        if (folderTag) return { mode: 'folder', value: folderTag.slice(9) };
        const shopTag = tags.find(tag => tag.startsWith('tsshop_'));
        if (shopTag) return { mode: 'shop', value: shopTag.slice(7) };
        if (tags.includes('tsmenu_quest')) return { mode: 'dashboard', value: '' };
        return null;
    }

    hasBinding(entity) {
        return Boolean(this.getBinding(entity));
    }

    describeBinding(entity) {
        const binding = this.getBinding(entity);
        if (!binding) return 'None';
        if (binding.mode === 'quest') {
            const task = this.db.tasks.get(binding.value);
            return task ? `Quest: ${task.name}` : `Broken quest binding: ${binding.value}`;
        }
        if (binding.mode === 'folder') {
            const folder = this.db.getFolders(true).find(entry => slugify(entry.name) === binding.value);
            return folder ? `Chapter: ${folder.name}` : `Broken chapter binding: ${binding.value}`;
        }
        if (binding.mode === 'shop') {
            if (binding.value === 'all') return 'Full shop';
            const category = Array.from(new Set(Array.from(this.db.shop.values()).map(item => item.category || 'General')))
                .find(name => slugify(name) === binding.value);
            return category ? `Shop: ${category}` : `Broken shop binding: ${binding.value}`;
        }
        return 'Full quest dashboard';
    }

    openBoundEntity(player, entity) {
        if (!player || !entity || !this.router) return false;
        const binding = this.getBinding(entity);
        if (!binding) return false;

        if (binding.mode === 'quest') {
            const task = this.db.tasks.get(binding.value);
            if (!task) {
                player.sendMessage(`§c[Quest System] This NPC points to a deleted quest (${binding.value}). Rebind it from the admin menu.`);
                return false;
            }
            this.router.openTask(player, task, 'npc');
            return true;
        }

        if (binding.mode === 'folder') {
            const folder = this.db.getFolders(true).find(entry => slugify(entry.name) === binding.value)?.name;
            if (!folder) {
                player.sendMessage('§c[Quest System] This NPC points to a chapter that no longer exists. Rebind it from the admin menu.');
                return false;
            }
            this.router.openFolder(player, folder, true);
            return true;
        }

        if (binding.mode === 'shop') {
            if (binding.value === 'all') {
                this.router.openShopCategory(player, null, true);
                return true;
            }
            const category = Array.from(new Set(Array.from(this.db.shop.values()).map(item => item.category || 'General')))
                .find(name => slugify(name) === binding.value);
            if (!category) {
                player.sendMessage('§c[Quest System] This NPC points to a shop category that no longer exists. Rebind it from the admin menu.');
                return false;
            }
            this.router.openShopCategory(player, category, true);
            return true;
        }

        this.router.openPlayerLog(player);
        return true;
    }

    openNearestBound(player, maxDistance = 8) {
        const entity = this.nearestEntity(player, maxDistance, true);
        if (!entity) return false;
        const now = Date.now();
        if (now - (this.lastOpen.get(player.id) || 0) < 300) return true;
        this.lastOpen.set(player.id, now);
        return this.openBoundEntity(player, entity);
    }

    nearestEntity(player, maxDistance = 8, boundOnly = false) {
        let entities = [];
        try {
            entities = player.dimension.getEntities({ location: player.location, maxDistance });
        } catch {
            return null;
        }
        const ignored = new Set(['minecraft:player', 'minecraft:item', 'minecraft:xp_orb']);
        const candidates = entities.filter(entity => {
            if (!entity || entity.id === player.id || ignored.has(entity.typeId)) return false;
            return !boundOnly || this.hasBinding(entity);
        });
        candidates.sort((a, b) => {
            const da = (a.location.x - player.location.x) ** 2 + (a.location.y - player.location.y) ** 2 + (a.location.z - player.location.z) ** 2;
            const db = (b.location.x - player.location.x) ** 2 + (b.location.y - player.location.y) ** 2 + (b.location.z - player.location.z) ** 2;
            return da - db;
        });
        return candidates[0] || null;
    }

    clearBindingTags(entity) {
        if (!entity || typeof entity.getTags !== 'function') return;
        for (const tag of entity.getTags()) {
            if (tag.startsWith('tsq_') || tag.startsWith('tsfolder_') || tag.startsWith('tsshop_') || tag === 'tsmenu_quest') {
                entity.removeTag(tag);
            }
        }
    }

    bindNearest(player, mode, value = '') {
        const entity = this.nearestEntity(player);
        if (!entity) return { ok: false, reason: 'No valid NPC or entity found within 8 blocks.' };

        if (mode === 'quest' && !this.db.tasks.has(value)) {
            return { ok: false, reason: `Quest ${value} was not found. Select it from the quest list.` };
        }
        if (mode === 'folder') {
            const folderExists = this.db.getFolders(true).some(entry => slugify(entry.name) === slugify(value));
            if (!folderExists) return { ok: false, reason: `Chapter ${value} was not found.` };
        }
        if (mode === 'shop' && value !== 'all') {
            const categoryExists = Array.from(this.db.shop.values()).some(item => slugify(item.category || 'General') === slugify(value));
            if (!categoryExists) return { ok: false, reason: `Shop category ${value} was not found.` };
        }

        try {
            this.clearBindingTags(entity);
            if (mode === 'quest') entity.addTag(`tsq_${value}`);
            else if (mode === 'folder') entity.addTag(`tsfolder_${slugify(value)}`);
            else if (mode === 'shop') entity.addTag(`tsshop_${value === 'all' ? 'all' : slugify(value)}`);
            else entity.addTag('tsmenu_quest');
        } catch (error) {
            return { ok: false, reason: `Could not tag this entity: ${error}` };
        }
        return { ok: true, entity };
    }

    unbindNearest(player) {
        const entity = this.nearestEntity(player);
        if (!entity) return false;
        this.clearBindingTags(entity);
        return true;
    }
}
