# Doujin Read Tracker

A Tampermonkey userscript for **Doujin-TH** and **Miku-Doujin**, designed for mobile and desktop.

> Independent community tool. Not affiliated with either website.

## Features

- Mark a story **READ** automatically when opened.
- Set a **LAST** checkpoint to remember where you stopped browsing.
- **Find LAST** by scanning up to five list pages at once in the background, starting from a remembered page hint when available.
- Hide READ entries.
- Compact floating panel (collapsible `📚` button), with Android-friendly tap targets and safe-area spacing.
- Records stay in **Tampermonkey storage on your device**; no external tracking server is used.

## Install (Android)

1. Install **Firefox for Android** and the **Tampermonkey** extension.
2. Open this link **in Firefox**: [Install Doujin Read Tracker](https://raw.githubusercontent.com/sniertough/doujin-tracker/main/doujin_tracker.user.js).
3. If Tampermonkey shows an install screen, choose **Install**. If it displays plain text instead, open Tampermonkey Dashboard > **Create a new script**, paste the contents, and save.
4. Visit [Doujin-TH](https://doujin-th.com/forum/index.php/board,1.0.html) or [Miku-Doujin](https://miku-doujin.com/) using Firefox.
5. Tap the small **📚** button to open the controls.

## Install (Desktop)

Install Tampermonkey for a supported desktop browser, then open the [userscript URL](https://raw.githubusercontent.com/sniertough/doujin-tracker/main/doujin_tracker.user.js) and install.

## Usage

- **📍**: Save a LAST checkpoint next to a title or inside a story.
- **🔎 หา LAST**: Find the saved story in the listing.
- **🙈 ซ่อน READ**: Hide visited stories on the current list.
- **📚**: Expand / collapse the floating panel.

## Notes and limitations

- The script was syntax-checked, but **not verified end-to-end on the live websites or every Android browser**. Report issues with the website URL and screenshots (avoid including personal data).
- The script may need changes when site navigation or pagination changes.
- Batch scanning is limited to five requests at a time and up to 200 pages. Please do not repeatedly trigger searches unnecessarily.
- On Miku, pagination may require a manual site-dropdown jump if the website blocks scripted navigation.
- Existing records from v1.7 should remain available because the Tampermonkey script identity and storage keys were retained. Disabling/deleting an older copy is recommended to prevent two copies running simultaneously.
- READ means **opened**, not necessarily finished reading.
- Clearing browser/extension storage may erase READ/LAST history. The storage is **not synced between Android and desktop**.
- Follow each website's terms and access rules.

## Userscript updates

The script includes `@updateURL` and `@downloadURL` pointing to this repository's `main` branch. Tampermonkey periodically checks for updates according to its extension settings.

## License

MIT. See [LICENSE](LICENSE).
