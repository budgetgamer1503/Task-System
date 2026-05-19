import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';
export class ShopUI {
    constructor(db, uiRouter) {
        this.db = db;
        this.router = uiRouter;
    }
    openPlayerShop(player) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title('§6§lQuest Shop');
        const shopItems = Array.from(this.db.shop.values());
        if (shopItems.length === 0) {
            form.body(`§d§lYour Points: §f${data.points}\n\n§7The shop is empty. Ask an admin to add items!`);
            form.button('§cBack');
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.router.openPlayerLog(player));
            });
            return;
        }
        form.body(`§d§lYour Points: §f${data.points}\n\n§7Browse items below. Tap to purchase.`);
        shopItems.forEach(item => {
            const affordable = data.points >= item.price;
            const priceTag = affordable ? `§a${item.price}pts` : `§c${item.price}pts`;
            form.button(`${affordable ? '§f' : '§8'}${item.name}\n${priceTag}`, item.icon || 'textures/items/gold_ingot');
        });
        form.button('§cBack');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === shopItems.length) {
                    this.router.openPlayerLog(player);
                    return;
                }
                const item = shopItems[r.selection];
                if (data.points < item.price) {
                    player.sendMessage(`§c[Quest Shop] Not enough points! Need §f${item.price}§c, have §f${data.points}`);
                    this.openPlayerShop(player);
                    return;
                }
                new MessageFormData()
                    .title('§6§lConfirm Purchase')
                    .body(`§fBuy §e${item.name}§f for §d${item.price} points§f?\n\n§7Remaining balance: §f${data.points - item.price} points`)
                    .button1('§a§lBuy')
                    .button2('§cCancel')
                    .show(player).then(cr => {
                        system.run(() => {
                            if (cr.selection === 0) {
                                data.points -= item.price;
                                this.db.savePlayer(player.id);
                                const commands = item.commands || (item.command ? [item.command] : []);
                                commands.forEach(cmd => {
                                    try { player.runCommand(cmd); } catch (e) { }
                                });
                                player.runCommand('playsound random.levelup @s ~~~ 0.8 1.2');
                                player.sendMessage(`§a[Quest Shop] §fPurchased §e${item.name}§f! §7(-${item.price}pts, balance: ${data.points})`);
                            }
                            this.openPlayerShop(player);
                        });
                    });
            });
        });
    }
    openAdminShop(player) {
        const form = new ActionFormData().title('§6§lManage Quest Shop');
        const shopItems = Array.from(this.db.shop.values());
        form.body(`§7${shopItems.length} item(s) in shop. Add or edit items.`);
        form.button('§a+ Add Shop Item', 'textures/items/gold_ingot');
        shopItems.forEach(item => {
            const cmds = item.commands || (item.command ? [item.command] : []);
            form.button(`§f${item.name}\n§7${item.price}pts — ${cmds.length} cmd(s)`, item.icon || 'textures/items/gold_ingot');
        });
        form.button('§c< Back');
        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === 0) {
                    this.uiCreateShopItem(player);
                } else if (r.selection === shopItems.length + 1) {
                    this.router.openAdminMenu(player);
                } else {
                    const item = shopItems[r.selection - 1];
                    this.uiEditShopItem(player, item);
                }
            });
        });
    }
    uiCreateShopItem(player, editItem = null) {
        const existingCmds = editItem?.commands || (editItem?.command ? [editItem.command] : []);
        new ModalFormData()
            .title(editItem ? '§eEdit Shop Item' : '§a§lAdd Shop Item')
            .textField('Item Name', 'e.g. Diamond Bundle', { defaultValue: editItem?.name || '' })
            .slider('Price (Quest Points)', 1, 5000, { valueStep: 5, defaultValue: editItem?.price || 50 })
            .textField('Reward Commands (;sep)', '/give @s diamond 64', { defaultValue: existingCmds.join(';') || '' })
            .textField('Icon (texture path)', 'textures/items/diamond', { defaultValue: editItem?.icon || 'textures/items/gold_ingot' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, price, commandStr, icon] = r.formValues;
                if (!name || name.trim() === '') {
                    player.sendMessage('§c[Quest Shop] Item name cannot be empty!');
                    return;
                }
                const commands = commandStr ? commandStr.split(';').filter(s => s.trim()) : [];
                const id = editItem?.id || `shop_${Date.now().toString(36)}`;
                const shopItem = {
                    id, name, price,
                    command: commands[0] || '',
                    commands: commands,
                    icon: icon || 'textures/items/gold_ingot'
                };
                this.db.shop.set(id, shopItem);
                this.db.saveShop();
                player.sendMessage(`§a[Quest Shop] ${editItem ? 'Updated' : 'Added'}: §f${name} §7(${price}pts, ${commands.length} cmd(s))`);
                system.run(() => this.openAdminShop(player));
            });
    }
    uiEditShopItem(player, item) {
        const cmds = item.commands || (item.command ? [item.command] : []);
        new MessageFormData()
            .title(`§e§l${item.name}`)
            .body(`§fPrice: §d${item.price} points\n§fCommands: §7${cmds.length}\n§fIcon: §7${item.icon}`)
            .button1('§eEdit')
            .button2('§cDelete')
            .show(player).then(r => {
                system.run(() => {
                    if (r.selection === 0) {
                        this.uiCreateShopItem(player, item);
                    } else if (r.selection === 1) {
                        this.db.shop.delete(item.id);
                        this.db.saveShop();
                        player.sendMessage(`§c[Quest Shop] Deleted: §f${item.name}`);
                        this.openAdminShop(player);
                    }
                });
            });
    }
}