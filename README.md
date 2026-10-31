# The Web

**[app.2360arachnid.com](https://app.2360arachnid.com)** · by VEX team 2360A Arachnid

Every alliance in VEX V5 Robotics Competition, spun into one web.

- **World web:** every team sits at its home town. Each thread is two teams that played on the same alliance, drawn in the order they first teamed up, so the whole season spins itself across the map. Press play to watch it again, or drag the slider through the season.
- **Team web:** pick a team and its alliances form an orb web. Ring 1 is its partners and ring 2 is their partners. Hover or tap a team to see where and when they teamed up, and click it to move to that team's web. The panel shows how many teams are within two and three steps, how many steps away the World Champions are, its most frequent partner, its farthest partner, and every partnership in order.
- **Six degrees of VEX:** link any two teams through the shortest chain of alliances, with a spider walking the chain. Each link in the chain is shareable.

Seasons:
- **Push Back (2025–26):** the complete season, with 165,072 alliance pairs between 12,612 teams.
- **Override (2026–27):** live, read from [stats.2360arachnid.com](https://stats.2360arachnid.com), which updates during events.

## How it's built

There are no libraries or build step: `index.html`, `app.js` and `style.css` draw on a canvas. The data is `web.json`, published by [VexPredict](https://github.com/s1g6r/VexPredict) (`vexpredict/web.py`) from official match results:
- `data/push-back.json` is the finished season.
- Override loads from the stats site, with `data/override.json` as an offline fallback.

Run it locally with `python3 -m http.server`, then open http://localhost:8000.
