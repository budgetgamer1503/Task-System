import { world, system, GameMode } from '@minecraft/server';
import { CONFIG } from './config.js';
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
    console.log('§a[QuestSystem] §ev3.0 Ready!');
    console.log('§7  Features: Chains, Achievements, Advanced Rewards, Streaks');
    console.log('§7  New Types: death, fish, place, use_item');
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
