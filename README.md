# Mini NetSim Studio

Basic Network Topology and Packet Routing Simulator.

## Run in VS Code
1. Open this folder in VS Code (File > Open Folder).
2. Install the "Live Server" extension, right-click `index.html` and choose "Open with Live Server".
   You can also double-click `index.html` to open it in a browser. No install or build step is needed.
3. An internet connection is only used for the Google Fonts. The app works without it using fallback fonts.

## Files
- `index.html`  page structure (Simulator, Dashboard and About Team tabs)
- `style.css`   all styling, with light and dark themes
- `script.js`   topology editor, Dijkstra's algorithm, packet animation, dashboard, team page

## Features
1. Create computers and routers and connect them.
2. Send a packet between two computers with an animation.
3. Find the shortest route using Dijkstra's algorithm (see `dijkstra()` in `script.js`).
4. Show the route, hop count and simulated packet delay.

Delay = sum of link latencies + 2 ms for each router on the path.

## Team
Adhiranshu Singh (24BIT0036), Lakshy Kesharwani (24BIT0066), Govind Innani (24BIT0157)
