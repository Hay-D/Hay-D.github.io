# Using HayDex

## Make a trade

1. Choose **Sell** or **Buy**, then **Add items**. Search by name or use the categories. Set your farm level to filter the list. You can mark items as favorites.
2. Tap an item to add it. BEM, SEM and LEM sets add with one tap. One set counts as one unit, and its price is for the whole set. Individual materials can be added separately. Help is in Services.
3. Edit the quantity or price on its card. You can use `3k`, `5x` the shop price, ratios like `2:1`, or sums like `20*4`. A blank price stays blank.

Use **Select** to change several items at once. **All** selects the list; **Price** and **Quantity** edit the selection. Price changes are temporary until you press **Save**. Deselecting restores unsaved prices. **Done** leaves selection mode. Undo and redo are available at the top. On a keyboard, `/` opens Add items, `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` redoes, `Delete` removes selected items, and `Esc` clears the selection.

Remove a card with its small delete button. Drag cards to reorder or drop them on the delete area. You can also move or delete an item in its details. Use the sort control for quantity, price, total value or name.

## Prices and sharing

**Prices** stores your usual prices. Item details also offer **Remember this price**. Settings control the starting quantity and price.

Tap the totals to choose a payment item and see the equivalent quantity. Turn **Partials** on or off for the trade.

**Text** offers plain text, Discord text or item code to copy or download. **Settings → Text format** changes the format and separators. **Image** previews the trade and lets you copy or download PNGs. Large exports can be split into pages and downloaded as a ZIP. With items selected, sharing uses that selection.

Image appearance controls Auto or fixed columns, width, quality, colors, borders, spacing, quantities, prices, names, totals and captions. Names start on. The HayDex watermark stays on exported images. Farm name, tag, Discord name and notes can be added in Settings.

## Save or move a list

Tap the list name to rename or save it. The bookmark button opens saved lists. Open or delete a saved list there, or start a new one. Your current trade saves as you edit.

**Import** accepts item codes, JSON or lines such as `20 Beeswax @ 3k`. Choose Replace to start fresh or Add to merge it with the current list. **Settings → Lists & backup** exports or restores lists and settings, including supported older backups. It also has **Clear this list**.

## Scan photos

1. Open **Scanner**. It uses bundled item and number artwork, with no model download.
2. Upload or drag in PNG, JPG or WebP barn, silo or roadside shop photos. Remove duplicates or unwanted photos before scanning.
3. Check **Crop & alignment** if the grid looks wrong. Choose a layout, adjust the crop or rows and columns, skip cropped edge rows, and apply the grid to other photos if needed.
4. Press **Scan photos**. In **Review**, check each crop, item name, quantity and price. Tap the crop to enlarge it. Correct readings, remove rows or add a result manually. Filter rows by their review status. Confirm rows you have checked, or use **Confirm valid**.
5. Press **Create trade**, then confirm **Import** to replace or merge the current list. You can also copy or download the results. Repeated items keep the largest quantity found in overlapping photos.

**Excluded items** leaves chosen goods out of the results. Scanner settings share your farm level and prices, and let you skip zero stock, show prices, use default prices and save edited prices. **Item code & corrections** also lets you export checked crops. You can stop a scan at any time. Photos are processed on your device.

Settings → About has the privacy policy, terms and version history.

Trading prices, between Saved prices and Payment item, shows seven-day buy and sell averages from [hayday.info](https://hayday.info/trading). These are posted prices, not confirmed sales. The Pages workflow refreshes them every six hours; the update date is shown. Local previews use the bundled snapshot. Run `npm run update-prices` to refresh it locally.

The All tab learns from item additions on this device. Frequent and recent choices appear first the next time you open the picker. In Image → More image options, enter a hex color beside each color picker.
