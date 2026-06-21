import { world, system, GameMode } from '@minecraft/server';
import { CONFIG, CATEGORIES } from './config.js';
import { Database } from './database.js';
import { AchievementManager } from './achievement_manager.js';
import { ChainManager } from './chain_manager.js';
import { QuestManager } from './quest_manager.js';
import { AdminUI } from './ui/admin_ui.js';
import { PlayerUI } from './ui/player_ui.js';
import { ShopUI } from './ui/shop_ui.js';
let db;
let questManager;
let achievementManager;
let chainManager;
let adminUI;
let playerUI;
let shopUI;
const uiRouter = {
    openAdminMenu: (player) => adminUI.openMenu(player),
    openPlayerLog: (player) => playerUI.openQuestLog(player),
    openLeaderboard: (player, backTarget = 'player') => playerUI.openLeaderboard(player, backTarget),
    openShopPlayer: (player) => shopUI.openPlayerShop(player),
    openShopAdmin: (player) => shopUI.openAdminShop(player),
    openChains: (player) => playerUI.uiPlayerChains(player),
    openAchievements: (player) => playerUI.uiAchievements(player)
};
system.run(() => {
    console.log('§a[QuestSystem] §eInitializing v3.0...');
    db = new Database();
    db.load();
    achievementManager = new AchievementManager(db);
    chainManager = new ChainManager(db);
    questManager = new QuestManager(db, achievementManager, chainManager);
    adminUI = new AdminUI(db, chainManager, uiRouter);
    playerUI = new PlayerUI(db, chainManager, achievementManager, uiRouter);
    shopUI = new ShopUI(db, uiRouter);
    questManager.start();
    world.afterEvents.itemUse.subscribe(ev => {
        if (ev.itemStack.typeId === CONFIG.ITEM_ID) {
            openMainMenu(ev.source);
        }
    });
    world.afterEvents.playerInteractWithEntity.subscribe(ev => {
        const player = ev.player;
        const entity = ev.target;
        const tags = entity.getTags();
        if (tags && tags.length > 0) {
            if (tags.includes('npc_shop')) {
                system.run(() => shopUI.openPlayerShop(player));
                return;
            }
            const questTag = tags.find(t => t.startsWith('npc_quest:'));
            if (questTag) {
                const questId = questTag.split(':')[1];
                const task = db.tasks.get(questId);
                if (task) {
                    system.run(() => playerUI.uiTaskDetails(player, task));
                    return;
                }
            }
            const questsTag = tags.find(t => t.startsWith('npc_quests:'));
            if (questsTag) {
                const questIds = questsTag.split(':')[1].split(',');
                const tasks = questIds.map(id => db.tasks.get(id.trim())).filter(Boolean);
                if (tasks.length > 0) {
                    system.run(() => playerUI.openCustomQuestList(player, "NPC Quests", tasks));
                    return;
                }
            }
            const catTag = tags.find(t => t.startsWith('npc_quest_cat:'));
            if (catTag) {
                const catName = catTag.split(':')[1];
                system.run(() => playerUI.openQuestLog(player, catName));
                return;
            }
        }
        
        // Fallback: Check NameTag (clean text matching)
        const nameTag = entity.nameTag;
        if (nameTag && nameTag.trim()) {
            const clean = nameTag.replace(/§[0-9a-fk-or]/ig, '').trim().toLowerCase();
            if (clean === 'shop' || clean === 'quest shop' || clean === 'shopkeeper' || clean === 'merchant') {
                system.run(() => shopUI.openPlayerShop(player));
                return;
            }
            for (const [key, catVal] of Object.entries(CATEGORIES)) {
                const cleanCat = catVal.replace(/§[0-9a-fk-or]/ig, '').trim().toLowerCase();
                if (clean === cleanCat) {
                    system.run(() => playerUI.openQuestLog(player, catVal));
                    return;
                }
            }
            for (const task of db.tasks.values()) {
                const cleanTaskName = task.name.replace(/§[0-9a-fk-or]/ig, '').trim().toLowerCase();
                if (clean === cleanTaskName && task.active) {
                    system.run(() => playerUI.uiTaskDetails(player, task));
                    return;
                }
            }
            for (const chain of db.chains.values()) {
                const cleanChainName = chain.name.replace(/§[0-9a-fk-or]/ig, '').trim().toLowerCase();
                if (clean === cleanChainName && chain.active) {
                    const chainProg = chainManager.getChainProgress(player.id, chain.id);
                    if (chainProg) {
                        system.run(() => playerUI.uiChainDetail(player, chainProg));
                        return;
                    }
                }
            }
        }
    });
    console.log('§a[QuestSystem] §ev3.0 Ready!');
    console.log('§7  Features: Chains, Achievements, Advanced Rewards, Streaks');
    console.log('§7  New Types: death, fish, place, use_item, approach');
    console.log(`§7  Loaded: ${db.tasks.size} tasks, ${db.chains.size} chains, ${db.shop.size} shop items`);
});
function openMainMenu(player) {
    const isAdmin = player.getGameMode() === GameMode.creative || player.hasTag('admin');
    if (isAdmin) {
        adminUI.openMenu(player);
    } else {
        system.run(() => playerUI.openQuestLog(player));
    }
}
