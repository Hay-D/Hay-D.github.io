# Using HayDex

[Open the illustrated PDF guide](public/HayDex-Guide.pdf).

## Make a trade

1. Choose **Sell** or **Buy**, then **Add items**. Search by name or use the categories. Set your farm level to filter the list. You can mark items as favorites.
2. Tap an item to add it. BEM, SEM and LEM sets add with one tap. One set counts as one unit, and its price is for the whole set. Individual materials can be added separately. Help is in Services.
3. Edit the quantity or price on its card. You can use `3k`, `5x` the shop price, ratios like `2:1`, or sums like `20*4`. A blank price stays blank.

Use **Select** to change several items at once. **All** selects the list. **Price** and **Quantity** edit the selection. Price changes are temporary until you press **Save**. Deselecting restores unsaved prices. **Done** leaves selection mode. Undo and redo are available at the top. On a keyboard, `/` opens Add items, `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` redoes, `Delete` removes selected items, and `Esc` clears the selection.

Remove a card with its small delete button. Drag cards to reorder or drop them on the delete area. You can also move or delete an item in its details. Use the sort control for quantity, price, total value, name, or farm level. The **All** tab in Add items learns which items you add on this device.

## Prices and sharing

**Prices → Saved prices** keeps prices for future trades on this device. Item details also offer **Remember this price**. Settings control the starting quantity and price.

**Prices → Trading prices** shows seven-day Buy and Sell averages in coins per item. Check the date of the snapshot. Compare two averages to estimate a Have:Want ratio. At 2,000 coins for Soy sauce and 1,000 for Cream, for example, the estimate is 1:2. [Market price source](https://hayday.info/trading)

GitHub Pages refreshes trading prices on its daily schedule. Local previews use the bundled snapshot. Run `npm run update-prices` to refresh it locally.

Tap the totals to choose a payment item and see the equivalent quantity. Turn **Partials** on or off for the trade.

**Text** offers plain text, Discord text or item code to copy or download. **Settings → Text format** changes the format and separators. **Image** previews the trade and lets you copy or download PNGs. Large exports can be split into pages and downloaded as a ZIP. With items selected, sharing uses that selection.

Image appearance controls Auto or fixed columns, width, quality, colors, borders, spacing, quantities, prices, names, totals and captions. Names start on. **More image options** accepts hex colors. The HayDex watermark stays on exported images. Farm name, tag, Discord name and notes can be added in Settings.

## Save or move a list

Tap the list name to rename or save it. The bookmark button opens saved lists. Open or delete a saved list there, or start a new one. Your current trade saves as you edit.

**Import** accepts item codes, JSON or lines such as `20 Beeswax @ 3k`. Choose Replace to start fresh or Add to merge it with the current list. **Settings → Lists & backup** exports or restores lists and settings, including supported older backups. It also has **Clear this list**.

## Trade posts and deals

Choose **Trade** beside Sell and Buy to add an exchange. Put the items you offer in **Have** and the items you want in **Want**. Set quantities on both sides. Enter an optional **Have to Want** ratio, such as `1:1` or `1:85`, and terms such as “Any mix is fine” or “First page jams only.” Qty 1 for a BEM, SEM or LEM means one set. If an agreed ratio counts individual materials, enter that rate separately. Add another exchange for alternate offers or rates. Tap an exchange to edit it. **Image** and **Text** share the ratio and terms with each offer.

In **Sell**, tap **Discount** below the items. Enter a percentage and a name such as Bundle deal. The image and Discord copy show the subtotal, discount and final coins. Your payment equivalent uses the final amount. Buy posts keep their regular price.

Open the **farm menu** at the top right to edit your farm, find saved trade posts, and open **Deals**, **History** or **Stats**. Use **New deal** or **From this post** to keep several deals open. Mark a deal **Complete** to record it. **Reopen** moves it back to Deals and removes it from the completed totals. Stats are calculated from the deals you complete. **Settings → Lists & backup** includes the deals and your history in backups.

Use **Import → Import an old post** or pick it in the farm menu. Paste Discord text or use **Scan post** to choose an image, text or JSON file. **Preview** shows what was read before **Load post** replaces the current draft. Original HayDex PNG exports restore the displayed items, quantities and prices, including Trade groups and their ratios. Older PNGs and screenshots work best with visible quantities and tile edges. Review the recovered rows and add prices after loading a screenshot.

Put the ratio in Have:Want order, as in this Discord exchange.

```text
Have
50 Soy sauce
Want
1 BEM set
Ratio · 50:1 (Have:Want)
```

A normal Sell or Buy message can include an amount and unit, such as `40 Jam @ 2k each`. Add your partial minimum or payment terms in the caption if needed.

## Scan photos or video

1. Open **Scanner**. The local Rust engine and reference artwork load in the background.
2. Upload PNG, JPG or WebP screenshots, or an MP4, WebM or MOV recording your browser can play. For video, keep the barn or silo visible, scroll slowly, and pause on each screen. Use up to 3 minutes of video per scan. Each clip can be up to 250 MB.
3. Check **Crop & alignment** if the grid looks wrong. Choose a layout, adjust the crop or rows and columns, skip cropped edge rows, and apply the grid to other photos if needed.
4. Press **Scan photos** or **Scan files**. In **Review**, check each crop, item name, quantity and price. Tap the crop to enlarge it. Correct readings, remove rows or add a result manually. Filter rows by their review status. Confirm rows you have checked, or use **Confirm valid**. Flagged video rows need manual confirmation.
5. Press **Create trade**, then confirm **Import** to replace or merge the current list. You can also copy or download the results. Overlapping photos keep the largest confirmed quantity. Video scans skip clipped rows and combine repeated sightings of an item. Review flags conflicting quantities and uncertain matches.

**Excluded items** leaves chosen goods out of the results. Scanner settings share your farm level and prices, and let you skip zero stock, show prices, use default prices and save edited prices. **Item code & corrections** also lets you export checked crops. You can stop a scan at any time. Photos and videos are processed on your device. If the local preview blocks video, restart it with the current `main.py`.

Settings → About has the privacy policy, terms and version history.
