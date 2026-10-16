import { system } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData } from '@minecraft/server-ui';

export class ShopUI {
    constructor(db, uiRouter) {
        this.db = db;
        this.router = uiRouter;
    }

    getCategories() {
        return Array.from(new Set(Array.from(this.db.shop.values()).map(item => item.category || 'General'))).sort();
    }

    openPlayerShop(player, category = null, fromNpc = false) {
        const data = this.db.getPlayer(player.id);
        const categories = this.getCategories();
        if (!category && categories.length > 1) {
            const form = new ActionFormData().title('§6§lQUEST SHOP');
            form.body(`§7Choose a shop category.\n\n§dWallet: §f${data.points} points`);
            categories.forEach(name => {
                const count = Array.from(this.db.shop.values()).filter(item => (item.category || 'General') === name).length;
                form.button(`§f§l${name}\n§7${count} items`, 'textures/ui/quest_folder');
            });
            form.button('§8Back', 'textures/ui/quest_back');
            form.show(player).then(result => {
                if (result.canceled) return;
                system.run(() => {
                    if (result.selection === categories.length) this.router.openPlayerLog(player);
                    else this.openPlayerShop(player, categories[result.selection], fromNpc);
                });
            });
            return;
        }

        const selected = category || categories[0] || 'General';
        const items = Array.from(this.db.shop.values())
            .filter(item => (item.category || 'General') === selected)
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || a.name.localeCompare(b.name));
        const form = new ActionFormData().title(`§6§l${selected}`);
        form.body(`§dWallet: §f${data.points} points\n§7Select an item to review and purchase.`);
        items.forEach(item => {
            const affordable = data.points >= item.price;
            form.button(`${affordable ? '§f' : '§8'}${item.name}\n${affordable ? '§a' : '§c'}${item.price} points`, item.icon || 'textures/items/gold_ingot');
        });
        form.button(categories.length > 1 ? '§8Back to Categories' : '§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === items.length) {
                    if (categories.length > 1) this.openPlayerShop(player, null, fromNpc);
                    else this.router.openPlayerLog(player);
                    return;
                }
                this.confirmPurchase(player, items[result.selection], selected, fromNpc);
            });
        });
    }

    confirmPurchase(player, item, category, fromNpc) {
        const data = this.db.getPlayer(player.id);
        if (data.points < item.price) {
            player.sendMessage(`§c[Quest Shop] You need ${item.price} points, but have ${data.points}.`);
            this.openPlayerShop(player, category, fromNpc);
            return;
        }
        new MessageFormData()
            .title(`Buy ${item.name}?`)
            .body(`Price: ${item.price} points\nBalance after purchase: ${data.points - item.price}\n\n${item.description || ''}`)
            .button1('Buy')
            .button2('Cancel')
            .show(player).then(result => {
                system.run(() => {
                    if (result.selection === 0) {
                        data.points -= item.price;
                        this.db.savePlayer(player.id);
                        const commands = item.commands || (item.command ? [item.command] : []);
                        commands.forEach(command => { try { player.runCommand(command); } catch (e) { } });
                        player.runCommand('playsound random.levelup @s ~~~ 0.8 1.2');
                        player.sendMessage(`§a[Quest Shop] Purchased §f${item.name} §7for ${item.price} points.`);
                    }
                    this.openPlayerShop(player, category, fromNpc);
                });
            });
    }

    openAdminShop(player) {
        const items = Array.from(this.db.shop.values()).sort((a, b) => (a.category || 'General').localeCompare(b.category || 'General') || Number(a.order || 0) - Number(b.order || 0));
        const form = new ActionFormData().title('§6§lSHOP MANAGER');
        form.body(`§7${items.length} configured shop items across ${this.getCategories().length} categories.`);
        form.button('§aAdd Shop Item', 'textures/items/gold_ingot');
        items.forEach(item => form.button(`§f${item.name}\n§7${item.category || 'General'} • ${item.price} pts`, item.icon || 'textures/items/gold_ingot'));
        form.button('§8Back', 'textures/ui/quest_back');
        form.show(player).then(result => {
            if (result.canceled) return;
            system.run(() => {
                if (result.selection === 0) this.uiCreateShopItem(player);
                else if (result.selection === items.length + 1) this.router.openAdminMenu(player);
                else this.uiEditShopItem(player, items[result.selection - 1]);
            });
        });
    }

    uiCreateShopItem(player, editItem = null) {
        const commands = editItem?.commands || (editItem?.command ? [editItem.command] : []);
        new ModalFormData().title(editItem ? 'Edit Shop Item' : 'Add Shop Item')
            .textField('Item name', 'Example: Diamond Kit', { defaultValue: editItem?.name || '' })
            .textField('Description', 'Shown before purchase', { defaultValue: editItem?.description || '' })
            .textField('Category / shop menu', 'General', { defaultValue: editItem?.category || 'General' })
            .textField('Price (numeric)', '100', { defaultValue: String(editItem?.price ?? 50) })
            .textField('Commands separated by semicolons', 'give @s diamond 1', { defaultValue: commands.join(';') })
            .textField('Icon texture path', 'textures/items/gold_ingot', { defaultValue: editItem?.icon || 'textures/items/gold_ingot' })
            .textField('Sort order (numeric)', '0', { defaultValue: String(editItem?.order ?? 0) })
            .show(player).then(result => {
                if (result.canceled) return;
                const [name, description, category, priceRaw, commandRaw, icon, orderRaw] = result.formValues;
                if (!String(name || '').trim()) {
                    player.sendMessage('§c[Quest Shop] Item name cannot be empty.');
                    return;
                }
                const parsedCommands = String(commandRaw || '').split(';').map(value => value.trim()).filter(Boolean);
                const id = editItem?.id || `shop_${Date.now().toString(36)}`;
                this.db.shop.set(id, {
                    id,
                    name: String(name).trim(),
                    description: String(description || ''),
                    category: String(category || 'General').trim() || 'General',
                    price: Math.max(1, Math.floor(Number(priceRaw) || 1)),
                    command: parsedCommands[0] || '',
                    commands: parsedCommands,
                    icon: String(icon || 'textures/items/gold_ingot'),
                    order: Number(orderRaw) || 0
                });
                this.db.saveShop();
                player.sendMessage(`§a[Quest Shop] ${editItem ? 'Updated' : 'Added'} §f${name}`);
                system.run(() => this.openAdminShop(player));
            });
    }

    uiEditShopItem(player, item) {
        new MessageFormData()
            .title(item.name)
            .body(`Category: ${item.category || 'General'}\nPrice: ${item.price}\nCommands: ${item.commands?.length || 0}\nOrder: ${item.order || 0}`)
            .button1('Edit')
            .button2('Delete')
            .show(player).then(result => {
                system.run(() => {
                    if (result.selection === 0) this.uiCreateShopItem(player, item);
                    else if (result.selection === 1) {
                        this.db.shop.delete(item.id);
                        this.db.saveShop();
                        player.sendMessage(`§e[Quest Shop] Deleted ${item.name}`);
                        this.openAdminShop(player);
                    }
                });
            });
    }
}
