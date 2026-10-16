import { world, system, GameMode } from '@minecraft/server';
import { CONFIG } from './config.js';
import { Database } from './database.js';
import { AchievementManager } from './achievement_manager.js';
import { ChainManager } from './chain_manager.js';
import { QuestManager } from './quest_manager.js';
import { PartyManager } from './party_manager.js';
import { BountyManager } from './bounty_manager.js';
import { BackupManager } from './backup_manager.js';
import { NpcManager } from './npc_manager.js';
import { AdminUI } from './ui/admin_ui.js';
import { PlayerUI } from './ui/player_ui.js';
import { ShopUI } from './ui/shop_ui.js';

let db;
let questManager;
let achievementManager;
let chainManager;
let partyManager;
let bountyManager;
let backupManager;
let npcManager;
let adminUI;
let playerUI;
let shopUI;

const uiRouter = {
    openAdminMenu: player => adminUI.openMenu(player),
    openPlayerLog: player => playerUI.openQuestLog(player),
    openTask: (player, task, source = 'npc') => playerUI.uiTaskDetails(player, task, source),
    openFolder: (player, folder, allowNpcOnly = false) => playerUI.openFolder(player, folder, allowNpcOnly),
    openLeaderboard: (player, backTarget = 'player') => playerUI.openLeaderboard(player, backTarget),
    openShopPlayer: (player, category = null, fromNpc = false) => shopUI.openPlayerShop(player, category, fromNpc),
    openShopCategory: (player, category = null, fromNpc = true) => shopUI.openPlayerShop(player, category, fromNpc),
    openShopAdmin: player => shopUI.openAdminShop(player),
    openChains: player => playerUI.uiPlayerChains(player),
    openAchievements: player => playerUI.uiAchievements(player)
};

system.run(() => {
    console.log(`§a[QuestSystem] §eInitializing v${CONFIG.VERSION}...`);
    db = new Database();
    db.load();

    achievementManager = new AchievementManager(db);
    chainManager = new ChainManager(db);
    partyManager = new PartyManager(db);
    bountyManager = new BountyManager(db);
    partyManager.load();
    bountyManager.load();
    backupManager = new BackupManager(db, partyManager, bountyManager);
    backupManager.load();
    npcManager = new NpcManager(db);

    questManager = new QuestManager(db, achievementManager, chainManager, partyManager, bountyManager);
    adminUI = new AdminUI(db, chainManager, npcManager, backupManager, uiRouter);
    playerUI = new PlayerUI(db, chainManager, achievementManager, partyManager, bountyManager, questManager, uiRouter);
    shopUI = new ShopUI(db, uiRouter);

    npcManager.setRouter(uiRouter);
    npcManager.start();
    questManager.start();

    world.afterEvents.itemUse.subscribe(event => {
        if (event.itemStack.typeId === CONFIG.ITEM_ID) openMainMenu(event.source);
    });

    console.log(`§a[QuestSystem] §ev${CONFIG.VERSION} Ready!`);
    console.log('§7  Features: Chapters, Multi-Objectives, NPC Givers, Parties, Bounties, Backups');
    console.log('§7  Objective Types: block, kill, gather, craft, place, fish, distance, effect, approach and more');
    console.log(`§7  Loaded: ${db.tasks.size} tasks, ${db.chains.size} chains, ${db.shop.size} shop items`);
});

function openMainMenu(player) {
    const isAdmin = player.getGameMode() === GameMode.Creative || player.hasTag('admin');
    if (isAdmin) adminUI.openMenu(player);
    else system.run(() => playerUI.openQuestLog(player));
}
