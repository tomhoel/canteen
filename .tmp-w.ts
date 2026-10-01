import fs from "node:fs";
import { parseCanteenHtml, CANTEENS } from "./src/server/services/scraper.service.ts";
for (const c of CANTEENS) {
  const f = `src/server/services/__fixtures__/weekly-${c.displayName.toLowerCase().replace(/ /g, "-")}.html`;
  const d = parseCanteenHtml(fs.readFileSync(f, "utf8"), c);
  console.log(c.displayName, "| week:", d.week, "| days:", d.menu.map(x => x.day.slice(0,3) + ":" + (x.no?.items.length ?? 0)).join(" "));
  for (const day of d.menu.slice(0, 2)) console.log("   ", day.day, "→", day.no?.items.map(i => (i.isMain ? "★" : "") + i.dish.slice(0, 36)).join(" | "));
}
