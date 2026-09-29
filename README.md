# sale-pdf-pages

**Live site: https://davis-pies.github.io/sale-pdf-pages/**

Drop a Consignor Inventory Report PDF on the page to regroup its items into printable tables by category, size and owner. The PDF is read in your browser and never uploaded.

To pick up where a printout left off, load the same report, then choose the saved PDF under "Restore layout from a printed PDF": table and row order, gaps, font size, grouping and period label come back. Zebra stripes aren't recorded in the printout, so set that by hand.

Run locally with `python3 -m http.server 8000` and open http://localhost:8000. Tests: `node --test test.mjs`.
