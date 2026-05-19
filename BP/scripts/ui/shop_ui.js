import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';

export class ShopUI {
    constructor(db, uiRouter) {
        this.db = db;
        this.router = uiRouter;
    }

    openPlayerShop(player) {
        const data = this.db.getPlayer(player.id);
        const form = new ActionFormData().title({ translate: 'ads.ui.shop.title' });

        const shopItems = Array.from(this.db.shop.values());

        if (shopItems.length === 0) {
            form.body({ translate: 'ads.ui.shop.empty', with: [String(data.points)] });
            form.button({ translate: 'ads.ui.btn_back' });
            form.show(player).then(r => {
                if (!r.canceled) system.run(() => this.router.openPlayerLog(player));
            });
            return;
        }

        form.body({ translate: 'ads.ui.shop.browse', with: [String(data.points)] });

        shopItems.forEach(item => {
            const affordable = data.points >= item.price;
            let priceTagKey = affordable ? 'ads.ui.shop.price_can_afford' : 'ads.ui.shop.price_cannot_afford';
            
            let btnText = [
                { text: `${affordable ? '§f' : '§8'}${item.name}\n` },
                { translate: priceTagKey, with: [String(item.price)] }
            ];
            
            form.button({ rawtext: btnText }, item.icon || 'textures/items/gold_ingot');
        });

        form.button({ translate: 'ads.ui.btn_back' });

        form.show(player).then(r => {
            if (r.canceled) return;
            system.run(() => {
                if (r.selection === shopItems.length) {
                    this.router.openPlayerLog(player);
                    return;
                }

                const item = shopItems[r.selection];

                if (data.points < item.price) {
                    player.sendMessage({ translate: 'ads.ui.shop.not_enough_points', with: [String(item.price), String(data.points)] });
                    this.openPlayerShop(player);
                    return;
                }

                new MessageFormData()
                    .title({ translate: 'ads.ui.shop.confirm_title' })
                    .body({ translate: 'ads.ui.shop.confirm_body', with: [item.name, String(item.price), String(data.points - item.price)] })
                    .button1({ translate: 'ads.ui.shop.btn_buy' })
                    .button2({ translate: 'ads.ui.shop.btn_cancel' })
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
                                player.sendMessage({ translate: 'ads.ui.shop.purchased', with: [item.name, String(item.price), String(data.points)] });
                            }
                            this.openPlayerShop(player);
                        });
                    });
            });
        });
    }

    openAdminShop(player) {
        const form = new ActionFormData().title({ translate: 'ads.ui.admin_shop.title' });
        const shopItems = Array.from(this.db.shop.values());

        form.body({ translate: 'ads.ui.admin_shop.body', with: [String(shopItems.length)] });
        form.button({ translate: 'ads.ui.admin_shop.btn_add' }, 'textures/items/gold_ingot');

        shopItems.forEach(item => {
            const cmds = item.commands || (item.command ? [item.command] : []);
            form.button({ translate: 'ads.ui.admin_shop.item_btn', with: [item.name, String(item.price), String(cmds.length)] }, item.icon || 'textures/items/gold_ingot');
        });

        form.button({ translate: 'ads.ui.admin_shop.btn_back' });

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
            .title({ translate: editItem ? 'ads.ui.admin_shop.edit_title' : 'ads.ui.admin_shop.add_title' })
            .textField({ translate: 'ads.ui.admin_shop.lbl_name' }, { translate: 'ads.ui.admin_shop.pl_name' }, { defaultValue: editItem?.name || '' })
            .slider({ translate: 'ads.ui.admin_shop.lbl_price' }, 1, 5000, { valueStep: 5, defaultValue: editItem?.price || 50 })
            .textField({ translate: 'ads.ui.admin_shop.lbl_cmds' }, { translate: 'ads.ui.admin_shop.pl_cmds' }, { defaultValue: existingCmds.join(';') || '' })
            .textField({ translate: 'ads.ui.admin_shop.lbl_icon' }, { translate: 'ads.ui.admin_shop.pl_icon' }, { defaultValue: editItem?.icon || 'textures/items/gold_ingot' })
            .show(player).then(r => {
                if (r.canceled) return;
                const [name, price, commandStr, icon] = r.formValues;

                if (!name || name.trim() === '') {
                    player.sendMessage({ translate: 'ads.ui.admin_shop.empty_name' });
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
                
                player.sendMessage({ translate: editItem ? 'ads.ui.admin_shop.updated' : 'ads.ui.admin_shop.added', with: [name, String(price), String(commands.length)] });
                
                system.run(() => this.openAdminShop(player));
            });
    }

    uiEditShopItem(player, item) {
        const cmds = item.commands || (item.command ? [item.command] : []);

        new MessageFormData()
            .title({ translate: 'ads.ui.admin_shop.edit_item_title', with: [item.name] })
            .body({ translate: 'ads.ui.admin_shop.edit_item_body', with: [String(item.price), String(cmds.length), item.icon] })
            .button1({ translate: 'ads.ui.admin_shop.btn_edit' })
            .button2({ translate: 'ads.ui.admin_shop.btn_delete' })
            .show(player).then(r => {
                system.run(() => {
                    if (r.selection === 0) {
                        this.uiCreateShopItem(player, item);
                    } else if (r.selection === 1) {
                        this.db.shop.delete(item.id);
                        this.db.saveShop();
                        player.sendMessage({ translate: 'ads.ui.admin_shop.deleted', with: [item.name] });
                        this.openAdminShop(player);
                    }
                });
            });
    }
}