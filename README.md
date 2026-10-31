# VEX Scan

**app.2360arachnid.com** · by VEX team 2360A Arachnid

Point your phone at a VEX V5RC robot's license plate and the team's card flips up:
rating and world rank, record, best skills, whether they've qualified for States or
Worlds, and your odds allied with them and against them. Every team you scan goes
into your Dex for that event.

- **Reading plates.** The camera frame under the aim box is searched for a row of
  character-shaped blobs (straightened using the plate's own angle), and only those
  go to Tesseract OCR running in the browser. The read is then matched against the
  teams registered at the event you picked, so a half-read plate still lands on the
  right team. On synthetic plates with tilt, blur, glare and clutter it reads about
  93% of single frames correctly; the scanner reads several frames a second and
  waits for a confident match.
- **Data** comes from [stats.2360arachnid.com](https://stats.2360arachnid.com)
  (`scan.json`, rebuilt with the stats site), with a bundled copy as the fallback.
  Odds use the stats site's rating model.
- **Offline.** Once loaded, the app and the plate reader are cached, so it keeps
  working on bad venue wifi.
- Nothing leaves your phone: no camera images are uploaded, and your team and Dex
  are stored in your browser.

The Web (every alliance this season on one map) lives at [/web/](web/).

Plain HTML, CSS and JavaScript; no build step. Tesseract.js (Apache 2.0) is vendored
in `vendor/tesseract/`.
